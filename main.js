/* ============================================================
   NOT BAD 2.0 — Main Application Script
   ============================================================ */

// ── STATE ──────────────────────────────────────────────────────
let groups = [];       // [{id, name, open, pairs:[{id,sources:[],target,color}]}]
let sortOrder = 'manual';
let dragState = null;

// ── COLORS ────────────────────────────────────────────────────
const DEFAULT_COLORS = [
  '#b3d9ff','#b3f0c8','#ffeab3','#ffc8b3','#dbb3ff','#b3f0f0',
  '#f0b3d9','#c8e6b3','#ffd9b3','#b3c8f0','#e6b3b3','#b3e6d9',
  '#d9b3e6','#e6d9b3','#b3b3e6','#f0d9b3','#b3d9b3','#d9d9b3',
  '#c8b3e6','#b3e6c8','#e6c8b3','#c8e6e6','#e6b3c8','#c8c8e6',
  '#d4a574','#f5d5e0','#b3c4cc','#c8d5b9','#d9c8b3','#b3b8d4'
];
let colorIdx = 0;

function nextColor() {
  const c = DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length];
  colorIdx++;
  return c;
}

// ── ID GEN ───────────────────────────────────────────────────
function uid() { return '_' + Math.random().toString(36).slice(2,9); }

// ── PERSPECTIVE DEFINITIONS ───────────────────────────────────
// Each entry: { label, pairs: [{sources, target}] }
const PERSPECTIVES = {
  he: {
    label: 'He / Him',
    pairs: [
      { sources: ['you'],              target: 'he',      color: '#b3d9ff' },
      { sources: ['your'],             target: 'his',     color: '#b3f0c8' },
      { sources: ["you're",'you are'], target: 'he is',   color: '#ffeab3' },
      { sources: ["you've",'you have'],target: 'he has',  color: '#ffc8b3' },
      { sources: ["you'd",'you would'],target: 'he would',color: '#dbb3ff' },
      { sources: ["you'll",'you will'],target: 'he will', color: '#b3f0f0' },
      { sources: ['yourself'],         target: 'himself', color: '#f0b3d9' },
    ]
  },
  she: {
    label: 'She / Her',
    pairs: [
      { sources: ['you'],              target: 'she',     color: '#f5d5e0' },
      { sources: ['your'],             target: 'her',     color: '#ffd9f5' },
      { sources: ["you're",'you are'], target: 'she is',  color: '#f0b3d9' },
      { sources: ["you've",'you have'],target: 'she has', color: '#ffc8e6' },
      { sources: ["you'd",'you would'],target: 'she would',color:'#e6b3d9' },
      { sources: ["you'll",'you will'],target: 'she will',color: '#dbb3f0' },
      { sources: ['yourself'],         target: 'herself', color: '#d9b3e6' },
    ]
  },
  they: {
    label: 'They / Them',
    pairs: [
      { sources: ['you'],              target: 'they',       color: '#c8d5b9' },
      { sources: ['your'],             target: 'their',      color: '#d9e6c8' },
      { sources: ["you're",'you are'], target: 'they are',   color: '#b3d9b3' },
      { sources: ["you've",'you have'],target: 'they have',  color: '#c8e6c8' },
      { sources: ["you'd",'you would'],target: 'they would', color: '#b3e6b3' },
      { sources: ["you'll",'you will'],target: 'they will',  color: '#c8f0c8' },
      { sources: ['yourself'],         target: 'themselves', color: '#b3e6c8' },
    ]
  }
};

// Active perspective key: 'none' | 'he' | 'she' | 'they' | 'custom'
let activePerspective = 'none';
// The ephemeral perspective group injected at runtime (not persisted in groups[])
let perspectiveGroup = null;

function makePerspectiveGroup(key, customName) {
  if (key === 'none' || !PERSPECTIVES[key] && key !== 'custom') return null;

  let def;
  if (key === 'custom' && customName) {
    const n = customName.trim();
    def = {
      pairs: [
        { sources: ['you'],               target: n,              color: '#ffe8b3' },
        { sources: ['your'],              target: `${n}'s`,       color: '#ffd9b3' },
        { sources: ["you're",'you are'],  target: `${n} is`,      color: '#ffc8b3' },
        { sources: ["you've",'you have'], target: `${n} has`,     color: '#ffb3b3' },
        { sources: ["you'd",'you would'], target: `${n} would`,   color: '#f0b3b3' },
        { sources: ["you'll",'you will'], target: `${n} will`,    color: '#e6b3b3' },
        { sources: ['yourself'],          target: `${n}self` ,    color: '#d9b3b3' },
      ]
    };
  } else {
    def = PERSPECTIVES[key];
  }

  return {
    id: '__persp__',
    name: `📌 Perspective: ${key === 'custom' ? customName : def?.label || key}`,
    open: false,
    _isPerspective: true,
    pairs: def.pairs.map(p => ({ id: uid(), ...p }))
  };
}

// ── DEFAULT USER GROUPS ────────────────────────────────────────
function makeDefaultGroups() {
  return []; // Start clean; perspective is handled via switcher
}

// ── INIT ─────────────────────────────────────────────────────
function init() {
  try {
    const saved = localStorage.getItem('nb2_groups');
    if (saved) {
      groups = JSON.parse(saved);
      colorIdx = parseInt(localStorage.getItem('nb2_colorIdx') || '0');
    } else {
      groups = makeDefaultGroups();
      colorIdx = 0;
    }
    activePerspective = localStorage.getItem('nb2_persp') || 'none';
    const customName = localStorage.getItem('nb2_persp_custom') || '';
    perspectiveGroup = makePerspectiveGroup(activePerspective, customName);
  } catch(e) {
    groups = makeDefaultGroups();
    activePerspective = 'none';
    perspectiveGroup = null;
  }
  renderDrawer();
  updatePerspUI();
  setupEvents();
}

// ── PERSIST ──────────────────────────────────────────────────
function persist() {
  localStorage.setItem('nb2_groups', JSON.stringify(groups));
  localStorage.setItem('nb2_colorIdx', String(colorIdx));
}

// ── RENDER DRAWER ─────────────────────────────────────────────
function renderDrawer() {
  const body = document.getElementById('drawerBody');
  let gs = [...groups];

  if (sortOrder === 'alpha') {
    gs.sort((a,b) => a.name.localeCompare(b.name));
  }

  body.innerHTML = '';

  // Perspective group shown read-only at top if active
  if (perspectiveGroup) {
    body.appendChild(buildGroupEl(perspectiveGroup, true));
  }

  gs.forEach(group => {
    const el = buildGroupEl(group, false);
    body.appendChild(el);
  });

  if (gs.length === 0 && !perspectiveGroup) {
    const em = document.createElement('div');
    em.className = 'text-muted text-center';
    em.style.padding = '24px 12px';
    em.innerHTML = 'No groups yet.<br>Click <strong>＋ Group</strong> to get started.';
    body.appendChild(em);
  }

  // pair count badge
  const total = groups.reduce((s,g) => s + g.pairs.length, 0)
              + (perspectiveGroup ? perspectiveGroup.pairs.length : 0);
  document.getElementById('pairCountBadge').textContent = total;
}

function buildGroupEl(group, readOnly) {
  const wrap = document.createElement('div');
  wrap.className = 'group-block';
  wrap.dataset.gid = group.id;

  if (readOnly) {
    wrap.style.borderColor = 'var(--sf-blue)';
    wrap.style.borderLeftWidth = '3px';
  }

  // header
  const hdr = document.createElement('div');
  hdr.className = 'group-header';

  if (!readOnly) {
    hdr.draggable = true;
    hdr.addEventListener('dragstart', onGroupDragStart);
    hdr.addEventListener('dragover', onGroupDragOver);
    hdr.addEventListener('drop', onGroupDrop);
    hdr.addEventListener('dragend', onGroupDragEnd);
  }

  if (readOnly) {
    hdr.innerHTML = `
      <span style="font-size:14px; flex-shrink:0;">🔒</span>
      <span class="group-title-input" style="flex:1; font-size:12px; font-weight:700; color:var(--sf-blue-dark);">${escHtml(group.name)}</span>
      <span class="group-toggle ${group.open ? 'open' : ''}" data-action="toggle" style="color:var(--sf-blue);">▶</span>
    `;
  } else {
    hdr.innerHTML = `
      <span class="group-drag-handle" title="Drag to reorder">⠿</span>
      <input class="group-title-input" value="${escHtml(group.name)}" placeholder="Group name…">
      <button class="sf-btn sf-btn-neutral sf-btn-xs" style="flex-shrink:0;" data-action="addpair">+ Pair</button>
      <button class="sf-btn sf-btn-icon sf-btn-xs" data-action="delgroup" title="Delete group" style="color:var(--sf-red); border-color:var(--sf-red);">✕</button>
      <span class="group-toggle ${group.open ? 'open' : ''}" data-action="toggle">▶</span>
    `;

    const nameInput = hdr.querySelector('.group-title-input');
    nameInput.addEventListener('input', () => { group.name = nameInput.value; persist(); });
    nameInput.addEventListener('mousedown', e => e.stopPropagation());

    hdr.querySelector('[data-action="addpair"]').addEventListener('click', e => {
      e.stopPropagation();
      addPair(group);
    });
    hdr.querySelector('[data-action="delgroup"]').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete group "${group.name}"?`)) {
        groups = groups.filter(g => g.id !== group.id);
        persist();
        renderDrawer();
        runProcess();
      }
    });
  }

  hdr.querySelector('[data-action="toggle"]').addEventListener('click', e => {
    e.stopPropagation();
    group.open = !group.open;
    if (!readOnly) persist();
    renderDrawer();
  });

  wrap.appendChild(hdr);

  // body
  const body = document.createElement('div');
  body.className = 'group-body' + (group.open ? '' : ' hidden');

  group.pairs.forEach(pair => {
    body.appendChild(buildPairEl(group, pair, readOnly));
  });

  if (group.pairs.length === 0 && !readOnly) {
    const em = document.createElement('div');
    em.className = 'text-muted text-center';
    em.style.padding = '8px 0';
    em.textContent = 'No pairs yet. Click + Pair to add.';
    body.appendChild(em);
  }

  wrap.appendChild(body);
  return wrap;
}

function buildPairEl(group, pair, readOnly) {
  const row = document.createElement('div');
  row.className = 'pair-row';
  row.dataset.pid = pair.id;

  // color swatch
  const swatch = document.createElement('div');
  swatch.className = 'pair-color-swatch';
  swatch.style.background = pair.color;
  swatch.title = readOnly ? 'Perspective color' : 'Click to change highlight color';

  if (!readOnly) {
    const colorPopup = document.createElement('div');
    colorPopup.className = 'color-picker-popup hidden';

    DEFAULT_COLORS.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'color-chip' + (pair.color === c ? ' selected' : '');
      chip.style.background = c;
      chip.title = c;
      chip.addEventListener('click', e => {
        e.stopPropagation();
        pair.color = c;
        swatch.style.background = c;
        colorPopup.querySelectorAll('.color-chip').forEach(ch => ch.classList.toggle('selected', ch.style.background === c));
        persist();
        runProcess();
        colorPopup.classList.add('hidden');
      });
      colorPopup.appendChild(chip);
    });

    swatch.appendChild(colorPopup);
    swatch.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.color-picker-popup').forEach(p => { if (p !== colorPopup) p.classList.add('hidden'); });
      colorPopup.classList.toggle('hidden');
    });
  }

  row.appendChild(swatch);

  // inputs
  const inputs = document.createElement('div');
  inputs.className = 'pair-inputs';

  // source words
  const srcLabel = document.createElement('span');
  srcLabel.className = 'pair-label';
  srcLabel.textContent = 'Replace:';
  inputs.appendChild(srcLabel);

  const srcWrap = document.createElement('div');
  srcWrap.className = 'pair-sources';

  if (readOnly) {
    // Show source tags without delete buttons, no add input
    pair.sources.forEach(src => {
      const tag = document.createElement('span');
      tag.className = 'source-tag';
      tag.style.opacity = '0.8';
      tag.textContent = src;
      srcWrap.appendChild(tag);
    });
  } else {
    function renderSources() {
      srcWrap.innerHTML = '';
      pair.sources.forEach((src, i) => {
        const tag = document.createElement('span');
        tag.className = 'source-tag';
        tag.innerHTML = `${escHtml(src)}<span class="source-tag-x" data-i="${i}">✕</span>`;
        tag.querySelector('.source-tag-x').addEventListener('click', e => {
          e.stopPropagation();
          pair.sources.splice(i, 1);
          persist();
          renderSources();
          runProcess();
        });
        srcWrap.appendChild(tag);
      });

      // add source mini input
      const addRow = document.createElement('div');
      addRow.className = 'add-source-row';
      const addInput = document.createElement('input');
      addInput.className = 'add-source-input';
      addInput.placeholder = '+ add word';
      addInput.title = 'Press Enter to add this word as a source';
      addInput.addEventListener('mousedown', e => e.stopPropagation());
      addInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && addInput.value.trim()) {
          e.preventDefault();
          const v = addInput.value.trim();
          if (!pair.sources.includes(v)) pair.sources.push(v);
          addInput.value = '';
          persist();
          renderSources();
          runProcess();
        }
      });
      addRow.appendChild(addInput);
      srcWrap.appendChild(addRow);
    }
    renderSources();
  }

  inputs.appendChild(srcWrap);

  // target
  const tgtLabel = document.createElement('span');
  tgtLabel.className = 'pair-label';
  tgtLabel.style.marginTop = '4px';
  tgtLabel.textContent = 'With:';
  inputs.appendChild(tgtLabel);

  if (readOnly) {
    const tgtSpan = document.createElement('span');
    tgtSpan.style.cssText = 'font-size:12px; font-weight:700; color:var(--sf-gray-7); padding:3px 0;';
    tgtSpan.textContent = pair.target || '—';
    inputs.appendChild(tgtSpan);
  } else {
    const tgtInput = document.createElement('input');
    tgtInput.className = 'pair-field';
    tgtInput.value = pair.target || '';
    tgtInput.placeholder = 'replacement word…';
    tgtInput.addEventListener('mousedown', e => e.stopPropagation());
    tgtInput.addEventListener('input', () => { pair.target = tgtInput.value; persist(); runProcess(); });
    inputs.appendChild(tgtInput);
  }

  row.appendChild(inputs);

  // delete button (only for editable pairs)
  if (!readOnly) {
    const del = document.createElement('span');
    del.className = 'pair-delete';
    del.title = 'Delete pair';
    del.textContent = '✕';
    del.addEventListener('click', e => {
      e.stopPropagation();
      group.pairs = group.pairs.filter(p => p.id !== pair.id);
      persist();
      renderDrawer();
      runProcess();
    });
    row.appendChild(del);
  }

  return row;
}

// ── GROUP DRAG ────────────────────────────────────────────────
function onGroupDragStart(e) {
  const wrap = e.currentTarget.closest('.group-block');
  dragState = { id: wrap.dataset.gid };
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => wrap.classList.add('dragging-group'), 0);
}
function onGroupDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.group-block').forEach(el => el.classList.remove('drag-over-group'));
  const wrap = e.currentTarget.closest('.group-block');
  if (wrap && dragState && wrap.dataset.gid !== dragState.id) {
    wrap.classList.add('drag-over-group');
  }
}
function onGroupDrop(e) {
  e.preventDefault();
  const wrap = e.currentTarget.closest('.group-block');
  if (!wrap || !dragState) return;
  const toId = wrap.dataset.gid;
  if (toId === dragState.id) return;

  const fromIdx = groups.findIndex(g => g.id === dragState.id);
  const toIdx = groups.findIndex(g => g.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;

  const [item] = groups.splice(fromIdx, 1);
  groups.splice(toIdx, 0, item);
  persist();
  renderDrawer();
  runProcess();
}
function onGroupDragEnd() {
  document.querySelectorAll('.group-block').forEach(el => {
    el.classList.remove('dragging-group', 'drag-over-group');
  });
  dragState = null;
}

// ── ADD GROUP / PAIR ──────────────────────────────────────────
function addGroup() {
  const g = { id: uid(), name: 'New Group', open: true, pairs: [] };
  groups.push(g);
  persist();
  renderDrawer();
}

function addPair(group) {
  const pair = { id: uid(), sources: [], target: '', color: nextColor() };
  group.pairs.push(pair);
  group.open = true;
  persist();
  renderDrawer();
}

// ── PROCESS / REPLACE ────────────────────────────────────────
function runProcess() {
  const input = document.getElementById('inputEditor');
  const output = document.getElementById('outputDisplay');

  updateWordCount(input.innerText, 'inputWordCount');

  if (!input.innerHTML.trim()) {
    output.innerHTML = '';
    updateWordCount('', 'outputWordCount');
    return;
  }

  // 1. Clone the input DOM
  const clone = input.cloneNode(true);

  // 2. Apply highlights on input editor
  applyHighlights(input, false);

  // 3. Build processed output with highlights
  const outClone = input.cloneNode(true);
  applyReplacements(outClone);
  applyHighlights(outClone, true);
  output.innerHTML = outClone.innerHTML;

  updateWordCount(output.innerText, 'outputWordCount');
}

// Walk text nodes in an element
function walkTextNodes(el, cb) {
  const iter = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let node;
  while (node = iter.nextNode()) nodes.push(node);
  nodes.forEach(cb);
}

// Apply word replacements (text substitution)
function applyReplacements(el) {
  // Build replacement map sorted by source length desc (to match longer phrases first)
  const repMap = [];
  const allGroups = perspectiveGroup ? [perspectiveGroup, ...groups] : groups;
  allGroups.forEach(g => {
    g.pairs.forEach(p => {
      if (p.target) {
        p.sources.forEach(src => {
          if (src.trim()) repMap.push({ from: src.trim(), to: p.target });
        });
      }
    });
  });
  repMap.sort((a,b) => b.from.length - a.from.length);

  if (!repMap.length) return;

  walkTextNodes(el, node => {
    let text = node.textContent;
    repMap.forEach(({ from, to }) => {
      const escaped = escapeRegex(from);
      const re = new RegExp('(^|[^\\w])(' + escaped + ')(?![\\w])', 'gi');
      text = text.replace(re, function(full, pre, match) {
        var rep;
        if (match === match.toUpperCase() && match.length > 1) rep = to.toUpperCase();
        else if (match[0] === match[0].toUpperCase()) rep = to[0].toUpperCase() + to.slice(1);
        else rep = to;
        return pre + rep;
      });
    });
    node.textContent = text;
  });
}

// Apply highlights (wrap matched words with <mark>)
function applyHighlights(el, isOutput) {
  // First clear existing marks
  el.querySelectorAll('mark.word-highlight').forEach(m => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });

  // All active groups including perspective
  const allGroups = perspectiveGroup ? [perspectiveGroup, ...groups] : groups;

  allGroups.forEach(g => {
    g.pairs.forEach(p => {
      const words = isOutput ? (p.target ? [p.target] : []) : p.sources;
      words.forEach(word => {
        if (!word.trim()) return;
        highlightWord(el, word.trim(), p.color);
      });
    });
  });
}

function highlightWord(el, word, color) {
  const escaped = escapeRegex(word);
  const re = new RegExp('(^|[^\\w])(' + escaped + ')(?![\\w])', 'gi');

  walkTextNodes(el, node => {
    if (!node.textContent.match(re)) return;
    // Only highlight if not inside a <mark> already
    if (node.parentElement && node.parentElement.tagName === 'MARK') return;

    const span = document.createElement('span');
    span.innerHTML = node.textContent.replace(re, function(full, pre, m) {
      return pre + '<mark class="word-highlight" style="background:' + color + ';">' + escHtml(m) + '</mark>';
    });
    const parent = node.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, node);
    parent.removeChild(node);
  });
}

// ── COPY OUTPUT CLEAN ─────────────────────────────────────────
function copyOutputClean() {
  const output = document.getElementById('outputDisplay');
  if (!output.innerHTML.trim()) { showToast('No output to copy.', 'error'); return; }

  // Build a clean HTML version: only <a> tags and list tags survive, everything else is unwrapped to plain text
  const clone = output.cloneNode(true);

  // Unwrap all marks/highlights/spans — keep their text content
  // Process deepest elements first (reverse document order) to avoid re-visiting
  const unwrapTargets = Array.from(clone.querySelectorAll('mark, span, b, strong, em, i, u, div, p, br'));
  unwrapTargets.reverse().forEach(el => {
    if (el.tagName === 'BR') {
      el.replaceWith('\n');
    } else {
      // Preserve block elements as newlines
      const isBlock = ['DIV','P'].includes(el.tagName);
      const frag = document.createDocumentFragment();
      if (isBlock && el.previousSibling) frag.appendChild(document.createTextNode('\n'));
      while (el.firstChild) frag.appendChild(el.firstChild);
      el.replaceWith(frag);
    }
  });

  // Now clone only has text nodes, <a> tags, and list tags (ul/ol/li)
  // Build clean HTML: text escaped, <a> and list tags kept
  function buildCleanHTML(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      const text = node.innerText || node.textContent;
      return `<a href="${href.replace(/"/g,'&quot;')}">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</a>`;
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'UL' || node.tagName === 'OL')) {
      const tag = node.tagName.toLowerCase();
      const inner = Array.from(node.childNodes).map(buildCleanHTML).join('');
      return `<${tag}>${inner}</${tag}>`;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'LI') {
      const inner = Array.from(node.childNodes).map(buildCleanHTML).join('');
      return `<li>${inner}</li>`;
    }
    // Any other element — just get its text
    if (node.nodeType === Node.ELEMENT_NODE) {
      return Array.from(node.childNodes).map(buildCleanHTML).join('');
    }
    return '';
  }

  const cleanHTML = Array.from(clone.childNodes).map(buildCleanHTML).join('').trim();
  // Derive plain text from cleanHTML so line breaks are always preserved
  const cleanText = cleanHTML
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/ul>|<\/ol>/gi, '\n')
    .replace(/<ul>|<ol>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  try {
    const htmlBlob = new Blob([cleanHTML], { type: 'text/html' });
    const textBlob = new Blob([cleanText], { type: 'text/plain' });
    const item = new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob });
    navigator.clipboard.write([item]).then(() => {
      showToast('✅ Output copied with hyperlinks!', 'success');
    }).catch(() => {
      navigator.clipboard.writeText(cleanText).then(() => {
        showToast('📋 Output copied (plain text).');
      });
    });
  } catch(e) {
    navigator.clipboard.writeText(cleanText).then(() => {
      showToast('📋 Output copied (plain text).');
    });
  }
}

// ── WORD COUNTS ──────────────────────────────────────────────
function updateWordCount(text, elId) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById(elId).textContent = `${words} word${words !== 1 ? 's' : ''}`;
}

// ── SAVE / LOAD ──────────────────────────────────────────────
function exportConfig() {
  const cfg = JSON.stringify({ groups, colorIdx }, null, 2);
  document.getElementById('saveLoadTextarea').value = cfg;
  navigator.clipboard.writeText(cfg).then(() => {
    showToast('✅ Config copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Config ready — copy the text above.');
  });
}

function importConfig() {
  const text = document.getElementById('saveLoadTextarea').value.trim();
  if (!text) { showToast('Paste a saved config first.', 'error'); return; }
  try {
    const cfg = JSON.parse(text);
    if (!Array.isArray(cfg.groups)) throw new Error('Invalid format');
    groups = cfg.groups;
    colorIdx = cfg.colorIdx || 0;
    persist();
    renderDrawer();
    runProcess();
    closeModal('saveLoadModal');
    showToast('✅ Config loaded!', 'success');
  } catch(e) {
    showToast('❌ Invalid configuration text.', 'error');
  }
}

// ── PRESETS ──────────────────────────────────────────────────
function getPresets() {
  try { return JSON.parse(localStorage.getItem('nb2_presets') || '[]'); }
  catch(e) { return []; }
}

function savePresets(arr) {
  localStorage.setItem('nb2_presets', JSON.stringify(arr));
}

function renderPresetList() {
  const list = document.getElementById('presetList');
  const presets = getPresets();
  list.innerHTML = '';

  if (presets.length === 0) {
    list.innerHTML = '<div class="text-muted text-center" style="padding:20px 0;">No presets saved yet.</div>';
    return;
  }

  presets.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'preset-item';
    const pairCount = p.groups.reduce((s,g) => s + g.pairs.length, 0);
    item.innerHTML = `
      <div style="flex:1;">
        <div class="preset-item-name">${escHtml(p.name)}</div>
        <div class="preset-item-meta">${p.groups.length} group${p.groups.length!==1?'s':''}, ${pairCount} pair${pairCount!==1?'s':''}</div>
      </div>
      <button class="sf-btn sf-btn-primary sf-btn-sm" data-load="${i}">Load</button>
      <button class="sf-btn sf-btn-neutral sf-btn-sm" data-del="${i}" style="color:var(--sf-red); border-color:var(--sf-red);">✕</button>
    `;
    item.querySelector('[data-load]').addEventListener('click', e => {
      e.stopPropagation();
      groups = JSON.parse(JSON.stringify(p.groups));
      colorIdx = p.colorIdx || 0;
      persist();
      renderDrawer();
      runProcess();
      closeModal('presetsModal');
      showToast(`✅ Preset "${p.name}" loaded!`, 'success');
    });
    item.querySelector('[data-del]').addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`Delete preset "${p.name}"?`)) return;
      const arr = getPresets();
      arr.splice(i, 1);
      savePresets(arr);
      renderPresetList();
    });
    list.appendChild(item);
  });
}

function saveCurrentAsPreset() {
  const name = document.getElementById('presetNameInput').value.trim();
  if (!name) { showToast('Enter a preset name.', 'error'); return; }
  const presets = getPresets();
  presets.unshift({ name, groups: JSON.parse(JSON.stringify(groups)), colorIdx });
  savePresets(presets);
  document.getElementById('presetNameInput').value = '';
  renderPresetList();
  showToast(`✅ Preset "${name}" saved!`, 'success');
}

// ── MODALS ────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }, 2400);
}

// ── UTILITY ───────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── PERSPECTIVE UI ────────────────────────────────────────────
function updatePerspUI() {
  const pills = document.querySelectorAll('.persp-pill');
  pills.forEach(pill => {
    pill.classList.toggle('active', pill.dataset.persp === activePerspective);
  });

  const label = document.getElementById('perspActiveLabel');
  if (activePerspective === 'none') {
    label.textContent = '';
  } else if (activePerspective === 'custom') {
    const name = localStorage.getItem('nb2_persp_custom') || '';
    label.textContent = name ? `Active: ${name}` : 'Active: Custom';
  } else {
    label.textContent = `Active: ${PERSPECTIVES[activePerspective]?.label || activePerspective}`;
  }

  const customRow = document.getElementById('perspCustomRow');
  customRow.style.display = activePerspective === 'name' ? 'flex' : 'none';
}

function setPerspective(key, customName) {
  activePerspective = key === 'name' ? 'name' : key; // 'name' means show custom row
  if (key !== 'name') {
    perspectiveGroup = makePerspectiveGroup(key, customName);
    localStorage.setItem('nb2_persp', key);
    if (customName) localStorage.setItem('nb2_persp_custom', customName);
  }
  updatePerspUI();
  renderDrawer();
  runProcess();
}

// ── EVENTS ────────────────────────────────────────────────────
function setupEvents() {
  // Perspective pills
  document.getElementById('perspPills').addEventListener('click', e => {
    const pill = e.target.closest('.persp-pill');
    if (!pill) return;
    const key = pill.dataset.persp;
    if (key === 'name') {
      // just show the custom row, don't switch yet
      activePerspective = 'name';
      updatePerspUI();
      return;
    }
    setPerspective(key);
  });

  document.getElementById('btnApplyCustomPersp').addEventListener('click', () => {
    const name = document.getElementById('perspCustomName').value.trim();
    if (!name) { showToast('Enter a name first.', 'error'); return; }
    localStorage.setItem('nb2_persp_custom', name);
    activePerspective = 'custom';
    perspectiveGroup = makePerspectiveGroup('custom', name);
    localStorage.setItem('nb2_persp', 'custom');
    updatePerspUI();
    renderDrawer();
    runProcess();
    showToast(`✅ Perspective set to: ${name}`, 'success');
  });

  // Drawer toggle
  const drawer = document.getElementById('sfDrawer');
  const toggle = document.getElementById('drawerToggle');
  toggle.addEventListener('click', () => {
    const collapsed = drawer.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▶' : '◀';
  });

  document.getElementById('btnAddGroup').addEventListener('click', addGroup);

  document.getElementById('sortOrder').addEventListener('change', e => {
    sortOrder = e.target.value;
    renderDrawer();
  });

  document.getElementById('btnGrammarCheck').addEventListener('click', checkGrammar);
  document.getElementById('btnGrammarClose').addEventListener('click', () => {
    document.getElementById('grammarPanel').classList.add('hidden');
    grammarMatches = [];
  });

  document.getElementById('btnProcess').addEventListener('click', runProcess);
  document.getElementById('btnCopyOutput').addEventListener('click', copyOutputClean);

  document.getElementById('btnClearInput').addEventListener('click', () => {
    document.getElementById('inputEditor').innerHTML = '';
    updateWordCount('', 'inputWordCount');
  });
  document.getElementById('btnClearOutput').addEventListener('click', () => {
    document.getElementById('outputDisplay').innerHTML = '';
    updateWordCount('', 'outputWordCount');
  });
  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (!confirm('Clear all text?')) return;
    document.getElementById('inputEditor').innerHTML = '';
    document.getElementById('outputDisplay').innerHTML = '';
    updateWordCount('', 'inputWordCount');
    updateWordCount('', 'outputWordCount');
  });

  // Auto-process on input
  document.getElementById('inputEditor').addEventListener('input', debounce(runProcess, 400));

  // Intercept paste in input to preserve links but sanitize
  document.getElementById('inputEditor').addEventListener('paste', e => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');

    if (html) {
      const sanitized = sanitizePaste(html);
      window._dbgPasteRaw  = html;
      window._dbgPasteSan  = sanitized;
      window._dbgPasteTxt  = text;
      document.execCommand('insertHTML', false, sanitized);
    } else {
      window._dbgPasteRaw  = null;
      window._dbgPasteSan  = null;
      window._dbgPasteTxt  = text;
      document.execCommand('insertText', false, text);
    }
    setTimeout(runProcess, 100);
  });

  // Ctrl+Shift+D → paste debugger modal
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      openPasteDebugger();
    }
  });

  // Presets
  document.getElementById('btnPresets').addEventListener('click', () => {
    renderPresetList();
    openModal('presetsModal');
  });
  document.getElementById('presetsClose').addEventListener('click', () => closeModal('presetsModal'));
  document.getElementById('presetsCancel').addEventListener('click', () => closeModal('presetsModal'));
  document.getElementById('btnSavePreset').addEventListener('click', saveCurrentAsPreset);

  // Save/Load
  document.getElementById('btnSaveLoad').addEventListener('click', () => {
    document.getElementById('saveLoadTextarea').value = '';
    openModal('saveLoadModal');
  });
  document.getElementById('saveLoadClose').addEventListener('click', () => closeModal('saveLoadModal'));
  document.getElementById('saveLoadCancel').addEventListener('click', () => closeModal('saveLoadModal'));
  document.getElementById('btnExportConfig').addEventListener('click', exportConfig);
  document.getElementById('btnImportConfig').addEventListener('click', importConfig);

  // Close popups on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.pair-color-swatch')) {
      document.querySelectorAll('.color-picker-popup').forEach(p => p.classList.add('hidden'));
    }
    // Close modals
    if (e.target.classList.contains('sf-modal-overlay')) {
      document.querySelectorAll('.sf-modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
  });

  // Prevent text selection during drag
  document.getElementById('drawerBody').addEventListener('mousedown', e => {
    if (e.target.closest('.group-drag-handle') || e.target.closest('.group-header')) {
      // Only prevent default on the handle, not inputs
      if (!e.target.closest('input') && !e.target.closest('button') && !e.target.closest('.pair-color-swatch')) {
        e.preventDefault();
      }
    }
  });
}

// ── SANITIZE PASTE ────────────────────────────────────────────
// Strategy: walk the HTML tree and emit a flat token stream of
// {text}, {br}, and {a} items. Line breaks are emitted only at
// true paragraph/row boundaries — NOT at every block-level tag.
// Table cells are space-joined within a row; rows become lines.
// This matches what Word itself does when you paste into Wordpad.
function sanitizePaste(rawHtml) {
  const tmp = document.createElement('div');
  tmp.innerHTML = rawHtml;

  // Tags whose entire subtree should be silently dropped
  const REMOVE_TAGS = new Set([
    'script','style','head','meta','link','xml',
    'o:p',                                   // Word empty-paragraph markers
    'w:sdt','w:sdtpr','w:sdtcontent',        // Word content controls
  ]);

  // Tags that mark a paragraph / hard line break AFTER their content
  const PARA_TAGS = new Set([
    'p','h1','h2','h3','h4','h5','h6',
    'blockquote',
    'section','article','header','footer','main','nav','aside',
    'figure','figcaption','dd','dt',
    'div',  // Word wraps paragraphs in divs when no <p> is present
  ]);

  // Normalise a raw text-node string to clean plain text
  function cleanStr(s) {
    return s
      .replace(/\xa0/g, ' ')       // non-breaking space → space
      .replace(/[\t\r\n]/g, ' ')   // tabs / CR / newlines → space
      .replace(/ {2,}/g, ' ');     // collapse runs of spaces
  }

  // ── Token emitters ──────────────────────────────────────────
  // out is an array of {type:'text'|'br'|'space'|'a', ...}
  // 'space' is a soft cell-separator (becomes ' ' unless at line edge)

  function extractTable(tableNode, out) {
    // Each <tr> → one line; cells within a row → space-separated
    for (const child of tableNode.childNodes) {
      const tag = child.tagName && child.tagName.toLowerCase();
      if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
        extractTable(child, out);
      } else if (tag === 'tr') {
        extractRow(child, out);
      }
    }
  }

  function extractRow(trNode, out) {
    const rowParts = [];
    let firstCell = true;
    for (const child of trNode.childNodes) {
      const tag = child.tagName && child.tagName.toLowerCase();
      if (tag === 'td' || tag === 'th') {
        const cellOut = [];
        extractChildren(child, cellOut);
        const cellText = tokenStreamToText(cellOut).trim();
        if (cellText) {
          if (!firstCell) rowParts.push({ type: 'text', value: ' ' }); // cell separator
          rowParts.push({ type: 'text', value: cellText });
          firstCell = false;
        }
      }
    }
    if (rowParts.length) {
      rowParts.forEach(t => out.push(t));
      out.push({ type: 'br' });
    }
  }

  function extract(node, out) {
    // Text node
    if (node.nodeType === Node.TEXT_NODE) {
      const t = cleanStr(node.textContent);
      if (t) out.push({ type: 'text', value: t });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();

    if (REMOVE_TAGS.has(tag)) return;

    if (tag === 'br') {
      out.push({ type: 'br' });
      return;
    }

    if (tag === 'a') {
      let href = (node.getAttribute('href') || '').trim();
      if (href.startsWith('#')) href = ''; // Word bookmark anchor — drop
      const linkText = cleanStr(node.textContent).trim();
      if (href && linkText) {
        out.push({ type: 'a', href, text: linkText });
      } else {
        extractChildren(node, out);
      }
      return;
    }

    // Table — special handling so cells join on one line per row
    if (tag === 'table') {
      extractTable(node, out);
      return;
    }

    // Skip structural table wrappers that aren't rows (handled inside extractTable)
    if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      extractTable(node, out);
      return;
    }

    // Lists — preserve as ul/ol/li tokens
    if (tag === 'ul' || tag === 'ol') {
      out.push({ type: 'list-open', listTag: tag });
      extractChildren(node, out);
      out.push({ type: 'list-close', listTag: tag });
      return;
    }

    if (tag === 'li') {
      out.push({ type: 'li-open' });
      extractChildren(node, out);
      out.push({ type: 'li-close' });
      return;
    }

    // Paragraph-level block: recurse, then emit two line breaks after content
    if (PARA_TAGS.has(tag)) {
      const before = out.length;
      extractChildren(node, out);
      if (out.length > before) {
        out.push({ type: 'br' });
        out.push({ type: 'br' });
      }
      return;
    }

    // Everything else (span, b, strong, em, u, font, etc.) — just recurse
    extractChildren(node, out);
  }

  function extractChildren(node, out) {
    for (const child of node.childNodes) extract(child, out);
  }

  // ── Convert a sub-stream to plain text (used for cell content) ──
  function tokenStreamToText(tokens) {
    return tokens.map(t => {
      if (t.type === 'text') return t.value;
      if (t.type === 'a')    return t.text;
      if (t.type === 'br')   return '\n';
      if (t.type === 'li-open')  return '• ';
      if (t.type === 'li-close') return '\n';
      return '';
    }).join('');
  }

  // ── Build token stream ───────────────────────────────────────
  const parts = [];
  extractChildren(tmp, parts);

  // ── Merge adjacent text tokens ───────────────────────────────
  const merged = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (p.type === 'text' && last && last.type === 'text') {
      last.value += p.value;
    } else {
      merged.push({ ...p });
    }
  }

  // ── After merging, do a final space-collapse pass ────────────
  // (merging may have joined two half-spaces into double-space)
  for (const p of merged) {
    if (p.type === 'text') p.value = p.value.replace(/ {2,}/g, ' ');
  }

  // ── Trim spaces adjacent to <br> ────────────────────────────
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].type !== 'text') continue;
    if (merged[i + 1] && merged[i + 1].type === 'br') {
      merged[i].value = merged[i].value.trimEnd();
    }
    if (i === 0 || (merged[i - 1] && merged[i - 1].type === 'br')) {
      merged[i].value = merged[i].value.trimStart();
    }
  }

  // ── Remove empty text tokens ─────────────────────────────────
  const cleaned = merged.filter(p => p.type !== 'text' || p.value !== '');

  // ── Collapse runs of <br> to at most 2 (one blank line) ──────
  const collapsed = [];
  let brRun = 0;
  for (const p of cleaned) {
    if (p.type === 'br') {
      brRun++;
      if (brRun <= 2) collapsed.push(p);
    } else {
      brRun = 0;
      collapsed.push(p);
    }
  }

  // ── Strip leading / trailing <br> ───────────────────────────
  while (collapsed.length && collapsed[0].type === 'br')                collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1].type === 'br') collapsed.pop();

  // ── Render to safe HTML ──────────────────────────────────────
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  let result = '';
  for (const p of collapsed) {
    if      (p.type === 'text')       result += escHtml(p.value);
    else if (p.type === 'br')         result += '<br>';
    else if (p.type === 'a')          result += `<a href="${escHtml(p.href)}">${escHtml(p.text)}</a>`;
    else if (p.type === 'list-open')  result += `<${p.listTag}>`;
    else if (p.type === 'list-close') result += `</${p.listTag}>`;
    else if (p.type === 'li-open')    result += '<li>';
    else if (p.type === 'li-close')   result += '</li>';
  }

  return result;
}

// ── DEBOUNCE ─────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── PLACEHOLDER ───────────────────────────────────────────────
(function() {
  const ed = document.getElementById('inputEditor');
  function updatePlaceholder() {
    if (!ed.innerText.trim()) {
      ed.dataset.empty = 'true';
    } else {
      delete ed.dataset.empty;
    }
  }
  ed.addEventListener('input', updatePlaceholder);
  updatePlaceholder();
})();

// ── PLACEHOLDER CSS ───────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  #inputEditor[data-empty="true"]::before {
    content: attr(data-placeholder);
    color: #b0adab;
    pointer-events: none;
    position: absolute;
    top: 14px; left: 16px;
    font-size: 13px;
    user-select: none;
  }
  #inputEditor { position: relative; }
`;
document.head.appendChild(style);

// ── GRAMMAR CHECK (LanguageTool) ──────────────────────────────
let grammarMatches = [];

async function checkGrammar() {
  const btn = document.getElementById('btnGrammarCheck');
  const panel = document.getElementById('grammarPanel');
  const results = document.getElementById('grammarResults');
  const status = document.getElementById('grammarStatus');

  const text = document.getElementById('inputEditor').innerText.trim();
  if (!text) { showToast('Paste some text into the input first.', 'error'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Checking…';
  panel.classList.remove('hidden');
  results.innerHTML = '<div class="text-muted text-center" style="padding:14px;">Checking with LanguageTool…</div>';
  status.textContent = '';

  try {
    const body = new URLSearchParams({ text, language: 'en-US', disabledCategories: 'CASING,PUNCTUATION,TYPOGRAPHY,STYLE,COLLOCATIONS', ignoredWords: 'YSOA,MediSave,Singpass,CPF,SingPass' });
    const resp = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!resp.ok) throw new Error(`LanguageTool returned ${resp.status}`);
    const data = await resp.json();
    grammarMatches = data.matches || [];
    renderGrammarResults(text);
  } catch(err) {
    results.innerHTML = `<div class="text-muted text-center" style="padding:14px; color:var(--sf-red);">⚠️ Could not reach LanguageTool. Check your connection and try again.</div>`;
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Grammar Check';
  }
}

function renderGrammarResults(text) {
  const results = document.getElementById('grammarResults');
  const status = document.getElementById('grammarStatus');

  if (!grammarMatches.length) {
    results.innerHTML = '<div class="grammar-empty">✅ No issues found — looks good!</div>';
    status.textContent = '';
    return;
  }

  status.textContent = `(${grammarMatches.length} issue${grammarMatches.length !== 1 ? 's' : ''})`;
  results.innerHTML = '';

  grammarMatches.forEach((match, idx) => {
    const issueType = match.rule.issueType || 'grammar';
    const typeClass = issueType === 'misspelling' ? 'spelling'
                    : issueType === 'style'        ? 'style'
                    : 'grammar';
    const icon = typeClass === 'spelling' ? '🔴' : typeClass === 'style' ? '🔵' : '🟡';

    // context snippet
    const start = Math.max(0, match.offset - 20);
    const end = Math.min(text.length, match.offset + match.length + 20);
    const snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    const highlighted = escHtml(snippet).replace(
      escHtml(text.slice(match.offset, match.offset + match.length)),
      `<strong style="color:var(--sf-red);">${escHtml(text.slice(match.offset, match.offset + match.length))}</strong>`
    );

    const suggestions = (match.replacements || []).slice(0, 4);

    const el = document.createElement('div');
    el.className = `grammar-issue ${typeClass}`;
    el.innerHTML = `
      <span class="grammar-issue-icon">${icon}</span>
      <div class="grammar-issue-body">
        <div class="grammar-issue-msg">${escHtml(match.message)}</div>
        <div class="grammar-issue-context">${highlighted}</div>
        ${suggestions.length ? `<div class="grammar-suggestions">
          ${suggestions.map(s => `<button class="grammar-fix-btn" data-idx="${idx}" data-fix="${escHtml(s.value)}">→ ${escHtml(s.value)}</button>`).join('')}
        </div>` : ''}
      </div>
    `;
    results.appendChild(el);
  });

  // Fix button handler
  results.addEventListener('click', e => {
    const btn = e.target.closest('.grammar-fix-btn');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    const fix = btn.dataset.fix;
    const match = grammarMatches[idx];
    if (!match) return;
    applyGrammarFix(match, fix);
  });
}

function applyGrammarFix(match, replacement) {
  const editor = document.getElementById('inputEditor');
  // Walk text nodes to find and replace the exact character range
  let charCount = 0;
  let done = false;

  function walk(node) {
    if (done) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent.length;
      const start = match.offset;
      const end = match.offset + match.length;

      if (charCount + len >= start && charCount <= end) {
        const localStart = start - charCount;
        const localEnd = end - charCount;
        if (localStart >= 0 && localEnd <= len) {
          const before = node.textContent.slice(0, localStart);
          const after = node.textContent.slice(localEnd);
          node.textContent = before + replacement + after;
          done = true;
        }
      }
      charCount += len;
    } else {
      node.childNodes.forEach(walk);
    }
  }

  walk(editor);
  setTimeout(runProcess, 50);
  // Re-check after short delay
  setTimeout(() => {
    grammarMatches = grammarMatches.filter(m => m !== match);
    const text = editor.innerText.trim();
    renderGrammarResults(text);
  }, 100);
  showToast(`Fixed: "${replacement}"`, 'success');
}

// ── START ─────────────────────────────────────────────────────
init();



// ── TETIA GRAMMAR BOT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
(function() {
  const fab   = document.getElementById('tetiaFab');
  const panel = document.getElementById('tetiaPanel');
  const body  = document.getElementById('tetiaBody');
  const checkBtn = document.getElementById('tetiaCheckBtn');
  const closeBtn = document.getElementById('tetiaClose');

  fab.addEventListener('click', () => panel.classList.toggle('open'));
  closeBtn.addEventListener('click', () => panel.classList.remove('open'));

  checkBtn.addEventListener('click', runTetiaCheck);

  // ── Browser spellcheck via hidden textarea ────────────────────────────
  // Browsers don't expose spellcheck results via JS directly, so we use a
  // hidden contenteditable div with spellcheck=true, inject the text, then
  // read back which words the browser flagged using getClientRects on a Range
  // — actually unreliable. Instead we use the most reliable cross-browser
  // method: a hidden <textarea> + the natively supported spell-checking on
  // input elements, queried via execCommand spell suggestions.
  //
  // Since no browser JS API actually exposes spell-check hits, we implement
  // our OWN word validator using the browser's built-in spellcheck on a
  // hidden <input> field: we set the value, trigger a context menu event to
  // force the browser to evaluate spellcheck, then read back via Selection.
  //
  // Fallback (most compatible): use a scratchpad <textarea spellcheck=true>,
  // select each word, and check document.queryCommandState('bold') as a proxy
  // — also not reliable.
  //
  // ACTUAL working solution: We use the browser's own spellcheck by embedding
  // each token into a temporary <textarea>, then checking whether
  // the textarea's checkValidity() or custom validity flags it. Since that's
  // also not a real API, we instead tokenise the text ourselves and send each
  // unique unknown-looking word to LT's single-word check endpoint, which IS
  // what the browser spellchecker does internally.
  //
  // TL;DR: We call LT with NO category restrictions (full check), which makes
  // it behave like a proper spellchecker + grammar checker combined.

  async function getBrowserSpellMisspellings(text) {
    // Use a hidden contenteditable. We set text, then query all <span> elements
    // the browser wraps around red-squiggle words — but browsers don't actually
    // insert spans, they paint squiggles as CSS decorations with no DOM hooks.
    //
    // Real working method: inject into a <textarea>, use the InputEvent
    // insertReplacementText API (Chrome 87+) — also not a query API.
    //
    // We must do this ourselves. Tokenise, filter obviously wrong tokens,
    // and return synthetic "match" objects in LT format.

    const IGNORED = new Set(['YSOA','MediSave','Singpass','CPF','SingPass','NRICs']);

    // Tokenise into words with their offsets
    const tokens = [];
    const re = /\b([a-zA-Z]{2,})\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const word = m[1];
      if (IGNORED.has(word)) continue;
      tokens.push({ word, offset: m.index });
    }

    // Deduplicate by lowercase word
    const unique = {};
    tokens.forEach(t => { unique[t.word.toLowerCase()] = unique[t.word.toLowerCase()] || []; unique[t.word.toLowerCase()].push(t); });

    // For each unique word, check it in isolation via LT (1 call per unique word is too slow).
    // Instead use a smarter trick: build one LT call with all unique unknown words
    // joined by newlines (each on its own line so offsets are easy to track), then
    // collect only TYPOS-category hits.
    const uniqueWords = Object.keys(unique);
    if (!uniqueWords.length) return [];

    // Build a probe text: each unique word on its own line
    const probeLines = uniqueWords;
    const probeText  = probeLines.join('\n');

    try {
      const resp = await fetch('https://api.languagetool.org/v2/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          text: probeText,
          language: 'en-US',
          // No disabledCategories — let everything through, we filter client-side
        }).toString()
      });
      if (!resp.ok) return [];
      const data = await resp.json();

      // Map probe hits back to real offsets in original text
      const results = [];
      let lineStart = 0;
      probeLines.forEach((word, lineIdx) => {
        const lineEnd = lineStart + word.length;
        const hitsOnLine = (data.matches || []).filter(h =>
          h.offset >= lineStart && h.offset < lineEnd &&
          (h.rule.issueType === 'misspelling' || (h.rule.category && h.rule.category.id === 'TYPOS'))
        );
        hitsOnLine.forEach(hit => {
          // This word is misspelled — find all occurrences in original text
          (unique[word] || []).forEach(tok => {
            results.push({
              offset: tok.offset,
              length: tok.word.length,
              message: `"${tok.word}" is not a known word.`,
              replacements: hit.replacements || [],
              rule: { issueType: 'misspelling', category: { id: 'TYPOS' } }
            });
          });
        });
        lineStart = lineEnd + 1; // +1 for the \n
      });

      return results;
    } catch(e) {
      return [];
    }
  }

  async function runTetiaCheck() {
    const text = document.getElementById('inputEditor')?.innerText?.trim();
    if (!text) {
      body.innerHTML = '<div class="tetia-empty">Hmm~ I don\'t see any text yet! Paste something in the Input panel first \uD83E\uDEA4</div>';
      panel.classList.add('open');
      return;
    }

    panel.classList.add('open');
    checkBtn.disabled = true;
    checkBtn.textContent = '⏳ Casting magic…';
    body.className = 'tetia-body loading';
    body.innerHTML = '<div class="tetia-dots"><span></span><span></span><span></span></div><span>Checking spells…</span>';

    try {
      // Run both checks in parallel: full LT check + browser-style spell probe
      const [ltResp, spellHits] = await Promise.all([
        fetch('https://api.languagetool.org/v2/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            text,
            language: 'en-US',
            // No category restrictions — full check
            ignoredWords: 'YSOA,MediSave,Singpass,CPF,SingPass'
          }).toString()
        }),
        getBrowserSpellMisspellings(text)
      ]);

      if (!ltResp.ok) throw new Error('LanguageTool error');
      const ltData  = await ltResp.json();
      const ltMatches = (ltData.matches || []);

      // Merge: add spell hits that LT didn't already cover (by offset)
      const ltOffsets = new Set(ltMatches.map(m => m.offset));
      const extraSpell = spellHits.filter(h => !ltOffsets.has(h.offset));
      const allMatches = [...ltMatches, ...extraSpell]
        .sort((a, b) => a.offset - b.offset);

      renderResults(allMatches, text);
    } catch(e) {
      body.className = 'tetia-body';
      body.innerHTML = '<div class="tetia-empty" style="color:#ba0517;">\u26A0\uFE0F Could not reach the grammar server. Check your connection~</div>';
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = '🔍 Check my text!';
    }
  }

  function renderResults(matches, text) {
    body.className = 'tetia-body';
    if (!matches.length) {
      body.innerHTML = '<div class="tetia-all-good">✅ No spell errors found — your writing is magical! ✨</div>';
      return;
    }

    const intro = `<p style="margin-bottom:10px;font-size:12px;color:#706e6b;">Found <strong>${matches.length}</strong> issue${matches.length !== 1 ? 's' : ''} to fix~ Let's go! 🪄</p>`;
    const items = matches.slice(0, 12).map((m, idx) => {
      const type = m.rule.issueType === 'misspelling' ? 'spelling' : m.rule.issueType === 'style' ? 'style' : 'grammar';
      const icon = type === 'spelling' ? '🔴' : type === 'style' ? '🔵' : '🟡';
      const snippet = text.slice(Math.max(0, m.offset - 15), m.offset + m.length + 15);
      const fixes = (m.replacements || []).slice(0, 3)
        .map(s => `<button class="tetia-fix-btn" data-idx="${idx}">→ ${escHtml(s.value)}</button>`)
        .join('');
      return `<div class="tetia-issue ${type}">
        <span style="font-size:14px;flex-shrink:0">${icon}</span>
        <div>
          <div>${escHtml(m.message)}</div>
          <div style="font-size:11px;color:#706e6b;font-style:italic;margin-top:2px;">"…${escHtml(snippet)}…"</div>
          ${fixes ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">${fixes}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    body.innerHTML = intro + items;

    // Store matches for fix buttons
    body._matches = matches;
    body._text = text;

    body.querySelectorAll('.tetia-fix-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const match = body._matches[idx];
        const fix = btn.textContent.replace('→ ', '').trim();
        if (match) applyGrammarFix(match, fix);
      });
    });
  }
})();
}); // DOMContentLoaded


// ===== PASTE DEBUGGER =====
// ===== PASTE DEBUGGER =====
function openPasteDebugger() {
  document.getElementById('dbgRaw').value       = window._dbgPasteRaw  || '(no HTML paste yet — paste something first)';
  document.getElementById('dbgSanitized').value = window._dbgPasteSan  || '(no HTML paste yet)';
  document.getElementById('dbgPlaintext').value = window._dbgPasteTxt  || '(no paste yet)';
  document.getElementById('pasteDebugModal').classList.add('open');
}
document.getElementById('pasteDebugClose').addEventListener('click',  () => document.getElementById('pasteDebugModal').classList.remove('open'));
document.getElementById('pasteDebugClose2').addEventListener('click', () => document.getElementById('pasteDebugModal').classList.remove('open'));
