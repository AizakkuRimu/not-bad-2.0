/* ============================================================
   SMARTBOT — Self-learning sentence categorisation system
   In-memory only. Export/Import for cross-session persistence.
   ============================================================ */
(function () {
  'use strict';

  /* ── STATE ─────────────────────────────────────────────────── */

  /* Taxonomy: array of { scheme, category, enquiry } */
  var SB_taxonomy = [];

  /* Custom sub-enquiries per "scheme||category||enquiry" key */
  var SB_subEnquiries = {}; /* key → string[] */

  /* Sentence DB: map of normalised text → record */
  /* record: { text, status:'pending'|'categorised'|'ignored',
               scheme, category, enquiry, subEnquiry,
               children: string[], sourceCount } */
  var SB_db = {};

  /* Review queue: array of texts from SB_db with status === 'pending' */
  var SB_queue = [];
  var SB_queueIdx = 0;

  /* Currently displayed sentence key */
  var SB_currentKey = null;

  /* Temp children list for current sentence being reviewed */
  var SB_tempChildren = [];

  /* ── HELPERS ────────────────────────────────────────────────── */
  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

  function escH(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg, type) {
    if (window.showToast) { window.showToast(msg, type); return; }
    var c = document.getElementById('toastContainer');
    if (!c) return;
    var t = document.createElement('div');
    t.className = 'toast' + (type ? ' toast-' + type : '');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }

  /* ── SENTENCE EXTRACTION ─────────────────────────────────────── */

  /* Phrases that mark an ignored sentence */
  var IGNORE_STARTS = [
    /^\s*dear\b/i,
    /^\s*we refer to\b/i,
    /^\s*we would be pleased\b/i,
    /^\s*we would be glad\b/i,
    /^\s*we would be happy\b/i,
    /^\s*yours sincerely\b/i,
    /^\s*yours faithfully\b/i,
    /^\s*thank you\b/i,
  ];

  function shouldIgnore(s) {
    s = s.trim();
    if (!s) return true;
    /* Less than 3 words */
    if (s.split(/\s+/).filter(Boolean).length < 3) return true;
    for (var i = 0; i < IGNORE_STARTS.length; i++) {
      if (IGNORE_STARTS[i].test(s)) return true;
    }
    return false;
  }

  /* Split a block of text into sentences */
  function splitSentences(text) {
    /* Split on . ! ? followed by space or end, but keep abbreviations reasonable */
    var raw = text.match(/[^.!?]+[.!?]*/g) || [text];
    var out = [];
    raw.forEach(function (s) {
      s = norm(s);
      if (s.length > 5) out.push(s);
    });
    return out;
  }

  /* Extract sentences from the Case Library (window.TL is not exposed,
     so we read from the rendered case list as a fallback,
     but we also expose a hook in caselibrary.js via window.tlGetAllCases) */
  function extractFromCaseLibrary() {
    var cases = [];
    /* Try the public API first */
    if (typeof window.tlGetAllCases === 'function') {
      cases = window.tlGetAllCases();
    } else {
      /* Fallback: scrape rendered text from the results list */
      var items = document.querySelectorAll('#tlResultsList .tl-result-item');
      items.forEach(function (el) {
        var cells = el.querySelectorAll('.tl-result-cell');
        if (cells.length > 0) {
          cases.push(cells[cells.length - 1].textContent);
        }
      });
    }

    var added = 0;
    var skipped = 0;

    cases.forEach(function (c) {
      var text = typeof c === 'string' ? c :
        (Array.isArray(c) ? c[c.length - 1] : '');
      if (!text) return;

      var sentences = splitSentences(text);
      sentences.forEach(function (s) {
        var key = norm(s);
        if (!key) return;

        /* Already in DB (any status) — skip */
        if (SB_db[key]) { skipped++; return; }

        if (shouldIgnore(key)) {
          /* Record as ignored immediately */
          SB_db[key] = { text: key, status: 'ignored', scheme: '', category: '',
            enquiry: '', subEnquiry: '', children: [], sourceCount: 1 };
          skipped++;
          return;
        }

        SB_db[key] = { text: key, status: 'pending', scheme: '', category: '',
          enquiry: '', subEnquiry: '', children: [], sourceCount: 1 };
        added++;
      });
    });

    rebuildQueue();
    return { added: added, skipped: skipped };
  }

  function rebuildQueue() {
    SB_queue = Object.keys(SB_db).filter(function (k) {
      return SB_db[k].status === 'pending';
    });
    /* Shuffle for variety */
    for (var i = SB_queue.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = SB_queue[i]; SB_queue[i] = SB_queue[j]; SB_queue[j] = tmp;
    }
    SB_queueIdx = 0;
  }

  /* ── TAXONOMY ────────────────────────────────────────────────── */

  function parseTaxonomy(raw) {
    var rows = raw.split('\n');
    var parsed = [];
    rows.forEach(function (row) {
      row = row.replace(/\r/g, '');
      if (!row.trim()) return;
      var cols = row.split('\t');
      if (cols.length < 3) {
        /* Try comma if no tabs (simple fallback) */
        cols = row.split(',');
      }
      if (cols.length < 3) return;
      var scheme   = norm(cols[0]);
      var category = norm(cols[1]);
      var enquiry  = norm(cols[2]);
      if (!scheme || !category || !enquiry) return;
      /* Deduplicate */
      var exists = parsed.some(function (p) {
        return p.scheme === scheme && p.category === category && p.enquiry === enquiry;
      });
      if (!exists) parsed.push({ scheme: scheme, category: category, enquiry: enquiry });
    });
    return parsed;
  }

  function getSchemes() {
    var s = {};
    SB_taxonomy.forEach(function (r) { s[r.scheme] = true; });
    return Object.keys(s).sort();
  }

  function getCategoriesForScheme(scheme) {
    var c = {};
    SB_taxonomy.forEach(function (r) {
      if (r.scheme === scheme) c[r.category] = true;
    });
    return Object.keys(c).sort();
  }

  function getEnquiriesForCat(scheme, category) {
    var e = {};
    SB_taxonomy.forEach(function (r) {
      if (r.scheme === scheme && r.category === category) e[r.enquiry] = true;
    });
    return Object.keys(e).sort();
  }

  function getSubEnquiries(scheme, category, enquiry) {
    var key = scheme + '||' + category + '||' + enquiry;
    return SB_subEnquiries[key] || [];
  }

  function addSubEnquiry(scheme, category, enquiry, value) {
    var key = scheme + '||' + category + '||' + enquiry;
    if (!SB_subEnquiries[key]) SB_subEnquiries[key] = [];
    value = norm(value);
    if (!value) return false;
    if (SB_subEnquiries[key].indexOf(value) !== -1) return false;
    SB_subEnquiries[key].push(value);
    return true;
  }

  /* ── DOM REFS ────────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  /* Review area */
  var elReviewEmpty   = $('sbReviewEmpty');
  var elReviewCard    = $('sbReviewCard');
  var elSentenceText  = $('sbSentenceText');
  var elSentenceMeta  = $('sbSentenceMeta');
  var elQueueBadge    = $('sbQueueBadge');
  var elSchemeSelect  = $('sbSchemeSelect');
  var elCategorySelect= $('sbCategorySelect');
  var elEnquirySelect = $('sbEnquirySelect');
  var elSubEnqSelect  = $('sbSubEnquirySelect');
  var elNewSubRow     = $('sbNewSubEnquiryRow');
  var elNewSubInput   = $('sbNewSubEnquiryInput');
  var elChildList     = $('sbChildList');
  var elChildInputRow = $('sbChildInputRow');
  var elChildInput    = $('sbChildInput');

  /* Taxonomy panel */
  var elTaxEmpty      = $('sbTaxEmpty');
  var elTaxTree       = $('sbTaxTree');
  var elTaxBadge      = $('sbTaxBadge');

  /* Viewer */
  var elViewerList    = $('sbViewerList');
  var elViewerEmpty   = $('sbViewerEmpty');
  var elViewerSearch  = $('sbViewerSearch');
  var elViewerScheme  = $('sbViewerSchemeFilter');
  var elViewerStatus  = $('sbViewerStatusFilter');
  var elViewerCount   = $('sbViewerCount');

  /* Modals */
  var elTaxModal      = $('sbTaxModal');
  var elTaxInput      = $('sbTaxInput');
  var elTaxStatus     = $('sbTaxStatus');
  var elTaxPreview    = $('sbTaxPreview');
  var elExportModal   = $('sbExportModal');
  var elImportModal   = $('sbImportModal');
  var elImportTa      = $('sbImportTa');
  var elImportStatus  = $('sbImportStatus');

  /* ── REVIEW UI ───────────────────────────────────────────────── */

  function updateQueueBadge() {
    var pending = Object.keys(SB_db).filter(function (k) { return SB_db[k].status === 'pending'; }).length;
    elQueueBadge.textContent = pending + ' remaining';
    elQueueBadge.style.background = pending > 0 ? '' : '#aaa';
  }

  function showNextSentence() {
    /* Rebuild queue each time to pick up newly extracted sentences */
    rebuildQueue();
    updateQueueBadge();
    updateViewerSchemeFilter();
    renderViewer();

    if (SB_queue.length === 0) {
      elReviewEmpty.style.display = '';
      elReviewCard.style.display = 'none';
      SB_currentKey = null;
      return;
    }

    /* Pick next */
    if (SB_queueIdx >= SB_queue.length) SB_queueIdx = 0;
    SB_currentKey = SB_queue[SB_queueIdx];
    SB_queueIdx++;

    var rec = SB_db[SB_currentKey];
    if (!rec) { showNextSentence(); return; }

    elReviewEmpty.style.display = 'none';
    elReviewCard.style.display = 'flex';
    elSentenceText.textContent = rec.text;
    elSentenceMeta.textContent = rec.sourceCount > 1 ? 'Appears in ' + rec.sourceCount + ' cases' : '';

    /* Reset form */
    SB_tempChildren = rec.children ? rec.children.slice() : [];
    populateSchemes();
    if (rec.scheme) {
      elSchemeSelect.value = rec.scheme;
      onSchemeChange();
      if (rec.category) {
        elCategorySelect.value = rec.category;
        onCategoryChange();
        if (rec.enquiry) {
          elEnquirySelect.value = rec.enquiry;
          onEnquiryChange();
          if (rec.subEnquiry) elSubEnqSelect.value = rec.subEnquiry;
        }
      }
    }
    renderChildList();
    elChildInputRow.style.display = 'none';
    elNewSubRow.style.display = 'none';
  }

  function populateSchemes() {
    elSchemeSelect.innerHTML = '<option value="">— Select —</option>';
    getSchemes().forEach(function (s) {
      var o = document.createElement('option');
      o.value = s; o.textContent = s;
      elSchemeSelect.appendChild(o);
    });
    elCategorySelect.innerHTML = '<option value="">— Select Scheme first —</option>';
    elCategorySelect.disabled = true;
    elEnquirySelect.innerHTML  = '<option value="">— Select Category first —</option>';
    elEnquirySelect.disabled   = true;
    elSubEnqSelect.innerHTML   = '<option value="">— None —</option><option value="__new__">＋ Add new…</option>';
  }

  function onSchemeChange() {
    var scheme = elSchemeSelect.value;
    elCategorySelect.innerHTML = '<option value="">— Select Category —</option>';
    elCategorySelect.disabled = !scheme;
    elEnquirySelect.innerHTML  = '<option value="">— Select Category first —</option>';
    elEnquirySelect.disabled   = true;
    elSubEnqSelect.innerHTML   = '<option value="">— None —</option><option value="__new__">＋ Add new…</option>';
    if (!scheme) return;
    getCategoriesForScheme(scheme).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      elCategorySelect.appendChild(o);
    });
  }

  function onCategoryChange() {
    var scheme   = elSchemeSelect.value;
    var category = elCategorySelect.value;
    elEnquirySelect.innerHTML = '<option value="">— Select Enquiry —</option>';
    elEnquirySelect.disabled  = !category;
    elSubEnqSelect.innerHTML  = '<option value="">— None —</option><option value="__new__">＋ Add new…</option>';
    if (!scheme || !category) return;
    getEnquiriesForCat(scheme, category).forEach(function (e) {
      var o = document.createElement('option');
      o.value = e; o.textContent = e;
      elEnquirySelect.appendChild(o);
    });
  }

  function onEnquiryChange() {
    var scheme   = elSchemeSelect.value;
    var category = elCategorySelect.value;
    var enquiry  = elEnquirySelect.value;
    elSubEnqSelect.innerHTML = '<option value="">— None —</option><option value="__new__">＋ Add new…</option>';
    if (!scheme || !category || !enquiry) return;
    getSubEnquiries(scheme, category, enquiry).forEach(function (s) {
      var o = document.createElement('option');
      o.value = s; o.textContent = s;
      elSubEnqSelect.appendChild(o);
    });
  }

  elSchemeSelect.addEventListener('change', onSchemeChange);
  elCategorySelect.addEventListener('change', onCategoryChange);
  elEnquirySelect.addEventListener('change', onEnquiryChange);

  elSubEnqSelect.addEventListener('change', function () {
    if (elSubEnqSelect.value === '__new__') {
      elNewSubRow.style.display = 'flex';
      elNewSubInput.focus();
    } else {
      elNewSubRow.style.display = 'none';
    }
  });

  $('sbSaveSubEnquiry').addEventListener('click', function () {
    var scheme   = elSchemeSelect.value;
    var category = elCategorySelect.value;
    var enquiry  = elEnquirySelect.value;
    var val      = norm(elNewSubInput.value);
    if (!scheme || !category || !enquiry || !val) {
      showToast('Please select Scheme, Category and Enquiry first, then type a name.', 'error');
      return;
    }
    if (addSubEnquiry(scheme, category, enquiry, val)) {
      onEnquiryChange();
      elSubEnqSelect.value = val;
      elNewSubRow.style.display = 'none';
      elNewSubInput.value = '';
      renderTaxonomy();
      showToast('Sub-Enquiry "' + val + '" saved!', 'success');
    } else {
      showToast('That Sub-Enquiry already exists.', 'error');
    }
  });

  /* Ignore button */
  $('sbIgnoreBtn').addEventListener('click', function () {
    if (!SB_currentKey || !SB_db[SB_currentKey]) return;
    SB_db[SB_currentKey].status = 'ignored';
    showToast('Sentence ignored.', '');
    showNextSentence();
  });

  /* Skip button */
  $('sbSkipBtn').addEventListener('click', function () {
    showNextSentence();
  });

  /* Categorise button */
  $('sbCategoriseBtn').addEventListener('click', function () {
    if (!SB_currentKey || !SB_db[SB_currentKey]) return;
    var scheme   = elSchemeSelect.value;
    var category = elCategorySelect.value;
    var enquiry  = elEnquirySelect.value;
    if (!scheme || !category || !enquiry) {
      showToast('Please select Scheme, Category and Enquiry.', 'error');
      return;
    }
    var subEnq = elSubEnqSelect.value === '__new__' ? '' : elSubEnqSelect.value;

    var rec = SB_db[SB_currentKey];
    rec.status    = 'categorised';
    rec.scheme    = scheme;
    rec.category  = category;
    rec.enquiry   = enquiry;
    rec.subEnquiry= subEnq;
    rec.children  = SB_tempChildren.slice();

    showToast('Categorised ✓', 'success');
    showNextSentence();
  });

  /* Extract buttons */
  function doExtract() {
    var result = extractFromCaseLibrary();
    if (result.added === 0 && result.skipped === 0) {
      showToast('No cases found in Case Library. Load cases first.', 'error');
      return;
    }
    showToast('Extracted ' + result.added + ' new sentence(s). ' + result.skipped + ' skipped.', 'success');
    showNextSentence();
  }
  $('sbExtractBtn').addEventListener('click', doExtract);
  $('sbExtractBtnCard').addEventListener('click', doExtract);

  /* ── CHILD SENTENCES ─────────────────────────────────────────── */

  function renderChildList() {
    elChildList.innerHTML = '';
    if (!SB_tempChildren.length) {
      elChildList.innerHTML = '<div style="font-size:11px; color:var(--sf-gray-5); font-style:italic;">No variations added yet.</div>';
      return;
    }
    SB_tempChildren.forEach(function (c, idx) {
      var chip = document.createElement('div');
      chip.className = 'sb-child-chip';
      chip.innerHTML = '<span class="sb-child-chip-text">' + escH(c) + '</span>' +
        '<button class="sb-child-chip-del" data-idx="' + idx + '" title="Remove">✕</button>';
      elChildList.appendChild(chip);
    });
  }

  elChildList.addEventListener('click', function (e) {
    var btn = e.target.closest('.sb-child-chip-del');
    if (!btn) return;
    var idx = parseInt(btn.dataset.idx, 10);
    SB_tempChildren.splice(idx, 1);
    renderChildList();
  });

  $('sbAddChildBtn').addEventListener('click', function () {
    elChildInputRow.style.display = 'flex';
    elChildInput.focus();
  });

  $('sbChildCancel').addEventListener('click', function () {
    elChildInputRow.style.display = 'none';
    elChildInput.value = '';
  });

  $('sbChildSave').addEventListener('click', function () {
    var val = norm(elChildInput.value);
    if (!val) return;
    if (SB_tempChildren.indexOf(val) === -1) {
      SB_tempChildren.push(val);
      renderChildList();
    }
    elChildInput.value = '';
    elChildInputRow.style.display = 'none';
  });

  /* ── TAXONOMY PANEL ──────────────────────────────────────────── */

  function renderTaxonomy() {
    if (!SB_taxonomy.length) {
      elTaxEmpty.style.display = '';
      elTaxTree.style.display = 'none';
      elTaxBadge.textContent = '';
      return;
    }

    elTaxEmpty.style.display = 'none';
    elTaxTree.style.display = 'flex';
    elTaxBadge.textContent = SB_taxonomy.length + ' rows';

    /* Build scheme → cat → enquiry map */
    var map = {};
    SB_taxonomy.forEach(function (r) {
      if (!map[r.scheme]) map[r.scheme] = {};
      if (!map[r.scheme][r.category]) map[r.scheme][r.category] = [];
      map[r.scheme][r.category].push(r.enquiry);
    });

    /* Count categorised sentences per enquiry */
    function countFor(scheme, cat, enq) {
      return Object.keys(SB_db).filter(function (k) {
        var r = SB_db[k];
        return r.status === 'categorised' && r.scheme === scheme && r.category === cat && r.enquiry === enq;
      }).length;
    }

    elTaxTree.innerHTML = '';
    Object.keys(map).sort().forEach(function (scheme) {
      var schemeDiv = document.createElement('div');
      schemeDiv.className = 'sb-tax-scheme';

      var hdr = document.createElement('div');
      hdr.className = 'sb-tax-scheme-hdr';
      hdr.innerHTML = '<span>▶</span><span style="flex:1;">' + escH(scheme) + '</span>';
      var schemeBody = document.createElement('div');
      schemeBody.className = 'sb-tax-scheme-body';

      hdr.addEventListener('click', function () {
        schemeBody.classList.toggle('open');
        hdr.querySelector('span').textContent = schemeBody.classList.contains('open') ? '▼' : '▶';
      });

      Object.keys(map[scheme]).sort().forEach(function (cat) {
        var catDiv = document.createElement('div');
        catDiv.className = 'sb-tax-cat';
        var catHdr = document.createElement('div');
        catHdr.className = 'sb-tax-cat-hdr';
        catHdr.innerHTML = '<span>▶</span><span style="flex:1;">' + escH(cat) + '</span>';
        var catBody = document.createElement('div');
        catBody.className = 'sb-tax-cat-body';

        catHdr.addEventListener('click', function () {
          catBody.classList.toggle('open');
          catHdr.querySelector('span').textContent = catBody.classList.contains('open') ? '▼' : '▶';
        });

        map[scheme][cat].sort().forEach(function (enq) {
          var cnt   = countFor(scheme, cat, enq);
          var enqEl = document.createElement('div');
          enqEl.className = 'sb-tax-enquiry';
          enqEl.innerHTML = escH(enq) + (cnt ? ' <span style="font-size:10px;background:#e8f0fe;color:#1a56ab;padding:1px 5px;border-radius:999px;font-weight:600;">' + cnt + '</span>' : '');
          catBody.appendChild(enqEl);

          /* Sub-enquiries */
          var subs = getSubEnquiries(scheme, cat, enq);
          subs.forEach(function (sub) {
            var subEl = document.createElement('div');
            subEl.className = 'sb-tax-sub';
            subEl.textContent = '↳ ' + sub;
            catBody.appendChild(subEl);
          });
        });

        catDiv.appendChild(catHdr);
        catDiv.appendChild(catBody);
        schemeBody.appendChild(catDiv);
      });

      schemeDiv.appendChild(hdr);
      schemeDiv.appendChild(schemeBody);
      elTaxTree.appendChild(schemeDiv);
    });
  }

  /* ── VIEWER ──────────────────────────────────────────────────── */

  function updateViewerSchemeFilter() {
    var cur = elViewerScheme.value;
    elViewerScheme.innerHTML = '<option value="">All Schemes</option>';
    getSchemes().forEach(function (s) {
      var o = document.createElement('option');
      o.value = s; o.textContent = s;
      elViewerScheme.appendChild(o);
    });
    elViewerScheme.value = cur;
  }

  function renderViewer() {
    var q      = (elViewerSearch.value || '').toLowerCase().trim();
    var scheme = elViewerScheme.value;
    var status = elViewerStatus.value;

    var keys = Object.keys(SB_db).filter(function (k) {
      var r = SB_db[k];
      if (status && r.status !== status) return false;
      if (scheme && r.scheme !== scheme) return false;
      if (q && r.text.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    elViewerCount.textContent = keys.length + ' sentence' + (keys.length !== 1 ? 's' : '');

    if (!keys.length) {
      elViewerList.innerHTML = '';
      elViewerEmpty.style.display = '';
      elViewerEmpty.textContent = Object.keys(SB_db).length ? 'No results match your filter.' : 'No sentences stored yet.';
      elViewerList.appendChild(elViewerEmpty);
      return;
    }

    elViewerEmpty.style.display = 'none';

    /* Sort: categorised first, then alphabetical */
    keys.sort(function (a, b) {
      var ra = SB_db[a], rb = SB_db[b];
      if (ra.status !== rb.status) {
        var ord = { categorised: 0, pending: 1, ignored: 2 };
        return (ord[ra.status] || 1) - (ord[rb.status] || 1);
      }
      return a < b ? -1 : a > b ? 1 : 0;
    });

    /* Only re-render if changed (basic perf) */
    elViewerList.innerHTML = '';

    keys.forEach(function (k) {
      var r = SB_db[k];
      var row = document.createElement('div');
      row.className = 'sb-viewer-row';

      var textEl = document.createElement('div');
      textEl.className = 'sb-viewer-row-text';
      /* Highlight search term */
      if (q) {
        var idx = r.text.toLowerCase().indexOf(q);
        if (idx >= 0) {
          textEl.innerHTML = escH(r.text.slice(0, idx)) +
            '<mark style="background:#fff3cd;">' + escH(r.text.slice(idx, idx + q.length)) + '</mark>' +
            escH(r.text.slice(idx + q.length));
        } else {
          textEl.textContent = r.text;
        }
      } else {
        textEl.textContent = r.text;
      }

      var tagsEl = document.createElement('div');
      tagsEl.className = 'sb-viewer-row-tags';

      if (r.status === 'ignored') {
        tagsEl.innerHTML = '<span class="sb-viewer-tag sb-viewer-tag-ignored">Ignored</span>';
      } else if (r.status === 'categorised') {
        if (r.scheme)    tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-scheme">' + escH(r.scheme) + '</span>';
        if (r.category)  tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-cat">' + escH(r.category) + '</span>';
        if (r.enquiry)   tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-enq">' + escH(r.enquiry) + '</span>';
        if (r.subEnquiry)tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-sub">' + escH(r.subEnquiry) + '</span>';
        if (r.children && r.children.length) {
          tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-children">+' + r.children.length + ' variation' + (r.children.length !== 1 ? 's' : '') + '</span>';
        }
      } else {
        tagsEl.innerHTML = '<span class="sb-viewer-tag" style="background:#f5f5f5;color:#aaa;">Pending</span>';
      }

      row.appendChild(textEl);
      row.appendChild(tagsEl);
      elViewerList.appendChild(row);
    });
  }

  elViewerSearch.addEventListener('input', renderViewer);
  elViewerScheme.addEventListener('change', renderViewer);
  elViewerStatus.addEventListener('change', renderViewer);

  /* ── TAXONOMY MODAL ──────────────────────────────────────────── */

  $('sbOpenImportTaxonomy').addEventListener('click', function () {
    elTaxModal.classList.add('open');
    elTaxInput.focus();
  });

  $('sbTaxModalClose').addEventListener('click', function () { elTaxModal.classList.remove('open'); });
  elTaxModal.addEventListener('click', function (e) { if (e.target === elTaxModal) elTaxModal.classList.remove('open'); });

  $('sbTaxClear').addEventListener('click', function () {
    elTaxInput.value = '';
    elTaxPreview.textContent = '';
    elTaxStatus.textContent = '';
  });

  elTaxInput.addEventListener('input', function () {
    var parsed = parseTaxonomy(elTaxInput.value);
    elTaxPreview.textContent = parsed.length ? parsed.length + ' rows detected (' + getUniqSchemes(parsed) + ' scheme' + (getUniqSchemes(parsed) !== 1 ? 's' : '') + ').' : '';
  });

  function getUniqSchemes(arr) {
    var s = {};
    arr.forEach(function (r) { s[r.scheme] = true; });
    return Object.keys(s).length;
  }

  $('sbTaxImport').addEventListener('click', function () {
    var parsed = parseTaxonomy(elTaxInput.value);
    if (!parsed.length) {
      elTaxStatus.textContent = '⚠ No valid rows found. Make sure columns are tab-separated.';
      return;
    }
    /* Merge, not replace */
    var added = 0;
    parsed.forEach(function (r) {
      var exists = SB_taxonomy.some(function (t) {
        return t.scheme === r.scheme && t.category === r.category && t.enquiry === r.enquiry;
      });
      if (!exists) { SB_taxonomy.push(r); added++; }
    });
    elTaxStatus.textContent = '✓ ' + added + ' rows added (' + (parsed.length - added) + ' already existed).';
    renderTaxonomy();
    populateSchemes();
    elTaxInput.value = '';
    showToast('Taxonomy imported: ' + added + ' rows added.', 'success');
    setTimeout(function () { elTaxModal.classList.remove('open'); }, 800);
  });

  /* ── EXPORT / IMPORT ─────────────────────────────────────────── */

  function exportData() {
    var payload = {
      v: 1,
      taxonomy: SB_taxonomy,
      subEnquiries: SB_subEnquiries,
      db: SB_db
    };
    return JSON.stringify(payload, null, 2);
  }

  function importData(raw) {
    var payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      return { ok: false, msg: 'Invalid JSON. Copy the full exported text.' };
    }
    if (!payload || payload.v !== 1) {
      return { ok: false, msg: 'Unrecognised format. Make sure you paste SmartBot export data.' };
    }

    var taxAdded = 0, dbAdded = 0, subAdded = 0;

    /* Taxonomy */
    if (Array.isArray(payload.taxonomy)) {
      payload.taxonomy.forEach(function (r) {
        if (!r.scheme || !r.category || !r.enquiry) return;
        var exists = SB_taxonomy.some(function (t) {
          return t.scheme === r.scheme && t.category === r.category && t.enquiry === r.enquiry;
        });
        if (!exists) { SB_taxonomy.push(r); taxAdded++; }
      });
    }

    /* Sub-enquiries */
    if (payload.subEnquiries && typeof payload.subEnquiries === 'object') {
      Object.keys(payload.subEnquiries).forEach(function (key) {
        if (!Array.isArray(payload.subEnquiries[key])) return;
        payload.subEnquiries[key].forEach(function (v) {
          if (!SB_subEnquiries[key]) SB_subEnquiries[key] = [];
          if (SB_subEnquiries[key].indexOf(v) === -1) {
            SB_subEnquiries[key].push(v);
            subAdded++;
          }
        });
      });
    }

    /* DB */
    if (payload.db && typeof payload.db === 'object') {
      Object.keys(payload.db).forEach(function (k) {
        if (SB_db[k]) return; /* skip existing */
        var r = payload.db[k];
        if (!r || !r.text) return;
        SB_db[k] = {
          text: r.text,
          status: r.status || 'pending',
          scheme: r.scheme || '',
          category: r.category || '',
          enquiry: r.enquiry || '',
          subEnquiry: r.subEnquiry || '',
          children: Array.isArray(r.children) ? r.children : [],
          sourceCount: r.sourceCount || 1
        };
        dbAdded++;
      });
    }

    return {
      ok: true,
      msg: taxAdded + ' taxonomy rows, ' + subAdded + ' sub-enquiries, ' + dbAdded + ' sentences imported.'
    };
  }

  /* ── BATCH EXPORT ────────────────────────────────────────────── */

  var _sbBatchSize = 50;

  /* Build one batch payload: taxonomy + subEnquiries always included,
     db is a slice of dbKeys[start..end] */
  function exportBatch(dbKeys, start, end) {
    var sliceDb = {};
    dbKeys.slice(start, end).forEach(function (k) { sliceDb[k] = SB_db[k]; });
    return JSON.stringify({
      v: 1,
      taxonomy: SB_taxonomy,
      subEnquiries: SB_subEnquiries,
      db: sliceDb
    });
  }

  function renderBatchButtons() {
    var container   = $('sbBatchButtons');
    var totalEl     = $('sbExportTotalCount');
    if (!container) return;

    var dbKeys = Object.keys(SB_db);
    var total  = dbKeys.length;
    if (totalEl) totalEl.textContent = total + ' sentence' + (total !== 1 ? 's' : '') + ' total';

    if (!total) {
      container.innerHTML = '<div style="font-size:12px; color:var(--sf-gray-5); font-style:italic;">No sentences in the database yet.</div>';
      return;
    }

    var numBatches = Math.ceil(total / _sbBatchSize);
    container.innerHTML = '';

    for (var i = 0; i < numBatches; i++) {
      var start = i * _sbBatchSize;
      var end   = Math.min(start + _sbBatchSize, total);
      var label = 'Batch ' + (i + 1);

      (function (bStart, bEnd, bLabel) {
        var btn = document.createElement('button');
        btn.className = 'tl-batch-btn';
        btn.innerHTML =
          '<span class="tl-batch-btn-label">' + escH(bLabel) + '</span>' +
          '<span class="tl-batch-btn-range">sentences ' + (bStart + 1) + '\u2013' + bEnd + ' of ' + total + '</span>' +
          '<span class="tl-batch-btn-action">\uD83D\uDCCB Copy</span>';

        btn.addEventListener('click', function () {
          var text = exportBatch(dbKeys, bStart, bEnd);
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity  = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);

          btn.classList.add('copied');
          btn.querySelector('.tl-batch-btn-action').textContent = '\u2713 Copied!';
          setTimeout(function () {
            btn.classList.remove('copied');
            btn.querySelector('.tl-batch-btn-action').textContent = '\uD83D\uDCCB Copy';
          }, 2000);
          showToast(bLabel + ' copied!', 'success');
        });

        container.appendChild(btn);
      })(start, end, label);
    }
  }

  /* Batch size pills */
  document.addEventListener('click', function (e) {
    var pill = e.target.closest('#sbBatchSizePills .tl-batch-pill');
    if (!pill) return;
    var pills = document.querySelectorAll('#sbBatchSizePills .tl-batch-pill');
    pills.forEach(function (p) { p.classList.remove('active'); });
    pill.classList.add('active');
    _sbBatchSize = parseInt(pill.dataset.size, 10);
    renderBatchButtons();
  });

  var sbBatchCustomApplyEl = $('sbBatchCustomApply');
  if (sbBatchCustomApplyEl) {
    sbBatchCustomApplyEl.addEventListener('click', function () {
      var customEl = $('sbBatchCustom');
      var v = customEl ? parseInt(customEl.value, 10) : 0;
      if (!v || v < 1) return;
      var pills = document.querySelectorAll('#sbBatchSizePills .tl-batch-pill');
      pills.forEach(function (p) { p.classList.remove('active'); });
      _sbBatchSize = v;
      renderBatchButtons();
    });
  }

  $('sbOpenBatchExport').addEventListener('click', function () {
    renderBatchButtons();
    elExportModal.classList.add('open');
  });

  $('sbExportModalClose').addEventListener('click', function () { elExportModal.classList.remove('open'); });
  $('sbExportModalClose2').addEventListener('click', function () { elExportModal.classList.remove('open'); });
  elExportModal.addEventListener('click', function (e) { if (e.target === elExportModal) elExportModal.classList.remove('open'); });

  $('sbOpenBatchImport').addEventListener('click', function () {
    elImportTa.value = '';
    elImportStatus.textContent = '';
    elImportModal.classList.add('open');
    elImportTa.focus();
  });

  $('sbImportModalClose').addEventListener('click', function () { elImportModal.classList.remove('open'); });
  $('sbImportModalClose2').addEventListener('click', function () { elImportModal.classList.remove('open'); });
  elImportModal.addEventListener('click', function (e) { if (e.target === elImportModal) elImportModal.classList.remove('open'); });

  $('sbImportLoad').addEventListener('click', function () {
    var result = importData(elImportTa.value.trim());
    elImportStatus.textContent = (result.ok ? '✓ ' : '⚠ ') + result.msg;
    if (result.ok) {
      renderTaxonomy();
      rebuildQueue();
      updateQueueBadge();
      renderViewer();
      updateViewerSchemeFilter();
      populateSchemes();
      showToast(result.msg, 'success');
      setTimeout(function () { elImportModal.classList.remove('open'); }, 1000);
    }
  });

  /* ── PUBLIC API FOR CASELIBRARY.JS ───────────────────────────── */
  /* Expose a hook so caselibrary can tell SmartBot when cases change */
  window.sbOnCasesUpdated = function () {
    /* If SmartBot tab is visible, re-extract */
    var sbEl = document.getElementById('viewSmartBot');
    if (sbEl && sbEl.classList.contains('tl-active')) {
      /* Don't auto-extract silently — user needs to press Extract */
    }
  };

  /* Called when SmartBot tab is opened */
  window.sbOnTabOpen = function () {
    renderTaxonomy();
    updateQueueBadge();
    renderViewer();
    updateViewerSchemeFilter();
    if (!SB_currentKey && SB_queue.length === 0) {
      elReviewEmpty.style.display = '';
      elReviewCard.style.display = 'none';
    }
  };

  /* ── INIT ────────────────────────────────────────────────────── */
  (function init() {
    updateQueueBadge();
    renderViewer();
  })();

})();
