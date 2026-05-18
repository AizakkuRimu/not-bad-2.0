/* ============================================================
   NEW UI WIRING — Drawer Tabs, Info Tooltips, Bot Routing
   ============================================================ */
document.addEventListener('DOMContentLoaded', function() {

  /* ── (i) Info tooltips ─────────────────────────────────── */
  var tooltip = document.getElementById('infoTooltip');
  document.querySelectorAll('.btn-info-i[data-info]').forEach(function(btn) {
    btn.addEventListener('mouseenter', function(e) {
      tooltip.textContent = btn.dataset.info;
      tooltip.classList.add('visible');
      positionTooltip(e);
    });
    btn.addEventListener('mousemove', positionTooltip);
    btn.addEventListener('mouseleave', function() { tooltip.classList.remove('visible'); });
    btn.addEventListener('click', function(e) { e.stopPropagation(); });
  });
  function positionTooltip(e) {
    var x = e.clientX + 14, y = e.clientY - 8;
    if (x + 290 > window.innerWidth) x = e.clientX - 295;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }

  /* ── Drawer Tabs ──────────────────────────────────────── */
  document.querySelectorAll('.drawer-tab-btn[data-drawtab]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.dataset.drawtab;
      document.querySelectorAll('.drawer-tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.drawer-tab-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      var panel = document.getElementById('tab' + target.charAt(0).toUpperCase() + target.slice(1));
      if (panel) panel.classList.add('active');
    });
  });

  /* ── Helper: close all bot panels ────────────────────── */
  function closeAllBotPanels() {
    document.getElementById('maomaoPanel') && document.getElementById('maomaoPanel').classList.remove('open');
    document.getElementById('tetiaPanel') && document.getElementById('tetiaPanel').classList.remove('open');
    document.getElementById('cocoPanel') && document.getElementById('cocoPanel').classList.remove('open');
    document.getElementById('frierenPanel') && document.getElementById('frierenPanel').classList.remove('open');
  }

  /* ── Helper: position panel so its top-left corner anchors
        to the bottom-right corner of the given button ────── */
  function positionPanelAtButton(panel, btn) {
    var rect   = btn.getBoundingClientRect();
    var panelW = panel.offsetWidth  || parseInt(getComputedStyle(panel).width)     || 320;
    var panelH = panel.offsetHeight || parseInt(getComputedStyle(panel).maxHeight) || 520;

    /* Anchor: panel top-left = button bottom-right */
    var left = rect.right + 4;
    var top  = rect.bottom + 6;

    /* Clamp so panel does not bleed off the right edge */
    if (left + panelW > window.innerWidth - 8) {
      left = window.innerWidth - panelW - 8;
    }
    if (left < 8) left = 8;

    /* Clamp so panel does not bleed off the bottom edge */
    if (top + panelH > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - panelH - 8);
    }

    panel.style.left   = left + 'px';
    panel.style.top    = top  + 'px';
    panel.style.bottom = '';
    panel.style.right  = '';
    /* Animate expanding from the top-left anchor point */
    panel.style.transformOrigin = 'top left';
  }

  /* ── Grammar Check → Maomao ───────────────────────────── */
  var btnGrammar = document.getElementById('btnGrammarCheck');
  if (btnGrammar) {
    btnGrammar.addEventListener('click', function() {
      var mp = document.getElementById('maomaoPanel');
      if (!mp) return;
      var isOpen = mp.classList.contains('open');
      closeAllBotPanels();
      if (!isOpen) {
        positionPanelAtButton(mp, btnGrammar);
        mp.classList.add('open');
        /* Pre-trigger grammar quick button */
        var grammarBtn = document.querySelector('.mao-quick-btn[data-mode="grammar"]');
        if (grammarBtn) {
          var text = (document.getElementById('inputEditor') || {}).innerText || '';
          if (text.trim()) grammarBtn.click();
        }
      }
    });
  }

  /* ── Spelling Check → Tetia ───────────────────────────── */
  var btnSpelling = document.getElementById('btnSpellingCheck');
  if (btnSpelling) {
    btnSpelling.addEventListener('click', function() {
      var tp = document.getElementById('tetiaPanel');
      if (!tp) return;
      var isOpen = tp.classList.contains('open');
      closeAllBotPanels();
      if (!isOpen) {
        positionPanelAtButton(tp, btnSpelling);
        tp.classList.add('open');
        /* Auto-trigger Tetia's check button */
        setTimeout(function() {
          var checkBtn = document.getElementById('tetiaCheckBtn');
          var text = (document.getElementById('inputEditor') || {}).innerText || '';
          if (checkBtn && text.trim()) checkBtn.click();
        }, 120);
      }
    });
  }

  /* ── Autofill Toggle → Coco (toggle panel only) ──────── */
  var btnAutofill = document.getElementById('btnAutofillToggle');
  if (btnAutofill) {
    btnAutofill.addEventListener('click', function() {
      var panel = document.getElementById('cocoPanel');
      if (!panel) return;
      var isOpen = panel.classList.contains('open');
      closeAllBotPanels();
      if (!isOpen) {
        positionPanelAtButton(panel, btnAutofill);
        panel.classList.add('open');
        updateCocoAutofillBtn();
      }
    });
  }

  /* ── Find Similar → Coco (toggle panel only) ─────────── */
  var btnFindSimToolbar = document.getElementById('btnFindSimilar');
  if (btnFindSimToolbar) {
    btnFindSimToolbar.addEventListener('click', function() {
      var panel = document.getElementById('cocoPanel');
      if (!panel) return;
      var isOpen = panel.classList.contains('open');
      closeAllBotPanels();
      if (!isOpen) {
        positionPanelAtButton(panel, btnFindSimToolbar);
        panel.classList.add('open');
      }
      /* Trigger find-similar logic after panel opens */
      setTimeout(function() {
        var cocoFindBtn = document.getElementById('cocoFindSimilar');
        if (cocoFindBtn) cocoFindBtn.click();
      }, 50);
    });
  }

  /* ── Insert Hyperlink → Frieren (toggle panel only) ──── */
  var btnInsHL = document.getElementById('btnInsertHyperlink');
  if (btnInsHL) {
    btnInsHL.addEventListener('click', function() {
      var panel = document.getElementById('frierenPanel');
      if (!panel) return;
      var isOpen = panel.classList.contains('open');
      closeAllBotPanels();
      if (!isOpen) {
        positionPanelAtButton(panel, btnInsHL);
        panel.classList.add('open');
        showFrierenMode('insert');
      }
    });
  }

  /* ── Auto Hyperlinks → Frieren (toggle panel only) ───── */
  var btnAutoHL = document.getElementById('btnAutoHyperlink');
  if (btnAutoHL) {
    btnAutoHL.addEventListener('click', function() {
      var panel = document.getElementById('frierenPanel');
      if (!panel) return;
      var isOpen = panel.classList.contains('open');
      closeAllBotPanels();
      if (!isOpen) {
        positionPanelAtButton(panel, btnAutoHL);
        panel.classList.add('open');
        showFrierenMode('auto');
      }
    });
  }

  /* ── Coco Panel Logic ─────────────────────────────────── */

  function openCocoPanel(mode) {
    var panel = document.getElementById('cocoPanel');
    closeAllBotPanels();
    var btn = mode === 'autofill'
      ? document.getElementById('btnAutofillToggle')
      : document.getElementById('btnFindSimilar');
    if (btn) positionPanelAtButton(panel, btn);
    panel.classList.add('open');
    if (mode === 'autofill') {
      updateCocoAutofillBtn();
    }
  }

  function updateCocoAutofillBtn() {
    var dot = document.getElementById('autofillDot');
    var btn = document.getElementById('cocoToggleAutofill');
    if (!dot || !btn) return;
    var isOn = dot.style.background === 'var(--sf-green)' || dot.style.background === '#3db84e';
    btn.textContent = isOn ? '⚡ Autofill: ON' : '⚡ Autofill: OFF';
    btn.classList.toggle('active', isOn);
  }

  document.getElementById('cocoClose').addEventListener('click', function() {
    var panel = document.getElementById('cocoPanel');
    panel.classList.remove('open');
    panel.classList.remove('expanded');
    document.getElementById('cocoSimArea').classList.remove('active');
  });

  document.getElementById('cocoToggleAutofill').addEventListener('click', function() {
    /* Delegate to the actual autofill toggle button */
    var orig = document.getElementById('btnAutofillToggle');
    if (orig) orig.dispatchEvent(new MouseEvent('click', { bubbles: false }));
    setTimeout(function() {
      updateCocoAutofillBtn();
      var dot = document.getElementById('autofillDot');
      var isOn = dot && (dot.style.background === 'var(--sf-green)' || dot.style.background === '#3db84e');
      if (isOn) {
        addCocoMsg('bot', 'Got it! ✨ Autofill is now ON! Keep typing in the editor and I\'ll suggest matching sentences from the Case Library. It\'s magical, you know!');
      } else {
        addCocoMsg('bot', 'Got it! ✨ Autofill is now OFF! You can keep typing without any automatic edits! Kinda cool, huh?');
      }
    }, 100);
  });

  document.getElementById('cocoFindSimilar').addEventListener('click', function() {
    /* Run Find Similar logic inline in Coco's panel */
    var cocoSimArea = document.getElementById('cocoSimArea');
    var cocoPanel = document.getElementById('cocoPanel');

    if (!window._NB_corpus || !window._NB_corpus.length) {
      addCocoMsg('bot', 'Hmm! ✨ The Case Library is empty — paste some cases first, then I can search for matches!');
      return;
    }

    var sel = window.getSelection();
    var queryText = sel ? sel.toString().trim() : '';
    if (queryText.length < 5) {
      addCocoMsg('bot', 'Select a sentence in the editor first, then I\'ll find similar ones for you! ✨');
      return;
    }

    /* Save selection for replacement */
    if (sel && sel.rangeCount) {
      window._NB_savedSelForReplace = sel.getRangeAt(0).cloneRange();
    }

    var results = window._NB_findSimilar ? window._NB_findSimilar(queryText) : [];

    addCocoMsg('bot', 'Found ' + results.length + ' match' + (results.length !== 1 ? 'es' : '') + ' for your sentence! ✨ Here they are below — click ↩ Use to swap!');

    /* Build list HTML */
    var maxScore = results.length ? results[0].score : 1;
    var qWords = results.length ? results[0].qWords : new Set();

    var listHTML = '';
    if (!results.length) {
      listHTML = '<div class="coco-sim-empty">No similar sentences found.<br><span style="font-size:11px;">Make sure the Case Library has cases loaded.</span></div>';
    } else {
      results.forEach(function(r, i) {
        var barH = Math.max(6, Math.round((r.score / maxScore) * 36));
        var highlighted = r.text.replace(/([a-zA-Z0-9']+)/g, function(word) {
          var lower = word.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (qWords.has(lower)) return '<em>' + escHtml(word) + '</em>';
          return escHtml(word);
        });
        listHTML +=
          '<div class="coco-sim-item" data-idx="' + i + '">' +
            '<div class="coco-sim-score">' +
              '<div class="coco-sim-score-num">' + r.score + '</div>' +
              '<div class="coco-sim-score-bar" style="height:' + barH + 'px;"></div>' +
            '</div>' +
            '<div class="coco-sim-text">' + highlighted + '</div>' +
            '<button class="coco-sim-use" data-idx="' + i + '">↩ Use</button>' +
          '</div>';
      });
    }

    document.getElementById('cocoSimQuery').innerHTML =
      'Matching: <strong>"' + escHtml(queryText.slice(0, 80)) + (queryText.length > 80 ? '…' : '') + '"</strong><br>' +
      '<span style="font-size:10px; color:#7cb87c;">' + results.length + ' match' + (results.length !== 1 ? 'es' : '') + ' · ' + (window._NB_corpus ? window._NB_corpus.length : 0) + ' sentences indexed</span>';
    document.getElementById('cocoSimList').innerHTML = listHTML;
    cocoPanel.classList.add('expanded');
    cocoSimArea.classList.add('active');

    /* Wire up Use buttons */
    cocoSimArea.querySelectorAll('.coco-sim-use').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx);
        var replacement = results[idx].text;
        if (!window._NB_savedSelForReplace) {
          showToast('⚠️ No sentence was selected before finding similar.', 'error');
          return;
        }
        var editorEl = document.getElementById('inputEditor');
        if (!editorEl) return;
        editorEl.focus();
        var sel2 = window.getSelection();
        sel2.removeAllRanges();
        sel2.addRange(window._NB_savedSelForReplace);
        document.execCommand('insertText', false, replacement);
        editorEl.dispatchEvent(new Event('input'));
        showToast('✅ Sentence replaced!', 'success');
        window._NB_savedSelForReplace = null;
        cocoSimArea.classList.remove('active');
        cocoPanel.classList.remove('expanded');
        addCocoMsg('bot', 'Done! ✨ The sentence has been swapped in!');
      });
    });
  });

  function addCocoMsg(role, html) {
    var msgs = document.getElementById('cocoMessages');
    var div = document.createElement('div');
    div.className = 'coco-msg' + (role === 'user' ? ' user' : '');
    div.innerHTML = role === 'bot'
      ? '<div class="coco-msg-avatar" style="padding:0;overflow:hidden;"><img data-isrc="IMG_COCO" alt="Coco" style="width:100%;height:100%;object-fit:cover;object-position:top center;border-radius:50%;"></div><div class="coco-bubble">' + html + '</div>'
      : '<div class="coco-bubble">' + html + '</div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  /* ── Frieren Panel Logic ──────────────────────────────── */

  function openFrierenPanel(mode) {
    var panel = document.getElementById('frierenPanel');
    closeAllBotPanels();
    var btn = mode === 'insert'
      ? document.getElementById('btnInsertHyperlink')
      : document.getElementById('btnAutoHyperlink');
    if (btn) positionPanelAtButton(panel, btn);
    panel.classList.add('open');
    showFrierenMode(mode);
  }

  function showFrierenMode(mode) {
    var insertArea = document.getElementById('frierenInsertArea');
    var autoArea = document.getElementById('frierenAutoArea');
    var panel = document.getElementById('frierenPanel');
    insertArea.classList.remove('active');
    autoArea.classList.remove('active');
    panel.classList.remove('expanded');

    if (mode === 'insert') {
      /* Call openHlInsert to save the selection range (it will open the hidden overlay, which we immediately close) */
      if (window._NB_openHlInsert) {
        window._NB_openHlInsert();
        /* Hide the overlay again — Frieren's panel is showing instead */
        var hlInsertOverlay = document.getElementById('hlInsertOverlay');
        if (hlInsertOverlay) {
          hlInsertOverlay.style.display = 'none';
          setTimeout(function() { hlInsertOverlay.style.display = ''; }, 0);
        }
      }
      /* Mirror the phrase display */
      var sel = window.getSelection();
      var phrase = sel ? sel.toString().trim() : '';
      var hlDisplay = document.getElementById('hlInsertPhraseDisplay');
      document.getElementById('frierenInsertPhraseDisplay').textContent =
        hlDisplay ? hlDisplay.textContent : (phrase ? '"' + phrase + '"' : '—');
      document.getElementById('frierenInsertUrlInput').value = document.getElementById('hlInsertUrlInput') ? document.getElementById('hlInsertUrlInput').value : '';
      insertArea.classList.add('active');
      panel.classList.add('expanded');
      addFrierenMsg('bot', phrase
        ? 'I see you\'ve selected "' + phrase.slice(0, 40) + (phrase.length > 40 ? '…' : '') + '". Enter the URL below and I\'ll attach it precisely.'
        : 'Highlight a word or phrase in the editor first. Then enter the URL below.');
    } else if (mode === 'auto') {
      autoArea.classList.add('active');
      panel.classList.add('expanded');
      addFrierenMsg('bot', 'Paste your source text with hyperlinks into the box below. I will detect every linked phrase and apply them to your input text automatically.');
    }
  }

  document.getElementById('frierenClose').addEventListener('click', function() {
    var panel = document.getElementById('frierenPanel');
    panel.classList.remove('open');
    panel.classList.remove('expanded');
    document.getElementById('frierenInsertArea').classList.remove('active');
    document.getElementById('frierenAutoArea').classList.remove('active');
  });

  document.getElementById('frierenInsertLink').addEventListener('click', function() {
    showFrierenMode('insert');
  });

  document.getElementById('frierenAutoLinks').addEventListener('click', function() {
    showFrierenMode('auto');
  });

  /* ── Frieren Insert Hyperlink actions ─────────────────── */
  document.getElementById('frierenInsertGoToLink').addEventListener('click', function() {
    var url = document.getElementById('frierenInsertUrlInput').value.trim();
    if (url) window.open(url, '_blank');
  });

  document.getElementById('frierenInsertCancel').addEventListener('click', function() {
    document.getElementById('frierenInsertArea').classList.remove('active');
    document.getElementById('frierenPanel').classList.remove('expanded');
  });

  document.getElementById('frierenInsertOk').addEventListener('click', function() {
    var url = document.getElementById('frierenInsertUrlInput').value.trim();
    if (!url) { showToast('⚠️ Please enter a URL first.', 'error'); return; }
    /* Sync URL into the hidden overlay's input, then call applyHlInsert */
    var hlUrlInput = document.getElementById('hlInsertUrlInput');
    if (hlUrlInput) hlUrlInput.value = url;
    if (window._NB_applyHlInsert) {
      window._NB_applyHlInsert();
    }
    document.getElementById('frierenInsertArea').classList.remove('active');
    document.getElementById('frierenPanel').classList.remove('expanded');
    addFrierenMsg('bot', '…Done. The hyperlink has been applied.');
  });

  /* ── Frieren Auto Links actions ───────────────────────── */
  /* Mirror the paste area events from the original hlAutoOverlay */
  var frierenPasteArea = document.getElementById('frierenAutoPasteArea');
  if (frierenPasteArea) {
    frierenPasteArea.addEventListener('input', function() {
      this.dataset.empty = this.textContent.trim() === '' ? 'true' : 'false';
    });
    frierenPasteArea.addEventListener('paste', function() {
      setTimeout(function() {
        frierenPasteArea.dataset.empty = frierenPasteArea.textContent.trim() === '' ? 'true' : 'false';
      }, 10);
    });
  }

  document.getElementById('frierenAutoCancel').addEventListener('click', function() {
    document.getElementById('frierenAutoArea').classList.remove('active');
    document.getElementById('frierenPanel').classList.remove('expanded');
    if (frierenPasteArea) { frierenPasteArea.innerHTML = ''; frierenPasteArea.dataset.empty = 'true'; }
    document.getElementById('frierenAutoResults').classList.remove('visible');
    document.getElementById('frierenAutoResultRows').innerHTML = '';
    document.getElementById('frierenAutoStatus').textContent = 'Paste text above to detect hyperlinks…';
    document.getElementById('frierenAutoApply').style.display = 'none';
  });

  document.getElementById('frierenAutoAnalyse').addEventListener('click', function() {
    /* Copy paste content to hidden overlay's paste area, then call analyse */
    var hlAutoPasteArea = document.getElementById('hlAutoPasteArea');
    if (!hlAutoPasteArea || !frierenPasteArea) return;
    hlAutoPasteArea.innerHTML = frierenPasteArea.innerHTML;
    hlAutoPasteArea.dataset.empty = frierenPasteArea.dataset.empty;

    if (window._NB_analyseAutoLinks) {
      window._NB_analyseAutoLinks();
      /* Mirror results back after a tick */
      setTimeout(function() {
        var hlAutoResults = document.getElementById('hlAutoResults');
        var hlAutoResultRows = document.getElementById('hlAutoResultRows');
        var hlAutoStatus = document.getElementById('hlAutoStatus');
        var hlAutoApply = document.getElementById('hlAutoApply');
        var frierenResults = document.getElementById('frierenAutoResults');
        var frierenResultRows = document.getElementById('frierenAutoResultRows');
        var frierenStatus = document.getElementById('frierenAutoStatus');
        var frierenApply = document.getElementById('frierenAutoApply');
        if (frierenResultRows && hlAutoResultRows) frierenResultRows.innerHTML = hlAutoResultRows.innerHTML;
        if (frierenResults && hlAutoResults) frierenResults.className = 'frieren-auto-results' + (hlAutoResults.classList.contains('visible') ? ' visible' : '');
        if (frierenStatus && hlAutoStatus) frierenStatus.textContent = hlAutoStatus.textContent;
        if (frierenApply && hlAutoApply) frierenApply.style.display = hlAutoApply.style.display;
      }, 50);
    }
  });

  document.getElementById('frierenAutoApply').addEventListener('click', function() {
    /* Copy content to hidden overlay, then apply */
    var hlAutoPasteArea = document.getElementById('hlAutoPasteArea');
    if (hlAutoPasteArea && frierenPasteArea) hlAutoPasteArea.innerHTML = frierenPasteArea.innerHTML;

    if (window._NB_applyAutoLinks) {
      window._NB_applyAutoLinks();
    }
    document.getElementById('frierenAutoArea').classList.remove('active');
    document.getElementById('frierenPanel').classList.remove('expanded');
    if (frierenPasteArea) { frierenPasteArea.innerHTML = ''; frierenPasteArea.dataset.empty = 'true'; }
    document.getElementById('frierenAutoResults').classList.remove('visible');
    document.getElementById('frierenAutoApply').style.display = 'none';
    addFrierenMsg('bot', '…Done. All detected hyperlinks have been applied to the input text.');
  });

  function addFrierenMsg(role, html) {
    var msgs = document.getElementById('frierenMessages');
    var div = document.createElement('div');
    div.className = 'frieren-msg' + (role === 'user' ? ' user' : '');
    div.innerHTML = role === 'bot'
      ? '<div class="frieren-msg-avatar" style="padding:0;overflow:hidden;"><img data-isrc="IMG_FRIEREN" alt="Frieren" style="width:100%;height:100%;object-fit:cover;object-position:top center;border-radius:50%;"></div><div class="frieren-bubble">' + escHtml(html) + '</div>'
      : '<div class="frieren-bubble">' + html + '</div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  /* ── Shared Anthropic API helper ─────────────────────── */
  function callAnthropicAPI(system, userMsg) {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: system,
        messages: [{ role: 'user', content: userMsg }]
      })
    }).then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.content && d.content[0] && d.content[0].text) return d.content[0].text;
        throw new Error('No content');
      });
  }

  /* ── Shared HTML escape ───────────────────────────────── */
  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>');
  }

  /* ── Keep Hyperlink Pairs tab badge in sync ───────────── */
  var _hlBadge = document.getElementById('hlPairBadge');
  var _origRenderHlPairs = window.renderHlPairs;
  /* MutationObserver on the hlSectionBody to update badge */
  var hlBodyObs = document.getElementById('hlSectionBody');
  if (hlBodyObs && _hlBadge) {
    new MutationObserver(function() {
      var cards = hlBodyObs.querySelectorAll('.hl-pair-card').length;
      _hlBadge.textContent = cards;
    }).observe(hlBodyObs, { childList: true, subtree: false });
  }

  /* ── Auto-switch to Hyperlinks tab when pairs are added ── */
  /* (optional nice-to-have) */

});
