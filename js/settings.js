/* ── Settings Tab — Goals, API Key, Notifications, Export/Import ── */

(function () {
  function getGoals() { return (DB.getConfig().goals || {}); }

  function saveGoals() {
    const config = DB.getConfig();
    config.goals = {
      dailyLossLimit: parseFloat(document.getElementById('goalLossLimit').value) || null,
      dailyTarget:    parseFloat(document.getElementById('goalDailyTarget').value) || null,
      maxTrades:      parseInt(document.getElementById('goalMaxTrades').value)   || null,
      weeklyTarget:   parseFloat(document.getElementById('goalWeeklyTarget').value) || null,
    };
    DB.set(DB_KEYS.config, config);
    toast('Goals saved', 'success');
    renderGoalProgress();
  }

  function saveApiKey() {
    const key    = document.getElementById('claudeApiKey').value.trim();
    const config = DB.getConfig();
    config.claudeApiKey = key;
    DB.set(DB_KEYS.config, config);
    toast(key ? 'API key saved — Coach AI is enabled' : 'API key cleared', key ? 'success' : 'info');
  }

  /* ── Load saved values into form ── */
  function loadSettings() {
    const config = DB.getConfig();
    const goals  = config.goals || {};

    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    set('goalLossLimit',    goals.dailyLossLimit);
    set('goalDailyTarget',  goals.dailyTarget);
    set('goalMaxTrades',    goals.maxTrades);
    set('goalWeeklyTarget', goals.weeklyTarget);

    if (config.claudeApiKey) {
      const el = document.getElementById('claudeApiKey');
      if (el) el.value = config.claudeApiKey;
    }

    renderGoalProgress();
    renderCsvConfig();
  }

  /* ── Goal progress bars ── */
  function renderGoalProgress() {
    const el = document.getElementById('goalProgress');
    if (!el) return;

    const goals   = getGoals();
    const trades  = DB.getTrades().filter(t => t.date === todayStr());
    const todayPnl = trades.reduce((s,t)=>s+(t.pnl||0),0);

    const tradesThisWeek = (() => {
      const now = new Date();
      const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1);
      const ws  = mon.toISOString().slice(0,10);
      return DB.getTrades().filter(t => t.date >= ws);
    })();
    const weekPnl = tradesThisWeek.reduce((s,t)=>s+(t.pnl||0),0);

    const rows = [];

    if (goals.dailyLossLimit) {
      const pct = Math.min(Math.abs(todayPnl) / goals.dailyLossLimit * 100, 100);
      const hit = todayPnl <= -Math.abs(goals.dailyLossLimit);
      rows.push({
        label: 'Daily Loss Limit',
        sub: `${fmt$(todayPnl)} / ${fmt$(-Math.abs(goals.dailyLossLimit))}`,
        pct, color: hit ? 'var(--loss)' : pct > 70 ? '#f59e0b' : 'var(--profit)',
        alert: hit ? '🛑 LIMIT HIT — stop trading' : '',
      });
    }

    if (goals.dailyTarget) {
      const pct = Math.min(Math.max(todayPnl,0) / goals.dailyTarget * 100, 100);
      rows.push({
        label: 'Daily Target',
        sub: `${fmt$(Math.max(todayPnl,0))} / ${fmt$(goals.dailyTarget)}`,
        pct, color: 'var(--profit)',
        alert: pct >= 100 ? '✅ Target hit — consider stopping' : '',
      });
    }

    if (goals.maxTrades) {
      const pct = Math.min(trades.length / goals.maxTrades * 100, 100);
      rows.push({
        label: 'Daily Trade Count',
        sub: `${trades.length} / ${goals.maxTrades} trades`,
        pct, color: pct >= 100 ? 'var(--loss)' : 'var(--accent)',
        alert: pct >= 100 ? '🛑 Max trades reached — no more entries today' : '',
      });
    }

    if (goals.weeklyTarget) {
      const pct = Math.min(Math.max(weekPnl,0) / goals.weeklyTarget * 100, 100);
      rows.push({
        label: 'Weekly Target',
        sub: `${fmt$(Math.max(weekPnl,0))} / ${fmt$(goals.weeklyTarget)}`,
        pct, color: 'var(--profit)',
        alert: pct >= 100 ? '✅ Weekly target hit!' : '',
      });
    }

    if (!rows.length) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Set your goals above to see progress tracking here.</div>';
      return;
    }

    el.innerHTML = rows.map(r => `
      <div class="goal-row">
        <div class="goal-row-header">
          <span class="goal-label">${r.label}</span>
          <span class="goal-sub">${r.sub}</span>
        </div>
        <div class="goal-track">
          <div class="goal-fill" style="width:${r.pct}%;background:${r.color}"></div>
        </div>
        ${r.alert ? `<div class="goal-alert">${r.alert}</div>` : ''}
      </div>
    `).join('');
  }

  /* ── CSV config display ── */
  function renderCsvConfig() {
    const el = document.getElementById('csvConfigDisplay');
    if (!el) return;
    const config = DB.getConfig();
    const map    = config.csvColumnMap || {};
    if (!Object.keys(map).length) {
      el.innerHTML = '<span style="color:var(--text-muted)">No CSV mapping saved yet — import a CSV in the Trade Log to configure.</span>';
      return;
    }
    const fields = { date:'Date', ticker:'Ticker', side:'Side', entry:'Entry', exit:'Exit', size:'Size', pnl:'P&L' };
    el.innerHTML = Object.entries(map).map(([k,v]) =>
      `<div class="csv-config-row"><span>${fields[k]||k}</span><span class="accent">→ column ${v}</span></div>`
    ).join('');
  }

  /* ── Export / Import ── */
  function exportData() {
    const data = {
      journal:  DB.getJournal(),
      trades:   DB.getTrades(),
      bestOpps: DB.getBestOpps(),
      patterns: DB.getPatterns(),
      rules:    DB.getRules(),
      config:   DB.getConfig(),
      exported: new Date().toISOString(),
      version:  '1.0',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `tradervue-${todayStr()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('Backup exported', 'success');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.trades)   DB.set(DB_KEYS.trades,   data.trades);
        if (data.journal)  DB.set(DB_KEYS.journal,  data.journal);
        if (data.bestOpps) DB.set(DB_KEYS.bestOpps, data.bestOpps);
        if (data.patterns) DB.set(DB_KEYS.patterns, data.patterns);
        if (data.rules)    DB.set(DB_KEYS.rules,    data.rules);
        if (data.config)   DB.set(DB_KEYS.config,   data.config);
        toast('Data restored from backup. Refresh the page.', 'success', 5000);
        loadSettings();
      } catch {
        toast('Invalid backup file', 'error');
      }
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!confirm('Delete ALL data (trades, journal, patterns, opps)? This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure? Type OK to confirm.')) return;
    Object.values(DB_KEYS).forEach(k => localStorage.removeItem(k));
    toast('All data cleared. Reload the page.', 'info', 5000);
  }

  /* ── Render the settings tab ── */
  function render() {
    loadSettings();
    renderGoalProgress();
  }

  /* ── Init ── */
  function init() {
    document.getElementById('saveGoalsBtn')?.addEventListener('click', saveGoals);
    document.getElementById('saveApiKeyBtn')?.addEventListener('click', saveApiKey);

    document.getElementById('exportDataBtn')?.addEventListener('click', exportData);
    document.getElementById('importDataInput')?.addEventListener('change', function () {
      if (this.files[0]) importData(this.files[0]);
    });
    document.getElementById('importDataBtn')?.addEventListener('click', () => {
      document.getElementById('importDataInput').click();
    });
    document.getElementById('clearDataBtn')?.addEventListener('click', clearAllData);

    document.getElementById('resetCsvBtn')?.addEventListener('click', () => {
      const config = DB.getConfig();
      delete config.csvColumnMap;
      DB.set(DB_KEYS.config, config);
      renderCsvConfig();
      toast('CSV mapping cleared — next import will ask to re-map', 'info');
    });

    document.getElementById('manualMorningRitualBtn')?.addEventListener('click', () => window.Ritual?.openMorning());
    document.getElementById('manualEveningRitualBtn')?.addEventListener('click', () => window.Ritual?.openEvening());

    document.getElementById('notifTestBtn')?.addEventListener('click', async () => {
      if (!('Notification' in window)) { toast('Browser notifications not supported', 'error'); return; }
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        new Notification('TraderVue', { body: '✅ Notifications working — kill zone reminders are active.' });
        toast('Test notification sent', 'success');
      } else {
        toast('Notification permission denied', 'error');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  window.Settings = { render };
})();
