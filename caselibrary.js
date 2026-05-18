/* ============================================================
   CASE LIBRARY — in-memory only, zero persistence
   Refresh / close = all data gone.
   ============================================================ */
(function () {

  /* ── STATE ─────────────────────────────────────────────────── */
  var TL = { cases: [], filtered: [], selectedId: null };

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

  /* ── TAB SWITCH ─────────────────────────────────────────────── */
  window.tlSwitchTab = function (tab) {
    var editorEl  = document.getElementById('sfContent');
    var drawerEl  = document.getElementById('sfDrawer');
    var libEl     = document.getElementById('viewTemplates');
    var tabEd     = document.getElementById('tabEditor');
    var tabTpl    = document.getElementById('tabTemplates');
    if (tab === 'templates') {
      editorEl.style.display = 'none';
      drawerEl.style.display = 'none';
      libEl.classList.add('tl-active');
      tabEd.classList.remove('active');
      tabTpl.classList.add('active');
    } else {
      editorEl.style.display = '';
      drawerEl.style.display = '';
      libEl.classList.remove('tl-active');
      tabEd.classList.add('active');
      tabTpl.classList.remove('active');
    }
  };

  /* ── MODAL OPEN / CLOSE ─────────────────────────────────────── */
  openPasteBtn.addEventListener('click', function () {
    pasteTa.value = '';
    modalStatus.textContent = '🔒 Nothing is stored or sent — data lives only in this browser tab.';
    modalOverlay.classList.add('open');
    setTimeout(function () { pasteTa.focus(); }, 120);
  });
  function closeModal() { modalOverlay.classList.remove('open'); }
  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', function (e) { if (e.target === modalOverlay) closeModal(); });
  modalClearTa.addEventListener('click', function () {
    pasteTa.value = '';
    modalStatus.textContent = 'Cleared.';
    pasteTa.focus();
  });

  /* Live feedback — debounced so large pastes don't block the UI */
  var _statusTimer = null;
  function updateStatus() {
    clearTimeout(_statusTimer);
    _statusTimer = setTimeout(function () {
      var val = pasteTa.value.trim();
      if (!val) { modalStatus.textContent = '🔒 Nothing stored or sent.'; return; }

      /* Check for a library backup (JSON export) */
      if (val.charAt(0) === '{') {
        try {
          var imp = JSON.parse(val);
          if (imp._caseLib && Array.isArray(imp.cases)) {
            modalStatus.textContent = '📥 Library backup detected — ' + imp.cases.length + ' case(s). Click ⚡ Parse to restore.';
            return;
          }
        } catch (e) {}
      }

      /* Otherwise count Dear-blocks */
      var blocks = parseCaseBlocks(val);
      if (blocks.length) {
        modalStatus.textContent = '✅ Detected ' + blocks.length + ' case letter' + (blocks.length !== 1 ? 's' : '') + '. Ready to parse.';
      } else if (/Dear\b/i.test(val)) {
        modalStatus.textContent = '⚠️ Found "Dear" but no recognised closing phrase. The letter must end with: "We would be pleased/glad...", "Yours sincerely", "Yours faithfully", or a line ending with cpf.gov.sg.';
      } else {
        modalStatus.textContent = '⚠️ No case letters found — paste letters starting with "Dear".';
      }
    }, 200);
  }
  pasteTa.addEventListener('input', updateStatus);

  /* ── URL NORMALISER ─────────────────────────────────────────── */
  /* http → https, and adds www. if the host has no subdomain yet    */
  function normalizeUrl(url) {
    url = url.trim();
    // Upgrade http → https
    if (/^http:\/\//i.test(url)) url = 'https://' + url.slice(7);
    // Add www. if not already present after https://
    if (/^https:\/\/(?!www\.)/i.test(url)) url = url.replace(/^https:\/\//i, 'https://www.');
    return url;
  }

  /* Also fixes any raw http:// URLs sitting as plain text in the textarea */
  function normalizeUrlsInText(text) {
    return text.replace(/\bhttps?:\/\/[^\s\]>)"]*/gi, function (u) { return normalizeUrl(u); });
  }

  /* Paste handler — defers extraction off the paste tick to avoid lag */
  pasteTa.addEventListener('paste', function (e) {
    var html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html) return; // plain text — browser handles it fine

    e.preventDefault();

    requestAnimationFrame(function () {
      /* Word strips hrefs from hyperlinks in its clipboard HTML, so <a> tags
         are useless. Just extract the visible plain text and normalise any
         URLs that are literally typed out in the document.                   */
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      var result = (tmp.innerText || tmp.textContent || '').replace(/\r\n/g, '\n');

      /* Normalise any raw http:// / https:// strings in the text */
      result = normalizeUrlsInText(result);

      var start = pasteTa.selectionStart;
      var end   = pasteTa.selectionEnd;
      pasteTa.value = pasteTa.value.slice(0, start) + result + pasteTa.value.slice(end);
      pasteTa.selectionStart = pasteTa.selectionEnd = start + result.length;

      updateStatus();
    });
  });

  /* ── PARSE ──────────────────────────────────────────────────── */
  modalParse.addEventListener('click', doParse);
  pasteTa.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doParse();
  });

  function doParse() {
    var raw = pasteTa.value.trim();
    if (!raw) { modalStatus.textContent = '⚠️ Nothing pasted yet.'; return; }

    /* ── JSON library restore ─────────────────────────────────── */
    if (raw.charAt(0) === '{') {
      try {
        var imp = JSON.parse(raw);
        if (imp._caseLib && Array.isArray(imp.cases) && imp.cases.length) {
          var before = TL.cases.length;
          TL.cases = TL.cases.concat(imp.cases);
          updateBadge();
          applySearch();
          searchInput.disabled = false;
          closeModal();
          showToast('📥 ' + imp.cases.length + ' case(s) restored — ' + TL.cases.length + ' total', 'success');
          return;
        }
      } catch (e) { /* not valid JSON — fall through to letter parser */ }
    }

    /* ── Letter block parser ──────────────────────────────────── */
    var rows = parseCaseBlocks(raw);
    if (!rows.length) {
      modalStatus.textContent = '⚠️ No cases found. Make sure each case has a code number (e.g. 20260425-8789251) and that the last column starts with "Dear" and ends with a recognised closing phrase (any number of columns is fine).';
      return;
    }

    var startId = TL.cases.length;
    rows.forEach(function (cells, i) {
      TL.cases.push({ id: 'c' + (startId + i), cells: cells });
    });

    updateBadge();
    applySearch();
    searchInput.disabled = false;
    closeModal();
    showToast('✅ ' + rows.length + ' case' + (rows.length !== 1 ? 's' : '') + ' added — ' + TL.cases.length + ' total', 'success');
  }

  /* ── CASE LETTER PARSER ─────────────────────────────────────── */
  /*
     Strategy:
       1. Pre-process: strip leading AND trailing whitespace per line
          so that indented blank lines collapse to truly empty lines.
       2. Find all code numbers (\d{8}-\d{7}) in the text.
       3. Chunk = everything between this code's end and the next code's
          start (so the next case ID is never included in the letter).
       4. Split chunk on blank-line groups → cells.
          Code = col 1, remaining cells = cols 2..N.
          The LAST cell is always the letter body, regardless of how many
          columns the case has (3, 4, 8, anything). Mixed column counts
          within the same paste are fully supported.
       5. Find "Dear" inside that letter chunk, trim to last closing phrase.
       6. Normalise and store.

     Recognised closings — matched across line-breaks:
       • "We would be pleased/glad …."
       • "Yours sincerely" + up to 4 trailing lines
  */

  var CLOSING_RES = [
    /* "We would/will be pleased/glad…" — terminal period optional, URL may be last word */
    /We would[\s\S]*?be (?:pleased|glad)[\s\S]{0,400}?(?:cpf\.gov\.sg[^\n]*|[.!?])/gi,
    /We will[\s\S]*?be (?:pleased|glad)[\s\S]{0,400}?(?:cpf\.gov\.sg[^\n]*|[.!?])/gi,
    /* "Yours sincerely / faithfully" + up to 6 trailing lines */
    /Yours sincerely[^\n]*(?:\n[^\n]*){0,6}/gi,
    /Yours faithfully[^\n]*(?:\n[^\n]*){0,6}/gi,
    /* Letter ends with a cpf.gov.sg URL line */
    /(?:please visit|refer to|visit us at|available at|visit)\s+(?:www\.)?cpf\.gov\.sg[^\n]*/gi,
  ];

  function lastClosingEnd(text) {
    var best = -1;
    CLOSING_RES.forEach(function (re) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text)) !== null) {
        var end = m.index + m[0].length;
        if (end > best) best = end;
      }
    });
    return best;
  }

  function joinWrappedLines(text) {
    /* Within each paragraph (between blank lines), join lines that are
       soft-wrapped mid-sentence. A line break is a soft wrap when:
         - the current line does NOT end with sentence punctuation (. ? ! :)
         - the next line is not blank
       In that case, replace the \n with a space.                          */
    var paragraphs = text.split('\n\n');
    paragraphs = paragraphs.map(function (para) {
      return para.replace(/([^.?!:\n])\n([^\n])/g, '$1 $2');
    });
    return paragraphs.join('\n\n');
  }

  function normaliseEditorText(text) {
    text = text.replace(/[ \t]+$/gm, '');
    text = joinWrappedLines(text);
    text = normalizeUrlsInText(text);
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  function parseCaseBlocks(rawText) {
    var blocks = [];

    /* ── Pre-process ──────────────────────────────────────────────
       Strip BOTH leading and trailing whitespace from every line.
       This collapses "  " (indented blank lines) to truly empty
       lines, making \n\n a reliable cell separator.               */
    var prepped = rawText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(function (line) { return line.trim(); })
      .join('\n');

    /* ── Find all code numbers ───────────────────────────────────── */
    var CODE_RE = /\d{8}-\d{7}/g;
    var codes = [];
    var m;
    while ((m = CODE_RE.exec(prepped)) !== null) {
      codes.push({ code: m[0], start: m.index, end: m.index + m[0].length });
    }

    if (!codes.length) return blocks;

    /* ── Process each code block ─────────────────────────────────── */
    for (var ci = 0; ci < codes.length; ci++) {
      var chunkStart = codes[ci].end;
      var chunkEnd   = ci + 1 < codes.length ? codes[ci + 1].start : prepped.length;
      var chunk = prepped.slice(chunkStart, chunkEnd);

      /* Split on runs of blank lines */
      var cells = chunk.split(/\n{2,}/);
      cells = cells
        .map(function (c) { return c.trim(); })
        .filter(function (c) { return c.length > 0; });

      /* Col 1 = code number (already captured).
         Last column = the letter body. Auto-detect based on how many
         blank-line-separated cells this case actually has, so 4-column
         and 8-column cases (and anything in between) all work.
         Minimum: at least 1 cell (the letter itself).               */
      if (cells.length < 1) continue;

      /* The last cell (and everything beyond it if cells overflowed)
         is treated as the letter body.                               */
      var LETTER_COL_IDX = cells.length - 1; // 0-based, always the last cell
      var letterChunk = cells.slice(LETTER_COL_IDX).join('\n\n');

      /* Find "Dear" inside the letter chunk */
      var dearMatch = /\bDear\b/i.exec(letterChunk);
      if (!dearMatch) continue;

      var letter = letterChunk.slice(dearMatch.index);

      /* Trim to last closing phrase */
      var closeEnd = lastClosingEnd(letter);
      if (closeEnd === -1) continue;

      letter = letter.slice(0, closeEnd);
      letter = normaliseEditorText(letter);
      if (!letter) continue;

      /* Build display cells for preview — code + all non-letter cols + letter */
      var displayCells = [codes[ci].code];
      for (var ci2 = 0; ci2 < LETTER_COL_IDX; ci2++) {
        displayCells.push(cells[ci2] || '');
      }
      displayCells.push(letter);

      blocks.push(displayCells);
    }

    return blocks;
  }

  /* ── SEARCH ─────────────────────────────────────────────────── */
  searchInput.addEventListener('input', applySearch);

  function applySearch() {
    var q = searchInput.value.trim().toLowerCase();
    if (!q) {
      TL.filtered = TL.cases.slice();
    } else {
      TL.filtered = TL.cases.filter(function (c) {
        return c.cells.some(function (cell) {
          return cell.toLowerCase().indexOf(q) !== -1;
        });
      });
    }
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
        d.innerHTML = '<div class="tl-empty-icon">📋</div><div class="tl-empty-ttl">No cases loaded yet</div><div class="tl-empty-sub">Click <strong>＋ Paste Cases</strong> and paste your case table text. Any number of columns is supported — the <strong>last column</strong> is always used as the letter body. Each case needs a <strong>code number</strong> (e.g. <em>20260425-8789251</em>) and the letter must start with <strong>Dear</strong> and end with <em>We would be pleased…</em>, <em>We would be glad…</em>, or <em>Yours sincerely</em>.</div>';
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

    // Header
    var hdr = document.createElement('div');
    hdr.className = 'tl-card-hdr';
    hdr.innerHTML =
      '<span class="tl-card-num">#' + (idx + 1) + '</span>' +
      '<span class="tl-card-title">' + hlText(String(titleCell).slice(0, 120), q) + '</span>' +
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
    var payload = JSON.stringify({ _caseLib: 1, cases: TL.cases });
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).then(function () {
        showToast('📤 Library copied! Paste it into the Case Library later to restore.', 'success');
      }).catch(function () { fallbackCopy(payload); });
    } else {
      fallbackCopy(payload);
    }
  }

  copyLibBtn.addEventListener('click', exportLibrary);

  /* ── CLEAR ALL ──────────────────────────────────────────────── */
  clearAllBtn.addEventListener('click', function () {
    TL.cases = []; TL.filtered = []; TL.selectedId = null;
    searchInput.value = ''; searchInput.disabled = true;
    previewBody.innerHTML = '<div class="tl-preview-empty"><span style="font-size:32px;">👆</span>Select a case to preview.</div>';
    previewFooter.style.display = 'none';
    badge.style.display = 'none'; clearAllBtn.style.display = 'none';
    resultCount.textContent = ''; subCount.textContent = '';
    renderResults([], '');
    showToast('Library cleared.', 'success');
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
    if (typeof window._NB_rebuildCorpus === 'function') window._NB_rebuildCorpus();
  }

})();
