/* ============================================================
   HYPERLINK FEATURES (1, 2, 3)
   ============================================================ */
document.addEventListener('DOMContentLoaded', function() {
(function() {
  'use strict';

  /* ── State ── */
  /* hlPairs: array of {
       id, phrase,
       specificMode: bool,
       globalUrl: string,
       byOccurrence: [{index:0, url:''}, ...]   (0-indexed, length = count in text)
     }
  */
  var hlPairs = [];
  var hlSectionOpen = true;

  function uid() {
    return Math.random().toString(36).slice(2, 9);
  }

  function escH(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Persist ── */
  function hlPersist() {
    try { localStorage.setItem('nb2_hlpairs', JSON.stringify(hlPairs)); } catch(e) {}
  }

  function hlLoad() {
    try {
      var raw = localStorage.getItem('nb2_hlpairs');
      if (raw) hlPairs = JSON.parse(raw);
    } catch(e) { hlPairs = []; }
  }

  /* ── Count phrase occurrences in editor plain text ── */
  function countOccurrences(phrase) {
    var editor = document.getElementById('inputEditor');
    if (!editor) return 0;
    var text = editor.innerText || '';
    var lower = text.toLowerCase();
    var pLower = phrase.toLowerCase();
    var count = 0;
    var pos = 0;
    while (true) {
      var idx = lower.indexOf(pLower, pos);
      if (idx === -1) break;
      count++;
      pos = idx + pLower.length;
    }
    return count;
  }

  /* ── Get occurrence positions for a phrase in a text string ── */
  function getOccurrencePositions(text, phrase) {
    var lower = text.toLowerCase();
    var pLower = phrase.toLowerCase();
    var positions = [];
    var pos = 0;
    while (true) {
      var idx = lower.indexOf(pLower, pos);
      if (idx === -1) break;
      positions.push(idx);
      pos = idx + pLower.length;
    }
    return positions;
  }

  /* ── Sync byOccurrence length to actual count in editor ── */
  function syncOccurrenceLengths() {
    hlPairs.forEach(function(pair) {
      var count = countOccurrences(pair.phrase);
      // Grow
      while (pair.byOccurrence.length < count) {
        pair.byOccurrence.push({ index: pair.byOccurrence.length, url: '' });
      }
      // Shrink (preserve existing URLs)
      pair.byOccurrence = pair.byOccurrence.slice(0, count);
    });
  }

  /* ── Apply all hyperlinks to the input editor DOM ── */
  function applyHyperlinksToDom() {
    var editor = document.getElementById('inputEditor');
    if (!editor) return;

    /* Step 1: unwrap all managed <a> tags, restoring text */
    editor.querySelectorAll('a[data-hl-managed]').forEach(function(a) {
      var parent = a.parentNode;
      while (a.firstChild) parent.insertBefore(a.firstChild, a);
      parent.removeChild(a);
    });

    /* Step 2: normalise adjacent text nodes (browser may split them) */
    editor.normalize();

    if (!hlPairs.length) return;

    /* Step 3: for each pair, apply hyperlinks using a text-offset approach */
    hlPairs.forEach(function(pair) {
      if (!pair.phrase) return;

      /* Build a list of (occurrenceIndex → url) to apply */
      var toApply = {}; // occurrenceIndex → url
      if (!pair.specificMode) {
        if (!pair.globalUrl) return;
        // Apply to all occurrences
        for (var i = 0; i < (pair.byOccurrence.length || 999); i++) {
          toApply[i] = pair.globalUrl;
        }
      } else {
        pair.byOccurrence.forEach(function(occ) {
          if (occ.url) toApply[occ.index] = occ.url;
        });
        if (!Object.keys(toApply).length) return;
      }

      /* Walk all text nodes and wrap matches */
      var pLower = pair.phrase.toLowerCase();
      var occIdx = 0;

      /* We need to iterate text nodes carefully; collect them first */
      var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
        acceptNode: function(node) {
          /* Don't enter existing managed links (they've been unwrapped already, but just in case) */
          if (node.parentElement && node.parentElement.dataset && node.parentElement.dataset.hlManaged) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      var textNodes = [];
      var n;
      while (n = walker.nextNode()) textNodes.push(n);

      /* Process each text node */
      textNodes.forEach(function(textNode) {
        var text = textNode.textContent;
        var lower = text.toLowerCase();
        var pos = 0;
        var segments = []; // array of {text, url or null}
        var hadMatch = false;

        while (pos < text.length) {
          var idx = lower.indexOf(pLower, pos);
          if (idx === -1) {
            segments.push({ text: text.slice(pos), url: null });
            break;
          }
          // Text before match
          if (idx > pos) segments.push({ text: text.slice(pos, idx), url: null });
          // Match
          var url = toApply.hasOwnProperty(occIdx) ? toApply[occIdx] : null;
          segments.push({ text: text.slice(idx, idx + pair.phrase.length), url: url });
          occIdx++;
          hadMatch = true;
          pos = idx + pair.phrase.length;
        }

        if (!hadMatch) return;

        /* Replace textNode with segment nodes */
        var parent = textNode.parentNode;
        if (!parent) return;
        segments.forEach(function(seg) {
          if (seg.url) {
            var a = document.createElement('a');
            a.href = seg.url;
            a.textContent = seg.text;
            a.dataset.hlManaged = 'true';
            parent.insertBefore(a, textNode);
          } else {
            parent.insertBefore(document.createTextNode(seg.text), textNode);
          }
        });
        parent.removeChild(textNode);
      });
    });
  }

  /* ── Find or create a hlPair for a phrase; return it ── */
  function getOrCreatePair(phrase) {
    var phraseLC = phrase.toLowerCase();
    var found = null;
    hlPairs.forEach(function(p) {
      if (p.phrase.toLowerCase() === phraseLC) found = p;
    });
    if (found) return found;
    var pair = {
      id: uid(),
      phrase: phrase,
      specificMode: false,
      globalUrl: '',
      byOccurrence: []
    };
    hlPairs.push(pair);
    return pair;
  }

  /* ── Which occurrence index is a DOM range at? ── */
  function getOccurrenceIndex(phrase, range) {
    var editor = document.getElementById('inputEditor');
    if (!editor) return 0;
    var text = editor.innerText || '';
    var positions = getOccurrencePositions(text, phrase);
    if (!positions.length) return 0;

    /* Find the char offset of the start of the selection within the editor */
    var preRange = document.createRange();
    preRange.setStart(editor, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    var charOffset = preRange.toString().length;

    /* Find which occurrence this offset falls within */
    for (var i = 0; i < positions.length; i++) {
      if (charOffset >= positions[i] && charOffset <= positions[i] + phrase.length) {
        return i;
      }
    }
    /* fallback: find closest */
    var best = 0;
    var bestDist = Infinity;
    positions.forEach(function(pos, i) {
      var dist = Math.abs(charOffset - pos);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }

  /* ── Render Hyperlink Pairs UI ── */
  function renderHlPairs() {
    syncOccurrenceLengths();

    var body = document.getElementById('hlSectionBody');
    var badge = document.getElementById('hlPairBadge');
    var emptyMsg = document.getElementById('hlEmptyMsg');

    if (!body) return;

    badge.textContent = hlPairs.length;

    /* Remove all pair cards, keep emptyMsg */
    Array.from(body.children).forEach(function(child) {
      if (child.id !== 'hlEmptyMsg') body.removeChild(child);
    });

    if (!hlPairs.length) {
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';

    hlPairs.forEach(function(pair) {
      var count = pair.byOccurrence.length;

      var card = document.createElement('div');
      card.className = 'hl-pair-card';
      card.dataset.pairId = pair.id;

      /* Header */
      var hdr = document.createElement('div');
      hdr.className = 'hl-pair-card-hdr';

      var phraseLabel = document.createElement('span');
      phraseLabel.className = 'hl-phrase-label';
      phraseLabel.title = pair.phrase;
      phraseLabel.textContent = '"' + pair.phrase + '"';

      var countBadge = document.createElement('span');
      countBadge.className = 'hl-count-badge';
      countBadge.textContent = count + 'x';

      var delBtn = document.createElement('button');
      delBtn.className = 'hl-del-btn';
      delBtn.title = 'Remove hyperlink pair';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', function() {
        hlPairs = hlPairs.filter(function(p) { return p.id !== pair.id; });
        hlPersist();
        applyHyperlinksToDom();
        renderHlPairs();
        triggerRunProcess();
      });

      hdr.appendChild(phraseLabel);
      hdr.appendChild(countBadge);
      hdr.appendChild(delBtn);
      card.appendChild(hdr);

      /* Body */
      var cardBody = document.createElement('div');
      cardBody.className = 'hl-pair-card-body';

      /* Toggle row */
      var toggleRow = document.createElement('div');
      toggleRow.className = 'hl-toggle-row';

      var toggleLabel = document.createElement('label');
      var toggleWrap = document.createElement('label');
      toggleWrap.className = 'hl-toggle';
      var toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.checked = pair.specificMode;
      var toggleTrack = document.createElement('span');
      toggleTrack.className = 'hl-toggle-track';
      toggleWrap.appendChild(toggleInput);
      toggleWrap.appendChild(toggleTrack);

      var toggleText = document.createElement('span');
      toggleText.textContent = 'Specific Hyperlinks Only';

      toggleLabel.style.display = 'flex';
      toggleLabel.style.alignItems = 'center';
      toggleLabel.style.gap = '6px';
      toggleLabel.style.cursor = 'pointer';
      toggleLabel.appendChild(toggleWrap);
      toggleLabel.appendChild(toggleText);

      toggleInput.addEventListener('change', function() {
        pair.specificMode = toggleInput.checked;
        hlPersist();
        renderHlPairs();
        applyHyperlinksToDom();
        triggerRunProcess();
      });

      toggleRow.appendChild(toggleLabel);
      cardBody.appendChild(toggleRow);

      if (!pair.specificMode) {
        /* Global URL input */
        var globalRow = document.createElement('div');
        globalRow.className = 'hl-global-url';

        var globalInput = document.createElement('input');
        globalInput.placeholder = 'https://… (applies to all occurrences)';
        globalInput.value = pair.globalUrl || '';
        globalInput.addEventListener('input', function() {
          pair.globalUrl = globalInput.value.trim();
          hlPersist();
          applyHyperlinksToDom();
          triggerRunProcess();
        });

        globalRow.appendChild(globalInput);
        cardBody.appendChild(globalRow);
      } else {
        /* Per-occurrence URL inputs */
        var occList = document.createElement('div');
        occList.className = 'hl-occurrence-list';

        if (count === 0) {
          var noOcc = document.createElement('div');
          noOcc.className = 'text-muted';
          noOcc.style.fontSize = '11px';
          noOcc.textContent = 'Phrase not found in current input text.';
          occList.appendChild(noOcc);
        } else {
          pair.byOccurrence.forEach(function(occ, i) {
            var row = document.createElement('div');
            row.className = 'hl-occ-row';

            var lbl = document.createElement('span');
            lbl.className = 'hl-occ-label';
            lbl.textContent = '(' + (i + 1) + ')';

            var urlIn = document.createElement('input');
            urlIn.className = 'hl-occ-url' + (occ.url ? ' linked' : '');
            urlIn.placeholder = 'https://… (leave blank to skip)';
            urlIn.value = occ.url || '';
            urlIn.addEventListener('input', function() {
              occ.url = urlIn.value.trim();
              urlIn.className = 'hl-occ-url' + (occ.url ? ' linked' : '');
              hlPersist();
              applyHyperlinksToDom();
              triggerRunProcess();
            });

            row.appendChild(lbl);
            row.appendChild(urlIn);
            occList.appendChild(row);
          });
        }

        cardBody.appendChild(occList);
      }

      card.appendChild(cardBody);
      body.appendChild(card);
    });
  }

  /* ── Trigger runProcess from the main script ── */
  function triggerRunProcess() {
    /* runProcess is defined in the main IIFE; dispatch an input event to trigger it */
    var editor = document.getElementById('inputEditor');
    if (editor) editor.dispatchEvent(new Event('input'));
  }

  /* ── Patch runProcess so hyperlinks are applied to output too ── */
  /* We hook into the inputEditor's input event which calls runProcess,
     and additionally call applyHyperlinksToDom after each runProcess */
  var _hlProcessScheduled = false;
  function scheduleHlApply() {
    if (_hlProcessScheduled) return;
    _hlProcessScheduled = true;
    setTimeout(function() {
      _hlProcessScheduled = false;
      applyHyperlinksToDom();
      renderHlPairs();
    }, 450); /* slightly after debounce(runProcess,400) */
  }

  document.getElementById('inputEditor').addEventListener('input', scheduleHlApply);

  /* Also re-apply when Apply Replacements is clicked */
  var btnProcess = document.getElementById('btnProcess');
  if (btnProcess) {
    btnProcess.addEventListener('click', function() {
      setTimeout(function() { applyHyperlinksToDom(); renderHlPairs(); }, 50);
    });
  }

  /* ── HL tab badge update (handled by MutationObserver in new UI wiring) ── */
  /* hlSection is now a drawer tab — no collapse toggle needed */

  /* ============================================================
     FEATURE 2: Insert Hyperlink to Highlighted Text
     ============================================================ */
  var _savedHlRange = null; // The DOM range that was selected when user clicked Insert Hyperlink

  var hlInsertOverlay = document.getElementById('hlInsertOverlay');
  var hlInsertClose   = document.getElementById('hlInsertClose');
  var hlInsertCancel  = document.getElementById('hlInsertCancel');
  var hlInsertOk      = document.getElementById('hlInsertOk');
  var hlInsertUrlInput= document.getElementById('hlInsertUrlInput');
  var hlInsertGoTo    = document.getElementById('hlInsertGoToLink');
  var hlInsertPhrase  = document.getElementById('hlInsertPhraseDisplay');

  function openHlInsert() {
    var sel = window.getSelection();
    var editor = document.getElementById('inputEditor');

    if (!sel || !sel.rangeCount) {
      showToast('⚠️ Highlight a word or phrase in the Editor first.', 'error');
      return;
    }
    var range = sel.getRangeAt(0);
    var selectedText = range.toString().trim();

    if (!selectedText) {
      showToast('⚠️ Highlight a word or phrase in the Editor first.', 'error');
      return;
    }

    /* Make sure selection is inside the editor */
    if (!editor.contains(range.commonAncestorContainer)) {
      showToast('⚠️ Selection must be inside the Input Text editor.', 'error');
      return;
    }

    _savedHlRange = range.cloneRange();
    hlInsertPhrase.textContent = '"' + selectedText + '"';
    hlInsertUrlInput.value = '';

    /* Pre-fill if we already have a pair for this phrase */
    var pair = hlPairs.find(function(p) { return p.phrase.toLowerCase() === selectedText.toLowerCase(); });
    if (pair && pair.globalUrl) hlInsertUrlInput.value = pair.globalUrl;

    hlInsertOverlay.classList.add('open');
    setTimeout(function() { hlInsertUrlInput.focus(); }, 80);
  }

  function closeHlInsert() {
    hlInsertOverlay.classList.remove('open');
    _savedHlRange = null;
  }

  function applyHlInsert() {
    var url = hlInsertUrlInput.value.trim();
    if (!url) { showToast('⚠️ Please enter a URL.', 'error'); return; }
    if (!_savedHlRange) { closeHlInsert(); return; }

    var selectedText = _savedHlRange.toString().trim();
    if (!selectedText) { closeHlInsert(); return; }

    /* Find or create hlPair for this phrase */
    var pair = getOrCreatePair(selectedText);

    /* Determine which occurrence was selected */
    var occIdx = getOccurrenceIndex(selectedText, _savedHlRange);

    /* Ensure byOccurrence is long enough */
    var count = countOccurrences(selectedText);
    while (pair.byOccurrence.length < count) {
      pair.byOccurrence.push({ index: pair.byOccurrence.length, url: '' });
    }

    /* Turn on specific mode and set this occurrence's URL */
    pair.specificMode = true;

    /* Check if ALL occurrences currently have the same URL (means global was set) */
    /* For simplicity, set only the specific occurrence */
    if (occIdx < pair.byOccurrence.length) {
      pair.byOccurrence[occIdx].url = url;
    }

    /* Also update globalUrl for reference */
    pair.globalUrl = url;

    hlPersist();
    applyHyperlinksToDom();
    renderHlPairs();
    triggerRunProcess();
    closeHlInsert();
    showToast('✅ Hyperlink applied!', 'success');
  }

  hlInsertClose.addEventListener('click', closeHlInsert);
  hlInsertCancel.addEventListener('click', closeHlInsert);
  hlInsertOk.addEventListener('click', applyHlInsert);

  hlInsertGoTo.addEventListener('click', function() {
    var url = hlInsertUrlInput.value.trim();
    if (url) window.open(url, '_blank', 'noopener');
    else showToast('⚠️ Enter a URL first.', 'error');
  });

  hlInsertUrlInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') applyHlInsert();
    if (e.key === 'Escape') closeHlInsert();
  });

  hlInsertOverlay.addEventListener('click', function(e) {
    if (e.target === hlInsertOverlay) closeHlInsert();
  });

  /* ============================================================
     FEATURE 3: Automatic Hyperlinks from Pasted Text
     ============================================================ */
  var hlAutoOverlay  = document.getElementById('hlAutoOverlay');
  var hlAutoClose    = document.getElementById('hlAutoClose');
  var hlAutoCancel   = document.getElementById('hlAutoCancel');
  var hlAutoAnalyse  = document.getElementById('hlAutoAnalyse');
  var hlAutoApply    = document.getElementById('hlAutoApply');
  var hlAutoPaste    = document.getElementById('hlAutoPasteArea');
  var hlAutoResults  = document.getElementById('hlAutoResults');
  var hlAutoResultRows = document.getElementById('hlAutoResultRows');
  var hlAutoStatus   = document.getElementById('hlAutoStatus');

  var _autoAnalysisData = null; // store analysis result between Analyse and Apply

  function openHlAuto() {
    hlAutoPaste.innerHTML = '';
    hlAutoPaste.dataset.empty = 'true';
    hlAutoResults.classList.remove('visible');
    hlAutoResultRows.innerHTML = '';
    hlAutoStatus.textContent = 'Paste text above to detect hyperlinks…';
    hlAutoApply.style.display = 'none';
    _autoAnalysisData = null;
    hlAutoOverlay.classList.add('open');
  }

  function closeHlAuto() {
    hlAutoOverlay.classList.remove('open');
  }

  /* Parse links from the paste area's HTML */
  function parseLinksFromPasteArea() {
    /* Build a map: phraseLC → [{url, phraseOriginal}] (in document order) */
    var linkMap = {}; // phraseLC → array of urls in order
    var allLinks = hlAutoPaste.querySelectorAll('a[href]');
    allLinks.forEach(function(a) {
      var href = (a.getAttribute('href') || '').trim();
      if (!href || href.startsWith('#')) return;
      var text = (a.innerText || a.textContent || '').trim();
      if (!text) return;
      var key = text.toLowerCase();
      if (!linkMap[key]) linkMap[key] = { phrase: text, urls: [] };
      linkMap[key].urls.push(href);
    });
    return linkMap;
  }

  /* Analyse: compare paste links with input editor content */
  function analyseAutoLinks() {
    var editor = document.getElementById('inputEditor');
    var inputText = editor ? (editor.innerText || '') : '';

    var linkMap = parseLinksFromPasteArea();
    var keys = Object.keys(linkMap);

    if (!keys.length) {
      hlAutoStatus.textContent = '⚠️ No hyperlinks detected in pasted text.';
      hlAutoApply.style.display = 'none';
      hlAutoResults.classList.remove('visible');
      return;
    }

    /* For each phrase, count how many times it appears in input */
    var analysisRows = [];
    keys.forEach(function(key) {
      var entry = linkMap[key];
      var inputCount = countOccurrences(entry.phrase);
      var sourceCount = entry.urls.length;
      var applyCount = Math.min(inputCount, sourceCount);

      analysisRows.push({
        phrase: entry.phrase,
        phraseLC: key,
        sourceUrls: entry.urls,
        sourceCount: sourceCount,
        inputCount: inputCount,
        applyCount: applyCount
      });
    });

    _autoAnalysisData = analysisRows;

    /* Render result rows */
    hlAutoResultRows.innerHTML = '';
    var anyApplicable = false;

    analysisRows.forEach(function(row) {
      var el = document.createElement('div');
      el.className = 'hl-auto-result-row';

      var statusClass, statusText;
      if (row.applyCount === 0) {
        statusClass = 'none';
        statusText = '✗ 0 to link';
      } else if (row.applyCount < row.sourceCount) {
        statusClass = 'partial';
        statusText = '~ ' + row.applyCount + ' of ' + row.sourceCount;
        anyApplicable = true;
      } else {
        statusClass = 'ok';
        statusText = '✓ ' + row.applyCount + ' to link';
        anyApplicable = true;
      }

      el.innerHTML =
        '<span class="hl-auto-result-phrase">' + escH(row.phrase) + '</span>' +
        '<span class="hl-auto-result-count">Src: ' + row.sourceCount + ' | Input: ' + row.inputCount + '</span>' +
        '<span class="hl-auto-result-status ' + statusClass + '">' + statusText + '</span>';

      hlAutoResultRows.appendChild(el);
    });

    hlAutoResults.classList.add('visible');

    var totalApply = analysisRows.reduce(function(s, r) { return s + r.applyCount; }, 0);
    hlAutoStatus.textContent = totalApply
      ? totalApply + ' hyperlink' + (totalApply !== 1 ? 's' : '') + ' ready to apply.'
      : '⚠️ No matching text found in the Input Editor.';

    hlAutoApply.style.display = anyApplicable ? '' : 'none';
  }

  /* Apply: push analysis data into hlPairs */
  function applyAutoLinks() {
    if (!_autoAnalysisData) return;

    _autoAnalysisData.forEach(function(row) {
      if (!row.applyCount) return;

      var pair = getOrCreatePair(row.phrase);

      /* Ensure byOccurrence array is large enough */
      var count = row.inputCount;
      while (pair.byOccurrence.length < count) {
        pair.byOccurrence.push({ index: pair.byOccurrence.length, url: '' });
      }

      /* Apply URLs in order; if source has fewer URLs than input occurrences, link only as many as source has */
      for (var i = 0; i < row.applyCount; i++) {
        if (i < pair.byOccurrence.length) {
          pair.byOccurrence[i].url = row.sourceUrls[i];
        }
      }

      /* Decide mode */
      /* If all applied URLs are the same, use global; otherwise specific */
      var allSame = row.sourceUrls.slice(0, row.applyCount).every(function(u) { return u === row.sourceUrls[0]; });
      if (allSame && row.applyCount > 0) {
        pair.specificMode = false;
        pair.globalUrl = row.sourceUrls[0];
      } else {
        pair.specificMode = true;
        pair.globalUrl = row.sourceUrls[0] || '';
      }
    });

    hlPersist();
    applyHyperlinksToDom();
    renderHlPairs();
    triggerRunProcess();
    closeHlAuto();
    showToast('✅ Hyperlinks applied!', 'success');
  }

  /* Paste area empty state */
  hlAutoPaste.addEventListener('input', function() {
    hlAutoPaste.dataset.empty = hlAutoPaste.innerText.trim() ? 'false' : 'true';
    /* Reset analysis */
    _autoAnalysisData = null;
    hlAutoApply.style.display = 'none';
    hlAutoResults.classList.remove('visible');
    hlAutoStatus.textContent = 'Paste text above, then click Analyse.';
  });

  /* Paste handler: preserve hyperlinks only */
  hlAutoPaste.addEventListener('paste', function(e) {
    e.preventDefault();
    var html = e.clipboardData.getData('text/html');
    var text = e.clipboardData.getData('text/plain');

    if (html) {
      /* Sanitise: keep only text and <a> tags */
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      var sanitised = '';
      function walkForLinks(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          sanitised += node.textContent;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        var tag = node.tagName.toLowerCase();
        if (tag === 'a') {
          var href = (node.getAttribute('href') || '').trim();
          var txt = (node.innerText || node.textContent || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          if (href && !href.startsWith('#')) {
            sanitised += '<a href="' + href.replace(/"/g,'&quot;') + '">' + txt + '</a>';
          } else {
            for (var i = 0; i < node.childNodes.length; i++) walkForLinks(node.childNodes[i]);
          }
          return;
        }
        if (tag === 'br' || tag === 'p' || tag === 'div') {
          for (var i = 0; i < node.childNodes.length; i++) walkForLinks(node.childNodes[i]);
          sanitised += '<br>';
          return;
        }
        for (var i = 0; i < node.childNodes.length; i++) walkForLinks(node.childNodes[i]);
      }
      for (var i = 0; i < tmp.childNodes.length; i++) walkForLinks(tmp.childNodes[i]);
      hlAutoPaste.innerHTML = sanitised;
    } else {
      document.execCommand('insertText', false, text);
    }
    hlAutoPaste.dataset.empty = hlAutoPaste.innerText.trim() ? 'false' : 'true';
    _autoAnalysisData = null;
    hlAutoApply.style.display = 'none';
    hlAutoStatus.textContent = 'Text pasted. Click Analyse to detect hyperlinks.';
  });

  /* Wrap openHlInsert / openHlAuto so Frieren's panel can call them silently */
  /* Toolbar buttons now only open Frieren — these fire only when called programmatically */
  var _hlInsertBtn = document.getElementById('btnInsertHyperlink');
  var _hlAutoBtn   = document.getElementById('btnAutoHyperlink');

  /* Expose so Frieren panel JS can call them directly */
  window._NB_openHlInsert  = openHlInsert;
  window._NB_openHlAuto    = openHlAuto;
  window._NB_closeHlInsert = closeHlInsert;
  window._NB_closeHlAuto   = closeHlAuto;
  window._NB_analyseAutoLinks = analyseAutoLinks;
  window._NB_applyAutoLinks   = applyAutoLinks;
  window._NB_applyHlInsert    = applyHlInsert;

  /* Suppress toolbar click opening the overlay — Frieren panel handles it */
  _hlInsertBtn.addEventListener('click', function(e) {
    e.stopImmediatePropagation();
  });
  _hlAutoBtn.addEventListener('click', function(e) {
    e.stopImmediatePropagation();
  });

  hlAutoClose.addEventListener('click', closeHlAuto);
  hlAutoCancel.addEventListener('click', closeHlAuto);
  hlAutoAnalyse.addEventListener('click', analyseAutoLinks);
  hlAutoApply.addEventListener('click', applyAutoLinks);
  hlAutoOverlay.addEventListener('click', function(e) { if (e.target === hlAutoOverlay) closeHlAuto(); });

  /* ── Init ── */
  hlLoad();
  syncOccurrenceLengths();
  renderHlPairs();
  applyHyperlinksToDom();

})();
}); // end DOMContentLoaded
