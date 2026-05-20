/* ============================================================
   AUTOFILL SUGGESTIONS + SENTENCE REPLACER
   - Autofill: prefix-match sentences from Case Library col 8
     as user types in the editor. Shows a dropdown of up to 4.
   - Find Similar: highlight text in editor → click button →
     ranked popup of library sentences sharing the most words.
   ============================================================ */
(function () {

  /* ── CSS ─────────────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = [

    /* Autofill dropdown */
    '#nb-autofill-dropdown {',
    '  position: fixed;',
    '  z-index: 8500;',
    '  background: white;',
    '  border: 1.5px solid var(--sf-blue);',
    '  border-radius: 6px;',
    '  box-shadow: 0 6px 24px rgba(0,0,0,0.18);',
    '  min-width: 420px;',
    '  max-width: 640px;',
    '  max-height: 70vh;',
    '  display: flex;',
    '  flex-direction: column;',
    '  overflow: hidden;',
    '  font-family: var(--font);',
    '}',
    '#nb-autofill-dropdown .af-scroll {',
    '  overflow-y: auto;',
    '  flex: 1;',
    '  max-height: 260px;',
    '}',
    '#nb-autofill-dropdown .af-header {',
    '  background: var(--sf-blue-light);',
    '  border-bottom: 1px solid var(--sf-gray-3);',
    '  padding: 5px 10px;',
    '  font-size: 10px;',
    '  font-weight: 700;',
    '  color: var(--sf-blue-dark);',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.06em;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '  flex-shrink: 0;',
    '}',
    '#nb-autofill-dropdown .af-item {',
    '  padding: 9px 13px;',
    '  font-size: 12.5px;',
    '  color: var(--sf-gray-7);',
    '  cursor: pointer;',
    '  border-bottom: 1px solid var(--sf-gray-2);',
    '  line-height: 1.6;',
    '  white-space: normal;',
    '  word-wrap: break-word;',
    '  transition: background 0.1s;',
    '}',
    '#nb-autofill-dropdown .af-item:last-child { border-bottom: none; }',
    '#nb-autofill-dropdown .af-item:hover,',
    '#nb-autofill-dropdown .af-item.af-focused { background: var(--sf-blue-light); }',
    '#nb-autofill-dropdown .af-match { font-weight: 700; color: var(--sf-blue); }',
    '#nb-autofill-dropdown .af-footer {',
    '  padding: 4px 10px;',
    '  font-size: 10px;',
    '  color: var(--sf-gray-5);',
    '  background: var(--sf-gray-1);',
    '  border-top: 1px solid var(--sf-gray-2);',
    '}',

    /* Find Similar popup */
    '#nb-similar-overlay {',
    '  position: fixed;',
    '  inset: 0;',
    '  background: rgba(0,0,0,0.38);',
    '  z-index: 8600;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '}',
    '#nb-similar-popup {',
    '  background: white;',
    '  border-radius: 8px;',
    '  box-shadow: 0 12px 48px rgba(0,0,0,0.28);',
    '  width: min(660px, 95vw);',
    '  max-height: 72vh;',
    '  display: flex;',
    '  flex-direction: column;',
    '  overflow: hidden;',
    '  font-family: var(--font);',
    '  animation: nb-pop-in 0.18s ease;',
    '}',
    '@keyframes nb-pop-in {',
    '  from { transform: scale(0.93) translateY(10px); opacity: 0; }',
    '  to   { transform: none; opacity: 1; }',
    '}',
    '#nb-similar-popup .sim-header {',
    '  background: var(--sf-nav-bg);',
    '  color: white;',
    '  padding: 13px 18px;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 10px;',
    '  flex-shrink: 0;',
    '}',
    '#nb-similar-popup .sim-header-title { flex: 1; font-size: 14px; font-weight: 700; }',
    '#nb-similar-popup .sim-close {',
    '  cursor: pointer; color: rgba(255,255,255,0.75);',
    '  font-size: 19px; line-height: 1;',
    '}',
    '#nb-similar-popup .sim-close:hover { color: white; }',
    '#nb-similar-popup .sim-query-box {',
    '  background: var(--sf-gray-1);',
    '  border-bottom: 1px solid var(--sf-gray-3);',
    '  padding: 10px 18px;',
    '  font-size: 12px;',
    '  color: var(--sf-gray-6);',
    '  flex-shrink: 0;',
    '}',
    '#nb-similar-popup .sim-query-box strong {',
    '  color: var(--sf-gray-7);',
    '  font-style: italic;',
    '}',
    '#nb-similar-popup .sim-count {',
    '  font-size: 11px;',
    '  color: var(--sf-gray-5);',
    '  margin-top: 2px;',
    '}',
    '#nb-similar-popup .sim-list {',
    '  flex: 1;',
    '  overflow-y: auto;',
    '  padding: 8px 0;',
    '}',
    '#nb-similar-popup .sim-item {',
    '  display: flex;',
    '  align-items: flex-start;',
    '  gap: 10px;',
    '  padding: 9px 18px;',
    '  cursor: pointer;',
    '  border-bottom: 1px solid var(--sf-gray-2);',
    '  transition: background 0.1s;',
    '}',
    '#nb-similar-popup .sim-item:last-child { border-bottom: none; }',
    '#nb-similar-popup .sim-item:hover { background: var(--sf-blue-light); }',
    '#nb-similar-popup .sim-score-bar {',
    '  flex-shrink: 0;',
    '  width: 36px;',
    '  display: flex;',
    '  flex-direction: column;',
    '  align-items: center;',
    '  gap: 3px;',
    '  padding-top: 2px;',
    '}',
    '#nb-similar-popup .sim-score-num {',
    '  font-size: 11px;',
    '  font-weight: 700;',
    '  color: var(--sf-blue);',
    '}',
    '#nb-similar-popup .sim-score-fill {',
    '  width: 6px;',
    '  border-radius: 3px;',
    '  background: linear-gradient(to top, var(--sf-blue-light), var(--sf-blue));',
    '  min-height: 4px;',
    '}',
    '#nb-similar-popup .sim-text {',
    '  flex: 1;',
    '  font-size: 12.5px;',
    '  color: var(--sf-gray-7);',
    '  line-height: 1.55;',
    '}',
    '#nb-similar-popup .sim-text em { color: var(--sf-blue); font-style: normal; font-weight: 600; }',
    '#nb-similar-popup .sim-replace-btn {',
    '  flex-shrink: 0;',
    '  padding: 4px 10px;',
    '  border-radius: 4px;',
    '  font-size: 11px;',
    '  font-weight: 700;',
    '  cursor: pointer;',
    '  border: 1.5px solid var(--sf-blue);',
    '  color: var(--sf-blue);',
    '  background: white;',
    '  font-family: var(--font);',
    '  transition: background 0.12s, color 0.12s;',
    '  white-space: nowrap;',
    '  align-self: center;',
    '}',
    '#nb-similar-popup .sim-replace-btn:hover { background: var(--sf-blue); color: white; }',
    '#nb-similar-popup .sim-empty {',
    '  padding: 36px 18px;',
    '  text-align: center;',
    '  color: var(--sf-gray-5);',
    '  font-size: 13px;',
    '}',
    '#nb-similar-popup .sim-footer {',
    '  border-top: 1px solid var(--sf-gray-3);',
    '  padding: 10px 18px;',
    '  background: var(--sf-gray-1);',
    '  font-size: 11px;',
    '  color: var(--sf-gray-5);',
    '  flex-shrink: 0;',
    '}',

  ].join('\n');
  document.head.appendChild(style);

  /* ── SENTENCE CORPUS ─────────────────────────────────────── */
  /* All sentences from col 8 of every case, deduplicated */
  var corpus = []; // [{text, words: Set}]

  function splitSentences(text) {
    /* Split on sentence-ending punctuation followed by whitespace / end */
    return text
      .replace(/\r\n/g, '\n')
      .split(/([.!?])\s+/).reduce(function(acc, part, i, arr) {
        if (i % 2 === 0) { acc.push(part); } else { acc[acc.length - 1] += part; }
        return acc;
      }, [])
      .map(function(s) { return s.trim(); })
      .filter(function(s) { return s.length > 15; }); /* skip tiny fragments */
  }

  function buildCorpus() {
    var tl = window._NB_TL;
    if (!tl || !tl.cases.length) { corpus = []; return; }

    var seen = new Set();
    var newCorpus = [];

    tl.cases.forEach(function(c) {
      var lastCell = c.cells[c.cells.length - 1] || '';
      var sentences = splitSentences(lastCell);
      sentences.forEach(function(sent) {
        var key = sent.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) return;
        seen.add(key);
        var words = new Set(
          sent.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(function(w) { return w.length > 2; }) /* skip stop-word-length */
        );
        newCorpus.push({ text: sent, words: words });
      });
    });

    corpus = newCorpus;
    /* Expose globally for Coco panel */
    window._NB_corpus = corpus;
  }

  /* Hook: called by updateBadge() every time library changes */
  window._NB_rebuildCorpus = function() { buildCorpus(); window._NB_corpus = corpus; };

  /* ── AUTOFILL STATE ──────────────────────────────────────── */
  var autofillOn = false;
  var afDropdown = null;
  var afFocusIdx = -1;
  var afDebounce = null;
  var afCurrentMatches = [];

  /* Saved selection for insertion */
  var afSavedRange = null;

  /* ── AUTOFILL TOGGLE ─────────────────────────────────────── */
  var btnToggle = document.getElementById('btnAutofillToggle');
  var afDot     = document.getElementById('autofillDot');

  btnToggle.addEventListener('click', function() {
    autofillOn = !autofillOn;
    afDot.style.background = autofillOn ? 'var(--sf-green)' : 'var(--sf-gray-4)';
    btnToggle.style.borderColor = autofillOn ? 'var(--sf-green)' : '';
    btnToggle.style.color = autofillOn ? 'var(--sf-green)' : '';
    if (!autofillOn) hideDropdown();
    showToast(autofillOn ? '✅ Autofill Suggestions ON' : '⭕ Autofill Suggestions OFF', 'success');
  });

  /* ── AUTOFILL DROPDOWN ───────────────────────────────────── */
  function getOrCreateDropdown() {
    if (!afDropdown) {
      afDropdown = document.createElement('div');
      afDropdown.id = 'nb-autofill-dropdown';
      document.body.appendChild(afDropdown);
    }
    return afDropdown;
  }

  function hideDropdown() {
    if (afDropdown) afDropdown.style.display = 'none';
    afFocusIdx = -1;
    afCurrentMatches = [];
  }

  function positionDropdown(editorEl) {
    /* Place below the caret — flip above if it would go off-screen */
    var sel = window.getSelection();
    var rect = null;
    if (sel && sel.rangeCount) {
      try {
        var r = sel.getRangeAt(0).getBoundingClientRect();
        if (r && r.width !== undefined) rect = r;
      } catch(e) {}
    }
    if (!rect || !rect.top) {
      rect = editorEl.getBoundingClientRect();
    }
    var dd = getOrCreateDropdown();

    /* Horizontal: keep within viewport */
    var ddW = 420;
    var left = rect.left;
    if (left + ddW > window.innerWidth - 12) left = window.innerWidth - ddW - 12;
    if (left < 8) left = 8;

    /* Vertical: prefer below caret, flip above if not enough room */
    var ddH = dd.offsetHeight || 320; /* estimated height before first render */
    var spaceBelow = window.innerHeight - rect.bottom - 8;
    var spaceAbove = rect.top - 8;

    dd.style.left   = left + 'px';
    dd.style.right  = '';

    if (spaceBelow >= ddH || spaceBelow >= spaceAbove) {
      /* Fits below, or more space below than above — go below */
      dd.style.top    = (rect.bottom + 4) + 'px';
      dd.style.bottom = '';
    } else {
      /* Flip above the caret */
      dd.style.top    = '';
      dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    }
  }

  /* Find sentences that start with the typed prefix (word-by-word order match) */
  function findAutofillMatches(prefix) {
    if (!corpus.length || prefix.length < 3) return [];
    var lower = prefix.toLowerCase();
    var matches = [];
    corpus.forEach(function(entry) {
      var sentLower = entry.text.toLowerCase();
      if (sentLower.startsWith(lower)) {
        matches.push(entry.text);
      }
    });
    /* Also do a substring match to catch partial word — always run to get all matches */
    corpus.forEach(function(entry) {
      var sentLower = entry.text.toLowerCase();
      if (!sentLower.startsWith(lower) && sentLower.indexOf(lower) === 0) {
        matches.push(entry.text);
      }
    });
    /* Deduplicate — no limit, show all matches */
    var seen2 = new Set();
    return matches.filter(function(m) {
      if (seen2.has(m)) return false;
      seen2.add(m);
      return true;
    });
  }

  /* Get the text in the current paragraph/line up to the caret */
  function getTypedPrefix(editorEl) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return '';
    var range = sel.getRangeAt(0);

    /* Walk up from the caret's text node to find the innermost
       block element (div, p, li, or the editor itself) that acts
       as the current "line", then take only the text within that
       block up to the caret position.                            */
    var node = range.startContainer;
    var offset = range.startOffset;

    /* If caret is inside a text node, grab text up to the caret */
    var lineText = '';
    if (node.nodeType === Node.TEXT_NODE) {
      lineText = node.textContent.slice(0, offset);
      node = node.parentNode;
    }

    /* Walk up collecting preceding text siblings within the same block */
    var BLOCK_TAGS = { DIV: 1, P: 1, LI: 1, BLOCKQUOTE: 1 };
    while (node && node !== editorEl && !BLOCK_TAGS[node.tagName]) {
      /* prepend any text from earlier siblings at this level */
      var sib = node.previousSibling;
      var hitBR = false;
      while (sib && !hitBR) {
        if (sib.nodeType === Node.TEXT_NODE) {
          lineText = sib.textContent + lineText;
          sib = sib.previousSibling;
        } else if (sib.tagName === 'BR') {
          /* Hard line break — everything before this is a previous line */
          lineText = '';
          hitBR = true;
        } else {
          lineText = (sib.innerText || sib.textContent || '') + lineText;
          sib = sib.previousSibling;
        }
      }
      if (hitBR) break;
      node = node.parentNode;
    }

    return lineText.trimStart();
  }

  function highlightMatch(sentence, prefix) {
    var lower = sentence.toLowerCase();
    var pLower = prefix.toLowerCase();
    var idx = lower.indexOf(pLower);
    if (idx === -1) return escHtmlAf(sentence);
    return escHtmlAf(sentence.slice(0, idx)) +
           '<span class="af-match">' + escHtmlAf(sentence.slice(idx, idx + prefix.length)) + '</span>' +
           escHtmlAf(sentence.slice(idx + prefix.length));
  }

  function escHtmlAf(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function showDropdown(matches, prefix, editorEl) {
    afCurrentMatches = matches;
    var dd = getOrCreateDropdown();
    var html = '<div class="af-header">💡 ' + matches.length + ' match' + (matches.length !== 1 ? 'es' : '') + ' · ' + corpus.length + ' sentences indexed</div>';
    html += '<div class="af-scroll">'; 
    matches.forEach(function(sent, i) { 
      html += '<div class="af-item" data-idx="' + i + '">' + highlightMatch(sent, prefix) + '</div>'; 
    }); 
    html += '</div>'; 
    html += '<div class="af-footer">↑↓ navigate · Enter / click to insert · Esc to dismiss</div>';
    dd.innerHTML = html;
    dd.style.display = 'block';
    positionDropdown(editorEl);

    /* Click to insert */
    dd.querySelectorAll('.af-item').forEach(function(item) {
      item.addEventListener('mousedown', function(e) {
        e.preventDefault(); /* don't blur editor */
        var idx = parseInt(item.dataset.idx);
        insertSuggestion(afCurrentMatches[idx], prefix, editorEl);
      });
    });

    afFocusIdx = -1;
  }

  function updateFocusHighlight() {
    if (!afDropdown) return;
    afDropdown.querySelectorAll('.af-item').forEach(function(item, i) {
      item.classList.toggle('af-focused', i === afFocusIdx);
      if (i === afFocusIdx) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /* Replace the typed prefix in the editor with the chosen sentence */
  function insertSuggestion(sentence, prefix, editorEl) {
    editorEl.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) { hideDropdown(); return; }

    /* Select the typed prefix backwards from caret, then replace it.
       We use a TreeWalker to move the range start backward by exactly
       prefix.length characters, crossing text-node boundaries safely. */
    var range = sel.getRangeAt(0).cloneRange();
    range.collapse(true); /* caret position = end of prefix */

    var charsToDelete = prefix.length;
    var node = range.startContainer;
    var offset = range.startOffset;

    /* Walk backwards through text nodes until we've covered prefix.length chars */
    while (charsToDelete > 0 && node) {
      if (node.nodeType === Node.TEXT_NODE) {
        var available = Math.min(offset, charsToDelete);
        offset -= available;
        charsToDelete -= available;
        if (charsToDelete === 0) {
          range.setStart(node, offset);
          break;
        }
        /* Move to previous text node */
        var prev = node.previousSibling;
        while (prev && prev.nodeType !== Node.TEXT_NODE) {
          if (prev.tagName === 'BR') { charsToDelete = 0; break; }
          prev = prev.previousSibling;
        }
        if (!prev || prev.tagName === 'BR') break;
        node = prev;
        offset = node.textContent.length;
      } else {
        break;
      }
    }

    if (charsToDelete === 0) {
      /* Successfully selected the prefix — replace it */
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, sentence);
    } else {
      /* Fallback: delete char-by-char using backspace simulation */
      for (var i = 0; i < prefix.length; i++) {
        document.execCommand('delete', false);
      }
      document.execCommand('insertText', false, sentence);
    }

    hideDropdown();
    editorEl.dispatchEvent(new Event('input'));
  }

  /* ── EDITOR INPUT HANDLER ─────────────────────────────────── */
  var editor = document.getElementById('inputEditor');
  if (editor) {
    editor.addEventListener('keydown', function(e) {
      if (!autofillOn || !afCurrentMatches.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        afFocusIdx = Math.min(afFocusIdx + 1, afCurrentMatches.length - 1);
        updateFocusHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        afFocusIdx = Math.max(afFocusIdx - 1, 0);
        updateFocusHighlight();
      } else if (e.key === 'Enter' && afFocusIdx >= 0) {
        e.preventDefault();
        var prefix = getTypedPrefix(editor);
        insertSuggestion(afCurrentMatches[afFocusIdx], prefix, editor);
      } else if (e.key === 'Escape') {
        hideDropdown();
      } else if (e.key === 'Tab' && afFocusIdx >= 0) {
        e.preventDefault();
        var prefix2 = getTypedPrefix(editor);
        insertSuggestion(afCurrentMatches[afFocusIdx], prefix2, editor);
      }
    });

    editor.addEventListener('input', function() {
      if (!autofillOn) return;
      clearTimeout(afDebounce);
      afDebounce = setTimeout(function() {
        if (!corpus.length) {
          hideDropdown();
          return;
        }
        var prefix = getTypedPrefix(editor);
        if (prefix.length < 3) { hideDropdown(); return; }
        var matches = findAutofillMatches(prefix);
        if (!matches.length) { hideDropdown(); return; }
        showDropdown(matches, prefix, editor);
      }, 120);
    });

    editor.addEventListener('blur', function() {
      /* Small delay so mousedown on dropdown item fires first */
      setTimeout(hideDropdown, 180);
    });
  }

  /* Close dropdown if clicking outside */
  document.addEventListener('mousedown', function(e) {
    if (afDropdown && !afDropdown.contains(e.target) && e.target !== editor) {
      hideDropdown();
    }
  });

  /* ── FIND SIMILAR ─────────────────────────────────────────── */
  var btnFindSimilar = document.getElementById('btnFindSimilar');

  /* Stop-words to ignore in word matching */
  var STOP_WORDS = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'by','from','as','is','are','was','were','be','been','being','have',
    'has','had','do','does','did','will','would','could','should','may',
    'might','must','shall','that','this','these','those','we','you','he',
    'she','it','they','our','your','his','her','its','their','not','also',
    'can','into','about','which','when','if','so','than','then','all',
    'any','some','one','two','three','been','i','my','me','us'
  ]);

  function scoreMatch(queriedWords, entryWords) {
    var score = 0;
    queriedWords.forEach(function(w) {
      if (!STOP_WORDS.has(w) && entryWords.has(w)) score++;
    });
    return score;
  }

  function findSimilarSentences(queryText) {
    var qWords = new Set(
      queryText.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(function(w) { return w.length > 2 && !STOP_WORDS.has(w); })
    );

    if (!qWords.size) return [];

    var scored = corpus.map(function(entry) {
      return { text: entry.text, words: entry.words, score: scoreMatch(qWords, entry.words), qWords: qWords };
    });

    scored = scored.filter(function(r) { return r.score > 0; });
    scored.sort(function(a, b) { return b.score - a.score; });
    return scored.slice(0, 30); /* up to 30 results */
  }
  /* Expose globally for Coco panel */
  window._NB_findSimilar = findSimilarSentences;

  function highlightCommonWords(sentence, qWords) {
    /* Wrap words that match the query in <em> */
    return sentence.replace(/([a-zA-Z0-9']+)/g, function(word) {
      var lower = word.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (qWords.has(lower) && !STOP_WORDS.has(lower)) {
        return '<em>' + escHtmlAf(word) + '</em>';
      }
      return escHtmlAf(word);
    });
  }

  /* The saved selection/range for "replace selected sentence" */
  var savedSelForReplace = null;

  function showSimilarPopup(queryText, results) {
    /* Remove any existing */
    var old = document.getElementById('nb-similar-overlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'nb-similar-overlay';

    var maxScore = results.length ? results[0].score : 1;

    var qWords = results.length ? results[0].qWords : new Set();

    var listHTML = '';
    if (!results.length) {
      listHTML = '<div class="sim-empty">No similar sentences found.<br><span style="font-size:11px;">Make sure the Case Library has cases loaded.</span></div>';
    } else {
      results.forEach(function(r, i) {
        var barH = Math.max(8, Math.round((r.score / maxScore) * 48));
        listHTML +=
          '<div class="sim-item" data-idx="' + i + '">' +
            '<div class="sim-score-bar">' +
              '<div class="sim-score-num">' + r.score + '</div>' +
              '<div class="sim-score-fill" style="height:' + barH + 'px;"></div>' +
            '</div>' +
            '<div class="sim-text">' + highlightCommonWords(r.text, qWords) + '</div>' +
            '<button class="sim-replace-btn" data-idx="' + i + '">↩ Use</button>' +
          '</div>';
      });
    }

    overlay.innerHTML =
      '<div id="nb-similar-popup">' +
        '<div class="sim-header">' +
          '<span style="font-size:18px;">🔄</span>' +
          '<span class="sim-header-title">Find Similar Sentences</span>' +
          '<span class="sim-close" id="nbSimClose">✕</span>' +
        '</div>' +
        '<div class="sim-query-box">' +
          '<div>Matching against: <strong>"' + escHtmlAf(queryText.slice(0, 120)) + (queryText.length > 120 ? '…' : '') + '"</strong></div>' +
          '<div class="sim-count">' + results.length + ' match' + (results.length !== 1 ? 'es' : '') + ' from ' + corpus.length + ' indexed sentences · sorted by shared keywords</div>' +
        '</div>' +
        '<div class="sim-list">' + listHTML + '</div>' +
        '<div class="sim-footer">Click <strong>↩ Use</strong> to replace your selected sentence in the editor.</div>' +
      '</div>';

    document.body.appendChild(overlay);

    /* Close button */
    document.getElementById('nbSimClose').addEventListener('click', function() {
      overlay.remove();
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });

    /* Replace buttons */
    overlay.querySelectorAll('.sim-replace-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx);
        var replacement = results[idx].text;
        replaceSelectedSentence(replacement);
        overlay.remove();
      });
    });
  }

  /* Expand selection to cover the full sentence containing the caret/selection */
  function getSelectedOrSentenceText() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return { text: '', range: null };

    var text = sel.toString().trim();
    if (text.length > 5) {
      /* User has a manual selection — use it */
      savedSelForReplace = sel.getRangeAt(0).cloneRange();
      return { text: text, range: savedSelForReplace };
    }

    /* No selection — try to auto-expand to the sentence */
    return { text: '', range: null };
  }

  /* Replace the saved range with the new sentence */
  function replaceSelectedSentence(newText) {
    if (!savedSelForReplace) {
      showToast('⚠️ No sentence was selected before finding similar.', 'error');
      return;
    }
    var editorEl = document.getElementById('inputEditor');
    if (!editorEl) return;
    editorEl.focus();
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelForReplace);
    document.execCommand('insertText', false, newText);
    editorEl.dispatchEvent(new Event('input'));
    showToast('✅ Sentence replaced!', 'success');
    savedSelForReplace = null;
  }

  /* Find Similar toolbar button is now handled entirely by uiwiring.js (Coco panel) */

})();
