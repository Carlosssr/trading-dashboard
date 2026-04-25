/* ── Trade Log Tab — CRUD + CSV Import ── */

(function () {
  let tradeImages = [];
  let csvHeaders  = [];
  let csvRows     = [];

  /* ── Helpers ── */
  function getTrades()  { return DB.getTrades(); }
  function saveTrades(t){ DB.set(DB_KEYS.trades, t); }

  function calcPnl(entry, exit, size, side) {
    const e = parseFloat(entry), x = parseFloat(exit), s = parseFloat(size);
    if (isNaN(e) || isNaN(x) || isNaN(s)) return 0;
    return side === 'short' ? (e - x) * s : (x - e) * s;
  }

  function calcR(entry, exit, stop, side) {
    const e = parseFloat(entry), x = parseFloat(exit), st = parseFloat(stop);
    if (isNaN(e) || isNaN(x) || isNaN(st) || st === 0) return null;
    const risk   = Math.abs(e - st);
    const reward = side === 'short' ? (e - x) : (x - e);
    return risk > 0 ? reward / risk : null;
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Summary bar ── */
  function updateSummary(trades) {
    const today = todayStr();
    const wins  = trades.filter(t => t.pnl > 0);
    const total = trades.reduce((s, t) => s + (t.pnl || 0), 0);
    const todayPnl = trades.filter(t => t.date === today).reduce((s,t) => s + (t.pnl||0), 0);
    const avgR  = trades.filter(t => t.r != null).reduce((s,t,_,a) => s + t.r/a.length, 0);
    const wr    = trades.length ? Math.round((wins.length / trades.length) * 100) : 0;

    const set = (id, val, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val;
      if (cls) { el.className = 'stat-value ' + cls; }
    };

    set('summaryTotalPnl', fmt$(total), pnlClass(total));
    set('summaryTodayPnl', fmt$(todayPnl), pnlClass(todayPnl));
    set('summaryWinRate',  `${wr}%`);
    set('summaryTradeCount', trades.length);
    set('summaryAvgR', trades.some(t=>t.r!=null) ? fmtR(avgR) : '—');
  }

  /* ── Populate setup filter datalist and select ── */
  function refreshSetupFilters() {
    const trades  = getTrades();
    const setups  = [...new Set(trades.map(t => t.setup).filter(Boolean))];
    const dl      = document.getElementById('setupTagList');
    const sel     = document.getElementById('tradeSetupFilter');
    if (dl) dl.innerHTML = setups.map(s => `<option value="${escHtml(s)}">`).join('');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = `<option value="">All Setups</option>` +
        setups.map(s => `<option value="${escHtml(s)}" ${s===cur?'selected':''}>${escHtml(s)}</option>`).join('');
    }
  }

  /* ── Render table ── */
  function renderTable() {
    const trades    = getTrades();
    const search    = document.getElementById('tradeSearch')?.value.toLowerCase() || '';
    const sideF     = document.getElementById('tradeSideFilter')?.value || '';
    const setupF    = document.getElementById('tradeSetupFilter')?.value || '';
    const dateFrom  = document.getElementById('tradeDateFrom')?.value || '';
    const dateTo    = document.getElementById('tradeDateTo')?.value || '';

    const filtered = trades.filter(t => {
      if (search && !t.ticker?.toLowerCase().includes(search)) return false;
      if (sideF  && t.side !== sideF)  return false;
      if (setupF && t.setup !== setupF) return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo   && t.date > dateTo)   return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));

    const tbody     = document.getElementById('tradeTableBody');
    const emptyRow  = document.getElementById('tradeEmptyRow');

    if (!filtered.length) {
      tbody.innerHTML = '';
      tbody.appendChild(emptyRow);
      emptyRow.classList.remove('hidden');
      updateSummary(trades);
      return;
    }

    emptyRow.classList.add('hidden');
    tbody.innerHTML = filtered.map(t => {
      const pnlCls = pnlClass(t.pnl || 0);
      const rStr   = t.r != null ? fmtR(t.r) : '—';
      const sideBadge = `<span class="badge badge-${t.side}">${t.side || '—'}</span>`;
      const hasImg = t.images?.length ? '🖼' : '';
      return `
        <tr data-id="${t.id}">
          <td>${t.date || '—'}</td>
          <td><strong>${escHtml(t.ticker || '—')}</strong></td>
          <td>${sideBadge}</td>
          <td>${t.entry != null ? '$' + parseFloat(t.entry).toFixed(2) : '—'}</td>
          <td>${t.exit  != null ? '$' + parseFloat(t.exit).toFixed(2)  : '—'}</td>
          <td>${t.size  != null ? Number(t.size).toLocaleString() : '—'}</td>
          <td class="${pnlCls}" style="font-weight:700">${t.pnl != null ? fmt$(t.pnl) : '—'}</td>
          <td class="${t.r != null ? pnlClass(t.r) : ''}">${rStr}</td>
          <td>${escHtml(t.setup || '—')}</td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(t.notes||'')}">${hasImg} ${escHtml(t.notes || '')}</td>
          <td>
            <div class="table-actions">
              <button class="table-btn edit-btn" data-id="${t.id}">Edit</button>
              <button class="table-btn danger delete-btn" data-id="${t.id}">Del</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditTrade(btn.dataset.id));
    });
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteTrade(btn.dataset.id));
    });

    updateSummary(trades);
    refreshSetupFilters();
  }

  /* ── Open modal for add ── */
  function openAddTrade() {
    document.getElementById('tradeModalTitle').textContent = 'Add Trade';
    document.getElementById('tradeEditId').value  = '';
    document.getElementById('tradeDate').value    = todayStr();
    document.getElementById('tradeTicker').value  = '';
    document.getElementById('tradeSide').value    = 'long';
    document.getElementById('tradeEntry').value   = '';
    document.getElementById('tradeExit').value    = '';
    document.getElementById('tradeSize').value    = '';
    document.getElementById('tradeStop').value    = '';
    document.getElementById('tradeSetup').value   = '';
    document.getElementById('tradeNotes').value   = '';
    tradeImages = [];
    renderImagePreviews('tradeImageGrid', tradeImages, removeTradeImage);
    openModal('tradeModal');
  }

  /* ── Open modal for edit ── */
  function openEditTrade(id) {
    const trade = getTrades().find(t => t.id === id);
    if (!trade) return;
    document.getElementById('tradeModalTitle').textContent = 'Edit Trade';
    document.getElementById('tradeEditId').value  = trade.id;
    document.getElementById('tradeDate').value    = trade.date || todayStr();
    document.getElementById('tradeTicker').value  = trade.ticker || '';
    document.getElementById('tradeSide').value    = trade.side || 'long';
    document.getElementById('tradeEntry').value   = trade.entry ?? '';
    document.getElementById('tradeExit').value    = trade.exit  ?? '';
    document.getElementById('tradeSize').value    = trade.size  ?? '';
    document.getElementById('tradeStop').value    = trade.stop  ?? '';
    document.getElementById('tradeSetup').value   = trade.setup || '';
    document.getElementById('tradeNotes').value   = trade.notes || '';
    tradeImages = [...(trade.images || [])];
    renderImagePreviews('tradeImageGrid', tradeImages, removeTradeImage);
    openModal('tradeModal');
  }

  function removeTradeImage(i) {
    tradeImages.splice(i, 1);
    renderImagePreviews('tradeImageGrid', tradeImages, removeTradeImage);
  }

  /* ── Save trade ── */
  function saveTrade() {
    const ticker = document.getElementById('tradeTicker').value.trim().toUpperCase();
    const date   = document.getElementById('tradeDate').value;
    if (!ticker || !date) { toast('Ticker and date are required', 'error'); return; }

    const side   = document.getElementById('tradeSide').value;
    const entry  = parseFloat(document.getElementById('tradeEntry').value) || null;
    const exit   = parseFloat(document.getElementById('tradeExit').value)  || null;
    const size   = parseFloat(document.getElementById('tradeSize').value)  || null;
    const stop   = parseFloat(document.getElementById('tradeStop').value)  || null;
    const setup  = document.getElementById('tradeSetup').value.trim();
    const notes  = document.getElementById('tradeNotes').value.trim();

    const pnl = (entry && exit && size) ? calcPnl(entry, exit, size, side) : null;
    const r   = (entry && exit && stop) ? calcR(entry, exit, stop, side)   : null;

    const editId = document.getElementById('tradeEditId').value;
    const trades = getTrades();

    if (editId) {
      const idx = trades.findIndex(t => t.id === editId);
      if (idx !== -1) {
        trades[idx] = { ...trades[idx], date, ticker, side, entry, exit, size, stop, setup, notes, pnl, r, images: tradeImages };
      }
    } else {
      trades.push({ id: genId(), date, ticker, side, entry, exit, size, stop, setup, notes, pnl, r, images: tradeImages });
    }

    saveTrades(trades);
    closeModal('tradeModal');
    renderTable();
    toast(`Trade ${editId ? 'updated' : 'added'}: ${ticker}`, 'success');
  }

  /* ── Delete trade ── */
  function deleteTrade(id) {
    if (!confirm('Delete this trade?')) return;
    const trades = getTrades().filter(t => t.id !== id);
    saveTrades(trades);
    renderTable();
    toast('Trade deleted', 'info');
  }

  /* ── CSV Import ── */
  function handleCsvFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) { toast('CSV file is empty', 'error'); return; }
      csvHeaders = parseCSVLine(lines[0]);
      csvRows    = lines.slice(1).map(parseCSVLine);

      const config = DB.getConfig();
      if (config.csvColumnMap && Object.keys(config.csvColumnMap).length) {
        importWithMapping(config.csvColumnMap);
      } else {
        showMappingModal();
      }
    };
    reader.readAsText(file);
  }

  function parseCSVLine(line) {
    const result = [];
    let current  = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  }

  const CSV_FIELDS = [
    { key: 'date',   label: 'Date' },
    { key: 'ticker', label: 'Ticker / Symbol' },
    { key: 'side',   label: 'Side (Buy/Sell/Long/Short)' },
    { key: 'entry',  label: 'Entry Price' },
    { key: 'exit',   label: 'Exit Price' },
    { key: 'size',   label: 'Shares / Qty' },
    { key: 'pnl',    label: 'Net P&L ($)' },
  ];

  function showMappingModal() {
    const config = DB.getConfig();
    const saved  = config.csvColumnMap || {};

    const grid = document.getElementById('csvMappingGrid');
    grid.innerHTML = CSV_FIELDS.map(f => {
      const options = csvHeaders.map((h, i) =>
        `<option value="${i}" ${saved[f.key] == i ? 'selected' : ''}>${escHtml(h)}</option>`
      ).join('');
      return `
        <div style="font-size:12px;font-weight:600;color:var(--text-muted)">${f.label}</div>
        <div class="csv-mapping-arrow">→</div>
        <select class="select" data-field="${f.key}">
          <option value="">— skip —</option>
          ${options}
        </select>
      `;
    }).join('');

    openModal('csvMappingModal');
  }

  function saveMapping() {
    const map = {};
    document.querySelectorAll('#csvMappingGrid select[data-field]').forEach(sel => {
      if (sel.value !== '') map[sel.dataset.field] = Number(sel.value);
    });
    const config = DB.getConfig();
    config.csvColumnMap = map;
    DB.set(DB_KEYS.config, config);
    closeModal('csvMappingModal');
    importWithMapping(map);
  }

  function normalizeSide(v) {
    const lv = String(v || '').toLowerCase();
    if (['buy','long','b'].includes(lv)) return 'long';
    if (['sell','short','s'].includes(lv)) return 'short';
    return lv.includes('short') ? 'short' : 'long';
  }

  function normalizeDate(v) {
    if (!v) return todayStr();
    const d = new Date(v);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return v.slice(0, 10);
  }

  function importWithMapping(map) {
    const trades = getTrades();
    let added = 0;

    csvRows.forEach(row => {
      const get = key => map[key] != null ? (row[map[key]] || '').trim() : '';
      const ticker = get('ticker').toUpperCase();
      if (!ticker) return;

      const side  = normalizeSide(get('side'));
      const entry = parseFloat(get('entry')) || null;
      const exit  = parseFloat(get('exit'))  || null;
      const size  = parseFloat(get('size'))  || null;
      const rawPnl = parseFloat(get('pnl'));
      const pnl   = !isNaN(rawPnl) ? rawPnl : (entry && exit && size ? calcPnl(entry, exit, size, side) : null);

      trades.push({
        id: genId(),
        date:   normalizeDate(get('date')),
        ticker,
        side,
        entry,
        exit,
        size,
        pnl,
        r:      null,
        setup:  '',
        notes:  '',
        images: [],
      });
      added++;
    });

    saveTrades(trades);
    renderTable();
    toast(`Imported ${added} trades`, 'success');
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Init ── */
  function init() {
    document.getElementById('addTradeBtn')?.addEventListener('click', openAddTrade);
    document.getElementById('saveTradeBtn')?.addEventListener('click', saveTrade);

    document.getElementById('csvImportBtn')?.addEventListener('click', () => {
      document.getElementById('csvFileInput').click();
    });
    document.getElementById('csvFileInput')?.addEventListener('change', function () {
      if (this.files[0]) handleCsvFile(this.files[0]);
    });
    document.getElementById('openMappingBtn')?.addEventListener('click', showMappingModal);
    document.getElementById('saveMappingBtn')?.addEventListener('click', saveMapping);

    // Filters
    ['tradeSearch','tradeSideFilter','tradeSetupFilter','tradeDateFrom','tradeDateTo'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', renderTable);
      document.getElementById(id)?.addEventListener('change', renderTable);
    });
    document.getElementById('clearTradeFilters')?.addEventListener('click', () => {
      ['tradeSearch','tradeDateFrom','tradeDateTo'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
      document.getElementById('tradeSideFilter').value  = '';
      document.getElementById('tradeSetupFilter').value = '';
      renderTable();
    });

    // Trade image upload
    document.getElementById('tradeImageInput')?.addEventListener('change', async function () {
      for (const f of Array.from(this.files)) {
        const b64 = await fileToBase64(f);
        tradeImages.push(b64);
      }
      renderImagePreviews('tradeImageGrid', tradeImages, removeTradeImage);
    });

    renderTable();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.TradeLog = { renderTable };
})();
