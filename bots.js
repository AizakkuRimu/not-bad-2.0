// ===== MAOMAO BOT JS =====
(function() {

  // ── Helpers ─────────────────────────────────────────────────────────────
  function escH(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getSentences(text) {
    // Split on sentence-ending punctuation, keep the punctuation
    return text.match(/[^.!?]+[.!?]*/g) || [text];
  }

  function highlight(sentence) {
    return '<span style="background:#fff3cd;padding:1px 3px;border-radius:2px;font-style:italic;">"' + escH(sentence.trim()) + '"</span>';
  }

  function issueBlock(problem, fix) {
    return '<div style="margin-bottom:12px;padding:10px 12px;background:#f8f9fa;border-left:3px solid #0176d3;border-radius:0 4px 4px 0;">' +
      '<div style="margin-bottom:4px;">🔍 <strong>Issue:</strong> ' + problem + '</div>' +
      '<div>💊 <strong>Fix:</strong> ' + fix + '</div>' +
    '</div>';
  }

  function allClearBlock(msg) {
    return '<div style="padding:10px 12px;background:#f0faf3;border-left:3px solid #2e844a;border-radius:0 4px 4px 0;">' +
      '✅ ' + msg + '</div>';
  }

  function intro(label, count) {
    if (count === 0) return '';
    return '<div style="margin-bottom:10px;font-size:12px;color:#706e6b;">Found <strong>' + count + '</strong> ' + label + (count !== 1 ? 's' : '') + ' to fix.</div>';
  }



  // ── 5. JARGON ───────────────────────────────────────────────────────────
  var JARGON_LIST = [
    { re: /\btouch base\b/gi,           fix: '"meet", "connect", or "check in"' },
    { re: /\bcircle back\b/gi,          fix: '"follow up"' },
    { re: /\bleverage\b/gi,             fix: '"use"' },
    { re: /\bsynergi[sz]e?\b/gi,        fix: '"work together"' },
    { re: /\bmoving forward\b/gi,       fix: '"from now on" or "going ahead"' },
    { re: /\breach out\b/gi,            fix: '"contact", "email", or "call"' },
    { re: /\bpivot\b/gi,                fix: '"change direction" or "shift focus"' },
    { re: /\bgame.?changer\b/gi,        fix: 'be specific about what makes it significant' },
    { re: /\bthought leader\b/gi,       fix: '"expert" or "specialist"' },
    { re: /\bvalue.?add\b/gi,           fix: 'be specific — what value, exactly?' },
    { re: /\baction item\b/gi,          fix: '"task" or "next step"' },
    { re: /\bbandwidth\b/gi,            fix: '"capacity" or "time"' },
    { re: /\bdeep.?dive\b/gi,           fix: '"detailed review" or "thorough analysis"' },
    { re: /\bpeel back the (layers|onion)\b/gi, fix: '"look more closely"' },
    { re: /\blow.?hanging fruit\b/gi,   fix: '"easy win" or "quick opportunity"' },
    { re: /\bboil the ocean\b/gi,       fix: '"try to do too much at once"' },
    { re: /\bmove the needle\b/gi,      fix: '"make a meaningful difference"' },
    { re: /\bcore competency\b/gi,      fix: '"main strength" or "key skill"' },
    { re: /\bholistic approach\b/gi,    fix: 'be specific about what you mean' },
    { re: /\bparadigm shift\b/gi,       fix: '"major change"' },
    { re: /\brobust\b/gi,               fix: '"strong", "reliable", or "thorough"' },
    { re: /\bseamless\b/gi,             fix: '"smooth" or "easy"' },
    { re: /\bscalable\b/gi,             fix: 'explain specifically how it grows' },
    { re: /\binnovative\b/gi,           fix: 'describe what is actually new about it' },
    { re: /\bworld.?class\b/gi,         fix: 'be specific about the standard' },
    { re: /\bbest.?in.?class\b/gi,      fix: 'be specific about the standard' },
    { re: /\bstakeholder\b/gi,          fix: '"team", "client", "partner" — name who specifically' },
    { re: /\bask\b(?=\s+(?:is|was|here|from))/gi, fix: '"request" or "question" — using "ask" as a noun is jargon' },
  ];

  function checkJargon(text) {
    var findings = [];
    JARGON_LIST.forEach(function(item) {
      if (findings.length >= 10) return;
      item.re.lastIndex = 0;
      var m;
      while ((m = item.re.exec(text)) !== null) {
        if (findings.length >= 10) break;
        var start = Math.max(0, m.index - 30);
        var end   = Math.min(text.length, m.index + m[0].length + 30);
        var ctx   = (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
        findings.push(issueBlock(
          highlight(ctx) + ' — <strong>"' + escH(m[0]) + '"</strong> is corporate jargon',
          'Replace with ' + item.fix
        ));
      }
    });
    if (!findings.length) return allClearBlock('No jargon detected. Plain and clear. 🍵');
    return intro('jargon phrase', findings.length) + findings.join('');
  }


  // ── 6. FORMAL (contractions / short forms) ──────────────────────────────
  // Matches contractions where the apostrophe belongs to the word, NOT to
  // possessives of proper nouns (names starting with a capital letter that
  // aren't sentence-starters) or well-known name endings we want to skip.
  //
  // Strategy:
  //   1. Find every contraction with a simple global regex.
  //   2. For each match, look at what comes BEFORE the apostrophe.
  //      If the token before 's / 've / 're / 'd / 'll is a word that starts
  //      with an uppercase letter AND is NOT the first word of a sentence,
  //      skip it — it is very likely a proper-noun possessive (e.g. "Tom's").
  //   3. Everything else is flagged.

  var CONTRACTION_RE = /\b(\w+)(n't|'ve|'re|'ll|'d|'s|'m)\b/gi;

  // Proper-noun possessive guard: word immediately before the clitic starts
  // with a capital, so it's probably a name.  We allow "It's", "He's" etc.
  // because those are pronouns that should still be expanded.
  var PRONOUNS = new Set([
    'i','he','she','it','they','we','you',
    'that','this','there','here','what','who',
    'how','when','where','let','that'
  ]);

  function isLikelyProperNoun(word) {
    if (!word) return false;
    // Starts with capital and is not a known pronoun-starter
    return /^[A-Z]/.test(word) && !PRONOUNS.has(word.toLowerCase());
  }

  var CONTRACTION_EXPAND = {
    "n't":  { neg: true,  hint: '"not"' },
    "'ve":  { hint: '"have"' },
    "'re":  { hint: '"are"' },
    "'ll":  { hint: '"will"' },
    "'d":   { hint: '"had" or "would"' },
    "'m":   { hint: '"am"' },
    // 's is tricky — could be "is", "has", or possessive of a common noun
    "'s":   { hint: '"is" or "has" (or rewrite to avoid the contraction)' },
  };

  function checkFormal(text) {
    var findings = [];
    var m;
    CONTRACTION_RE.lastIndex = 0;

    while ((m = CONTRACTION_RE.exec(text)) !== null) {
      if (findings.length >= 12) break;

      var base   = m[1];   // word before the clitic
      var clitic = m[2];   // the short form, e.g. 've

      // Normalise clitic to a lookup key (regex may capture curly apostrophes)
      var key = clitic.replace(/[\u2018\u2019]/g, "'").toLowerCase();

      // Skip proper-noun possessives for 's
      if (key === "'s" && isLikelyProperNoun(base)) continue;

      var info = CONTRACTION_EXPAND[key];
      if (!info) continue;          // shouldn't happen, but be safe

      // Grab surrounding context
      var start   = Math.max(0, m.index - 30);
      var end     = Math.min(text.length, m.index + m[0].length + 30);
      var ctx     = (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
      var full    = escH(m[0]);

      findings.push(issueBlock(
        highlight(ctx) + ' — <strong>"' + full + '"</strong> is a contraction',
        'Expand to the full form: replace ' + full + ' with the full word (' + info.hint + ')'
      ));
    }

    if (!findings.length) return allClearBlock('No contractions found. Reads formally. 🍵');
    return intro('contraction', findings.length) + findings.join('');
  }


  // ── 7. SENSITIVE IDs ────────────────────────────────────────────────────
  // Detects common national ID / passport numbers and censors chars 2-5
  // (keeps 1st char, masks next 4 with X, shows the rest).
  // e.g.  S1234567C  ->  SXXXX567C
  //       970101-14-5678 -> 9XXXX1-14-5678

  var ID_PATTERNS = [
    {
      name: 'Singapore NRIC / FIN',
      // S/T/F/G/M + 7 digits + 1 letter, word-bounded
      re: /\b([STFGM])(\d{4})(\d{3}[A-Z])\b/gi,
      censor: function(raw, g1, g2, g3) {
        return g1.toUpperCase() + 'XXXX' + g3.toUpperCase();
      }
    },
    {
      name: 'Malaysian IC (MyKad)',
      // 12 digits, optional dashes after pos 6 and 8: YYMMDD-SS-NNNN or YYMMDDSSNNNN
      // Uses lookahead/lookbehind to avoid partial matches inside longer digit strings
      re: /(?<!\d)(\d{6}-?\d{2}-?\d{4})(?!\d)/g,
      censor: function(raw) {
        // Strip dashes, keep digit[0], mask digits[1-4], restore rest, re-insert dashes
        var digits   = raw.replace(/-/g, '');
        var censored = digits[0] + 'XXXX' + digits.slice(5);
        if (raw.indexOf('-') !== -1) {
          return censored.slice(0,6) + '-' + censored.slice(6,8) + '-' + censored.slice(8);
        }
        return censored;
      }
    },
    {
      name: 'Passport number',
      // 1-2 uppercase letters + 6-9 alphanumerics, must contain at least one digit
      re: /\b([A-Z]{1,2})([A-Z0-9]{4})([A-Z0-9]{2,7})\b/g,
      censor: function(raw, g1, g2, g3) {
        // Must have at least one digit in the whole match, else it is just a word
        if (!/\d/.test(raw)) return null;
        // Skip if too short (under 7 total chars) to be a doc number
        if (raw.length < 7) return null;
        return g1 + 'XXXX' + g3;
      }
    },
  ];

  function checkSensitiveIDs(text) {
    var findings = [];
    var seen = {};

    ID_PATTERNS.forEach(function(pattern) {
      if (findings.length >= 15) return;
      pattern.re.lastIndex = 0;
      var m;
      while ((m = pattern.re.exec(text)) !== null) {
        if (findings.length >= 15) break;
        var raw = m[0];
        var key = raw.toUpperCase();
        if (seen[key]) continue;

        var groups   = Array.prototype.slice.call(m, 1);
        var censored = pattern.censor.apply(null, [raw].concat(groups));
        if (censored === null) continue;

        seen[key] = true;

        var start = Math.max(0, m.index - 25);
        var end   = Math.min(text.length, m.index + raw.length + 25);
        var ctx   = (start > 0 ? '...' : '') + text.slice(start, end).trim() + (end < text.length ? '...' : '');

        findings.push(issueBlock(
          highlight(ctx) + ' &mdash; possible <strong>' + pattern.name + '</strong>: <code style="background:#fde8e8;padding:1px 4px;border-radius:3px;font-family:monospace;">' + escH(raw) + '</code>',
          'Censor or remove before sharing. Censored form: <code style="background:#e8f4fd;padding:1px 4px;border-radius:3px;font-family:monospace;font-weight:700;">' + escH(censored) + '</code>'
        ));
      }
    });

    if (!findings.length) return allClearBlock('No sensitive ID numbers detected. Safe to share. \uD83C\uDF75');
    return (
      '<div style="margin-bottom:10px;padding:8px 12px;background:#fff3cd;border-left:3px solid #dd7a01;border-radius:0 4px 4px 0;font-size:12px;">' +
      '\u26A0\uFE0F <strong>Sensitive identifiers found.</strong> Review and censor before sending.' +
      '</div>' +
      intro('sensitive ID', findings.length) +
      findings.join('')
    );
  }


  // ── ANALYSIS DISPATCH ───────────────────────────────────────────────────
  var SYNC_ANALYSERS = {
    jargon:       checkJargon,
    formal:       checkFormal,
    sensitiveids: checkSensitiveIDs,
  };

  // ── Grammar check via LanguageTool ──────────────────────────────────────
  async function checkGrammarLT(text) {
    try {
      var resp = await fetch('https://api.languagetool.org/v2/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          text: text,
          language: 'en-US',
          disabledCategories: 'CASING,PUNCTUATION,TYPOGRAPHY,STYLE,COLLOCATIONS',
          ignoredWords: 'YSOA,MediSave,Singpass,CPF,SingPass'
        }).toString()
      });
      if (!resp.ok) throw new Error('LT error ' + resp.status);
      var data = await resp.json();
      var matches = (data.matches || []).filter(function(m) {
        // Exclude style/casing/punctuation categories — those belong to Tetia
        var cat = (m.rule.category && m.rule.category.id) || '';
        return !['CASING','PUNCTUATION','TYPOGRAPHY','STYLE','COLLOCATIONS'].includes(cat);
      });
      if (!matches.length) return allClearBlock('No grammar issues detected. Reads correctly. 🍵');
      var findings = matches.slice(0, 8).map(function(m) {
        var snippet = text.slice(Math.max(0, m.offset - 20), m.offset + m.length + 20);
        var before  = m.offset > 20 ? '…' : '';
        var after   = (m.offset + m.length + 20) < text.length ? '…' : '';
        var fixes   = (m.replacements || []).slice(0, 3).map(function(r) { return '“' + escH(r.value) + '”'; }).join(' or ');
        return issueBlock(
          highlight(before + snippet + after) + ' — ' + escH(m.message),
          fixes ? 'Try: ' + fixes : m.rule.description ? escH(m.rule.description) : 'Rewrite for clarity.'
        );
      });
      return intro('grammar issue', findings.length) + findings.join('');
    } catch(e) {
      return '<div style="color:var(--sf-red);padding:10px;">⚠️ Could not reach grammar server. Check your connection.</div>';
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  var MAOMAO_IMG = document.querySelector('.maomao-fab img') ? document.querySelector('.maomao-fab img').src : '';

  var fab       = document.getElementById('maomaoFab');
  var panel     = document.getElementById('maomaoPanel');
  var closeBtn  = document.getElementById('maomaoClose');
  var messages  = document.getElementById('maomaoMessages');

  fab.addEventListener('click', function() { panel.classList.toggle('open'); });
  closeBtn.addEventListener('click', function() { panel.classList.remove('open'); });

  document.querySelectorAll('.mao-quick-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var mode = btn.dataset.mode;
      var text = ((document.getElementById('inputEditor') || {}).innerText || '').trim();
      if (!text) {
        addMsg('…No text in the input panel. Paste something first. 🍵', 'bot');
        panel.classList.add('open');
        return;
      }
      addMsg('Analyse for: ' + btn.textContent.trim(), 'user');
      panel.classList.add('open');
      if (mode === 'grammar') {
        addTypingMsg(function(removeTyping) {
          checkGrammarLT(text).then(function(result) {
            removeTyping();
            addMsg(result, 'bot');
          });
        });
      } else {
        setTimeout(function() {
          addMsg(SYNC_ANALYSERS[mode](text), 'bot');
        }, 120);
      }
    });
  });



  function addTypingMsg(callback) {
    var id = 'mao-typing-' + Date.now();
    var div = document.createElement('div');
    div.id = id;
    div.className = 'mao-msg';
    div.innerHTML = '<div class="mao-msg-avatar"><img src="' + MAOMAO_IMG + '" alt="Maomao"></div><div class="mao-bubble" style="color:#b0adab;font-style:italic;">checking…</div>';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    callback(function() { var el = document.getElementById(id); if (el) el.remove(); });
  }

  function addMsg(html, who) {
    var div = document.createElement('div');
    div.className = 'mao-msg' + (who === 'user' ? ' user' : '');
    if (who === 'bot') {
      div.innerHTML = '<div class="mao-msg-avatar"><img src="' + MAOMAO_IMG + '" alt="Maomao"></div><div class="mao-bubble">' + html + '</div>';
    } else {
      div.innerHTML = '<div class="mao-msg-user-avatar">You</div><div class="mao-bubble">' + html + '</div>';
    }
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

})();
