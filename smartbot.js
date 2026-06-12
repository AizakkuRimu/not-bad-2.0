/* ============================================================
   SMARTBOT — Self-learning sentence categorisation system
   In-memory only. Export/Import for cross-session persistence.
   ============================================================ */
(function () {
  'use strict';

  /* ── STATE ─────────────────────────────────────────────────── */

  /* Taxonomy: array of { scheme, category, enquiry } */
  var SB_taxonomy = [];

  /* Taxonomy sort direction: 'asc' (A→Z) or 'desc' (Z→A) */
  var SB_taxSortDir = 'asc';

  /* Custom sub-enquiries per "scheme||category||enquiry" key */
  var SB_subEnquiries = {}; /* key → string[] */

  /* Sentence DB: map of normalised text → record */
  /* record: { text, status:'pending'|'categorised'|'ignored',
               tags: [{ scheme, category, enquiry, subEnquiry }],
               children: string[], sourceCount }
     Legacy fields scheme/category/enquiry/subEnquiry are migrated on load. */
  var SB_db = {};

  /* Review queue: array of texts from SB_db with status === 'pending' */
  var SB_queue = [];
  var SB_queueIdx = 0;

  /* Currently displayed sentence key */
  var SB_currentKey = null;

  /* Temp children list for current sentence being reviewed */
  var SB_tempChildren = [];

  /* Temp tags for current sentence being reviewed: [{scheme,category,enquiry,subEnquiry}] */
  var SB_tempTags = [];

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

  /* Split a block of text into sentences.
     Strategy: split on line breaks first (hard boundaries), then within each
     line split on  .  /  !  /  ?  that are followed by whitespace + uppercase
     AND preceded by a letter that is NOT a known abbreviation prefix.
     This avoids chopping cpf.gov.sg, 8.30am, S$1,234.56, "Mr.", "Dr.", etc. */
  var _ABBREV_RE = /\b(?:mr|mrs|ms|dr|prof|sr|jr|vs|no|vol|dept|est|approx|ref|tel|fax|pg|pp|fig|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.\s*$/i;

  function splitSentences(text) {
    /* 1. Hard-split on line breaks */
    var lines = text.split(/\r?\n/);
    var out = [];
    lines.forEach(function (line) {
      line = norm(line);
      if (!line) return;
      /* 2. Within a line, split only where a sentence-ending punctuation
            is followed by a space + uppercase letter AND the preceding token
            is not a known abbreviation. */
      var sentences = [];
      var re = /([.!?])\s+(?=[A-Z])/g;
      var last = 0, m;
      while ((m = re.exec(line)) !== null) {
        var before = line.slice(0, m.index + 1); /* includes the punctuation */
        /* Skip if this looks like an abbreviation */
        if (_ABBREV_RE.test(before)) continue;
        /* Skip if preceded by a single capital letter (initial like "A. Smith") */
        if (/\b[A-Z]\.\s*$/.test(before)) continue;
        sentences.push(line.slice(last, m.index + 1));
        last = m.index + 1 + m[0].length - m[0].trimLeft().length;
        /* advance past the whitespace */
        last = re.lastIndex;
      }
      sentences.push(line.slice(last));

      sentences.forEach(function (s) {
        s = norm(s);
        if (s.length > 5) out.push(s);
      });
    });
    return out;
  }

  /* ── CUT-OFF DETECTION ──────────────────────────────────────────
     Given a stored sentence and the full source letter text, determine
     whether the sentence was cut off mid-phrase.
     A sentence is considered cut-off when:
       • It does NOT end with  . ! ?  (no terminal punctuation)  AND
       • The source text contains the sentence followed by more non-whitespace
         content on the same line (i.e. there is more text on that line).
     Returns the full corrected sentence string, or null if not cut off.  */
  var _ABBREV_WORDS = ['mr','mrs','ms','dr','prof','sr','jr','vs','no','vol','dept','est','approx','ref','tel','fax','pg','pp','fig',
    'jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec','etc','eg','ie'];

  /* Is there a genuine sentence boundary at text[i] (a . ! or ?)? */
  function _isBoundary(text, i) {
    var ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') return false;

    var prev = text[i - 1];
    if (prev && /[0-9]/.test(prev)) return false; /* e.g. "8.30am" */

    var after = text.slice(i + 1);
    var m = after.match(/^(\s*)(\S?)/);
    var ws = m[1], nextCh = m[2];

    /* No space and next char is alphanumeric -> part of a URL/decimal, not a boundary */
    if (ws.length === 0 && /[A-Za-z0-9]/.test(nextCh)) return false;

    /* If there IS a next char, it should look like the start of a new sentence */
    if (nextCh && !/[A-Z0-9"'(]/.test(nextCh)) return false;

    /* Abbreviation / initial check on the word immediately preceding the dot */
    var wordMatch = text.slice(0, i).match(/([A-Za-z]+)$/);
    if (wordMatch) {
      var w = wordMatch[1].toLowerCase();
      if (w.length === 1) return false; /* single-letter initial like "A." or "g." in "e.g." */
      if (_ABBREV_WORDS.indexOf(w) !== -1) return false;
    }

    return true;
  }

  function sbGetFixedSentence(storedText, sourceText) {
    if (!storedText || !sourceText) return null;

    var normStored = storedText.replace(/\s+/g, ' ').trim();
    if (!normStored) return null;

    /* Flatten the source so a sentence that wraps across a single line break
       can still be matched/reconstructed, but preserve paragraph breaks
       (blank lines) as hard stops — expansion must never cross into a
       different paragraph. */
    var flat = sourceText
      .replace(/\n[ \t]*\n+/g, '\u0001')   /* paragraph break -> marker */
      .replace(/\s+/g, ' ')
      .trim();

    var pos = flat.indexOf(normStored);
    if (pos === -1) pos = flat.toLowerCase().indexOf(normStored.toLowerCase());
    if (pos === -1) return null;

    var end = pos + normStored.length;

    /* Expand backwards to the start of this sentence: find the nearest
       preceding boundary, then start right after the whitespace that follows it. */
    var start = 0;
    for (var i = pos - 1; i >= 0; i--) {
      if (flat[i] === '\u0001') { start = i + 1; break; }
      if (_isBoundary(flat, i)) {
        var j = i + 1;
        while (j < flat.length && /\s/.test(flat[j])) j++;
        start = j;
        break;
      }
    }

    /* Expand forwards to the end of this sentence: find the nearest
       following boundary (it may already be exactly at `end`). */
    var newEnd = flat.length;
    for (var k = Math.max(end - 1, 0); k < flat.length; k++) {
      if (flat[k] === '\u0001') { newEnd = k; break; }
      if (_isBoundary(flat, k)) {
        newEnd = k + 1;
        break;
      }
    }
    end = newEnd;

    var fixed = norm(flat.slice(start, end).replace(/\u0001/g, ' '));
    if (!fixed || fixed.toLowerCase() === normStored.toLowerCase()) return null;
    return fixed;
  }

  /* Extract sentences from the Case Library (window.TL is not exposed,
     so we read from the rendered case list as a fallback,
     but we also expose a hook in caselibrary.js via window.tlGetAllCases) */
  function extractFromCaseLibrary() {
    /* Use the richer API (with IDs) if available, else fall back */
    var casesWithId = [];
    if (typeof window.tlGetAllCasesWithId === 'function') {
      casesWithId = window.tlGetAllCasesWithId();
    } else if (typeof window.tlGetAllCases === 'function') {
      /* Wrap plain strings with a dummy id */
      window.tlGetAllCases().forEach(function (text, i) {
        casesWithId.push({ id: 'c' + i, letter: text });
      });
    } else {
      /* Fallback: scrape rendered text */
      var items = document.querySelectorAll('#tlResultsList .tl-result-item');
      items.forEach(function (el, i) {
        var cells = el.querySelectorAll('.tl-result-cell');
        if (cells.length > 0) casesWithId.push({ id: 'c' + i, letter: cells[cells.length - 1].textContent });
      });
    }

    var added = 0;
    var skipped = 0;

    casesWithId.forEach(function (c) {
      var text = c.letter || '';
      if (!text) return;
      var caseId = c.id || '';

      var sentences = splitSentences(text);
      sentences.forEach(function (s) {
        var key = norm(s);
        if (!key) return;

        if (SB_db[key]) {
          /* Already exists — just append this caseId to sourceIds if not present */
          if (caseId && SB_db[key].sourceIds) {
            if (SB_db[key].sourceIds.indexOf(caseId) === -1) {
              SB_db[key].sourceIds.push(caseId);
              SB_db[key].sourceCount = SB_db[key].sourceIds.length;
            }
          }
          skipped++;
          return;
        }

        if (shouldIgnore(key)) {
          SB_db[key] = { text: key, status: 'ignored', tags: [],
            children: [], sourceCount: 1,
            sourceIds: caseId ? [caseId] : [] };
          skipped++;
          return;
        }

        SB_db[key] = { text: key, status: 'pending', tags: [],
          children: [], sourceCount: 1,
          sourceIds: caseId ? [caseId] : [] };
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

  /* ── TAXONOMY CRUD HELPERS ──────────────────────────────────── */

  function renameTaxonomyScheme(oldName, newName) {
    newName = norm(newName);
    if (!newName || newName === oldName) return false;
    if (getSchemes().indexOf(newName) !== -1) return false;
    SB_taxonomy.forEach(function (r) { if (r.scheme === oldName) r.scheme = newName; });
    /* Move sub-enquiry keys */
    Object.keys(SB_subEnquiries).forEach(function (k) {
      if (k.indexOf(oldName + '||') === 0) {
        var rest = k.slice(oldName.length);
        SB_subEnquiries[newName + rest] = SB_subEnquiries[k];
        delete SB_subEnquiries[k];
      }
    });
    /* Update sentence db */
    Object.keys(SB_db).forEach(function (k) {
      var rec = SB_db[k];
      if (rec.tags) rec.tags.forEach(function (t) { if (t.scheme === oldName) t.scheme = newName; });
      if (rec.scheme === oldName) rec.scheme = newName;
    });
    return true;
  }

  function renameTaxonomyCategory(scheme, oldName, newName) {
    newName = norm(newName);
    if (!newName || newName === oldName) return false;
    if (getCategoriesForScheme(scheme).indexOf(newName) !== -1) return false;
    SB_taxonomy.forEach(function (r) { if (r.scheme === scheme && r.category === oldName) r.category = newName; });
    Object.keys(SB_subEnquiries).forEach(function (k) {
      var prefix = scheme + '||' + oldName + '||';
      if (k.indexOf(prefix) === 0) {
        var enq = k.slice(prefix.length);
        var newKey = scheme + '||' + newName + '||' + enq;
        SB_subEnquiries[newKey] = SB_subEnquiries[k];
        delete SB_subEnquiries[k];
      }
    });
    Object.keys(SB_db).forEach(function (k) {
      var rec = SB_db[k];
      if (rec.tags) rec.tags.forEach(function (t) { if (t.scheme === scheme && t.category === oldName) t.category = newName; });
      if (rec.scheme === scheme && rec.category === oldName) rec.category = newName;
    });
    return true;
  }

  function renameTaxonomyEnquiry(scheme, category, oldName, newName) {
    newName = norm(newName);
    if (!newName || newName === oldName) return false;
    if (getEnquiriesForCat(scheme, category).indexOf(newName) !== -1) return false;
    SB_taxonomy.forEach(function (r) { if (r.scheme === scheme && r.category === category && r.enquiry === oldName) r.enquiry = newName; });
    var oldKey = scheme + '||' + category + '||' + oldName;
    var newKey = scheme + '||' + category + '||' + newName;
    if (SB_subEnquiries[oldKey]) {
      SB_subEnquiries[newKey] = SB_subEnquiries[oldKey];
      delete SB_subEnquiries[oldKey];
    }
    Object.keys(SB_db).forEach(function (k) {
      var rec = SB_db[k];
      if (rec.tags) rec.tags.forEach(function (t) { if (t.scheme === scheme && t.category === category && t.enquiry === oldName) t.enquiry = newName; });
      if (rec.scheme === scheme && rec.category === category && rec.enquiry === oldName) rec.enquiry = newName;
    });
    return true;
  }

  function addTaxonomyEntry(scheme, category, enquiry) {
    scheme = norm(scheme); category = norm(category); enquiry = norm(enquiry);
    if (!scheme || !category || !enquiry) return false;
    var exists = SB_taxonomy.some(function (r) { return r.scheme === scheme && r.category === category && r.enquiry === enquiry; });
    if (exists) return false;
    SB_taxonomy.push({ scheme: scheme, category: category, enquiry: enquiry });
    return true;
  }

  function deleteTaxonomyCategory(scheme, category) {
    SB_taxonomy = SB_taxonomy.filter(function (r) { return !(r.scheme === scheme && r.category === category); });
    Object.keys(SB_subEnquiries).forEach(function (k) {
      if (k.indexOf(scheme + '||' + category + '||') === 0) delete SB_subEnquiries[k];
    });
    Object.keys(SB_db).forEach(function (k) {
      var rec = SB_db[k];
      if (rec.tags) {
        rec.tags = rec.tags.filter(function (t) { return !(t.scheme === scheme && t.category === category); });
        if (!rec.tags.length && rec.status === 'categorised') rec.status = 'pending';
      }
      if (rec.scheme === scheme && rec.category === category) { rec.scheme = ''; rec.category = ''; rec.enquiry = ''; rec.subEnquiry = ''; }
    });
  }

  function deleteTaxonomyEnquiry(scheme, category, enquiry) {
    SB_taxonomy = SB_taxonomy.filter(function (r) { return !(r.scheme === scheme && r.category === category && r.enquiry === enquiry); });
    var key = scheme + '||' + category + '||' + enquiry;
    delete SB_subEnquiries[key];
    Object.keys(SB_db).forEach(function (k) {
      var rec = SB_db[k];
      if (rec.tags) {
        rec.tags = rec.tags.filter(function (t) { return !(t.scheme === scheme && t.category === category && t.enquiry === enquiry); });
        if (!rec.tags.length && rec.status === 'categorised') rec.status = 'pending';
      }
      if (rec.scheme === scheme && rec.category === category && rec.enquiry === enquiry) { rec.enquiry = ''; rec.subEnquiry = ''; }
    });
  }

  /* ── EXPORT TAXONOMY AS TXT ──────────────────────────────────── */

  function exportTaxonomyTxt() {
    if (!SB_taxonomy.length) { showToast('No taxonomy to export yet.', 'error'); return; }

    /* Build tab-separated lines matching the import format:
       scheme\tcategory\tenquiry
       For sub-enquiries, add an optional 4th column:
       scheme\tcategory\tenquiry\tsubEnquiry                           */
    var lines = [];
    /* Header comment so the file is self-documenting */
    lines.push('# SmartBot Taxonomy Export');
    lines.push('# Format: Scheme[TAB]Category[TAB]Enquiry  (paste into Import Taxonomy to restore)');
    lines.push('# Sub-enquiries are listed below their parent row as: Scheme[TAB]Category[TAB]Enquiry[TAB]SubEnquiry');
    lines.push('');

    /* Sort same way as the tree */
    var sorted = SB_taxonomy.slice().sort(function (a, b) {
      if (a.scheme < b.scheme) return -1; if (a.scheme > b.scheme) return 1;
      if (a.category < b.category) return -1; if (a.category > b.category) return 1;
      if (a.enquiry < b.enquiry) return -1; if (a.enquiry > b.enquiry) return 1;
      return 0;
    });

    sorted.forEach(function (r) {
      lines.push(r.scheme + '\t' + r.category + '\t' + r.enquiry);
      /* Append any sub-enquiries for this row */
      var subs = getSubEnquiries(r.scheme, r.category, r.enquiry).slice().sort();
      subs.forEach(function (sub) {
        lines.push(r.scheme + '\t' + r.category + '\t' + r.enquiry + '\t' + sub);
      });
    });

    var content = lines.join('\n');
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'taxonomy-export.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📄 Taxonomy exported as taxonomy-export.txt', 'success');
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

  /* Sub-enquiry searchable combo refs */
  var elSubEnqSearch    = $('sbSubEnqSearch');
  var elSubEnqHidden    = $('sbSubEnquirySelect');   /* hidden input holds the real value */
  var elSubEnqDropdown  = $('sbSubEnqDropdown');
  var elSubEnqSelect    = elSubEnqHidden;            /* alias used by legacy code paths */

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
  /* ── FIX ALL button (auto-applies cutoff/merge fixes to whole DB) ── */
  if (elViewerList && elViewerList.parentNode) {
    var sbFixAllBtn = document.createElement('button');
    sbFixAllBtn.textContent = '🔧 Fix All Sentences';
    sbFixAllBtn.style.cssText = 'font-size:11px;padding:4px 10px;background:#f59e0b;border:none;border-radius:4px;color:#fff;font-weight:700;cursor:pointer;margin:0 0 8px;';
    sbFixAllBtn.addEventListener('click', function () {
      var res = sbFixAllSentences();
      if (res.fixed === 0) {
        showToast('No cut-off sentences found.', '');
      } else {
        showToast('✓ Fixed ' + res.fixed + ' sentence(s)' + (res.merged ? ' (' + res.merged + ' merged with existing).' : '.'), 'success');
      }
      rebuildQueue(); updateQueueBadge(); renderViewer();
    });
    elViewerList.parentNode.insertBefore(sbFixAllBtn, elViewerList);
  }



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

  /* ── TEMPLATE DETECTION ───────────────────────────────────────── */

  /* Find text from the LAST "Dear" onward */
  function sbExtractTemplateChunk(text) {
    var re = /\bDear\b/gi, lastIdx = -1, m;
    while ((m = re.exec(text)) !== null) { lastIdx = m.index; }
    return lastIdx === -1 ? null : text.slice(lastIdx);
  }

  function sbNormWs(s) { return s.replace(/\s+/g, ' ').trim().toLowerCase(); }

  function sbSentenceInTemplate(sentence, templateChunk) {
    if (!sentence || !templateChunk) return false;
    var n = sbNormWs(sentence);
    return n.length >= 5 && sbNormWs(templateChunk).indexOf(n) !== -1;
  }

  /* Get the letter text of the first source case for a record.
     If sourceIds is empty (e.g. imported/legacy records), scans ALL cases
     for one that contains the sentence text. */
  function sbGetSourceLetterText(rec) {
    if (typeof window.tlGetAllCasesWithId !== 'function') return null;
    var cases = window.tlGetAllCasesWithId();
    if (!cases || !cases.length) return null;

    /* Try known sourceIds first */
    if (rec.sourceIds && rec.sourceIds.length) {
      for (var i = 0; i < rec.sourceIds.length; i++) {
        var id = rec.sourceIds[i];
        for (var j = 0; j < cases.length; j++) {
          if (cases[j].id === id && cases[j].letter) return cases[j].letter;
        }
      }
    }

    /* Fallback: scan all cases for one containing this sentence text */
    var needle = rec.text.replace(/\s+/g, ' ').trim().toLowerCase();
    for (var k = 0; k < cases.length; k++) {
      if (cases[k].letter && cases[k].letter.replace(/\s+/g, ' ').toLowerCase().indexOf(needle) !== -1) {
        return cases[k].letter;
      }
    }
    return null;
  }

  /* Build and render the meta line + template indicator badge */
  function renderTemplateIndicator(rec) {
    elSentenceMeta.innerHTML = '';

    /* Source count */
    if (rec.sourceCount > 1) {
      var countSpan = document.createElement('span');
      countSpan.className = 'sb-meta-count';
      countSpan.textContent = 'Appears in ' + rec.sourceCount + ' cases';
      elSentenceMeta.appendChild(countSpan);
    }

    /* Template badge — only when we have source letter data */
    var letterText = sbGetSourceLetterText(rec);
    if (letterText !== null) {
      var templateChunk = sbExtractTemplateChunk(letterText);
      var inTemplate = sbSentenceInTemplate(rec.text, templateChunk);
      if (rec.sourceCount > 1) {
        var sep = document.createElement('span');
        sep.className = 'sb-meta-sep';
        sep.textContent = '·';
        elSentenceMeta.appendChild(sep);
      }
      var badge = document.createElement('span');
      badge.className = 'sb-template-badge ' + (inTemplate ? 'sb-template-badge-in' : 'sb-template-badge-out');
      badge.textContent = inTemplate ? '✓ In Template' : '✕ Not in Template — can ignore';
      elSentenceMeta.appendChild(badge);
    }
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
    renderTemplateIndicator(rec);

    /* Reset form */
    SB_tempChildren = rec.children ? rec.children.slice() : [];
    SB_tempTags = rec.tags ? rec.tags.map(function(t){ return Object.assign({}, t); }) : [];
    /* Legacy migration: if old record has flat scheme/category/enquiry, convert */
    if (!SB_tempTags.length && rec.scheme && rec.category && rec.enquiry) {
      SB_tempTags = [{ scheme: rec.scheme, category: rec.category, enquiry: rec.enquiry, subEnquiry: rec.subEnquiry || '' }];
    }
    populateSchemes();
    renderTempTagsList();
    resetCatForm();
    renderChildList();
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
    resetSubEnqCombo();
  }

  function resetCatForm() {
    elSchemeSelect.value = '';
    elCategorySelect.innerHTML = '<option value="">— Select Scheme first —</option>';
    elCategorySelect.disabled = true;
    elEnquirySelect.innerHTML = '<option value="">— Select Category first —</option>';
    elEnquirySelect.disabled = true;
    resetSubEnqCombo();
    elChildInputRow.style.display = 'none';
    elNewSubRow.style.display = 'none';
  }

  /* ── SEARCHABLE SUB-ENQUIRY COMBO ───────────────────────────── */

  /* Internal state for the combo */
  var _subEnqOptions = [];   /* full list of {value, label} for current enquiry */
  var _subEnqOpen    = false;

  function resetSubEnqCombo() {
    _subEnqOptions = [];
    elSubEnqHidden.value = '';
    elSubEnqSearch.value = '';
    elSubEnqSearch.placeholder = 'Search or select sub-enquiry…';
    elSubEnqSearch.disabled = true;
    elSubEnqDropdown.style.display = 'none';
    _subEnqOpen = false;
  }

  function buildSubEnqOptions(scheme, category, enquiry) {
    var subs = getSubEnquiries(scheme, category, enquiry);
    _subEnqOptions = [{ value: '', label: '— None —' }];
    subs.forEach(function (s) { _subEnqOptions.push({ value: s, label: s }); });
    _subEnqOptions.push({ value: '__new__', label: '＋ Add new sub-enquiry…' });
  }

  function renderSubEnqDropdown(filter) {
    var q = (filter || '').toLowerCase().trim();
    var items = _subEnqOptions.filter(function (o) {
      if (o.value === '__new__') return true;
      if (!q) return true;
      return o.label.toLowerCase().indexOf(q) !== -1;
    });

    elSubEnqDropdown.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:8px 10px; font-size:12px; color:var(--sf-gray-5); font-style:italic;';
      empty.textContent = 'No matches found.';
      elSubEnqDropdown.appendChild(empty);
      return;
    }

    items.forEach(function (o) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:7px 10px; font-size:12px; cursor:pointer; border-bottom:1px solid var(--sf-gray-2);';
      if (o.value === elSubEnqHidden.value) {
        item.style.background = '#eef4ff';
        item.style.fontWeight = '600';
      }
      if (o.value === '__new__') {
        item.style.color = 'var(--sf-brand)';
        item.style.fontWeight = '600';
        item.style.borderTop = '1px solid var(--sf-gray-3)';
      }
      item.textContent = o.label;
      item.addEventListener('mousedown', function (e) {
        e.preventDefault(); /* stop blur from firing before click */
        selectSubEnq(o.value, o.label);
      });
      item.addEventListener('mouseover', function () { item.style.background = '#f0f4ff'; });
      item.addEventListener('mouseout', function () {
        item.style.background = o.value === elSubEnqHidden.value ? '#eef4ff' : '';
      });
      elSubEnqDropdown.appendChild(item);
    });
  }

  function openSubEnqDropdown() {
    /* Position the fixed dropdown under the search input */
    var rect = elSubEnqSearch.getBoundingClientRect();
    elSubEnqDropdown.style.left  = rect.left + 'px';
    elSubEnqDropdown.style.top   = (rect.bottom + 2) + 'px';
    elSubEnqDropdown.style.width = rect.width + 'px';
    renderSubEnqDropdown(elSubEnqSearch.value);
    elSubEnqDropdown.style.display = 'block';
    _subEnqOpen = true;
  }

  function closeSubEnqDropdown() {
    elSubEnqDropdown.style.display = 'none';
    _subEnqOpen = false;
  }

  function selectSubEnq(value, label) {
    if (value === '__new__') {
      elSubEnqHidden.value = '';
      elSubEnqSearch.value = '';
      closeSubEnqDropdown();
      elNewSubRow.style.display = 'flex';
      elNewSubInput.focus();
      return;
    }
    elSubEnqHidden.value = value;
    /* Show the label in the search box; for None show placeholder instead */
    elSubEnqSearch.value = value ? label : '';
    if (!value) elSubEnqSearch.placeholder = '— None (click to change) —';
    closeSubEnqDropdown();
    elNewSubRow.style.display = 'none';
  }

  /* Refresh combo after adding a new sub-enquiry */
  function refreshSubEnqCombo(scheme, category, enquiry, selectValue) {
    buildSubEnqOptions(scheme, category, enquiry);
    var found = _subEnqOptions.find(function (o) { return o.value === selectValue; });
    if (found) {
      selectSubEnq(found.value, found.label);
    }
  }

  /* Wire combo events */
  elSubEnqSearch.addEventListener('focus', function () {
    if (!elSubEnqSearch.disabled) {
      elSubEnqSearch.select();
      openSubEnqDropdown();
    }
  });

  elSubEnqSearch.addEventListener('input', function () {
    elSubEnqHidden.value = ''; /* clear selection while typing */
    openSubEnqDropdown();
    renderSubEnqDropdown(elSubEnqSearch.value);
  });

  elSubEnqSearch.addEventListener('blur', function () {
    /* Small delay so mousedown on item fires first */
    setTimeout(closeSubEnqDropdown, 150);
  });

  elSubEnqSearch.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSubEnqDropdown(); elSubEnqSearch.blur(); }
  });

  function onSchemeChange() {
    var scheme = elSchemeSelect.value;
    elCategorySelect.innerHTML = '<option value="">— Select Category —</option>';
    elCategorySelect.disabled = !scheme;
    elEnquirySelect.innerHTML  = '<option value="">— Select Category first —</option>';
    elEnquirySelect.disabled   = true;
    resetSubEnqCombo();
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
    resetSubEnqCombo();
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
    resetSubEnqCombo();
    if (!scheme || !category || !enquiry) return;
    buildSubEnqOptions(scheme, category, enquiry);
    elSubEnqSearch.disabled = false;
    elSubEnqSearch.placeholder = 'Search or select sub-enquiry…';
  }

  elSchemeSelect.addEventListener('change', onSchemeChange);
  elCategorySelect.addEventListener('change', onCategoryChange);
  elEnquirySelect.addEventListener('change', onEnquiryChange);

  /* Cancel adding new sub-enquiry */
  var elCancelNewSub = $('sbCancelNewSub');
  if (elCancelNewSub) {
    elCancelNewSub.addEventListener('click', function () {
      elNewSubRow.style.display = 'none';
      elNewSubInput.value = '';
    });
  }

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
      refreshSubEnqCombo(scheme, category, enquiry, val);
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

    /* If there's a partially-filled tag form, add it automatically before saving */
    var pendingScheme   = elSchemeSelect.value;
    var pendingCategory = elCategorySelect.value;
    var pendingEnquiry  = elEnquirySelect.value;
    if (pendingScheme && pendingCategory && pendingEnquiry) {
      var pendingSub = (elSubEnqHidden.value === '__new__' || !elSubEnqHidden.value) ? '' : elSubEnqHidden.value;
      addCurrentTagToTemp(pendingScheme, pendingCategory, pendingEnquiry, pendingSub);
    }

    if (!SB_tempTags.length) {
      showToast('Please add at least one tag (Scheme, Category and Enquiry).', 'error');
      return;
    }

    var rec = SB_db[SB_currentKey];
    rec.status   = 'categorised';
    rec.tags     = SB_tempTags.slice();
    /* Keep legacy flat fields pointing to first tag for compatibility */
    rec.scheme    = rec.tags[0].scheme;
    rec.category  = rec.tags[0].category;
    rec.enquiry   = rec.tags[0].enquiry;
    rec.subEnquiry= rec.tags[0].subEnquiry;
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

  /* ── TEMP TAGS (multiple scheme/category/enquiry/subEnquiry per sentence) ── */

  var elTempTagsList = $('sbTempTagsList');

  function tagKey(tag) {
    return tag.scheme + '||' + tag.category + '||' + tag.enquiry + '||' + (tag.subEnquiry || '');
  }

  function addCurrentTagToTemp(scheme, category, enquiry, subEnquiry) {
    var newTag = { scheme: scheme, category: category, enquiry: enquiry, subEnquiry: subEnquiry || '' };
    var nk = tagKey(newTag);
    var exists = SB_tempTags.some(function(t){ return tagKey(t) === nk; });
    if (exists) { showToast('That tag combination is already added.', 'error'); return false; }
    SB_tempTags.push(newTag);
    renderTempTagsList();
    return true;
  }

  function renderTempTagsList() {
    if (!elTempTagsList) return;
    elTempTagsList.innerHTML = '';
    if (!SB_tempTags.length) {
      elTempTagsList.innerHTML = '<div style="font-size:11px; color:var(--sf-gray-5); font-style:italic;">No tags yet — fill the form below and click ＋ Add Tag.</div>';
      return;
    }
    SB_tempTags.forEach(function(tag, idx) {
      var chip = document.createElement('div');
      chip.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;background:#f0f4ff;border:1px solid #c5d6f8;border-radius:6px;padding:4px 8px;margin-bottom:4px;';
      var inner = '<span class="sb-viewer-tag sb-viewer-tag-scheme" style="font-size:10px;">' + escH(tag.scheme) + '</span>' +
        '<span class="sb-viewer-tag sb-viewer-tag-cat" style="font-size:10px;">' + escH(tag.category) + '</span>' +
        '<span class="sb-viewer-tag sb-viewer-tag-enq" style="font-size:10px;">' + escH(tag.enquiry) + '</span>';
      if (tag.subEnquiry) inner += '<span class="sb-viewer-tag sb-viewer-tag-sub" style="font-size:10px;">' + escH(tag.subEnquiry) + '</span>';
      chip.innerHTML = inner + '<button class="sb-child-chip-del" data-tagidx="' + idx + '" title="Remove tag" style="margin-left:auto;">✕</button>';
      elTempTagsList.appendChild(chip);
    });
  }

  if (elTempTagsList) {
    elTempTagsList.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-tagidx]');
      if (!btn) return;
      var idx = parseInt(btn.dataset.tagidx, 10);
      SB_tempTags.splice(idx, 1);
      renderTempTagsList();
    });
  }

  /* ＋ Add Tag button */
  var elAddTagBtn = $('sbAddTagBtn');
  if (elAddTagBtn) {
    elAddTagBtn.addEventListener('click', function() {
      var scheme   = elSchemeSelect.value;
      var category = elCategorySelect.value;
      var enquiry  = elEnquirySelect.value;
      if (!scheme || !category || !enquiry) {
        showToast('Select Scheme, Category and Enquiry before adding a tag.', 'error');
        return;
      }
      var subEnq = (elSubEnqHidden.value === '__new__' || !elSubEnqHidden.value) ? '' : elSubEnqHidden.value;
      if (addCurrentTagToTemp(scheme, category, enquiry, subEnq)) {
        /* Reset the dropdowns so user can add another tag */
        resetCatForm();
        showToast('Tag added! Add another or click ✓ Categorise to save.', 'success');
      }
    });
  }

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

  /* ── TAXONOMY FILTER STATE ──────────────────────────────────── */
  /* { type: 'enquiry'|'sub', scheme, category, enquiry, sub } or null */
  var _taxFilter = null;

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
        if (r.status !== 'categorised') return false;
        /* Multi-tag: check if any tag matches */
        if (r.tags && r.tags.length) {
          return r.tags.some(function(t){ return t.scheme === scheme && t.category === cat && t.enquiry === enq; });
        }
        /* Legacy flat */
        return r.scheme === scheme && r.category === cat && r.enquiry === enq;
      }).length;
    }

    /* Count categorised sentences per sub-enquiry */
    function countForSub(scheme, cat, enq, sub) {
      return Object.keys(SB_db).filter(function (k) {
        var r = SB_db[k];
        if (r.status !== 'categorised') return false;
        if (r.tags && r.tags.length) {
          return r.tags.some(function(t){ return t.scheme === scheme && t.category === cat && t.enquiry === enq && t.subEnquiry === sub; });
        }
        return r.scheme === scheme && r.category === cat && r.enquiry === enq && r.subEnquiry === sub;
      }).length;
    }

    elTaxTree.innerHTML = '';
    Object.keys(map).sort(function(a,b){ return SB_taxSortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a); }).forEach(function (scheme) {
      var schemeDiv = document.createElement('div');
      schemeDiv.className = 'sb-tax-scheme';

      var hdr = document.createElement('div');
      hdr.className = 'sb-tax-scheme-hdr';
      hdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;background:#0176d3;color:#fff;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;user-select:none;';
      var schemeArrow = document.createElement('span');
      schemeArrow.textContent = '▼'; /* start expanded */
      var schemeLbl = document.createElement('span');
      schemeLbl.style.cssText = 'flex-grow:1; flex-shrink:1; flex-basis:auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#fff;';
      schemeLbl.textContent = scheme;

      /* Delete scheme button */
      var schemeDelBtn = document.createElement('button');
      schemeDelBtn.textContent = '✕';
      schemeDelBtn.title = 'Delete this scheme';
      schemeDelBtn.style.cssText = 'background:rgba(255,255,255,0.2);border:none;border-radius:3px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;padding:1px 5px;line-height:1;flex-shrink:0;';
      schemeDelBtn.addEventListener('mouseenter', function() { schemeDelBtn.style.background = 'rgba(255,255,255,0.4)'; });
      schemeDelBtn.addEventListener('mouseleave', function() { schemeDelBtn.style.background = 'rgba(255,255,255,0.2)'; });
      schemeDelBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!confirm('Delete scheme "' + scheme + '" and all its categories/enquiries? Sentence tags using this scheme will be cleared.')) return;
        /* Remove from taxonomy */
        SB_taxonomy = SB_taxonomy.filter(function (r) { return r.scheme !== scheme; });
        /* Remove sub-enquiries for this scheme */
        Object.keys(SB_subEnquiries).forEach(function (k) {
          if (k.indexOf(scheme + '||') === 0) delete SB_subEnquiries[k];
        });
        /* Clear tags on sentences that used this scheme */
        Object.keys(SB_db).forEach(function (k) {
          var rec = SB_db[k];
          if (rec.tags) {
            rec.tags = rec.tags.filter(function (t) { return t.scheme !== scheme; });
          }
          if (rec.scheme === scheme) { rec.scheme = ''; rec.category = ''; rec.enquiry = ''; rec.subEnquiry = ''; }
          if (rec.tags && rec.tags.length === 0 && rec.status === 'categorised') rec.status = 'pending';
        });
        if (_taxFilter && _taxFilter.scheme === scheme) _taxFilter = null;
        rebuildQueue();
        updateQueueBadge();
        renderTaxonomy();
        renderViewer();
        updateViewerSchemeFilter();
        showToast('Scheme "' + scheme + '" deleted.', '');
      });

      hdr.appendChild(schemeArrow);
      hdr.appendChild(schemeLbl);
      hdr.appendChild(schemeDelBtn);

      var schemeBody = document.createElement('div');
      schemeBody.className = 'sb-tax-scheme-body open'; /* start open */

      hdr.addEventListener('click', function () {
        schemeBody.classList.toggle('open');
        schemeArrow.textContent = schemeBody.classList.contains('open') ? '▼' : '▶';
      });

      Object.keys(map[scheme]).sort(function(a,b){ return SB_taxSortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a); }).forEach(function (cat) {
        var catDiv = document.createElement('div');
        catDiv.className = 'sb-tax-cat';
        var catHdr = document.createElement('div');
        catHdr.className = 'sb-tax-cat-hdr';
        var catArrow = document.createElement('span');
        catArrow.textContent = '▼'; /* start expanded */
        var catLbl = document.createElement('span');
        catLbl.style.cssText = 'flex-grow:1; flex-shrink:1; flex-basis:auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        catLbl.textContent = cat;
        catHdr.appendChild(catArrow);
        catHdr.appendChild(catLbl);
        var catBody = document.createElement('div');
        catBody.className = 'sb-tax-cat-body open'; /* start open */

        catHdr.addEventListener('click', function () {
          catBody.classList.toggle('open');
          catArrow.textContent = catBody.classList.contains('open') ? '▼' : '▶';
        });

        map[scheme][cat].sort(function(a,b){ return SB_taxSortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a); }).forEach(function (enq) {
          var cnt   = countFor(scheme, cat, enq);
          var enqEl = document.createElement('div');
          enqEl.className = 'sb-tax-enquiry';

          /* highlight if active filter */
          var isEnqActive = _taxFilter && _taxFilter.type === 'enquiry' &&
            _taxFilter.scheme === scheme && _taxFilter.category === cat && _taxFilter.enquiry === enq;
          if (isEnqActive) enqEl.classList.add('sb-tax-active');

          enqEl.innerHTML = escH(enq) + (cnt ? ' <span style="font-size:10px;background:#e8f0fe;color:#1a56ab;padding:1px 5px;border-radius:999px;font-weight:600;">' + cnt + '</span>' : '');
          catBody.appendChild(enqEl);

          /* Click on enquiry: filter viewer */
          enqEl.addEventListener('click', function (e) {
            e.stopPropagation();
            if (isEnqActive) {
              _taxFilter = null;
            } else {
              _taxFilter = { type: 'enquiry', scheme: scheme, category: cat, enquiry: enq };
            }
            renderTaxonomy();
            renderViewer();
          });

          /* Sub-enquiries */
          var subs = getSubEnquiries(scheme, cat, enq).slice().sort(function(a,b){ return SB_taxSortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a); });
          subs.forEach(function (sub) {
            var subCnt = countForSub(scheme, cat, enq, sub);
            var subEl = document.createElement('div');
            subEl.className = 'sb-tax-sub';

            /* highlight if active filter */
            var isSubActive = _taxFilter && _taxFilter.type === 'sub' &&
              _taxFilter.scheme === scheme && _taxFilter.category === cat &&
              _taxFilter.enquiry === enq && _taxFilter.sub === sub;
            if (isSubActive) subEl.classList.add('sb-tax-active');

            subEl.innerHTML = '↳ ' + escH(sub) + (subCnt ? ' <span style="font-size:10px;background:#f0e8ff;color:#7526e3;padding:1px 5px;border-radius:999px;font-weight:600;">' + subCnt + '</span>' : '');
            catBody.appendChild(subEl);

            /* Click on sub-enquiry: filter viewer */
            subEl.addEventListener('click', function (e) {
              e.stopPropagation();
              if (isSubActive) {
                _taxFilter = null;
              } else {
                _taxFilter = { type: 'sub', scheme: scheme, category: cat, enquiry: enq, sub: sub };
              }
              renderTaxonomy();
              renderViewer();
            });
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

  /* ── FIX + MERGE HELPER ─────────────────────────────────────────
     Fixes a cut-off sentence by renaming its DB key to newKey.
     If newKey already exists in SB_db, merges both records:
       • tags:      union of both (deduped by scheme+cat+enq+sub)
       • status:    'categorised' wins over 'pending' / 'ignored'
       • sourceIds: union
       • children:  union
     The old record and (if merging) the existing record are both removed;
     a single merged record is written under newKey.
     Returns the merged/fixed record, or null on no-op.             */
  function sbMergeAndFix(oldKey, newText) {
    var oldRec = SB_db[oldKey];
    if (!oldRec) return null;
    var newKey = norm(newText);
    if (newKey === oldKey) return null; /* already matches */

    var existingRec = SB_db[newKey]; /* may or may not exist */

    /* ── Build merged record ── */
    /* Start from the "more complete" record as base */
    var base, other;
    if (!existingRec) {
      base  = oldRec;
      other = null;
    } else if (existingRec.status === 'categorised' && oldRec.status !== 'categorised') {
      base  = existingRec;
      other = oldRec;
    } else {
      /* old record wins as base (it's the one the user just fixed) */
      base  = oldRec;
      other = existingRec;
    }

    /* Merge tags (union, deduped) */
    function tagKey(t) { return (t.scheme||'') + '||' + (t.category||'') + '||' + (t.enquiry||'') + '||' + (t.subEnquiry||''); }
    var mergedTags = (base.tags || []).map(function(t){ return Object.assign({}, t); });
    var seen = {};
    mergedTags.forEach(function(t){ seen[tagKey(t)] = true; });
    if (other) {
      (other.tags || []).forEach(function(t) {
        var k = tagKey(t);
        if (!seen[k] && t.scheme && t.category && t.enquiry) {
          mergedTags.push(Object.assign({}, t));
          seen[k] = true;
        }
      });
    }

    /* Status: categorised > pending > ignored */
    var statusRank = { categorised: 2, pending: 1, ignored: 0 };
    var mergedStatus = base.status;
    if (other && (statusRank[other.status] || 0) > (statusRank[base.status] || 0)) {
      mergedStatus = other.status;
    }

    /* sourceIds union */
    var mergedSrcIds = (base.sourceIds || []).slice();
    if (other) {
      (other.sourceIds || []).forEach(function(id) {
        if (mergedSrcIds.indexOf(id) === -1) mergedSrcIds.push(id);
      });
    }

    /* children union */
    var mergedChildren = (base.children || []).slice();
    if (other) {
      (other.children || []).forEach(function(c) {
        if (mergedChildren.indexOf(c) === -1) mergedChildren.push(c);
      });
    }

    var merged = {
      text:        newKey,
      status:      mergedStatus,
      tags:        mergedTags,
      scheme:      mergedTags.length ? mergedTags[0].scheme    : '',
      category:    mergedTags.length ? mergedTags[0].category  : '',
      enquiry:     mergedTags.length ? mergedTags[0].enquiry   : '',
      subEnquiry:  mergedTags.length ? mergedTags[0].subEnquiry: '',
      children:    mergedChildren,
      sourceIds:   mergedSrcIds,
      sourceCount: mergedSrcIds.length || base.sourceCount || 1
    };

    /* Write merged, remove originals */
    SB_db[newKey] = merged;
    if (oldKey !== newKey) delete SB_db[oldKey];

    return merged;
  }

  /* ── FIX ALL: scan every DB entry, auto-apply cutoff fixes ────── */
  function sbFixAllSentences() {
    var keys = Object.keys(SB_db);
    var fixedCount = 0, mergedCount = 0;

    keys.forEach(function (k) {
      var r = SB_db[k];
      if (!r) return; /* may have been removed by an earlier merge in this loop */

      var sourceLetterText = sbGetSourceLetterText(r);
      if (!sourceLetterText) return;

      var fixedText = sbGetFixedSentence(r.text, sourceLetterText);
      if (!fixedText) return;

      var newKey = norm(fixedText);
      var wasMerge = !!SB_db[newKey] && newKey !== k;
      var merged = sbMergeAndFix(k, fixedText);
      if (!merged) return;

      fixedCount++;
      if (wasMerge) mergedCount++;
    });

    return { fixed: fixedCount, merged: mergedCount };
  }
  window.sbFixAllSentences = sbFixAllSentences;



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
      if (q && r.text.toLowerCase().indexOf(q) === -1) return false;

      /* Scheme filter — match if any tag has this scheme */
      if (scheme) {
        var hasScheme = false;
        if (r.tags && r.tags.length) {
          hasScheme = r.tags.some(function(t){ return t.scheme === scheme; });
        } else if (r.scheme === scheme) { hasScheme = true; }
        if (!hasScheme) return false;
      }

      /* Taxonomy sidebar filter */
      if (_taxFilter) {
        if (r.status !== 'categorised') return false;
        var tagMatches = false;
        if (r.tags && r.tags.length) {
          tagMatches = r.tags.some(function(t) {
            if (t.scheme !== _taxFilter.scheme || t.category !== _taxFilter.category || t.enquiry !== _taxFilter.enquiry) return false;
            if (_taxFilter.type === 'sub' && t.subEnquiry !== _taxFilter.sub) return false;
            return true;
          });
        } else {
          /* Legacy */
          tagMatches = r.scheme === _taxFilter.scheme && r.category === _taxFilter.category && r.enquiry === _taxFilter.enquiry;
          if (_taxFilter.type === 'sub') tagMatches = tagMatches && r.subEnquiry === _taxFilter.sub;
        }
        if (!tagMatches) return false;
      }
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
        /* Render all tags - multi-tag support */
        var activeTags = (r.tags && r.tags.length) ? r.tags : (r.scheme ? [{ scheme: r.scheme, category: r.category, enquiry: r.enquiry, subEnquiry: r.subEnquiry || '' }] : []);
        if (activeTags.length > 1) {
          tagsEl.innerHTML += '<span class="sb-viewer-tag" style="background:#e8f0fe;color:#1a56ab;font-weight:700;">' + activeTags.length + ' tags</span>';
        }
        activeTags.forEach(function(tag, ti) {
          if (ti > 0) tagsEl.innerHTML += '<span style="color:var(--sf-gray-3);font-size:10px;padding:0 2px;">|</span>';
          if (tag.scheme)    tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-scheme">' + escH(tag.scheme) + '</span>';
          if (tag.category)  tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-cat">' + escH(tag.category) + '</span>';
          if (tag.enquiry)   tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-enq">' + escH(tag.enquiry) + '</span>';
          if (tag.subEnquiry)tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-sub">' + escH(tag.subEnquiry) + '</span>';
        });
        if (r.children && r.children.length) {
          tagsEl.innerHTML += '<span class="sb-viewer-tag sb-viewer-tag-children">+' + r.children.length + ' variation' + (r.children.length !== 1 ? 's' : '') + '</span>';
        }
      } else {
        tagsEl.innerHTML = '<span class="sb-viewer-tag" style="background:#f5f5f5;color:#aaa;">Pending</span>';
      }

      /* ── Cut-off detection: check if sentence is truncated ── */
      var fixedText = null;
      var sourceLetterText = sbGetSourceLetterText(r);
      if (sourceLetterText) {
        fixedText = sbGetFixedSentence(r.text, sourceLetterText);
      }

      row.appendChild(textEl);
      row.appendChild(tagsEl);

      if (fixedText) {
        var fixBanner = document.createElement('div');
        fixBanner.style.cssText = 'font-size:10px;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:3px 7px;margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
        fixBanner.innerHTML = '<span>⚠ Looks cut off →</span>' +
          '<span style="color:#92400e;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px;" title="' + escH(fixedText) + '">' + escH(fixedText) + '</span>';
        var fixBtn = document.createElement('button');
        fixBtn.textContent = '🔧 Fix Sentence';
        fixBtn.style.cssText = 'font-size:10px;padding:2px 8px;background:#f59e0b;border:none;border-radius:4px;color:#fff;font-weight:700;cursor:pointer;flex-shrink:0;margin-left:auto;';
        fixBanner.appendChild(fixBtn);
        row.appendChild(fixBanner);

        /* Fix: rename/merge using shared helper */
        (function(oldKey, newText) {
          fixBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var newKey = norm(newText);
            var wasMerge = !!SB_db[newKey] && newKey !== oldKey;
            var merged = sbMergeAndFix(oldKey, newText);
            if (!merged) { showToast('Already matches source.', ''); return; }
            if (SB_currentKey === oldKey) SB_currentKey = newKey;
            showToast(wasMerge ? '✓ Fixed & merged with existing sentence.' : '✓ Sentence fixed.', 'success');
            rebuildQueue(); updateQueueBadge(); renderViewer();
          });
        })(k, fixedText);
      }

      /* Click to show sentence detail / edit popup */
      (function(rec, key) {
        row.addEventListener('click', function () { showSentenceDetail(rec, key); });
      })(r, k);

      elViewerList.appendChild(row);
    });
  }

  /* ── SENTENCE DETAIL / EDIT POPUP ───────────────────────────── */

  /* Key of the record currently open in the detail modal */
  var _detailKey = null;
  /* Working copy of tags being edited */
  var _detailTags = [];

  function showSentenceDetail(r, dbKey) {
    var modal = $('sbDetailModal');
    if (!modal) return;

    _detailKey = dbKey || null;
    /* Build working copy — migrate legacy flat fields if needed */
    var activeTags = (r.tags && r.tags.length)
      ? r.tags.map(function(t){ return Object.assign({}, t); })
      : (r.scheme ? [{ scheme: r.scheme, category: r.category, enquiry: r.enquiry, subEnquiry: r.subEnquiry || '' }] : []);
    _detailTags = activeTags;

    renderDetailModal(r);
    modal.classList.add('open');
  }

  function renderDetailModal(r) {
    var bodyEl = $('sbDetailBody');
    if (!bodyEl) return;

    /* ── Sentence text ── */
    var html = '<div class="sb-detail-sentence">' + escH(r.text) + '</div>';

    /* Cut-off check in detail modal */
    var dmSourceText = sbGetSourceLetterText(r);
    var dmFixed = dmSourceText ? sbGetFixedSentence(r.text, dmSourceText) : null;
    if (dmFixed) {
      html += '<div style="font-size:11px;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:5px;padding:5px 10px;margin-bottom:8px;display:flex;align-items:flex-start;gap:8px;">' +
        '<span>⚠ Sentence looks cut off. Full version:<br><em style="color:#92400e;">' + escH(dmFixed) + '</em></span>' +
        '<button id="sdFixSentenceBtn" style="font-size:11px;padding:3px 10px;background:#f59e0b;border:none;border-radius:4px;color:#fff;font-weight:700;cursor:pointer;flex-shrink:0;margin-left:auto;white-space:nowrap;">🔧 Fix</button>' +
        '</div>';
    }
    var statusBg = r.status === 'categorised' ? '#27ae60' : r.status === 'ignored' ? '#e74c3c' : '#aaa';
    html += '<div style="margin-bottom:12px;"><span style="font-size:11px;font-weight:700;background:' + statusBg + ';color:#fff;padding:2px 10px;border-radius:999px;">' + r.status.toUpperCase() + '</span></div>';

    /* ── Tags section (editable) ── */
    if (r.status === 'categorised' || r.status === 'pending') {
      html += '<div class="sb-detail-section-label" style="margin-bottom:8px;">🏷️ Tags' + (_detailTags.length ? ' (' + _detailTags.length + ')' : '') + '</div>';
      html += '<div id="sdTagRows"></div>';
      html += '<button class="sf-btn sf-btn-neutral sf-btn-sm" id="sdAddTagRow" style="font-size:11px;margin-top:4px;margin-bottom:14px;">＋ Add Another Tag</button>';
    }

    /* ── Variations ── */
    if (r.children && r.children.length) {
      html += '<div class="sb-detail-section-label">🔗 Variations / Child Sentences</div>';
      html += '<div class="sb-detail-children">';
      r.children.forEach(function (c) {
        html += '<div class="sb-child-chip"><span class="sb-child-chip-text">' + escH(c) + '</span></div>';
      });
      html += '</div>';
    }

    /* ── Source cases ── */
    if (r.sourceIds && r.sourceIds.length) {
      html += '<div class="sb-detail-section-label">📁 Found in Case' + (r.sourceIds.length > 1 ? 's' : '') + '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:5px;">';
      r.sourceIds.forEach(function (cid) {
        html += '<button class="sb-detail-case-link" data-caseid="' + escH(cid) + '">📁 ' + escH(cid) + '</button>';
      });
      html += '</div>';
    }

    bodyEl.innerHTML = html;

    /* Wire Fix Sentence button in detail modal */
    var sdFixBtn = $('sdFixSentenceBtn');
    if (sdFixBtn && dmFixed && _detailKey) {
      (function(oldKey, newText) {
        sdFixBtn.addEventListener('click', function() {
          var newKey = norm(newText);
          var wasMerge = !!SB_db[newKey] && newKey !== oldKey;
          var merged = sbMergeAndFix(oldKey, newText);
          if (!merged) { showToast('Already matches source.', ''); return; }
          if (SB_currentKey === oldKey) SB_currentKey = newKey;
          _detailKey = newKey;
          showToast(wasMerge ? '✓ Fixed & merged with existing sentence.' : '✓ Sentence fixed.', 'success');
          rebuildQueue(); updateQueueBadge(); renderViewer();
          renderDetailModal(SB_db[newKey]);
        });
      })(_detailKey, dmFixed);
    }

    /* Render the editable tag rows */
    if (r.status === 'categorised' || r.status === 'pending') {
      renderDetailTagRows();

      /* ＋ Add tag row */
      var addBtn = $('sdAddTagRow');
      if (addBtn) {
        addBtn.addEventListener('click', function() {
          _detailTags.push({ scheme: '', category: '', enquiry: '', subEnquiry: '' });
          renderDetailTagRows();
        });
      }
    }

    /* Wire case-link buttons */
    bodyEl.querySelectorAll('.sb-detail-case-link').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cid = btn.dataset.caseid;
        var modal = $('sbDetailModal');
        if (typeof window.tlSelectCaseById === 'function' && window.tlSelectCaseById(cid)) {
          if (modal) modal.classList.remove('open');
          showToast('📁 Opened case in Case Library', 'success');
        }
      });
    });
  }

  /* Build one editable tag row and append it to #sdTagRows */
  function renderDetailTagRows() {
    var container = $('sdTagRows');
    if (!container) return;
    container.innerHTML = '';

    _detailTags.forEach(function(tag, ti) {
      var row = document.createElement('div');
      row.className = 'sd-tag-edit-row';
      row.dataset.idx = ti + 1;

      /* ── Scheme select ── */
      var schemeWrap = _sdMakeField('Scheme');
      var schemeSelect = document.createElement('select');
      schemeSelect.className = 'sb-select sd-tag-scheme';
      schemeSelect.style.cssText = 'font-size:12px; flex:1;';
      var schemeOpt = document.createElement('option');
      schemeOpt.value = ''; schemeOpt.textContent = '— Scheme —';
      schemeSelect.appendChild(schemeOpt);
      getSchemes().forEach(function(s) {
        var o = document.createElement('option'); o.value = s; o.textContent = s;
        if (s === tag.scheme) o.selected = true;
        schemeSelect.appendChild(o);
      });
      schemeWrap.appendChild(schemeSelect);
      row.appendChild(schemeWrap);

      /* ── Category select ── */
      var catWrap = _sdMakeField('Category');
      var catSelect = document.createElement('select');
      catSelect.className = 'sb-select sd-tag-cat';
      catSelect.style.cssText = 'font-size:12px; flex:1;';
      catSelect.disabled = !tag.scheme;
      _sdPopulateCat(catSelect, tag.scheme, tag.category);
      catWrap.appendChild(catSelect);
      row.appendChild(catWrap);

      /* ── Enquiry select ── */
      var enqWrap = _sdMakeField('Enquiry');
      var enqSelect = document.createElement('select');
      enqSelect.className = 'sb-select sd-tag-enq';
      enqSelect.style.cssText = 'font-size:12px; flex:1;';
      enqSelect.disabled = !tag.category;
      _sdPopulateEnq(enqSelect, tag.scheme, tag.category, tag.enquiry);
      enqWrap.appendChild(enqSelect);
      row.appendChild(enqWrap);

      /* ── Sub-Enquiry select ── */
      var subWrap = _sdMakeField('Sub-Enquiry');
      var subSelect = document.createElement('select');
      subSelect.className = 'sb-select sd-tag-sub';
      subSelect.style.cssText = 'font-size:12px; flex:1;';
      subSelect.disabled = !tag.enquiry;
      _sdPopulateSub(subSelect, tag.scheme, tag.category, tag.enquiry, tag.subEnquiry);
      subWrap.appendChild(subSelect);
      row.appendChild(subWrap);

      /* ── Delete button ── */
      var delBtn = document.createElement('button');
      delBtn.className = 'sf-btn sf-btn-sm';
      delBtn.style.cssText = 'font-size:11px;background:#fff0f0;border-color:#f5c0c0;color:#c0392b;align-self:flex-end;flex-shrink:0;margin-bottom:2px;';
      delBtn.textContent = '🗑 Remove';
      row.appendChild(delBtn);

      container.appendChild(row);

      /* ── Cascade change events ── */
      (function(idx, sS, cS, eS, suS, dB) {
        sS.addEventListener('change', function() {
          _detailTags[idx].scheme = sS.value;
          _detailTags[idx].category = '';
          _detailTags[idx].enquiry = '';
          _detailTags[idx].subEnquiry = '';
          cS.disabled = !sS.value;
          _sdPopulateCat(cS, sS.value, '');
          eS.disabled = true; _sdPopulateEnq(eS, '', '', '');
          suS.disabled = true; _sdPopulateSub(suS, '', '', '', '');
        });
        cS.addEventListener('change', function() {
          _detailTags[idx].category = cS.value;
          _detailTags[idx].enquiry = '';
          _detailTags[idx].subEnquiry = '';
          eS.disabled = !cS.value;
          _sdPopulateEnq(eS, sS.value, cS.value, '');
          suS.disabled = true; _sdPopulateSub(suS, '', '', '', '');
        });
        eS.addEventListener('change', function() {
          _detailTags[idx].enquiry = eS.value;
          _detailTags[idx].subEnquiry = '';
          suS.disabled = !eS.value;
          _sdPopulateSub(suS, sS.value, cS.value, eS.value, '');
        });
        suS.addEventListener('change', function() {
          _detailTags[idx].subEnquiry = suS.value === '__none__' ? '' : suS.value;
        });
        dB.addEventListener('click', function() {
          _detailTags.splice(idx, 1);
          renderDetailTagRows();
        });
      })(ti, schemeSelect, catSelect, enqSelect, subSelect, delBtn);
    });
  }

  /* Helper: make a labelled field wrapper */
  function _sdMakeField(label) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;';
    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:10px;font-weight:700;color:var(--sf-gray-6);text-transform:uppercase;letter-spacing:0.04em;';
    lbl.textContent = label;
    wrap.appendChild(lbl);
    return wrap;
  }

  function _sdPopulateCat(sel, scheme, current) {
    sel.innerHTML = '';
    var o = document.createElement('option'); o.value = ''; o.textContent = '— Category —'; sel.appendChild(o);
    getCategoriesForScheme(scheme).forEach(function(c) {
      var opt = document.createElement('option'); opt.value = c; opt.textContent = c;
      if (c === current) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function _sdPopulateEnq(sel, scheme, category, current) {
    sel.innerHTML = '';
    var o = document.createElement('option'); o.value = ''; o.textContent = '— Enquiry —'; sel.appendChild(o);
    getEnquiriesForCat(scheme, category).forEach(function(e) {
      var opt = document.createElement('option'); opt.value = e; opt.textContent = e;
      if (e === current) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function _sdPopulateSub(sel, scheme, category, enquiry, current) {
    sel.innerHTML = '';
    var none = document.createElement('option'); none.value = '__none__'; none.textContent = '— None —'; sel.appendChild(none);
    getSubEnquiries(scheme, category, enquiry).forEach(function(s) {
      var opt = document.createElement('option'); opt.value = s; opt.textContent = s;
      if (s === current) opt.selected = true;
      sel.appendChild(opt);
    });
    /* If the saved value isn't in the current list (renamed/deleted), show it as a stale option so user can see it */
    if (current) {
      var found = Array.from(sel.options).some(function(o){ return o.value === current; });
      if (!found) {
        var stale = document.createElement('option');
        stale.value = current;
        stale.textContent = '⚠ ' + current + ' (no longer in list)';
        stale.style.color = '#c0392b';
        stale.selected = true;
        sel.appendChild(stale);
      }
    }
    if (!current) sel.value = '__none__';
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
      v: 2,
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
    if (!payload || (payload.v !== 1 && payload.v !== 2)) {
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
        var r = payload.db[k];
        if (!r || !r.text) return;

        /* Migrate v1 flat fields → tags array */
        var importedTags = [];
        if (Array.isArray(r.tags) && r.tags.length) {
          importedTags = r.tags;
        } else if (r.scheme && r.category && r.enquiry) {
          importedTags = [{ scheme: r.scheme, category: r.category, enquiry: r.enquiry, subEnquiry: r.subEnquiry || '' }];
        }

        if (SB_db[k]) {
          /* Record already exists — only overwrite if imported is categorised
             and existing is pending/ignored (don't lose work) */
          if (r.status === 'categorised' && SB_db[k].status !== 'categorised') {
            SB_db[k].status   = 'categorised';
            SB_db[k].tags     = importedTags;
            /* Legacy flat fields for compat */
            SB_db[k].scheme    = importedTags.length ? importedTags[0].scheme    : '';
            SB_db[k].category  = importedTags.length ? importedTags[0].category  : '';
            SB_db[k].enquiry   = importedTags.length ? importedTags[0].enquiry   : '';
            SB_db[k].subEnquiry= importedTags.length ? importedTags[0].subEnquiry: '';
            SB_db[k].children  = Array.isArray(r.children) ? r.children : SB_db[k].children;
            dbAdded++;
          }
          return;
        }
        SB_db[k] = {
          text: r.text,
          status: r.status || 'pending',
          tags: importedTags,
          scheme: importedTags.length ? importedTags[0].scheme     : '',
          category: importedTags.length ? importedTags[0].category : '',
          enquiry:  importedTags.length ? importedTags[0].enquiry  : '',
          subEnquiry: importedTags.length ? importedTags[0].subEnquiry : '',
          children: Array.isArray(r.children) ? r.children : [],
          sourceCount: r.sourceCount || 1,
          sourceIds: Array.isArray(r.sourceIds) ? r.sourceIds : []
        };
        dbAdded++;
      });
    }

    return {
      ok: true,
      taxAdded: taxAdded,
      subAdded: subAdded,
      dbAdded:  dbAdded,
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
      v: 2,
      taxonomy: SB_taxonomy,
      subEnquiries: SB_subEnquiries,
      db: sliceDb
    });
  }

  function renderBatchButtons() {
    var container   = $('sbBatchButtons');
    var totalEl     = $('sbExportTotalCount');
    if (!container) return;

    /* Export only categorised — ignored are auto-reapplied on next extraction */
    var dbKeys = Object.keys(SB_db).filter(function (k) {
      return SB_db[k].status === 'categorised';
    });
    var total        = dbKeys.length;
    var ignoredCount = Object.keys(SB_db).filter(function (k) { return SB_db[k].status === 'ignored'; }).length;
    var pendingCount = Object.keys(SB_db).filter(function (k) { return SB_db[k].status === 'pending'; }).length;
    if (totalEl) totalEl.textContent = total + ' categorised sentence' + (total !== 1 ? 's' : '') +
      (ignoredCount > 0 ? ' · ' + ignoredCount + ' auto-ignored excluded' : '') +
      (pendingCount > 0 ? ' · ' + pendingCount + ' pending excluded' : '');

    if (!total) {
      container.innerHTML = '<div style="font-size:12px; color:var(--sf-gray-5); font-style:italic;">No categorised or ignored sentences yet — finish reviewing first.</div>';
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
    /* Reset all boxes to a single empty box */
    var boxesEl = $('sbImportBoxes');
    if (boxesEl) {
      boxesEl.innerHTML =
        '<div class="tl-paste-box" id="sbImportBox_1">' +
          '<div class="tl-paste-box-hdr">' +
            '<span class="tl-paste-box-label">Batch 1</span>' +
            '<span class="tl-paste-box-count" id="sbImportCount_1"></span>' +
          '</div>' +
          '<textarea class="tl-paste-ta tl-paste-ta-narrow" id="sbImportTa" data-box="1"' +
            ' placeholder="Paste exported SmartBot data here…"' +
            ' style="font-family:monospace;font-size:11px;resize:none;height:260px;" spellcheck="false"></textarea>' +
        '</div>';
    }
    /* Re-read the (possibly new) textarea ref */
    elImportTa = $('sbImportTa');
    _sbImportBoxCount = 1;
    var statusEl = $('sbImportStatus');
    if (statusEl) statusEl.textContent = '';
    elImportModal.classList.add('open');
    if (elImportTa) elImportTa.focus();
  });

  $('sbImportModalClose').addEventListener('click', function () { elImportModal.classList.remove('open'); });
  $('sbImportModalClose2').addEventListener('click', function () { elImportModal.classList.remove('open'); });
  elImportModal.addEventListener('click', function (e) { if (e.target === elImportModal) elImportModal.classList.remove('open'); });

  /* ── MULTI-BOX IMPORT ───────────────────────────────────────── */
  var _sbImportBoxCount = 1;

  var sbImportAddBoxEl = $('sbImportAddBox');
  if (sbImportAddBoxEl) {
    sbImportAddBoxEl.addEventListener('click', function () {
      _sbImportBoxCount++;
      var n = _sbImportBoxCount;
      var boxesEl = $('sbImportBoxes');
      if (!boxesEl) return;
      var box = document.createElement('div');
      box.className = 'tl-paste-box';
      box.id = 'sbImportBox_' + n;
      box.innerHTML =
        '<div class="tl-paste-box-hdr">' +
          '<span class="tl-paste-box-label">Batch ' + n + '</span>' +
          '<span class="tl-paste-box-count" id="sbImportCount_' + n + '"></span>' +
          '<button class="tl-paste-box-remove" data-box="' + n + '" title="Remove">✕</button>' +
        '</div>' +
        '<textarea class="tl-paste-ta tl-paste-ta-narrow" data-box="' + n + '"' +
          ' placeholder="Paste exported SmartBot data here…"' +
          ' style="font-family:monospace;font-size:11px;resize:none;height:260px;" spellcheck="false"></textarea>';
      boxesEl.appendChild(box);
      box.querySelector('textarea').focus();
      /* Wire remove button */
      box.querySelector('.tl-paste-box-remove').addEventListener('click', function () {
        box.remove();
      });
    });
  }

  var sbImportClearAllEl = $('sbImportClearAll');
  if (sbImportClearAllEl) {
    sbImportClearAllEl.addEventListener('click', function () {
      var tas = document.querySelectorAll('#sbImportBoxes textarea');
      tas.forEach(function (ta) { ta.value = ''; });
      var statusEl = $('sbImportStatus');
      if (statusEl) statusEl.textContent = '';
    });
  }

  $('sbImportLoad').addEventListener('click', function () {
    /* Collect all non-empty boxes */
    var tas = document.querySelectorAll('#sbImportBoxes textarea');
    var totalTax = 0, totalSub = 0, totalDb = 0, errors = 0;

    tas.forEach(function (ta) {
      var raw = ta.value.trim();
      if (!raw) return;
      var result = importData(raw);
      if (result.ok) {
        totalTax += result.taxAdded || 0;
        totalSub += result.subAdded || 0;
        totalDb  += result.dbAdded  || 0;
      } else {
        errors++;
      }
    });

    var statusEl = $('sbImportStatus');
    var msg;
    if (errors && totalDb === 0 && totalTax === 0) {
      msg = '⚠ ' + errors + ' batch' + (errors !== 1 ? 'es' : '') + ' had errors. Check format.';
      if (statusEl) statusEl.textContent = msg;
      return;
    }
    msg = '✓ ' + totalTax + ' taxonomy rows, ' + totalSub + ' sub-enquiries, ' + totalDb + ' sentences imported' +
      (errors ? ' (' + errors + ' batch error' + (errors !== 1 ? 'es' : '') + ')' : '') + '.';
    if (statusEl) statusEl.textContent = msg;

    renderTaxonomy();
    rebuildQueue();
    updateQueueBadge();
    renderViewer();
    updateViewerSchemeFilter();
    populateSchemes();
    showToast(msg, 'success');
    setTimeout(function () { elImportModal.classList.remove('open'); }, 1200);
  });

  /* ── TAXONOMY SORT BUTTON ────────────────────────────────────── */
  var elTaxSortBtn = $('sbTaxSortBtn');
  if (elTaxSortBtn) {
    /* Set initial label */
    elTaxSortBtn.textContent = 'A → Z';
    elTaxSortBtn.addEventListener('click', function () {
      SB_taxSortDir = SB_taxSortDir === 'asc' ? 'desc' : 'asc';
      elTaxSortBtn.textContent = SB_taxSortDir === 'asc' ? 'A → Z' : 'Z → A';
      renderTaxonomy();
    });
  }

  /* ── ADD SUB-ENQUIRY BUTTON (inline, next to Add Tag) ─────────── */
  var elAddSubEnqBtn = $('sbAddSubEnqBtn');
  var elAddSubEnqInline = $('sbAddSubEnqInline');     /* the inline form row in HTML */
  var elAddSubEnqInput  = $('sbAddSubEnqInlineInput'); /* text input inside it */
  var elAddSubEnqSave   = $('sbAddSubEnqInlineSave');
  var elAddSubEnqCancel = $('sbAddSubEnqInlineCancel');

  function openAddSubEnqInline() {
    var scheme   = elSchemeSelect.value;
    var category = elCategorySelect.value;
    var enquiry  = elEnquirySelect.value;
    if (!scheme || !category || !enquiry) {
      showToast('Select a Scheme, Category and Enquiry first.', 'error');
      return;
    }
    if (elAddSubEnqInline) {
      elAddSubEnqInline.style.display = 'flex';
      if (elAddSubEnqInput) { elAddSubEnqInput.value = ''; elAddSubEnqInput.focus(); }
    }
  }

  if (elAddSubEnqBtn) {
    elAddSubEnqBtn.addEventListener('click', openAddSubEnqInline);
  }

  if (elAddSubEnqCancel) {
    elAddSubEnqCancel.addEventListener('click', function () {
      if (elAddSubEnqInline) elAddSubEnqInline.style.display = 'none';
      if (elAddSubEnqInput)  elAddSubEnqInput.value = '';
    });
  }

  if (elAddSubEnqSave) {
    elAddSubEnqSave.addEventListener('click', function () {
      var scheme   = elSchemeSelect.value;
      var category = elCategorySelect.value;
      var enquiry  = elEnquirySelect.value;
      var val      = elAddSubEnqInput ? norm(elAddSubEnqInput.value) : '';
      if (!scheme || !category || !enquiry || !val) {
        showToast('Select Scheme, Category and Enquiry first, then type a name.', 'error');
        return;
      }
      if (addSubEnquiry(scheme, category, enquiry, val)) {
        refreshSubEnqCombo(scheme, category, enquiry, val);
        renderTaxonomy();
        if (elAddSubEnqInline) elAddSubEnqInline.style.display = 'none';
        if (elAddSubEnqInput)  elAddSubEnqInput.value = '';
        showToast('Sub-Enquiry "' + val + '" added!', 'success');
      } else {
        showToast('That Sub-Enquiry already exists.', 'error');
      }
    });
  }

  /* Allow Enter key in the inline sub-enquiry input */
  if (elAddSubEnqInput) {
    elAddSubEnqInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { if (elAddSubEnqSave) elAddSubEnqSave.click(); }
      if (e.key === 'Escape') { if (elAddSubEnqCancel) elAddSubEnqCancel.click(); }
    });
  }

  /* ── SUB-ENQUIRY MANAGER ─────────────────────────────────────── */

  var elSubMgrModal   = $('sbSubMgrModal');
  var elSubMgrScheme  = $('sbSubMgrScheme');
  var elSubMgrCat     = $('sbSubMgrCat');
  var elSubMgrEnq     = $('sbSubMgrEnq');
  var elSubMgrSearch  = $('sbSubMgrSearch');
  var elSubMgrList    = $('sbSubMgrList');
  var elSubMgrCount   = $('sbSubMgrCount');
  var elSubMgrAddScheme = $('sbSubMgrAddScheme');
  var elSubMgrAddCat    = $('sbSubMgrAddCat');
  var elSubMgrAddEnq    = $('sbSubMgrAddEnq');
  var elSubMgrAddInput  = $('sbSubMgrAddInput');

  /* Only wire up if all elements exist */
  if (elSubMgrModal && elSubMgrScheme && elSubMgrCat && elSubMgrEnq &&
      elSubMgrSearch && elSubMgrList && elSubMgrAddScheme && elSubMgrAddCat &&
      elSubMgrAddEnq && elSubMgrAddInput) {

  function populateSubMgrFilters() {
    var schemes = getSchemes();

    /* Filter dropdowns */
    var curS = elSubMgrScheme.value;
    elSubMgrScheme.innerHTML = '<option value="">All Schemes</option>';
    schemes.forEach(function (s) {
      var o = document.createElement('option'); o.value = s; o.textContent = s;
      elSubMgrScheme.appendChild(o);
    });
    elSubMgrScheme.value = curS;

    var curC = elSubMgrCat.value;
    elSubMgrCat.innerHTML = '<option value="">All Categories</option>';
    if (curS) {
      getCategoriesForScheme(curS).forEach(function (c) {
        var o = document.createElement('option'); o.value = c; o.textContent = c;
        elSubMgrCat.appendChild(o);
      });
    }
    elSubMgrCat.value = curC;

    var curE = elSubMgrEnq.value;
    elSubMgrEnq.innerHTML = '<option value="">All Enquiries</option>';
    if (curS && curC) {
      getEnquiriesForCat(curS, curC).forEach(function (e) {
        var o = document.createElement('option'); o.value = e; o.textContent = e;
        elSubMgrEnq.appendChild(o);
      });
    }
    elSubMgrEnq.value = curE;

    /* Add-new dropdowns */
    var aS = elSubMgrAddScheme.value;
    elSubMgrAddScheme.innerHTML = '<option value="">— Scheme —</option>';
    schemes.forEach(function (s) {
      var o = document.createElement('option'); o.value = s; o.textContent = s;
      elSubMgrAddScheme.appendChild(o);
    });
    elSubMgrAddScheme.value = aS;

    var aC = elSubMgrAddCat.value;
    elSubMgrAddCat.innerHTML = '<option value="">— Category —</option>';
    elSubMgrAddCat.disabled = !aS;
    if (aS) {
      getCategoriesForScheme(aS).forEach(function (c) {
        var o = document.createElement('option'); o.value = c; o.textContent = c;
        elSubMgrAddCat.appendChild(o);
      });
    }
    elSubMgrAddCat.value = aC;

    var aE = elSubMgrAddEnq.value;
    elSubMgrAddEnq.innerHTML = '<option value="">— Enquiry —</option>';
    elSubMgrAddEnq.disabled = !(aS && aC);
    if (aS && aC) {
      getEnquiriesForCat(aS, aC).forEach(function (e) {
        var o = document.createElement('option'); o.value = e; o.textContent = e;
        elSubMgrAddEnq.appendChild(o);
      });
    }
    elSubMgrAddEnq.value = aE;
  }

  function renderSubMgrList() {
    var fScheme = elSubMgrScheme.value;
    var fCat    = elSubMgrCat.value;
    var fEnq    = elSubMgrEnq.value;
    var fQ      = (elSubMgrSearch.value || '').toLowerCase().trim();

    /* Collect all sub-enquiry entries */
    var rows = [];
    Object.keys(SB_subEnquiries).forEach(function (key) {
      var parts = key.split('||');
      if (parts.length !== 3) return;
      var scheme = parts[0], cat = parts[1], enq = parts[2];
      if (fScheme && scheme !== fScheme) return;
      if (fCat    && cat    !== fCat)    return;
      if (fEnq    && enq    !== fEnq)    return;
      (SB_subEnquiries[key] || []).forEach(function (sub) {
        if (fQ && sub.toLowerCase().indexOf(fQ) === -1 &&
            scheme.toLowerCase().indexOf(fQ) === -1 &&
            cat.toLowerCase().indexOf(fQ)    === -1 &&
            enq.toLowerCase().indexOf(fQ)    === -1) return;
        rows.push({ key: key, scheme: scheme, cat: cat, enq: enq, sub: sub });
      });
    });

    elSubMgrCount.textContent = rows.length + ' sub-enqu' + (rows.length !== 1 ? 'iries' : 'iry');

    if (!rows.length) {
      elSubMgrList.innerHTML = '<div style="font-size:12px; color:var(--sf-gray-5); font-style:italic; padding:12px 0;">' +
        (Object.keys(SB_subEnquiries).length ? 'No results match your filter.' : 'No sub-enquiries yet. Add one above.') + '</div>';
      return;
    }

    /* Group by key for tidy display */
    rows.sort(function (a, b) {
      if (a.key < b.key) return -1; if (a.key > b.key) return 1;
      return a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0;
    });

    elSubMgrList.innerHTML = '';
    var lastKey = null;
    rows.forEach(function (r) {
      if (r.key !== lastKey) {
        lastKey = r.key;
        var hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:11px; font-weight:700; color:var(--sf-gray-6); padding:8px 4px 4px; text-transform:uppercase; letter-spacing:0.04em; border-top:1px solid var(--sf-gray-2); margin-top:4px;';
        hdr.textContent = r.scheme + ' › ' + r.cat + ' › ' + r.enq;
        elSubMgrList.appendChild(hdr);
      }

      var row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:5px 6px; border-radius:5px; background:#fafafa; border:1px solid var(--sf-gray-2); margin-bottom:4px;';

      var namePart = document.createElement('span');
      namePart.style.cssText = 'flex:1; font-size:12px; color:var(--sf-gray-8);';
      namePart.textContent = r.sub;

      /* Edit inline */
      var editBtn = document.createElement('button');
      editBtn.className = 'sf-btn sf-btn-neutral sf-btn-sm';
      editBtn.style.fontSize = '11px';
      editBtn.textContent = '✏️ Rename';

      /* Delete */
      var delBtn = document.createElement('button');
      delBtn.className = 'sf-btn sf-btn-sm';
      delBtn.style.cssText = 'font-size:11px; background:#fff0f0; border-color:#f5c0c0; color:#c0392b;';
      delBtn.textContent = '🗑 Delete';

      (function (subKey, subVal) {
        editBtn.addEventListener('click', function () {
          var newName = prompt('Rename sub-enquiry "' + subVal + '" to:', subVal);
          if (!newName) return;
          newName = norm(newName);
          if (!newName || newName === subVal) return;
          var arr = SB_subEnquiries[subKey];
          if (!arr) return;
          if (arr.indexOf(newName) !== -1) { showToast('That name already exists.', 'error'); return; }
          var idx = arr.indexOf(subVal);
          if (idx === -1) return;
          arr[idx] = newName;
          /* Update any db entries - both flat fields and tags array */
          Object.keys(SB_db).forEach(function (k) {
            var p = subKey.split('||');
            /* Update tags array */
            if (SB_db[k].tags) {
              SB_db[k].tags.forEach(function(t) {
                if (t.scheme === p[0] && t.category === p[1] && t.enquiry === p[2] && t.subEnquiry === subVal) {
                  t.subEnquiry = newName;
                }
              });
            }
            /* Update legacy flat fields */
            if (SB_db[k].subEnquiry === subVal && SB_db[k].scheme === p[0] && SB_db[k].category === p[1] && SB_db[k].enquiry === p[2]) {
              SB_db[k].subEnquiry = newName;
            }
          });
          showToast('Renamed to "' + newName + '"', 'success');
          renderTaxonomy();
          renderSubMgrList();
        });

        delBtn.addEventListener('click', function () {
          if (!confirm('Delete sub-enquiry "' + subVal + '"? Sentences using it will have their sub-enquiry cleared.')) return;
          var arr = SB_subEnquiries[subKey];
          if (!arr) return;
          var idx = arr.indexOf(subVal);
          if (idx !== -1) arr.splice(idx, 1);
          /* Clear db entries - both flat fields and tags array */
          Object.keys(SB_db).forEach(function (k) {
            var p = subKey.split('||');
            /* Update tags array */
            if (SB_db[k].tags) {
              SB_db[k].tags.forEach(function(t) {
                if (t.scheme === p[0] && t.category === p[1] && t.enquiry === p[2] && t.subEnquiry === subVal) {
                  t.subEnquiry = '';
                }
              });
            }
            /* Update legacy flat fields */
            if (SB_db[k].subEnquiry === subVal && SB_db[k].scheme === p[0] && SB_db[k].category === p[1] && SB_db[k].enquiry === p[2]) {
              SB_db[k].subEnquiry = '';
            }
          });
          showToast('"' + subVal + '" deleted.', '');
          renderTaxonomy();
          renderSubMgrList();
        });
      })(r.key, r.sub);

      row.appendChild(namePart);
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      elSubMgrList.appendChild(row);
    });
  }

  /* ── TAXONOMY MANAGER SECTION (inside Sub-Enquiry Manager modal) ── */

  function renderTaxMgrSection() {
    var container = $('sbTaxMgrSection');
    if (!container) return;

    container.innerHTML = '';

    /* ── Header ── */
    var hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:11px;font-weight:700;color:var(--sf-gray-6);text-transform:uppercase;letter-spacing:0.05em;padding:0 0 6px;border-bottom:1px solid var(--sf-gray-2);margin-bottom:8px;display:flex;align-items:center;gap:8px;';
    hdr.innerHTML = '<span style="flex:1;">📂 Schemes · Categories · Enquiries</span>';

    container.appendChild(hdr);

    if (!SB_taxonomy.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px;color:var(--sf-gray-5);font-style:italic;padding:6px 0 10px;';
      empty.textContent = 'No taxonomy loaded yet. Use Import Taxonomy to add one.';
      container.appendChild(empty);
      return;
    }

    /* Build scheme → cat → [enquiries] map */
    var map = {};
    SB_taxonomy.forEach(function (r) {
      if (!map[r.scheme]) map[r.scheme] = {};
      if (!map[r.scheme][r.category]) map[r.scheme][r.category] = [];
      if (map[r.scheme][r.category].indexOf(r.enquiry) === -1) map[r.scheme][r.category].push(r.enquiry);
    });

    var schemes = Object.keys(map).sort();

    /* ── Add new enquiry row (top-level quick-add) ── */
    var addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding:8px;background:#f5f8ff;border:1px solid #d0e0ff;border-radius:6px;';
    addRow.innerHTML = '<span style="font-size:11px;font-weight:600;color:var(--sf-gray-7);width:100%;margin-bottom:3px;">＋ Add new Scheme / Category / Enquiry:</span>';

    var addSchemeIn = document.createElement('input');
    addSchemeIn.type = 'text'; addSchemeIn.placeholder = 'Scheme';
    addSchemeIn.style.cssText = 'flex:1;min-width:90px;font-size:11px;border:1px solid var(--sf-gray-3);border-radius:4px;padding:3px 6px;';

    var addCatIn = document.createElement('input');
    addCatIn.type = 'text'; addCatIn.placeholder = 'Category';
    addCatIn.style.cssText = 'flex:1;min-width:90px;font-size:11px;border:1px solid var(--sf-gray-3);border-radius:4px;padding:3px 6px;';

    var addEnqIn = document.createElement('input');
    addEnqIn.type = 'text'; addEnqIn.placeholder = 'Enquiry';
    addEnqIn.style.cssText = 'flex:1;min-width:90px;font-size:11px;border:1px solid var(--sf-gray-3);border-radius:4px;padding:3px 6px;';

    var addBtn2 = document.createElement('button');
    addBtn2.className = 'sf-btn sf-btn-brand sf-btn-sm';
    addBtn2.style.fontSize = '11px';
    addBtn2.textContent = '＋ Add';

    addBtn2.addEventListener('click', function () {
      var s = norm(addSchemeIn.value), c = norm(addCatIn.value), e = norm(addEnqIn.value);
      if (!s || !c || !e) { showToast('Enter Scheme, Category and Enquiry.', 'error'); return; }
      if (addTaxonomyEntry(s, c, e)) {
        addSchemeIn.value = ''; addCatIn.value = ''; addEnqIn.value = '';
        renderTaxonomy(); populateSchemes(); renderTaxMgrSection(); populateSubMgrFilters();
        showToast('Added "' + s + ' › ' + c + ' › ' + e + '"', 'success');
      } else {
        showToast('That combination already exists.', 'error');
      }
    });

    addRow.appendChild(addSchemeIn); addRow.appendChild(addCatIn);
    addRow.appendChild(addEnqIn); addRow.appendChild(addBtn2);
    container.appendChild(addRow);

    /* ── Tree of scheme/category/enquiry with inline controls ── */
    schemes.forEach(function (scheme) {
      /* Scheme block */
      var schemeWrap = document.createElement('div');
      schemeWrap.style.cssText = 'margin-bottom:8px;';

      var schemeHdr = document.createElement('div');
      schemeHdr.style.cssText = 'display:flex;align-items:center;gap:5px;padding:4px 7px;background:#0176d3;color:#fff;border-radius:5px;font-size:11px;font-weight:700;';

      var sLabel = document.createElement('span');
      sLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      sLabel.textContent = scheme;

      /* Rename scheme */
      var sRenBtn = document.createElement('button');
      sRenBtn.style.cssText = 'background:rgba(255,255,255,0.2);border:none;border-radius:3px;color:#fff;font-size:10px;cursor:pointer;padding:1px 5px;';
      sRenBtn.textContent = '✏️ Rename';
      sRenBtn.addEventListener('click', function () {
        var newName = prompt('Rename scheme "' + scheme + '" to:', scheme);
        if (!newName) return;
        if (renameTaxonomyScheme(scheme, newName)) {
          rebuildQueue(); updateQueueBadge(); renderTaxonomy(); populateSchemes();
          renderTaxMgrSection(); populateSubMgrFilters(); renderSubMgrList();
          showToast('Scheme renamed to "' + norm(newName) + '"', 'success');
        } else { showToast('Name already exists or invalid.', 'error'); }
      });

      /* Delete scheme */
      var sDelBtn = document.createElement('button');
      sDelBtn.style.cssText = 'background:rgba(255,80,80,0.3);border:none;border-radius:3px;color:#fff;font-size:10px;cursor:pointer;padding:1px 5px;';
      sDelBtn.textContent = '🗑 Delete';
      sDelBtn.addEventListener('click', function () {
        if (!confirm('Delete scheme "' + scheme + '" and ALL its categories, enquiries and sub-enquiries? Sentence tags will be cleared.')) return;
        SB_taxonomy = SB_taxonomy.filter(function (r) { return r.scheme !== scheme; });
        Object.keys(SB_subEnquiries).forEach(function (k) { if (k.indexOf(scheme + '||') === 0) delete SB_subEnquiries[k]; });
        Object.keys(SB_db).forEach(function (k) {
          var rec = SB_db[k];
          if (rec.tags) { rec.tags = rec.tags.filter(function (t) { return t.scheme !== scheme; }); if (!rec.tags.length && rec.status === 'categorised') rec.status = 'pending'; }
          if (rec.scheme === scheme) { rec.scheme = ''; rec.category = ''; rec.enquiry = ''; rec.subEnquiry = ''; }
        });
        rebuildQueue(); updateQueueBadge(); renderTaxonomy(); populateSchemes();
        renderTaxMgrSection(); populateSubMgrFilters(); renderSubMgrList();
        showToast('Scheme "' + scheme + '" deleted.', '');
      });

      schemeHdr.appendChild(sLabel); schemeHdr.appendChild(sRenBtn); schemeHdr.appendChild(sDelBtn);
      schemeWrap.appendChild(schemeHdr);

      /* Categories under this scheme */
      var cats = Object.keys(map[scheme]).sort();
      cats.forEach(function (cat) {
        var catWrap = document.createElement('div');
        catWrap.style.cssText = 'margin-left:10px;margin-top:3px;';

        var catRow = document.createElement('div');
        catRow.style.cssText = 'display:flex;align-items:center;gap:5px;padding:3px 6px;background:#e8f0fe;border-radius:4px;font-size:11px;font-weight:600;color:#1a3a6b;';

        var cLabel = document.createElement('span');
        cLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        cLabel.textContent = cat;

        /* Rename category */
        var cRenBtn = document.createElement('button');
        cRenBtn.style.cssText = 'background:rgba(255,255,255,0.6);border:1px solid #c5d6f8;border-radius:3px;font-size:10px;cursor:pointer;padding:1px 5px;color:#1a3a6b;';
        cRenBtn.textContent = '✏️ Rename';
        (function (sc, cc) {
          cRenBtn.addEventListener('click', function () {
            var newName = prompt('Rename category "' + cc + '" to:', cc);
            if (!newName) return;
            if (renameTaxonomyCategory(sc, cc, newName)) {
              rebuildQueue(); updateQueueBadge(); renderTaxonomy(); populateSchemes();
              renderTaxMgrSection(); populateSubMgrFilters(); renderSubMgrList();
              showToast('Category renamed to "' + norm(newName) + '"', 'success');
            } else { showToast('Name already exists or invalid.', 'error'); }
          });
        })(scheme, cat);

        /* Delete category */
        var cDelBtn = document.createElement('button');
        cDelBtn.style.cssText = 'background:#fff0f0;border:1px solid #f5c0c0;border-radius:3px;font-size:10px;cursor:pointer;padding:1px 5px;color:#c0392b;';
        cDelBtn.textContent = '🗑 Delete';
        (function (sc, cc) {
          cDelBtn.addEventListener('click', function () {
            if (!confirm('Delete category "' + cc + '" and all its enquiries? Sentence tags will be cleared.')) return;
            deleteTaxonomyCategory(sc, cc);
            rebuildQueue(); updateQueueBadge(); renderTaxonomy(); populateSchemes();
            renderTaxMgrSection(); populateSubMgrFilters(); renderSubMgrList();
            showToast('Category "' + cc + '" deleted.', '');
          });
        })(scheme, cat);

        catRow.appendChild(cLabel); catRow.appendChild(cRenBtn); catRow.appendChild(cDelBtn);
        catWrap.appendChild(catRow);

        /* Enquiries under this category */
        var enqs = map[scheme][cat].slice().sort();
        enqs.forEach(function (enq) {
          var enqRow = document.createElement('div');
          enqRow.style.cssText = 'display:flex;align-items:center;gap:5px;padding:2px 6px 2px 18px;font-size:11px;color:var(--sf-gray-8);border-bottom:1px solid var(--sf-gray-1);';

          var eLabel = document.createElement('span');
          eLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          eLabel.textContent = '↳ ' + enq;

          /* Rename enquiry */
          var eRenBtn = document.createElement('button');
          eRenBtn.className = 'sf-btn sf-btn-neutral sf-btn-sm';
          eRenBtn.style.fontSize = '10px';
          eRenBtn.textContent = '✏️ Rename';
          (function (sc, cc, ec) {
            eRenBtn.addEventListener('click', function () {
              var newName = prompt('Rename enquiry "' + ec + '" to:', ec);
              if (!newName) return;
              if (renameTaxonomyEnquiry(sc, cc, ec, newName)) {
                rebuildQueue(); updateQueueBadge(); renderTaxonomy(); populateSchemes();
                renderTaxMgrSection(); populateSubMgrFilters(); renderSubMgrList();
                showToast('Enquiry renamed to "' + norm(newName) + '"', 'success');
              } else { showToast('Name already exists or invalid.', 'error'); }
            });
          })(scheme, cat, enq);

          /* Delete enquiry */
          var eDelBtn = document.createElement('button');
          eDelBtn.className = 'sf-btn sf-btn-sm';
          eDelBtn.style.cssText = 'font-size:10px;background:#fff0f0;border-color:#f5c0c0;color:#c0392b;';
          eDelBtn.textContent = '🗑 Delete';
          (function (sc, cc, ec) {
            eDelBtn.addEventListener('click', function () {
              if (!confirm('Delete enquiry "' + ec + '"? Its sub-enquiries and sentence tags will be cleared.')) return;
              deleteTaxonomyEnquiry(sc, cc, ec);
              rebuildQueue(); updateQueueBadge(); renderTaxonomy(); populateSchemes();
              renderTaxMgrSection(); populateSubMgrFilters(); renderSubMgrList();
              showToast('Enquiry "' + ec + '" deleted.', '');
            });
          })(scheme, cat, enq);

          enqRow.appendChild(eLabel); enqRow.appendChild(eRenBtn); enqRow.appendChild(eDelBtn);
          catWrap.appendChild(enqRow);
        });

        schemeWrap.appendChild(catWrap);
      });

      container.appendChild(schemeWrap);
    });

    /* Divider before sub-enquiry section */
    var divider = document.createElement('hr');
    divider.style.cssText = 'border:none;border-top:1px solid var(--sf-gray-2);margin:10px 0 8px;';
    container.appendChild(divider);
  }

  function openSubMgrModal() {
    if (!elSubMgrModal) { showToast('Sub-Enquiry Manager unavailable.', 'error'); return; }
    populateSubMgrFilters();
    renderTaxMgrSection();
    renderSubMgrList();
    elSubMgrModal.classList.add('open');
  }

  var elOpenSubMgrBtn = $('sbOpenSubMgr');
  if (elOpenSubMgrBtn) elOpenSubMgrBtn.addEventListener('click', openSubMgrModal);
  if ($('sbSubMgrClose'))  $('sbSubMgrClose').addEventListener('click',  function () { if (elSubMgrModal) elSubMgrModal.classList.remove('open'); });
  if ($('sbSubMgrClose2')) $('sbSubMgrClose2').addEventListener('click', function () { if (elSubMgrModal) elSubMgrModal.classList.remove('open'); });
  if (elSubMgrModal) elSubMgrModal.addEventListener('click', function (e) { if (e.target === elSubMgrModal) elSubMgrModal.classList.remove('open'); });

  /* Filter change handlers */
  elSubMgrScheme.addEventListener('change', function () {
    elSubMgrCat.innerHTML = '<option value="">All Categories</option>';
    elSubMgrEnq.innerHTML = '<option value="">All Enquiries</option>';
    if (elSubMgrScheme.value) {
      getCategoriesForScheme(elSubMgrScheme.value).forEach(function (c) {
        var o = document.createElement('option'); o.value = c; o.textContent = c;
        elSubMgrCat.appendChild(o);
      });
    }
    renderSubMgrList();
  });
  elSubMgrCat.addEventListener('change', function () {
    elSubMgrEnq.innerHTML = '<option value="">All Enquiries</option>';
    if (elSubMgrScheme.value && elSubMgrCat.value) {
      getEnquiriesForCat(elSubMgrScheme.value, elSubMgrCat.value).forEach(function (e) {
        var o = document.createElement('option'); o.value = e; o.textContent = e;
        elSubMgrEnq.appendChild(o);
      });
    }
    renderSubMgrList();
  });
  elSubMgrEnq.addEventListener('change', renderSubMgrList);
  elSubMgrSearch.addEventListener('input', renderSubMgrList);

  /* Add-new dropdowns in manager */
  elSubMgrAddScheme.addEventListener('change', function () {
    elSubMgrAddCat.innerHTML = '<option value="">— Category —</option>';
    elSubMgrAddCat.disabled = !elSubMgrAddScheme.value;
    elSubMgrAddEnq.innerHTML = '<option value="">— Enquiry —</option>';
    elSubMgrAddEnq.disabled = true;
    if (elSubMgrAddScheme.value) {
      getCategoriesForScheme(elSubMgrAddScheme.value).forEach(function (c) {
        var o = document.createElement('option'); o.value = c; o.textContent = c;
        elSubMgrAddCat.appendChild(o);
      });
    }
  });
  elSubMgrAddCat.addEventListener('change', function () {
    elSubMgrAddEnq.innerHTML = '<option value="">— Enquiry —</option>';
    elSubMgrAddEnq.disabled = !elSubMgrAddCat.value;
    if (elSubMgrAddScheme.value && elSubMgrAddCat.value) {
      getEnquiriesForCat(elSubMgrAddScheme.value, elSubMgrAddCat.value).forEach(function (e) {
        var o = document.createElement('option'); o.value = e; o.textContent = e;
        elSubMgrAddEnq.appendChild(o);
      });
    }
  });

  $('sbSubMgrAddBtn').addEventListener('click', function () {
    var s = elSubMgrAddScheme.value;
    var c = elSubMgrAddCat.value;
    var e = elSubMgrAddEnq.value;
    var v = norm(elSubMgrAddInput.value);
    if (!s || !c || !e || !v) {
      showToast('Please select Scheme, Category, Enquiry and enter a name.', 'error');
      return;
    }
    if (addSubEnquiry(s, c, e, v)) {
      elSubMgrAddInput.value = '';
      renderTaxonomy();
      populateSubMgrFilters();
      renderSubMgrList();
      showToast('Sub-Enquiry "' + v + '" added!', 'success');
    } else {
      showToast('That Sub-Enquiry already exists.', 'error');
    }
  });

  } /* end sub-mgr null-guard */

  /* ── EXPORT TAXONOMY (standalone button outside modal, if present) ── */
  var elExportTaxBtn = $('sbExportTaxonomy');
  if (elExportTaxBtn) elExportTaxBtn.addEventListener('click', exportTaxonomyTxt);

  /* ── FEATURE 6: FIND IN CASE LIBRARY ──────────────────────────── */
  $('sbFindInCaseLib').addEventListener('click', function () {
    if (!SB_currentKey || !SB_db[SB_currentKey]) return;
    var rec = SB_db[SB_currentKey];
    var currentSentence = rec.text || '';

    /* If we have a tracked source case ID, navigate directly to it */
    if (rec.sourceIds && rec.sourceIds.length > 0) {
      var firstId = rec.sourceIds[0];
      if (typeof window.tlSelectCaseById === 'function' && window.tlSelectCaseById(firstId, currentSentence)) {
        showToast('📁 Opened case in Case Library', 'success');
        return;
      }
    }

    /* Fallback: switch tab and keyword-search; still set sentence for when user clicks a case */
    if (typeof window.tlSetPreviewSentence === 'function') window.tlSetPreviewSentence(currentSentence);
    if (typeof window.tlSwitchTab === 'function') window.tlSwitchTab('templates');
    setTimeout(function () {
      var searchInput = document.getElementById('tlSearchInput');
      if (searchInput) {
        var words = rec.text.split(' ').slice(0, 6).join(' ');
        searchInput.disabled = false;
        searchInput.value = words;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.focus();
        showToast('Searching Case Library for this sentence…', '');
      }
    }, 120);
  });

  /* ── DETAIL MODAL WIRING ────────────────────────────────────── */
  var _detailModal = $('sbDetailModal');
  if (_detailModal) {
    $('sbDetailModalClose').addEventListener('click', function () { _detailModal.classList.remove('open'); });
    $('sbDetailModalClose2').addEventListener('click', function () { _detailModal.classList.remove('open'); });
    _detailModal.addEventListener('click', function (e) { if (e.target === _detailModal) _detailModal.classList.remove('open'); });
    /* Save button — wired via delegation so it works after innerHTML re-render */
    $('sbDetailSaveBtn').addEventListener('click', function() {
      if (!_detailKey || !SB_db[_detailKey]) { showToast('Nothing to save.', 'error'); return; }

      /* Validate: all tags must have scheme+category+enquiry */
      var valid = true;
      _detailTags.forEach(function(t, i) {
        if (!t.scheme || !t.category || !t.enquiry) {
          showToast('Tag #' + (i+1) + ' is missing Scheme, Category or Enquiry.', 'error');
          valid = false;
        }
      });
      if (!valid) return;
      if (!_detailTags.length) { showToast('Add at least one tag before saving.', 'error'); return; }

      /* Deduplicate */
      var seen = {};
      _detailTags = _detailTags.filter(function(t) {
        var k = t.scheme + '||' + t.category + '||' + t.enquiry + '||' + (t.subEnquiry||'');
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });

      var rec = SB_db[_detailKey];
      rec.tags      = _detailTags.map(function(t){ return Object.assign({}, t); });
      rec.status    = 'categorised';
      rec.scheme    = rec.tags[0].scheme;
      rec.category  = rec.tags[0].category;
      rec.enquiry   = rec.tags[0].enquiry;
      rec.subEnquiry= rec.tags[0].subEnquiry || '';

      showToast('Sentence tags saved ✓', 'success');
      renderViewer();
      renderTaxonomy();
      renderDetailModal(rec);
    });
  }

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

  /* ── DEBUG HELPER (console only) ────────────────────────────── */
  /* Run window.sbDebugCutoff() in the browser console to see which
     sentences are detected as cut-off and what their source text looks like. */
  window.sbDebugCutoff = function () {
    if (typeof window.tlGetAllCasesWithId !== 'function') {
      console.warn('[SmartBot] tlGetAllCasesWithId not available — load cases first.');
      return;
    }
    var results = [];
    Object.keys(SB_db).forEach(function (k) {
      var rec = SB_db[k];
      var src = sbGetSourceLetterText(rec);
      if (!src) { results.push({ key: k, issue: 'no source found' }); return; }
      var fixed = sbGetFixedSentence(rec.text, src);
      if (fixed) results.push({ key: k, stored: rec.text, fixed: fixed, status: rec.status });
    });
    var cutoff = results.filter(function(r){ return r.fixed; });
    var noSrc  = results.filter(function(r){ return r.issue; });
    console.log('[SmartBot] Cut-off sentences detected:', cutoff.length);
    cutoff.forEach(function(r){ console.log('  CUTOFF:', r.stored, '\n    → FIX:', r.fixed); });
    console.log('[SmartBot] Sentences with no source case found:', noSrc.length);
    if (noSrc.length) console.log('  (these have no matching case loaded — sourceIds empty and text not found in any case)');
    return { cutoff: cutoff, noSource: noSrc };
  };

  /* ── INIT ────────────────────────────────────────────────────── */
  (function init() {
    updateQueueBadge();
    renderViewer();
  })();

})();
