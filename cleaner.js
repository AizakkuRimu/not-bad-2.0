/* ============================================================
   CLEANER — strips <!-- /* Font Definitions … --> junk blocks
   ============================================================ */
(function () {

  var overlay   = document.getElementById('clOverlay');
  var closeBtn  = document.getElementById('clClose');
  var clearBtn  = document.getElementById('clClearBtn');
  var runBtn    = document.getElementById('clRunBtn');
  var copyBtn   = document.getElementById('clCopyBtn');
  var inputTa   = document.getElementById('clInput');
  var outputTa  = document.getElementById('clOutput');
  var outputWrap= document.getElementById('clOutputWrap');
  var status    = document.getElementById('clStatus');
  var openBtn   = document.getElementById('btnCleaner');

  /* ── OPEN / CLOSE ─────────────────────────────────────────── */
  openBtn.addEventListener('click', function () {
    overlay.classList.add('open');
    setTimeout(function () { inputTa.focus(); }, 100);
  });

  function closeModal() {
    overlay.classList.remove('open');
  }
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  /* ── CLEAR ────────────────────────────────────────────────── */
  clearBtn.addEventListener('click', function () {
    inputTa.value = '';
    outputTa.value = '';
    outputWrap.style.display = 'none';
    status.textContent = '';
    status.className = 'cl-status';
    inputTa.focus();
  });

  /* ── CLEAN ────────────────────────────────────────────────── */
  runBtn.addEventListener('click', function () {
    var raw = inputTa.value;

    if (!raw.trim()) {
      status.textContent = 'Nothing to clean — paste some text first.';
      status.className = 'cl-status warn';
      return;
    }

    /*
      Match every block that:
        - starts with  <!--  (optional whitespace)  followed by  /* Font Definitions
        - ends with    -->
      The [\s\S]*? is non-greedy so each block is matched independently.
      We also swallow any trailing newline so we don't leave blank lines.
    */
    var re = /<!--\s*\/\*\s*Font Definitions[\s\S]*?-->\r?\n?/gi;

    var count = 0;
    var cleaned = raw.replace(re, function () {
      count++;
      return '';
    });

    outputTa.value = cleaned;
    outputWrap.style.display = '';

    if (count === 0) {
      status.textContent = 'No Font Definitions blocks found — text is already clean.';
      status.className = 'cl-status warn';
    } else {
      status.textContent = '✓ Removed ' + count + ' block' + (count !== 1 ? 's' : '') + ' successfully.';
      status.className = 'cl-status success';
    }

    /* Scroll output into view */
    setTimeout(function () {
      outputWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  });

  /* ── COPY OUTPUT ──────────────────────────────────────────── */
  copyBtn.addEventListener('click', function () {
    if (!outputTa.value) return;
    navigator.clipboard.writeText(outputTa.value).then(function () {
      copyBtn.textContent = '✓ Copied!';
      setTimeout(function () { copyBtn.textContent = '📋 Copy'; }, 1800);
    }).catch(function () {
      /* Fallback for older browsers */
      outputTa.select();
      document.execCommand('copy');
      copyBtn.textContent = '✓ Copied!';
      setTimeout(function () { copyBtn.textContent = '📋 Copy'; }, 1800);
    });
  });

})();
