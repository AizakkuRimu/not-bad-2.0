/* ============================================================
   CASE LIBRARY — in-memory only, zero persistence
   Refresh / close = all data gone.
   ============================================================ */
(function () {

  /* ── STATE ─────────────────────────────────────────────────── */
  var TL = { cases: [], filtered: [], selectedId: null };

  /* Tag state */
  var _activeTags = new Set();   /* tags currently selected for filtering — empty = show all */
  var _tagColors  = {};          /* tag name → hsl color string */
  var _tagPalette = [
    '#0176d3','#2e844a','#7526e3','#dd7a01','#ba0517',
    '#14b8a6','#ec4899','#f59e0b','#6366f1','#059669',
    '#dc2626','#8b5cf6','#0891b2','#65a30d','#d97706'
  ];
  var _tagColorIdx = 0;

  function getTagColor(tag) {
    if (!_tagColors[tag]) {
      _tagColors[tag] = _tagPalette[_tagColorIdx % _tagPalette.length];
      _tagColorIdx++;
    }
    return _tagColors[tag];
  }

  /* ── DOM ────────────────────────────────────────────────────── */
  var modalOverlay  = document.getElementById('tlModalOverlay');
  var modalClose    = document.getElementById('tlModalClose');
  var pasteTa       = document.getElementById('tlPasteTa');
  var modalParse    = document.getElementById('tlModalParse');
  var modalClearTa  = document.getElementById('tlModalClearTa');
  var modalStatus   = document.getElementById('tlModalStatus');
  var openPasteBtn  = document.getElementById('tlOpenPaste');
  var searchInput   = document.getElementById('tlSearchInput');
  var resultsList   = document.getElementById('tlResultsList');
  var previewBody   = document.getElementById('tlPreviewBody');
  var previewFooter = document.getElementById('tlPreviewFooter');
  var useBtn        = document.getElementById('tlUseBtn');
  var copyBtn       = document.getElementById('tlCopyBtn');
  var badge         = document.getElementById('tlBadge');
  var clearAllBtn   = document.getElementById('tlClearAll');
  var copyLibBtn    = document.getElementById('tlCopyLib');
  var resultCount   = document.getElementById('tlResultCount');
  var subCount      = document.getElementById('tlSubCount');
  var batchTagInput = document.getElementById('tlBatchTagInput');

  /* ── TAB SWITCH ─────────────────────────────────────────────── */
  window.tlSwitchTab = function (tab) {
    var editorEl  = document.getElementById('sfContent');
    var drawerEl  = document.getElementById('sfDrawer');
    var libEl     = document.getElementById('viewTemplates');
    var sbEl      = document.getElementById('viewSmartBot');
    var tabEd     = document.getElementById('tabEditor');
    var tabTpl    = document.getElementById('tabTemplates');
    var tabSB     = document.getElementById('tabSmartBot');
    if (!editorEl || !drawerEl || !libEl || !tabEd || !tabTpl) {
      console.error('[tlSwitchTab] One or more elements not found - aborting.');
      return;
    }
    /* Reset all first */
    editorEl.style.display = 'none';
    drawerEl.style.display = 'none';
    libEl.classList.remove('tl-active');
    if (sbEl) sbEl.classList.remove('tl-active');
    tabEd.classList.remove('active');
    tabTpl.classList.remove('active');
    if (tabSB) tabSB.classList.remove('active');

    if (tab === 'templates') {
      libEl.classList.add('tl-active');
      tabTpl.classList.add('active');
    } else if (tab === 'smartbot') {
      if (sbEl) sbEl.classList.add('tl-active');
      if (tabSB) tabSB.classList.add('active');
      if (window.sbOnTabOpen) window.sbOnTabOpen();
    } else {
      editorEl.style.display = '';
      drawerEl.style.display = '';
      tabEd.classList.add('active');
    }
  };

  /* ── MULTI-BOX PASTE STATE ────────────────────────────────── */
  var _boxCount = 1;  // number of paste boxes currently shown

  /* Get all textarea values joined — treats all boxes as one big paste */
  function getAllPasteText() {
    var parts = [];
    document.getElementById('tlPasteBoxes').querySelectorAll('.tl-paste-box').forEach(function (box) {
      var ta = box.querySelector('textarea');
      if (ta && ta.value.trim()) parts.push(ta.value.trim());
    });
    return parts.join('\n\n\n');
  }

  /* ── MODAL OPEN / CLOSE ─────────────────────────────────────── */
  openPasteBtn.addEventListener('click', function () {
    modalStatus.textContent = '🔒 Nothing is stored or sent — data lives only in this browser tab.';
    modalOverlay.classList.add('open');
    setTimeout(function () { pasteTa.focus(); }, 120);
  });
  /* Reset paste boxes to just box 1, cleared */
  function resetPasteBoxes() {
    var container = document.getElementById('tlPasteBoxes');
    container.querySelectorAll('.tl-paste-box').forEach(function (box, i) {
      if (i > 0) box.remove();
    });
    pasteTa.value = '';
    var ct1 = document.getElementById('tlPasteCount_1');
    if (ct1) ct1.textContent = '';
    var total = document.getElementById('tlTotalDetected');
    if (total) total.textContent = '';
    _boxCount = 1;
  }

  function closeModal() {
    modalOverlay.classList.remove('open');
    resetPasteBoxes();
    if (batchTagInput) batchTagInput.value = '';
  }
  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', function (e) { if (e.target === modalOverlay) closeModal(); });

  /* Clear All — clears every box */
  modalClearTa.addEventListener('click', function () {
    document.getElementById('tlPasteBoxes').querySelectorAll('.tl-paste-box').forEach(function (box) {
      var ta = box.querySelector('textarea');
      if (ta) ta.value = '';
      var ct = box.querySelector('.tl-paste-box-count');
      if (ct) ct.textContent = '';
    });
    var total = document.getElementById('tlTotalDetected');
    if (total) total.textContent = '';
    modalStatus.textContent = 'Cleared.';
    pasteTa.focus();
  });

  /* Renumber visible box labels to always read Batch 1, 2, 3… */
  function renumberBoxLabels() {
    document.getElementById('tlPasteBoxes').querySelectorAll('.tl-paste-box').forEach(function (box, i) {
      var label = box.querySelector('.tl-paste-box-label');
      if (label) label.textContent = 'Batch ' + (i + 1);
    });
    _boxCount = document.getElementById('tlPasteBoxes').querySelectorAll('.tl-paste-box').length;
  }

  /* ── ADD BATCH BOX ──────────────────────────────────────────── */
  document.getElementById('tlAddBatch').addEventListener('click', function () {
    _boxCount++;
    var boxId   = _boxCount;
    var taId    = 'tlPasteTa_' + boxId;
    var countId = 'tlPasteCount_' + boxId;

    var box = document.createElement('div');
    box.className = 'tl-paste-box';
    box.id = 'tlPasteBox_' + boxId;

    var hdr = document.createElement('div');
    hdr.className = 'tl-paste-box-hdr';
    hdr.innerHTML =
      '<span class="tl-paste-box-label">Batch ' + boxId + '</span>' +
      '<span class="tl-paste-box-count" id="' + countId + '"></span>' +
      '<button class="tl-paste-box-remove" title="Remove this box" data-box="' + boxId + '">✕</button>';

    var ta = document.createElement('textarea');
    ta.className = 'tl-paste-ta tl-paste-ta-narrow';
    ta.id = taId;
    ta.dataset.box = boxId;
    ta.placeholder = 'Ctrl+V to paste…';
    ta.spellcheck = false;

    box.appendChild(hdr);
    box.appendChild(ta);

    document.getElementById('tlPasteBoxes').appendChild(box);

    /* Wire up events for new textarea */
    wireTextarea(ta, countId);

    /* Scroll new box into view */
    setTimeout(function () { box.scrollIntoView({ behavior: 'smooth', inline: 'end' }); ta.focus(); }, 60);
  });

  /* Remove box button (delegated) */
  document.getElementById('tlPasteBoxes').addEventListener('click', function (e) {
    var btn = e.target.closest('.tl-paste-box-remove');
    if (!btn) return;
    var boxId = btn.dataset.box;
    var box = document.getElementById('tlPasteBox_' + boxId);
    if (box) box.remove();
    renumberBoxLabels();
    updateTotalCount();
  });

  /* ── URL NORMALISER ─────────────────────────────────────────── */
  function normalizeUrl(url) {
    url = url.trim();
    if (/^http:\/\//i.test(url)) url = 'https://' + url.slice(7);
    if (/^https:\/\/(?!www\.)/i.test(url)) url = url.replace(/^https:\/\//i, 'https://www.');
    return url;
  }
  function normalizeUrlsInText(text) {
    return text.replace(/\bhttps?:\/\/[^\s\]>)"'']*/gi, function (u) { return normalizeUrl(u); });
  }

  /* ── WIRE A TEXTAREA (live count + paste handler) ───────────── */
  function wireTextarea(ta, countId) {
    /* Live per-box count */
    var _timer = null;
    function updateBoxCount() {
      clearTimeout(_timer);
      _timer = setTimeout(function () {
        var val = ta.value.trim();
        var ct = document.getElementById(countId);
        if (!ct) return;
        if (!val) { ct.textContent = ''; updateTotalCount(); return; }
        var isCol = /^Column\s*\(1\)\s*:/m.test(val);
        var n = isCol ? parseColumnFormat(val).length : parseCaseBlocks(val).length;
        ct.textContent = n ? n + ' case' + (n !== 1 ? 's' : '') + ' detected' : '⚠️ None detected';
        updateTotalCount();
      }, 250);
    }
    ta.addEventListener('input', updateBoxCount);

    /* Rich paste handler (strips Word HTML → plain text) */
    ta.addEventListener('paste', function (e) {
      var html = e.clipboardData && e.clipboardData.getData('text/html');
      if (!html) return;
      e.preventDefault();
      requestAnimationFrame(function () {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var result = (tmp.innerText || tmp.textContent || '').replace(/\r\n/g, '\n');
        result = normalizeUrlsInText(result);
        var start = ta.selectionStart;
        var end   = ta.selectionEnd;
        ta.value = ta.value.slice(0, start) + result + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + result.length;
        updateBoxCount();
      });
    });
  }

  /* Wire the first (default) box */
  wireTextarea(pasteTa, 'tlPasteCount_1');

  /* ── TOTAL CASE COUNT ACROSS ALL BOXES ──────────────────────── */
  function updateTotalCount() {
    var combined = getAllPasteText();
    var total = document.getElementById('tlTotalDetected');
    if (!total) return;
    if (!combined) { total.textContent = ''; updateStatus(); return; }
    var isCol = /^Column\s*\(1\)\s*:/m.test(combined);
    var n = isCol ? parseColumnFormat(combined).length : parseCaseBlocks(combined).length;
    total.textContent = n ? 'Total across all boxes: ' + n + ' case' + (n !== 1 ? 's' : '') : '';
    updateStatus(combined);
  }

  /* ── LIVE STATUS (bottom of modal) ─────────────────────────── */
  var _statusTimer = null;
  function updateStatus(combined) {
    clearTimeout(_statusTimer);
    _statusTimer = setTimeout(function () {
      var val = combined !== undefined ? combined : getAllPasteText();
      if (!val) { modalStatus.textContent = '🔒 Nothing stored or sent.'; return; }
      if (/^Column\s*\(1\)\s*:/m.test(val)) {
        var colCases = parseColumnFormat(val);
        modalStatus.textContent = '📥 Library backup detected — ' + colCases.length + ' case(s). Click ⚡ Parse to restore.';
        return;
      }
      var blocks = parseCaseBlocks(val);
      if (blocks.length) {
        modalStatus.textContent = '✅ ' + blocks.length + ' case letter' + (blocks.length !== 1 ? 's' : '') + ' ready to parse.';
      } else if (/Dear\b/i.test(val)) {
        modalStatus.textContent = '⚠️ Found "Dear" but no recognised closing phrase.';
      } else {
        modalStatus.textContent = '⚠️ No case letters found — paste letters starting with "Dear".';
      }
    }, 200);
  }

    /* ── PARSE ──────────────────────────────────────────────────── */
  modalParse.addEventListener('click', doParse);
  pasteTa.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doParse();
  });

  function doParse() {
    var raw = getAllPasteText();
    if (!raw) { modalStatus.textContent = '⚠️ Nothing pasted yet.'; return; }

    /* Read the tag name (trimmed, or empty string if blank) */
    var batchTag = batchTagInput ? batchTagInput.value.trim() : '';

    /* ── Column-format library restore ───────────────────────────
       Detects the exported "Column (1): ..." plain-text format.
       Each case is separated by a line containing only "---".    */
    if (/^Column\s*\(1\)\s*:/m.test(raw)) {
      var restoredCases = parseColumnFormat(raw);
      if (restoredCases.length) {
        var startIdR = TL.cases.length;
        restoredCases.forEach(function (cells, i) {
          TL.cases.push({ id: 'c' + (startIdR + i), cells: cells, tag: batchTag });
        });
        if (batchTag) getTagColor(batchTag); /* ensure color assigned */
        updateBadge();
        applySearch();
        searchInput.disabled = false;
        closeModal();
        showToast('📥 ' + restoredCases.length + ' case(s) restored — ' + TL.cases.length + ' total' + (batchTag ? ' [' + batchTag + ']' : ''), 'success');
        return;
      }
    }

    /* ── Letter block parser ──────────────────────────────────── */
    var rows = parseCaseBlocks(raw);
    if (!rows.length) {
      modalStatus.textContent = '⚠️ No cases found. Make sure each case has a code number (e.g. XXXXXXXX-XXXXXXX) and that the last column starts with "Dear" and ends with a recognised closing phrase (any number of columns is fine).';
      return;
    }

    var startId = TL.cases.length;
    rows.forEach(function (cells, i) {
      TL.cases.push({ id: 'c' + (startId + i), cells: cells, tag: batchTag });
    });
    if (batchTag) getTagColor(batchTag); /* ensure color assigned */

    updateBadge();
    applySearch();
    searchInput.disabled = false;
    closeModal();
    showToast('✅ ' + rows.length + ' case' + (rows.length !== 1 ? 's' : '') + ' added — ' + TL.cases.length + ' total' + (batchTag ? ' [' + batchTag + ']' : ''), 'success');
  }

  /* ══════════════════════════════════════════════════════════════
     CASE LETTER PARSER  (Word / Excel paste)
     ══════════════════════════════════════════════════════════════

     Rules (in order):

     1.  Normalise line endings → \n. Strip trailing whitespace from
         every line. Collapse blank lines that contain only spaces to
         truly empty lines.

     2.  Find every occurrence of a line that CONTAINS 8digits-7digits
         anywhere in it. That is the case-ID line. Extract just the
         numeric code (8d-7d) as Column 1.

     3.  The GROUP for a case = everything from the end of the ID line
         to just before the next ID line (or end of text).

     4.  Within the group, split on 2+ consecutive blank lines.
         Each split segment = one column (2, 3, 4 … N).

     5.  Find the segment that starts with "Dear" (after trimming).
         All segments from that point onward are joined with \n\n
         — this is the LETTER column (always the last column).

     6.  Trim the letter to its closing phrase:
           • "Yours sincerely" (priority) — keep up to 6 trailing lines
           • "Yours faithfully"           — keep up to 6 trailing lines
           • "We would be …"             — keep to end of that sentence
         Use the LAST occurrence found (latest position in text).

     7.  Clean each non-letter column:
           • Remove any single line break that has text on both sides
             (soft-wrap) — replace with a single space.
           • Collapse multiple spaces to one.
           • Trim leading/trailing whitespace.

     8.  Clean the letter column:
           • Within each paragraph (text between blank lines), remove
             single line breaks that have text on both sides — replace
             with a single space.
           • Keep blank lines between paragraphs (they are \n\n).
           • Collapse 3+ consecutive newlines to \n\n.
           • Trim leading/trailing whitespace.

     9.  Skip any case where no Dear column is found.
  ══════════════════════════════════════════════════════════════ */

  /* ── Closing-phrase detector ──────────────────────────────── */
  function findClosingEnd(text) {
    /* Priority 1: Yours sincerely / faithfully + up to 6 trailing lines */
    var sincerelyRe = /Yours (?:sincerely|faithfully)[^\n]*(?:\n[^\n]*){0,6}/gi;
    /* Priority 2: We would be … (to end of that sentence/line) */
    var weWouldRe   = /We would be\b[^\n]*/gi;
    /* Priority 3: "Thank you" as a standalone closing line — only when it is the
       ENTIRE line (just the two words, optional trailing punctuation, nothing else).
       This prevents "Thank you for your feedback..." from being treated as a closing. */
    var thankYouRe  = /^Thank you[.,!]?\s*(?:\n[^\n]*){0,6}/gim;

    var best = -1;

    /* Check sincerely first — it takes priority */
    sincerelyRe.lastIndex = 0;
    var m;
    while ((m = sincerelyRe.exec(text)) !== null) {
      var e = m.index + m[0].length;
      if (e > best) best = e;
    }

    /* Only fall back to "We would be" if no sincerely found */
    if (best === -1) {
      weWouldRe.lastIndex = 0;
      while ((m = weWouldRe.exec(text)) !== null) {
        var e2 = m.index + m[0].length;
        if (e2 > best) best = e2;
      }
    }

    /* Fall back to "Thank you" if neither sincerely nor We would be found */
    if (best === -1) {
      thankYouRe.lastIndex = 0;
      while ((m = thankYouRe.exec(text)) !== null) {
        var e4 = m.index + m[0].length;
        if (e4 > best) best = e4;
      }
    }

    /* Final fallback: gov.sg domain line */
    if (best === -1) {
      var cpfRe = /(?:visit|refer to|available at)\s+(?:www\.)?cpf\.gov\.sg[^\n]*/gi;
      cpfRe.lastIndex = 0;
      while ((m = cpfRe.exec(text)) !== null) {
        var e3 = m.index + m[0].length;
        if (e3 > best) best = e3;
      }
    }

    return best;
  }

  /* ── Clean a non-letter column ────────────────────────────── */
  function cleanNonLetterCol(text) {
    /* Remove soft-wrap line breaks: \n where both sides have text */
    text = text.replace(/([^\n])\n([^\n])/g, '$1 $2');
    /* Collapse multiple spaces */
    text = text.replace(/  +/g, ' ');
    return text.trim();
  }

  /* ── Clean the letter column ──────────────────────────────── */
  function cleanLetterCol(text) {
    /* Split into paragraphs on blank lines */
    var paras = text.split(/\n{2,}/);
    paras = paras.map(function (para) {
      /* Within each paragraph, remove soft-wrap line breaks */
      para = para.replace(/([^\n])\n([^\n])/g, '$1 $2');
      /* Collapse multiple spaces */
      para = para.replace(/  +/g, ' ');
      return para.trim();
    }).filter(function (p) { return p.length > 0; });
    return paras.join('\n\n').trim();
  }

  /* ── Main parser ──────────────────────────────────────────── */
  function parseCaseBlocks(rawText) {
    var blocks = [];

    /* Step 1 — normalise */
    var prepped = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(function (line) { return line.trimRight ? line.trimRight() : line.replace(/\s+$/, ''); })
      .join('\n');

    /* Step 2 — find all lines containing 8digits-7digits */
    var CODE_LINE_RE = /^.*?(\d{8}-\d{7}).*$/gm;
    var codes = [];
    var m;
    while ((m = CODE_LINE_RE.exec(prepped)) !== null) {
      codes.push({
        code     : m[1],
        lineStart: m.index,
        lineEnd  : m.index + m[0].length
      });
    }

    if (!codes.length) return blocks;

    /* Step 3 — slice groups */
    for (var ci = 0; ci < codes.length; ci++) {
      var groupStart = codes[ci].lineEnd;
      var groupEnd   = ci + 1 < codes.length ? codes[ci + 1].lineStart : prepped.length;
      var group      = prepped.slice(groupStart, groupEnd);

      /* Step 4 — split on 2+ blank lines → raw column segments */
      var segments = group.split(/\n{2,}/);
      segments = segments
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s.length > 0; });

      if (!segments.length) continue;

      /* Step 5 — find the Dear segment */
      var dearIdx = -1;
      for (var di = 0; di < segments.length; di++) {
        if (/^\s*Dear\b/i.test(segments[di])) { dearIdx = di; break; }
      }
      if (dearIdx === -1) continue;

      /* Join all segments from dearIdx onward as the letter */
      var rawLetter = segments.slice(dearIdx).join('\n\n');

      /* Step 6 — trim to closing phrase */
      var closeEnd = findClosingEnd(rawLetter);
      if (closeEnd === -1) continue;
      rawLetter = rawLetter.slice(0, closeEnd);

      /* Step 7 — clean non-letter columns */
      var displayCells = [codes[ci].code];
      for (var si = 0; si < dearIdx; si++) {
        displayCells.push(cleanNonLetterCol(segments[si]));
      }

      /* Step 8 — clean letter column */
      var cleanLetter = cleanLetterCol(rawLetter);
      if (!cleanLetter) continue;
      displayCells.push(cleanLetter);

      blocks.push(displayCells);
    }

    return blocks;
  }

  /* ── Column-format export parser (for re-import) ─────────── */
  /*
     Expected format per case:
       Column (1): <value>
       Column (2): <value, possibly multiline>
       ...
       ---
     Each column value runs until the next "Column (N):" line or "---".
  */
  function parseColumnFormat(rawText) {
    var cases = [];
    /* Split into case blocks on lines that are exactly "---" */
    var caseBlocks = rawText.split(/^---$/m);
    caseBlocks.forEach(function (block) {
      block = block.trim();
      if (!block) return;

      var cells = [];
      /* Match each "Column (N): " header and capture everything until
         the next "Column (" header or end of block */
      var COL_RE = /^Column\s*\(\d+\)\s*:\s*/m;
      /* Split on lines that start with "Column (N):" */
      var parts = block.split(/^(?=Column\s*\(\d+\)\s*:)/m);
      parts.forEach(function (part) {
        part = part.trim();
        if (!part) return;
        /* Strip the "Column (N): " prefix */
        var val = part.replace(/^Column\s*\(\d+\)\s*:\s*/, '').trim();
        cells.push(val);
      });

      if (cells.length >= 2) cases.push(cells);
    });
    return cases;
  }

  /* ── SEARCH ─────────────────────────────────────────────────── */
  searchInput.addEventListener('input', applySearch);

  function applySearch() {
    var q = searchInput.value.trim().toLowerCase();
    var tagFilter = _activeTags.size > 0;

    TL.filtered = TL.cases.filter(function (c) {
      /* Tag filter */
      if (tagFilter && !_activeTags.has(c.tag || '')) return false;
      /* Text search */
      if (!q) return true;
      return c.cells.some(function (cell) {
        return cell.toLowerCase().indexOf(q) !== -1;
      });
    });
    renderResults(TL.filtered, searchInput.value.trim());
  }

  /* ── RENDER RESULTS ─────────────────────────────────────────── */
  function renderResults(cases, query) {
    var q = (query || '').trim().toLowerCase();
    resultCount.textContent = cases.length + ' / ' + TL.cases.length;
    subCount.textContent = cases.length + ' shown';

    if (!cases.length) {
      resultsList.innerHTML = '';
      var d = document.createElement('div');
      d.className = 'tl-empty';
      if (!TL.cases.length) {
        d.innerHTML = '<div class="tl-empty-icon">📋</div><div class="tl-empty-ttl">No cases loaded yet</div><div class="tl-empty-sub">Click <strong>＋ Paste Cases</strong> and paste your case table text. Any number of columns is supported — the <strong>last column</strong> is always used as the letter body. Each case needs a <strong>code number</strong> (e.g. <em>XXXXXXXX-XXXXXXX</em>) and the letter must start with <strong>Dear</strong> and end with <em>We would be pleased…</em>, <em>We would be glad…</em>, or <em>Yours sincerely</em>.</div>';
      } else {
        d.innerHTML = '<div class="tl-empty-icon">🔍</div><div class="tl-empty-ttl">No matches</div><div class="tl-empty-sub">Try a different keyword.</div>';
      }
      resultsList.appendChild(d);
      return;
    }

    var frag = document.createDocumentFragment();
    cases.forEach(function (c, idx) {
      frag.appendChild(buildCard(c, idx, q));
    });
    resultsList.innerHTML = '';
    resultsList.appendChild(frag);
  }

  function escH(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function hlText(text, q) {
    if (!q) return escH(text);
    var safe  = escH(text);
    var safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp('(' + safeQ + ')', 'gi'), '<span class="tl-hl">$1</span>');
  }

  /* ── BUILD CARD ─────────────────────────────────────────────── */
  function buildCard(c, idx, q) {
    var lastIdx = c.cells.length - 1;
    var titleCell = c.cells.find(function (cl) { return cl.trim(); }) || '';

    var card = document.createElement('div');
    card.className = 'tl-card' + (TL.selectedId === c.id ? ' tl-selected' : '');
    card.dataset.id = c.id;

    // Tag pill HTML
    var tagHtml = '';
    if (c.tag) {
      var tc = getTagColor(c.tag);
      tagHtml = '<span class="tl-card-tag" style="background:' + tc + '22; color:' + tc + '; border:1px solid ' + tc + '44;">' + escH(c.tag) + '</span>';
    }

    // Header
    var hdr = document.createElement('div');
    hdr.className = 'tl-card-hdr';
    hdr.innerHTML =
      '<span class="tl-card-num">#' + (idx + 1) + '</span>' +
      '<span class="tl-card-title">' + hlText(String(titleCell).slice(0, 120), q) + tagHtml + '</span>' +
      '<span class="tl-card-cols">' + c.cells.length + ' col' + (c.cells.length !== 1 ? 's' : '') + '</span>';
    card.appendChild(hdr);

    // Chips
    var chips = document.createElement('div');
    chips.className = 'tl-card-chips';
    c.cells.forEach(function (cell, ci) {
      if (!cell.trim()) return;
      var chip = document.createElement('span');
      chip.className = 'tl-chip' + (ci === lastIdx ? ' tl-last' : '');
      chip.title = cell;
      chip.innerHTML = hlText(cell.slice(0, 55) + (cell.length > 55 ? '…' : ''), q);
      chips.appendChild(chip);
    });
    card.appendChild(chips);

    card.addEventListener('click', function () {
      var prev = resultsList.querySelector('.tl-selected');
      if (prev) prev.classList.remove('tl-selected');
      card.classList.add('tl-selected');
      TL.selectedId = c.id;
      showPreview(c, q);
    });
    return card;
  }

  /* ── PREVIEW ────────────────────────────────────────────────── */
  function showPreview(c, q) {
    previewBody.innerHTML = '';
    var lastIdx = c.cells.length - 1;

    c.cells.forEach(function (cell, ci) {
      var wrap = document.createElement('div');
      wrap.className = 'tl-preview-cell' + (ci === lastIdx ? ' tl-last-preview' : '');

      var lbl = document.createElement('div');
      lbl.className = 'tl-preview-cell-lbl';
      lbl.textContent = (ci === lastIdx ? '★ ' : '') + 'Column ' + (ci + 1) + (ci === lastIdx ? '  (pushed to Editor)' : '');

      var val = document.createElement('div');
      val.className = 'tl-preview-cell-val';

      // Safe highlight in plain text
      if (q && cell) {
        val.innerHTML = hlText(cell, q).replace(/\n/g, '<br>');
      } else {
        val.innerHTML = cell ? escH(cell).replace(/\n/g, '<br>') : '<em style="color:var(--sf-gray-5);">(empty)</em>';
      }

      wrap.appendChild(lbl);
      wrap.appendChild(val);
      previewBody.appendChild(wrap);
    });

    previewFooter.style.display = 'flex';

    useBtn.onclick = function () {
      var lastCell = c.cells[lastIdx] || '';
      var editor = document.getElementById('inputEditor');
      if (editor) {
        /* Convert plain text → HTML so sanitizePaste can apply the
           same normalisation the Editor uses on its own paste handler.
           Each \n becomes a <br> so paragraph structure is preserved. */
        function escHtmlTL(s) {
          return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }
        var asHtml = escHtmlTL(lastCell).replace(/\n/g, '<br>');
        var sanitized = (typeof sanitizePaste === 'function')
          ? sanitizePaste(asHtml)
          : asHtml;
        editor.innerHTML = sanitized;
        /* Place caret at end */
        var sel = window.getSelection();
        if (sel) {
          var range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        editor.dispatchEvent(new Event('input'));
        tlSwitchTab('editor');
        showToast('✅ Pasted into Editor!', 'success');
      }
    };

    copyBtn.onclick = function () {
      var lastCell = c.cells[lastIdx] || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastCell).then(function () {
          showToast('📋 Copied to clipboard!', 'success');
        }).catch(fallbackCopy.bind(null, lastCell));
      } else {
        fallbackCopy(lastCell);
      }
    };
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('📋 Copied!', 'success'); }
    catch(e) { showToast('Copy failed — try Ctrl+C manually.', 'error'); }
    document.body.removeChild(ta);
  }

  /* ── EXPORT LIBRARY ─────────────────────────────────────────── */
  function exportLibrary() {
    if (!TL.cases.length) { showToast('No cases to export yet.', 'error'); return; }

    /* Build plain-text Column (N): format.
       Each case is a block of "Column (1): ...\nColumn (2): ...\n..."
       separated by a line containing only "---".
       All actual newlines inside cell values are kept as real newlines
       so the export looks exactly like the cleaned-up parsed version.  */
    var lines = [];
    TL.cases.forEach(function (c, ci) {
      c.cells.forEach(function (cell, i) {
        lines.push('Column (' + (i + 1) + '): ' + cell);
      });
      if (ci < TL.cases.length - 1) lines.push('---');
    });
    var payload = lines.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).then(function () {
        showToast('📤 Library copied! Paste it into ＋ Paste Cases to restore.', 'success');
      }).catch(function () { fallbackCopy(payload); });
    } else {
      fallbackCopy(payload);
    }
  }

  copyLibBtn.addEventListener('click', exportLibrary);

  /* ── CLEAR ALL ──────────────────────────────────────────────── */
  clearAllBtn.addEventListener('click', function () {
    TL.cases = []; TL.filtered = []; TL.selectedId = null;
    _activeTags.clear();
    searchInput.value = ''; searchInput.disabled = true;
    previewBody.innerHTML = '<div class="tl-preview-empty"><span style="font-size:32px;">👆</span>Select a case to preview.</div>';
    previewFooter.style.display = 'none';
    badge.style.display = 'none'; clearAllBtn.style.display = 'none';
    resultCount.textContent = ''; subCount.textContent = '';
    renderResults([], '');
    renderTagFilterBar();
    showToast('Library cleared.', 'success');
  });

  /* ── TAG FILTER BAR ─────────────────────────────────────────── */
  function getAllTags() {
    var tagMap = {}; /* tag -> count */
    TL.cases.forEach(function (c) {
      var t = c.tag || '';
      tagMap[t] = (tagMap[t] || 0) + 1;
    });
    return tagMap;
  }

  function renderTagFilterBar() {
    var bar   = document.getElementById('tlTagFilterBar');
    var chips = document.getElementById('tlTagChips');
    if (!bar || !chips) return;

    var tagMap = getAllTags();
    var tagNames = Object.keys(tagMap).filter(function (t) { return t; }); /* named tags only */

    if (!tagNames.length) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    chips.innerHTML = '';

    tagNames.sort().forEach(function (tag) {
      var color = getTagColor(tag);
      var chip = document.createElement('button');
      chip.className = 'tl-tag-chip' + (_activeTags.has(tag) ? ' active' : '');
      chip.innerHTML =
        '<span class="tl-tag-dot" style="background:' + color + ';"></span>' +
        escH(tag) +
        '<span class="tl-tag-count">(' + tagMap[tag] + ')</span>';
      chip.title = 'Filter: ' + tag;
      chip.addEventListener('click', function () {
        if (_activeTags.has(tag)) {
          _activeTags.delete(tag);
          chip.classList.remove('active');
        } else {
          _activeTags.add(tag);
          chip.classList.add('active');
        }
        window._NB_activeTags = _activeTags;
        if (typeof window._NB_rebuildCorpus === 'function') window._NB_rebuildCorpus();
        applySearch();
      });
      chips.appendChild(chip);
    });
  }

  /* Show All button */
  document.getElementById('tlTagFilterAll').addEventListener('click', function () {
    _activeTags.clear();
    window._NB_activeTags = _activeTags;
    if (typeof window._NB_rebuildCorpus === 'function') window._NB_rebuildCorpus();
    renderTagFilterBar();
    applySearch();
  });

  /* ── BADGE ──────────────────────────────────────────────────── */
  function updateBadge() {
    var n = TL.cases.length;
    badge.textContent = n;
    badge.style.display = n ? 'inline-block' : 'none';
    clearAllBtn.style.display = n ? 'inline-block' : 'none';
    copyLibBtn.style.display  = n ? 'inline-block' : 'none';
    var tab = document.getElementById('tabTemplates');
    if (tab) tab.textContent = '📁 Case Library' + (n ? ' (' + n + ')' : '');
    /* Expose updated sentence corpus to autofill/replacer system */
    window._NB_TL = TL;
    window._NB_activeTags = _activeTags;
    if (typeof window._NB_rebuildCorpus === 'function') window._NB_rebuildCorpus();
    /* Notify SmartBot that cases have been updated */
    if (typeof window.sbOnCasesUpdated === 'function') window.sbOnCasesUpdated();
    /* Refresh batch panel if it's currently visible */
    var paneBatch = document.getElementById('tlPaneBatch');
    if (paneBatch && paneBatch.style.display !== 'none') renderBatchButtons();
    /* Update tag filter bar */
    renderTagFilterBar();
  }

  /* ── PUBLIC: Expose all case letter bodies to SmartBot ─────── */
  window.tlGetAllCases = function () {
    return TL.cases.map(function (c) {
      /* Return last cell (the letter body) */
      return Array.isArray(c.cells) ? c.cells[c.cells.length - 1] || '' : '';
    }).filter(Boolean);
  };

  /* ── PREVIEW TAB SWITCHER ───────────────────────────────────── */
  window.tlSwitchPreviewTab = function (tab) {
    var panePreview = document.getElementById('tlPanePreview');
    var paneBatch   = document.getElementById('tlPaneBatch');
    var tabPreview  = document.getElementById('tlTabPreview');
    var tabBatch    = document.getElementById('tlTabBatch');
    if (tab === 'batch') {
      panePreview.style.display = 'none';
      paneBatch.style.display   = 'flex';
      tabPreview.classList.remove('active');
      tabBatch.classList.add('active');
      renderBatchButtons();
    } else {
      panePreview.style.display = 'flex';
      paneBatch.style.display   = 'none';
      tabPreview.classList.add('active');
      tabBatch.classList.remove('active');
    }
  };

  /* ── BATCH COPY ─────────────────────────────────────────────── */
  var _batchSize = 50; // default

  /* Pill selection */
  var batchSizePills = document.getElementById('tlBatchSizePills');
  batchSizePills.addEventListener('click', function (e) {
    var pill = e.target.closest('.tl-batch-pill');
    if (!pill) return;
    _batchSize = parseInt(pill.dataset.size, 10);
    /* Update active state */
    batchSizePills.querySelectorAll('.tl-batch-pill').forEach(function (p) {
      p.classList.remove('active');
    });
    pill.classList.add('active');
    renderBatchButtons();
  });

  /* Custom size */
  document.getElementById('tlBatchCustomApply').addEventListener('click', function () {
    var val = parseInt(document.getElementById('tlBatchCustom').value, 10);
    if (!val || val < 1) { showToast('Enter a valid batch size.', 'error'); return; }
    _batchSize = val;
    /* Deactivate all pills */
    batchSizePills.querySelectorAll('.tl-batch-pill').forEach(function (p) {
      p.classList.remove('active');
    });
    renderBatchButtons();
    showToast('Batch size set to ' + val + '.', 'success');
  });

  /* Render the batch buttons based on current library + batch size */
  function renderBatchButtons() {
    var container = document.getElementById('tlBatchButtons');
    container.innerHTML = '';

    if (!TL.cases.length) {
      container.innerHTML = '<div style="font-size:12px; color:var(--sf-gray-5); font-style:italic;">Load some cases first, then batch buttons will appear here.</div>';
      return;
    }

    var total      = TL.cases.length;
    var batchCount = Math.ceil(total / _batchSize);

    /* Summary line */
    var summary = document.createElement('div');
    summary.style.cssText = 'font-size:11px; color:var(--sf-gray-6); margin-bottom:4px;';
    summary.textContent = total + ' cases → ' + batchCount + ' batch' + (batchCount !== 1 ? 'es' : '') + ' of up to ' + _batchSize + ' each.';
    container.appendChild(summary);

    for (var b = 0; b < batchCount; b++) {
      var start   = b * _batchSize;                          // 0-based index
      var end     = Math.min(start + _batchSize, total);     // exclusive
      var dispStart = start + 1;                             // 1-based for display
      var dispEnd   = end;                                   // 1-based for display

      (function (batchIdx, sliceStart, sliceEnd, ds, de) {
        var btn = document.createElement('button');
        btn.className = 'tl-batch-btn';
        btn.innerHTML =
          '<span class="tl-batch-btn-label">Batch (' + (batchIdx + 1) + ')</span>' +
          '<span class="tl-batch-btn-range">Case ' + ds + ' – ' + de + ' (' + (de - ds + 1) + ' cases)</span>' +
          '<span class="tl-batch-btn-action">📋 Copy</span>';

        btn.addEventListener('click', function () {
          var batch = TL.cases.slice(sliceStart, sliceEnd);

          /* Serialise in the same Column (N): format that the parser understands */
          var lines = [];
          batch.forEach(function (c, ci) {
            c.cells.forEach(function (cell, i) {
              lines.push('Column (' + (i + 1) + '): ' + cell);
            });
            if (ci < batch.length - 1) lines.push('---');
          });
          var payload = lines.join('\n');

          var actionSpan = btn.querySelector('.tl-batch-btn-action');
          function markCopied() {
            btn.classList.add('copied');
            actionSpan.textContent = '✅ Copied!';
            setTimeout(function () {
              btn.classList.remove('copied');
              actionSpan.textContent = '📋 Copy';
            }, 2500);
          }

          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(payload).then(markCopied).catch(function () {
              fallbackCopy(payload); markCopied();
            });
          } else {
            fallbackCopy(payload); markCopied();
          }
        });

        container.appendChild(btn);
      })(b, start, end, dispStart, dispEnd);
    }
  }

  /* ── SEARCH SIMILAR ENQUIRY ─────────────────────────────────── */

  var simOverlay  = document.getElementById('tlSimOverlay');
  var simClose    = document.getElementById('tlSimClose');
  var simInput    = document.getElementById('tlSimInput');
  var simFind     = document.getElementById('tlSimFind');
  var simClear    = document.getElementById('tlSimClear');
  var simStatus   = document.getElementById('tlSimStatus');
  var simResults  = document.getElementById('tlSimResults');
  var openSimBtn  = document.getElementById('tlOpenSimilar');

  openSimBtn.addEventListener('click', function () {
    if (!TL.cases.length) {
      showToast('Load some cases first, then use Search Similar Enquiry.', 'error');
      return;
    }
    simStatus.textContent = '';
    simResults.innerHTML = '';
    simOverlay.classList.add('open');
    setTimeout(function () { simInput.focus(); }, 120);
  });

  function closeSimModal() { simOverlay.classList.remove('open'); }
  simClose.addEventListener('click', closeSimModal);
  simOverlay.addEventListener('click', function (e) { if (e.target === simOverlay) closeSimModal(); });
  simClear.addEventListener('click', function () {
    simInput.value = '';
    var kwEl = document.getElementById('tlSimKeyword');
    if (kwEl) kwEl.value = '';
    simResults.innerHTML = '';
    simStatus.textContent = '';
    simInput.focus();
  });

  /* TF-IDF-style similarity: tokenise → term frequency → cosine-like dot product */
  var SIM_STOP = new Set([
    'the','a','an','and','or','of','to','in','is','it','this','that','we','you',
    'your','our','for','on','be','with','has','have','had','are','was','were',
    'will','would','can','could','should','may','also','as','by','at','from',
    'not','but','so','if','do','does','did','all','any','no','mr','ms','mrs',
    'dear','sir','madam','sincerely','faithfully','regards','please','hereby',
    'i','my','me','he','she','they','them','their','its','been','than','then',
    'into','about','more','such','which','when','where','how','what','who'
  ]);

  function tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length > 2 && !SIM_STOP.has(w); });
  }

  function termFreq(tokens) {
    var freq = {};
    tokens.forEach(function (t) { freq[t] = (freq[t] || 0) + 1; });
    /* Normalise by token count */
    var total = tokens.length || 1;
    var tf = {};
    Object.keys(freq).forEach(function (k) { tf[k] = freq[k] / total; });
    return tf;
  }

  function cosineSim(tfA, keysA, tfB) {
    var dot = 0, normA = 0, normB = 0;
    keysA.forEach(function (k) {
      var a = tfA[k] || 0;
      var b = tfB[k] || 0;
      dot  += a * b;
      normA += a * a;
    });
    Object.keys(tfB).forEach(function (k) { normB += tfB[k] * tfB[k]; });
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  function getActiveCasesForSim() {
    /* Return cases filtered by active tags (if any) */
    if (_activeTags.size === 0) return TL.cases;
    return TL.cases.filter(function (c) { return _activeTags.has(c.tag || ''); });
  }

  function findSimilarCases(queryText) {
    var qTokens = tokenize(queryText);
    if (!qTokens.length) return [];
    var qTF   = termFreq(qTokens);
    var qKeys = Object.keys(qTF);

    var pool = getActiveCasesForSim();

    var scored = pool.map(function (c) {
      var middleCols = c.cells.slice(1); /* skip first col (case ID) */
      var combinedText = middleCols.join(' ');
      var cTokens = tokenize(combinedText);
      var cTF     = termFreq(cTokens);
      var score   = cosineSim(qTF, qKeys, cTF);

      var shared = qKeys.filter(function (k) { return cTF[k]; })
        .sort(function (a, b) { return (cTF[b] * qTF[b]) - (cTF[a] * qTF[a]); })
        .slice(0, 8);

      return { c: c, score: score, shared: shared };
    });

    return scored
      .filter(function (s) { return s.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 15);
  }

  /* Keyword search — looks only at the LAST column of each case */
  function findByKeyword(keyword) {
    var kw = keyword.trim().toLowerCase();
    if (!kw) return [];

    var pool = getActiveCasesForSim();

    var results = pool.filter(function (c) {
      var lastCell = (c.cells[c.cells.length - 1] || '').toLowerCase();
      return lastCell.indexOf(kw) !== -1;
    });

    /* Sort: those where keyword appears more frequently ranked higher */
    results.sort(function (a, b) {
      function countOccurrences(str, sub) {
        var n = 0, pos = 0;
        while ((pos = str.indexOf(sub, pos)) !== -1) { n++; pos++; }
        return n;
      }
      var lastA = (a.cells[a.cells.length - 1] || '').toLowerCase();
      var lastB = (b.cells[b.cells.length - 1] || '').toLowerCase();
      return countOccurrences(lastB, kw) - countOccurrences(lastA, kw);
    });

    return results.slice(0, 20).map(function (c) {
      return { c: c, score: 1, shared: [keyword], isKeyword: true };
    });
  }

  simFind.addEventListener('click', runSimSearch);
  simInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSimSearch();
  });

  function runSimSearch() {
    var q   = simInput.value.trim();
    var kw  = document.getElementById('tlSimKeyword') ? document.getElementById('tlSimKeyword').value.trim() : '';
    var pool = getActiveCasesForSim();

    if (!q && !kw) { simStatus.textContent = '⚠️ Please paste some enquiry text or enter a keyword first.'; return; }
    if (!TL.cases.length) { simStatus.textContent = '⚠️ No cases loaded yet.'; return; }
    if (!pool.length) { simStatus.textContent = '⚠️ No cases match the active tag filter.'; return; }

    simStatus.textContent = 'Scanning ' + pool.length + ' cases…';
    simResults.innerHTML = '';

    setTimeout(function () {
      var results;
      var isKeywordMode = kw.length > 0;

      if (isKeywordMode) {
        /* Keyword mode: search last column only */
        results = findByKeyword(kw);
        /* If enquiry text also provided, filter results by it additionally */
        if (q && results.length) {
          var qTokens = tokenize(q);
          var qTF = termFreq(qTokens);
          var qKeys = Object.keys(qTF);
          results = results.filter(function (r) {
            var combinedText = r.c.cells.slice(1).join(' ');
            var cTokens = tokenize(combinedText);
            var cTF = termFreq(cTokens);
            return cosineSim(qTF, qKeys, cTF) > 0;
          });
        }
      } else {
        results = findSimilarCases(q);
      }

      if (!results.length) {
        simStatus.textContent = isKeywordMode
          ? '⚠️ Keyword "' + kw + '" not found in last column of any case.'
          : '⚠️ No similar cases found. Try adding more detail to your query.';
        simResults.innerHTML = '<div class="tl-sim-empty">No matches found — ' + (isKeywordMode ? 'try a different keyword.' : 'try rephrasing or adding more keywords.') + '</div>';
        return;
      }

      var modeLabel = isKeywordMode ? 'keyword "' + kw + '"' : 'enquiry text';
      simStatus.textContent = results.length + ' case' + (results.length !== 1 ? 's' : '') + ' found by ' + modeLabel + '. Click a result to load it.';
      if (_activeTags.size > 0) {
        simStatus.textContent += ' (filtered by tag)';
      }

      var topScore = results[0].score || 1;
      var frag = document.createDocumentFragment();

      results.forEach(function (r, i) {
        var pct = isKeywordMode ? 100 : Math.round((r.score / topScore) * 100);
        var card = document.createElement('div');
        card.className = 'tl-sim-card';

        /* For keyword mode, highlight the keyword in the last column snippet */
        var lastCol = r.c.cells[r.c.cells.length - 1] || '';
        var snippet;
        if (isKeywordMode) {
          /* Find where the keyword is in the last column and show context around it */
          var kwIdx = lastCol.toLowerCase().indexOf(kw.toLowerCase());
          var start = Math.max(0, kwIdx - 60);
          var end   = Math.min(lastCol.length, kwIdx + kw.length + 120);
          snippet = (start > 0 ? '…' : '') + lastCol.slice(start, end) + (end < lastCol.length ? '…' : '');
        } else {
          snippet = r.c.cells.slice(1, -1).join(' · ').slice(0, 180);
          if (!snippet) snippet = lastCol.slice(0, 180);
        }

        /* Tag pill */
        var tagHtml = '';
        if (r.c.tag) {
          var tc2 = getTagColor(r.c.tag);
          tagHtml = '<span style="display:inline-block;padding:1px 7px;font-size:10px;font-weight:700;border-radius:10px;margin-left:6px;background:' + tc2 + '22;color:' + tc2 + ';border:1px solid ' + tc2 + '44;">' + escH(r.c.tag) + '</span>';
        }

        var matchWords = isKeywordMode ? [] : r.shared;

        /* Highlight keyword inside snippet */
        var snippetHtml = escH(snippet);
        if (isKeywordMode && kw) {
          var safeKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          snippetHtml = snippetHtml.replace(new RegExp('(' + safeKw + ')', 'gi'), '<span class="tl-sim-kw-hl">$1</span>');
        }

        card.innerHTML =
          '<div class="tl-sim-card-hdr">' +
            '<span class="tl-sim-rank">#' + (i + 1) + '</span>' +
            (isKeywordMode
              ? '<span style="font-size:10px;color:var(--sf-gray-5);">Keyword match — last col</span>'
              : '<div class="tl-sim-score-bar"><div class="tl-sim-score-fill" style="width:' + pct + '%"></div></div><span class="tl-sim-score-pct">' + pct + '%</span>'
            ) +
          '</div>' +
          '<div class="tl-sim-title">' + escH(String(r.c.cells[0]).slice(0, 100)) + tagHtml + '</div>' +
          '<div class="tl-sim-snippet">' + snippetHtml + '</div>' +
          (matchWords.length ? '<div class="tl-sim-matches">' +
            matchWords.map(function (w) { return '<span class="tl-sim-match-word">' + escH(w) + '</span>'; }).join('') +
          '</div>' : '');

        card.addEventListener('click', function () {
          var lastCell = r.c.cells[r.c.cells.length - 1] || '';
          var editor = document.getElementById('inputEditor');
          if (editor) {
            function escHtmlSim(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
            var asHtml = escHtmlSim(lastCell).replace(/\n/g, '<br>');
            var sanitized = (typeof sanitizePaste === 'function') ? sanitizePaste(asHtml) : asHtml;
            editor.innerHTML = sanitized;
            var sel = window.getSelection();
            if (sel) {
              var range = document.createRange();
              range.selectNodeContents(editor);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            }
            editor.dispatchEvent(new Event('input'));
            closeSimModal();
            tlSwitchTab('editor');
            showToast('✅ Case #' + (i + 1) + ' loaded into Editor!', 'success');
          }
        });

        frag.appendChild(card);
      });

      simResults.appendChild(frag);
    }, 30);
  }

  /* ── COLUMN SORT ─────────────────────────────────────────────── */
  var sortColSel  = document.getElementById('tlSortCol');
  var sortDirBtn  = document.getElementById('tlSortDir');
  var sortWrap    = document.getElementById('tlSortWrap');
  var _sortCol    = -1;   /* -1 = no sort */
  var _sortAsc    = true; /* true = A→Z */

  /* Rebuild column options whenever cases change */
  function rebuildSortOptions() {
    /* Determine max columns */
    var maxCols = 0;
    TL.cases.forEach(function (c) { if (c.cells.length > maxCols) maxCols = c.cells.length; });

    sortColSel.innerHTML = '<option value="">— None —</option>';
    for (var ci = 0; ci < maxCols; ci++) {
      var opt = document.createElement('option');
      opt.value = ci;
      opt.textContent = 'Col ' + (ci + 1) + (ci === 0 ? ' (ID)' : ci === maxCols - 1 ? ' (Letter)' : '');
      if (ci === _sortCol) opt.selected = true;
      sortColSel.appendChild(opt);
    }

    sortWrap.style.display = maxCols ? 'flex' : 'none';
  }

  sortColSel.addEventListener('change', function () {
    _sortCol = sortColSel.value === '' ? -1 : parseInt(sortColSel.value, 10);
    applySearch();
  });

  sortDirBtn.addEventListener('click', function () {
    _sortAsc = !_sortAsc;
    sortDirBtn.textContent = _sortAsc ? 'A→Z' : 'Z→A';
    sortDirBtn.classList.toggle('desc', !_sortAsc);
    if (_sortCol >= 0) applySearch();
  });

  /* Patch applySearch to also apply sorting */
  var _origApplySearch = applySearch;
  applySearch = function () {
    _origApplySearch();
    if (_sortCol < 0) return;
    TL.filtered.sort(function (a, b) {
      var va = (a.cells[_sortCol] || '').toLowerCase();
      var vb = (b.cells[_sortCol] || '').toLowerCase();
      if (va < vb) return _sortAsc ? -1 : 1;
      if (va > vb) return _sortAsc ? 1 : -1;
      return 0;
    });
    renderResults(TL.filtered, searchInput.value.trim());
  };

  /* Hook into updateBadge to refresh sort options when library changes */
  var _origUpdateBadge2 = updateBadge;
  updateBadge = function () {
    _origUpdateBadge2();
    rebuildSortOptions();
  };

  /* Init */
  rebuildSortOptions();



})();
