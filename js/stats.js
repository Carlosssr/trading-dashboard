/* ── Stats & Analytics Tab ── */

(function () {
  let equityChart  = null;
  let dailyChart   = null;

  /* ── Filter trades by period ── */
  function filterByPeriod(trades) {
    const period = document.getElementById('statsPeriod')?.value || 'all';
    if (period === 'all') return trades;

    const now = new Date();
    if (period === '7')  { const d = new Date(now); d.setDate(d.getDate()-7);  return trades.filter(t => t.date >= d.toISOString().slice(0,10)); }
    if (period === '30') { const d = new Date(now); d.setDate(d.getDate()-30); return trades.filter(t => t.date >= d.toISOString().slice(0,10)); }
    if (period === 'thismonth') {
      const prefix = now.toISOString().slice(0, 7);
      return trades.filter(t => t.date?.startsWith(prefix));
    }
    return trades;
  }

  /* ── Compute all stats ── */
  function computeStats(trades) {
    const wins   = trades.filter(t => (t.pnl || 0) > 0);
    const losses = trades.filter(t => (t.pnl || 0) < 0);
    const total  = trades.reduce((s, t) => s + (t.pnl || 0), 0);
    const grossW = wins.reduce((s, t) => s + (t.pnl || 0), 0);
    const grossL = Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0));
    const wr     = trades.length ? (wins.length / trades.length * 100) : 0;
    const pf     = grossL > 0 ? grossW / grossL : wins.length ? Infinity : 0;
    const avgW   = wins.length ? grossW / wins.length : 0;
    const avgL   = losses.length ? grossL / losses.length : 0;

    const rTrades = trades.filter(t => t.r != null);
    const avgR   = rTrades.length ? rTrades.reduce((s,t)=>s+t.r,0) / rTrades.length : 0;

    const pnls   = trades.map(t => t.pnl || 0);
    const best   = pnls.length ? Math.max(...pnls) : 0;
    const worst  = pnls.length ? Math.min(...pnls) : 0;

    return { total, wr, pf, avgW, avgL, avgR, best, worst, count: trades.length };
  }

  /* ── Render summary cards ── */
  function renderCards(s) {
    const set = (id, val, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val;
      el.className = 'stat-card-value' + (cls ? ' ' + cls : '');
    };
    set('statTotalPnl',    fmt$(s.total),                      pnlClass(s.total));
    set('statWinRate',     s.count ? `${s.wr.toFixed(1)}%` : '—');
    set('statProfitFactor',s.pf === Infinity ? '∞' : s.pf.toFixed(2));
    set('statAvgR',        s.count ? fmtR(s.avgR) : '—');
    set('statAvgWin',      s.count ? fmt$(s.avgW) : '—',       'profit');
    set('statAvgLoss',     s.count ? fmt$(s.avgL) : '—',       'loss');
    set('statBestTrade',   s.count ? fmt$(s.best) : '—',       'profit');
    set('statWorstTrade',  s.count ? fmt$(s.worst) : '—',      'loss');
    set('statTradeCount',  s.count);
  }

  /* ── Equity curve ── */
  function renderEquityChart(trades) {
    const container = document.getElementById('equityChart');
    if (!container) return;

    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    if (equityChart) { equityChart.remove(); equityChart = null; }
    if (!sorted.length || typeof LightweightCharts === 'undefined') {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px">No trades to display</div>';
      return;
    }

    container.innerHTML = '';
    const chart = LightweightCharts.createChart(container, {
      width:  container.clientWidth  || 600,
      height: container.clientHeight || 240,
      layout:      { background: { color: 'transparent' }, textColor: '#6b7280' },
      grid:        { vertLines: { color: '#2a2a2a' }, horzLines: { color: '#2a2a2a' } },
      crosshair:   { mode: 1 },
      rightPriceScale: { borderColor: '#2a2a2a' },
      timeScale:   { borderColor: '#2a2a2a', timeVisible: true },
    });

    let cumulative = 0;
    const data = sorted.map(t => {
      cumulative += (t.pnl || 0);
      return { time: t.date, value: parseFloat(cumulative.toFixed(2)) };
    });

    const uniqueData = [];
    const seen = new Set();
    data.forEach(d => {
      if (seen.has(d.time)) {
        uniqueData[uniqueData.length-1].value = d.value;
      } else {
        seen.add(d.time);
        uniqueData.push({ ...d });
      }
    });

    const series = chart.addAreaSeries({
      lineColor:   '#f59e0b',
      topColor:    'rgba(245,158,11,0.3)',
      bottomColor: 'rgba(245,158,11,0.02)',
      lineWidth:   2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    series.setData(uniqueData);
    chart.timeScale().fitContent();
    equityChart = chart;

    const ro = new ResizeObserver(() => {
      chart.resize(container.clientWidth, container.clientHeight);
    });
    ro.observe(container);
  }

  /* ── Daily P&L bar chart ── */
  function renderDailyChart(trades) {
    const container = document.getElementById('dailyPnlChart');
    if (!container) return;

    if (dailyChart) { dailyChart.remove(); dailyChart = null; }
    if (!trades.length || typeof LightweightCharts === 'undefined') {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px">No trades to display</div>';
      return;
    }

    const byDate = {};
    trades.forEach(t => {
      if (!t.date) return;
      byDate[t.date] = (byDate[t.date] || 0) + (t.pnl || 0);
    });

    const data = Object.entries(byDate)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([time, pnl]) => ({
        time,
        value: parseFloat(pnl.toFixed(2)),
        color: pnl >= 0 ? '#22c55e' : '#ef4444',
      }));

    container.innerHTML = '';
    const chart = LightweightCharts.createChart(container, {
      width:  container.clientWidth  || 400,
      height: container.clientHeight || 240,
      layout:      { background: { color: 'transparent' }, textColor: '#6b7280' },
      grid:        { vertLines: { color: '#2a2a2a' }, horzLines: { color: '#2a2a2a' } },
      rightPriceScale: { borderColor: '#2a2a2a' },
      timeScale:   { borderColor: '#2a2a2a' },
    });

    const series = chart.addHistogramSeries({
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    series.setData(data);
    chart.timeScale().fitContent();
    dailyChart = chart;

    const ro = new ResizeObserver(() => {
      chart.resize(container.clientWidth, container.clientHeight);
    });
    ro.observe(container);
  }

  /* ── P&L by Setup (horizontal bars) ── */
  function renderSetupChart(trades) {
    const el = document.getElementById('setupPnlChart');
    if (!el) return;

    const bySetup = {};
    trades.forEach(t => {
      if (!t.setup) return;
      if (!bySetup[t.setup]) bySetup[t.setup] = { pnl: 0, count: 0, wins: 0 };
      bySetup[t.setup].pnl   += (t.pnl || 0);
      bySetup[t.setup].count += 1;
      if ((t.pnl || 0) > 0) bySetup[t.setup].wins++;
    });

    const entries = Object.entries(bySetup).sort((a,b) => b[1].pnl - a[1].pnl);

    if (!entries.length) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:16px">No tagged trades yet — add setup tags to your trades.</div>';
      return;
    }

    const maxAbs = Math.max(...entries.map(([,v]) => Math.abs(v.pnl)));

    el.innerHTML = entries.map(([setup, v]) => {
      const pct    = maxAbs > 0 ? (Math.abs(v.pnl) / maxAbs * 100) : 0;
      const color  = v.pnl >= 0 ? 'var(--profit)' : 'var(--loss)';
      const wr     = Math.round(v.wins / v.count * 100);
      return `
        <div class="setup-bar-row">
          <div class="setup-bar-label" title="${setup}">${setup}</div>
          <div class="setup-bar-track">
            <div class="setup-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <div class="setup-bar-value" style="color:${color}">${fmt$(v.pnl)}</div>
          <div style="font-size:10px;color:var(--text-muted);min-width:60px;text-align:right">${wr}% WR</div>
        </div>
      `;
    }).join('');
  }

  /* ── Time-of-day heatmap ── */
  function renderToD(trades) {
    const el = document.getElementById('todHeatmap');
    if (!el) return;

    const HOURS = ['7','8','9','10','11','12','13','14','15','16'];
    const DAYS  = ['Mon','Tue','Wed','Thu','Fri'];
    const DAY_IDX = [1,2,3,4,5];

    const grid = {};
    DAYS.forEach(d => { grid[d] = {}; HOURS.forEach(h => { grid[d][h] = 0; }); });

    trades.forEach(t => {
      if (!t.date) return;
      const dt  = new Date(t.date + 'T12:00:00');
      const dow = dt.getDay();
      const dayName = DAYS[DAY_IDX.indexOf(dow)];
      if (!dayName) return;
      const hour = '10';
      grid[dayName][hour] = (grid[dayName][hour] || 0) + (t.pnl || 0);
    });

    const allVals  = DAYS.flatMap(d => HOURS.map(h => grid[d][h]));
    const maxAbsV  = Math.max(...allVals.map(Math.abs), 1);

    function cellColor(v) {
      const intensity = Math.min(Math.abs(v) / maxAbsV, 1);
      if (v === 0) return 'var(--bg-secondary)';
      if (v > 0) return `rgba(34,197,94,${(intensity * 0.7 + 0.1).toFixed(2)})`;
      return `rgba(239,68,68,${(intensity * 0.7 + 0.1).toFixed(2)})`;
    }

    el.innerHTML = `
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">P&L color by weekday — green/brighter = more profitable.</p>
      <div class="heatmap-grid" style="grid-template-columns: 60px repeat(${HOURS.length}, 1fr)">
        <div></div>
        ${HOURS.map(h => `<div class="heatmap-header">${h}:00</div>`).join('')}
        ${DAYS.map(d => `
          <div class="heatmap-label">${d}</div>
          ${HOURS.map(h => {
            const v = grid[d][h];
            const tip = v !== 0 ? fmt$(v) : '';
            return `<div class="heatmap-cell" style="background:${cellColor(v)}" title="${tip}"></div>`;
          }).join('')}
        `).join('')}
      </div>
    `;
  }

  /* ── Full render ── */
  function render() {
    const allTrades = DB.getTrades();
    const trades    = filterByPeriod(allTrades);

    const s = computeStats(trades);
    renderCards(s);
    renderEquityChart(trades);
    renderDailyChart(trades);
    renderSetupChart(trades);
    renderToD(trades);
  }

  /* ── Init ── */
  function init() {
    document.getElementById('statsPeriod')?.addEventListener('change', render);
  }

  document.addEventListener('DOMContentLoaded', init);
  window.Stats = { render };
})();
