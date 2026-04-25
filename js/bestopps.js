/* ── Best Opps — Missed Plays Tab ── */

(function () {
  let oppImages = [];

  function getOpps()  { return DB.getBestOpps(); }
  function saveOpps(o){ DB.set(DB_KEYS.bestOpps, o); }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  const OUTCOME_LABELS = {
    worked:  { label: 'Would Have Worked', cls: 'outcome-worked' },
    failed:  { label: 'Would Have Failed',  cls: 'outcome-failed' },
    partial: { label: 'Partial Move',       cls: 'outcome-partial' },
    unknown: { label: 'Unknown',            cls: 'outcome-unknown' },
  };

  /* ── Render grid ── */
  function render() {
    const opps  = getOpps();
    const search = document.getElementById('oppSearch')?.value.toLowerCase() || '';
    const dateF  = document.getElementById('oppDateFilter')?.value || '';

    const filtered = opps.filter(o => {
      if (search && !o.ticker?.toLowerCase().includes(search) && !o.pattern?.toLowerCase().includes(search)) return false;
      if (dateF  && o.date !== dateF) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

    const grid    = document.getElementById('oppsGrid');
    const empty   = document.getElementById('oppsEmptyState');

    if (!filtered.length) {
      grid.innerHTML = '';
      grid.appendChild(empty);
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = filtered.map(o => {
      const outcome = OUTCOME_LABELS[o.outcome] || OUTCOME_LABELS.unknown;
      const entryStr = o.entry ? `<span style="font-size:11px;color:var(--text-muted)">Hyp. entry: $${parseFloat(o.entry).toFixed(2)}</span>` : '';
      const tf = o.timeframe ? `<span class="badge badge-custom">${escHtml(o.timeframe)}</span>` : '';
      const imgCount = o.images?.length ? `<span style="font-size:11px;color:var(--text-muted)">🖼 ${o.images.length}</span>` : '';

      return `
        <div class="opp-card" data-id="${o.id}">
          <div class="opp-card-header">
            <span class="opp-ticker">${escHtml(o.ticker || '—')}</span>
            <span class="opp-date">${o.date || '—'}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
            <span class="opp-pattern">${escHtml(o.pattern || '—')}</span>
            ${tf}
          </div>
          ${entryStr ? `<div style="margin-bottom:6px">${entryStr}</div>` : ''}
          ${o.whyPassed ? `<div class="opp-notes">${escHtml(o.whyPassed)}</div>` : ''}
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
            <span class="opp-outcome-badge ${outcome.cls}">${outcome.label}</span>
            <div style="display:flex;gap:8px;align-items:center">
              ${imgCount}
              <button class="table-btn edit-opp" data-id="${o.id}">Edit</button>
              <button class="table-btn danger delete-opp" data-id="${o.id}">Del</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.edit-opp').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openEdit(btn.dataset.id); });
    });
    grid.querySelectorAll('.delete-opp').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); deleteOpp(btn.dataset.id); });
    });

    // Click card to view images
    grid.querySelectorAll('.opp-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        const opp = getOpps().find(o => o.id === card.dataset.id);
        if (opp?.images?.length) openLightbox(opp.images[0]);
      });
    });
  }

  /* ── Open modal: add ── */
  function openAdd() {
    document.getElementById('oppModalTitle').textContent = 'Log Missed Play';
    document.getElementById('oppEditId').value   = '';
    document.getElementById('oppDate').value     = todayStr();
    document.getElementById('oppTicker').value   = '';
    document.getElementById('oppTimeframe').value = '5m';
    document.getElementById('oppPattern').value  = '';
    document.getElementById('oppEntry').value    = '';
    document.getElementById('oppOutcome').value  = 'unknown';
    document.getElementById('oppWhyPassed').value = '';
    oppImages = [];
    renderImagePreviews('oppImageGrid', oppImages, removeOppImage);
    openModal('oppModal');
  }

  /* ── Open modal: edit ── */
  function openEdit(id) {
    const opp = getOpps().find(o => o.id === id);
    if (!opp) return;
    document.getElementById('oppModalTitle').textContent = 'Edit Missed Play';
    document.getElementById('oppEditId').value    = opp.id;
    document.getElementById('oppDate').value      = opp.date || todayStr();
    document.getElementById('oppTicker').value    = opp.ticker || '';
    document.getElementById('oppTimeframe').value = opp.timeframe || '5m';
    document.getElementById('oppPattern').value   = opp.pattern || '';
    document.getElementById('oppEntry').value     = opp.entry ?? '';
    document.getElementById('oppOutcome').value   = opp.outcome || 'unknown';
    document.getElementById('oppWhyPassed').value = opp.whyPassed || '';
    oppImages = [...(opp.images || [])];
    renderImagePreviews('oppImageGrid', oppImages, removeOppImage);
    openModal('oppModal');
  }

  function removeOppImage(i) {
    oppImages.splice(i, 1);
    renderImagePreviews('oppImageGrid', oppImages, removeOppImage);
  }

  /* ── Save ── */
  function saveOpp() {
    const ticker  = document.getElementById('oppTicker').value.trim().toUpperCase();
    const date    = document.getElementById('oppDate').value;
    if (!ticker || !date) { toast('Ticker and date required', 'error'); return; }

    const pattern   = document.getElementById('oppPattern').value.trim();
    const timeframe = document.getElementById('oppTimeframe').value;
    const entry     = parseFloat(document.getElementById('oppEntry').value) || null;
    const outcome   = document.getElementById('oppOutcome').value;
    const whyPassed = document.getElementById('oppWhyPassed').value.trim();

    const opps   = getOpps();
    const editId = document.getElementById('oppEditId').value;

    if (editId) {
      const idx = opps.findIndex(o => o.id === editId);
      if (idx !== -1) {
        opps[idx] = { ...opps[idx], date, ticker, pattern, timeframe, entry, outcome, whyPassed, images: oppImages };
      }
    } else {
      opps.push({ id: genId(), date, ticker, pattern, timeframe, entry, outcome, whyPassed, images: oppImages });
    }

    saveOpps(opps);
    closeModal('oppModal');
    render();
    toast(`Play logged: ${ticker}`, 'success');
  }

  /* ── Delete ── */
  function deleteOpp(id) {
    if (!confirm('Delete this missed play?')) return;
    saveOpps(getOpps().filter(o => o.id !== id));
    render();
    toast('Play deleted', 'info');
  }

  /* ── Init ── */
  function init() {
    document.getElementById('addOppBtn')?.addEventListener('click', openAdd);
    document.getElementById('saveOppBtn')?.addEventListener('click', saveOpp);

    ['oppSearch', 'oppDateFilter'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', render);
      document.getElementById(id)?.addEventListener('change', render);
    });

    document.getElementById('clearOppFilters')?.addEventListener('click', () => {
      document.getElementById('oppSearch').value = '';
      document.getElementById('oppDateFilter').value = '';
      render();
    });

    document.getElementById('oppImageInput')?.addEventListener('change', async function () {
      for (const f of Array.from(this.files)) {
        const b64 = await fileToBase64(f);
        oppImages.push(b64);
      }
      renderImagePreviews('oppImageGrid', oppImages, removeOppImage);
    });

    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
