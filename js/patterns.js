/* ── Pattern Library Tab ── */

(function () {
  let patternImage = null;

  function getPatterns() {
    let stored = DB.getPatterns();
    if (!stored) {
      // First visit — seed the library
      stored = window.PATTERN_SEED ? [...window.PATTERN_SEED] : [];
      DB.set(DB_KEYS.patterns, stored);
    }
    return stored;
  }

  function savePatterns(p) { DB.set(DB_KEYS.patterns, p); }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Calculate win rate for a pattern from Trade Log ── */
  function patternStats(name) {
    if (!name) return null;
    const trades = DB.getTrades().filter(t =>
      t.setup && t.setup.toLowerCase().includes(name.toLowerCase().slice(0, 8))
    );
    if (!trades.length) return null;
    const wins = trades.filter(t => (t.pnl || 0) > 0).length;
    return { count: trades.length, winRate: Math.round((wins / trades.length) * 100) };
  }

  /* ── Render the grid ── */
  function render() {
    const patterns = getPatterns();
    const search   = (document.getElementById('patternSearch')?.value || '').toLowerCase();
    const catF     = document.getElementById('patternCategoryFilter')?.value || '';

    const filtered = patterns.filter(p => {
      if (catF   && p.category !== catF) return false;
      if (search && !p.name.toLowerCase().includes(search) && !p.description?.toLowerCase().includes(search)) return false;
      return true;
    });

    const grid  = document.getElementById('patternGrid');
    const empty = document.getElementById('patternEmptyState');

    if (!filtered.length) {
      grid.innerHTML = '';
      grid.appendChild(empty);
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    const catOrder = { 'ict-core': 0, 'ict-time': 1, kitt: 2, custom: 3 };
    filtered.sort((a, b) => (catOrder[a.category]||9) - (catOrder[b.category]||9) || a.name.localeCompare(b.name));

    grid.innerHTML = filtered.map(p => {
      const stats   = patternStats(p.name);
      const imgHtml = p.image
        ? `<img class="pattern-card-img" src="${p.image}" alt="${escHtml(p.name)}" />`
        : `<div class="pattern-card-img-placeholder">📊</div>`;

      const rulesHtml = p.rules?.length
        ? `<ul class="pattern-card-rules">${p.rules.slice(0,3).map(r=>`<li>${escHtml(r)}</li>`).join('')}</ul>`
        : '';

      const statsHtml = stats
        ? `<div class="pattern-stat">From trades: <strong>${stats.winRate}% WR</strong> (${stats.count})</div>`
        : `<div class="pattern-stat" style="color:var(--text-dim)">No trade data yet</div>`;

      return `
        <div class="pattern-card" data-id="${p.id}">
          ${imgHtml}
          <div class="pattern-card-body">
            <div class="pattern-card-header">
              <span class="pattern-card-name">${escHtml(p.name)}</span>
              ${categoryBadge(p.category)}
            </div>
            <div class="pattern-card-desc">${escHtml(p.description || '')}</div>
            ${rulesHtml}
            <div class="pattern-card-footer">
              ${statsHtml}
              <div class="card-actions">
                <button class="table-btn edit-pattern" data-id="${p.id}">Edit</button>
                <button class="table-btn danger delete-pattern" data-id="${p.id}">Del</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.edit-pattern').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openEdit(btn.dataset.id); });
    });
    grid.querySelectorAll('.delete-pattern').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); deletePattern(btn.dataset.id); });
    });
    grid.querySelectorAll('.pattern-card-img').forEach(img => {
      img.addEventListener('click', () => openLightbox(img.src));
    });
  }

  /* ── Open add modal ── */
  function openAdd() {
    document.getElementById('patternModalTitle').textContent = 'Add Pattern';
    document.getElementById('patternEditId').value    = '';
    document.getElementById('patternName').value      = '';
    document.getElementById('patternCategory').value  = 'custom';
    document.getElementById('patternDesc').value      = '';
    document.getElementById('patternRules').value     = '';
    patternImage = null;
    document.getElementById('patternImageGrid').innerHTML = '';
    openModal('patternModal');
  }

  /* ── Open edit modal ── */
  function openEdit(id) {
    const p = getPatterns().find(p => p.id === id);
    if (!p) return;
    document.getElementById('patternModalTitle').textContent = 'Edit Pattern';
    document.getElementById('patternEditId').value    = p.id;
    document.getElementById('patternName').value      = p.name || '';
    document.getElementById('patternCategory').value  = p.category || 'custom';
    document.getElementById('patternDesc').value      = p.description || '';
    document.getElementById('patternRules').value     = (p.rules || []).join('\n');
    patternImage = p.image || null;

    const grid = document.getElementById('patternImageGrid');
    grid.innerHTML = '';
    if (patternImage) {
      const wrap = document.createElement('div');
      wrap.className = 'preview-img-wrap';
      const img = document.createElement('img');
      img.src = patternImage;
      img.onclick = () => openLightbox(patternImage);
      const rm = document.createElement('button');
      rm.className = 'preview-img-remove';
      rm.textContent = '✕';
      rm.onclick = () => { patternImage = null; grid.innerHTML = ''; };
      wrap.appendChild(img); wrap.appendChild(rm); grid.appendChild(wrap);
    }
    openModal('patternModal');
  }

  /* ── Save pattern ── */
  function savePattern() {
    const name = document.getElementById('patternName').value.trim();
    if (!name) { toast('Pattern name is required', 'error'); return; }

    const category = document.getElementById('patternCategory').value;
    const desc     = document.getElementById('patternDesc').value.trim();
    const rulesRaw = document.getElementById('patternRules').value;
    const rules    = rulesRaw.split('\n').map(r => r.trim()).filter(Boolean);
    const editId   = document.getElementById('patternEditId').value;

    const patterns = getPatterns();

    if (editId) {
      const idx = patterns.findIndex(p => p.id === editId);
      if (idx !== -1) {
        patterns[idx] = { ...patterns[idx], name, category, description: desc, rules, image: patternImage };
      }
    } else {
      patterns.push({ id: genId(), name, category, description: desc, rules, image: patternImage, tags: [] });
    }

    savePatterns(patterns);
    closeModal('patternModal');
    render();
    toast(`Pattern ${editId ? 'updated' : 'added'}: ${name}`, 'success');
  }

  /* ── Delete pattern ── */
  function deletePattern(id) {
    const p = getPatterns().find(p => p.id === id);
    if (!confirm(`Delete pattern "${p?.name}"?`)) return;
    savePatterns(getPatterns().filter(p => p.id !== id));
    render();
    toast('Pattern deleted', 'info');
  }

  /* ── Init ── */
  function init() {
    document.getElementById('addPatternBtn')?.addEventListener('click', openAdd);
    document.getElementById('savePatternBtn')?.addEventListener('click', savePattern);

    ['patternSearch', 'patternCategoryFilter'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', render);
      document.getElementById(id)?.addEventListener('change', render);
    });

    document.getElementById('patternImageInput')?.addEventListener('change', async function () {
      if (!this.files[0]) return;
      patternImage = await fileToBase64(this.files[0]);
      const grid = document.getElementById('patternImageGrid');
      grid.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'preview-img-wrap';
      const img = document.createElement('img');
      img.src = patternImage;
      img.onclick = () => openLightbox(patternImage);
      const rm = document.createElement('button');
      rm.className = 'preview-img-remove';
      rm.textContent = '✕';
      rm.onclick = () => { patternImage = null; grid.innerHTML = ''; };
      wrap.appendChild(img); wrap.appendChild(rm); grid.appendChild(wrap);
    });

    render();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.Patterns = { render };
})();
