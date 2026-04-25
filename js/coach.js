/* ── Coach Tab — AI Insights + Claude API Chat ── */

(function () {
  let chatHistory = [];

  /* ── Rule-based insights from trade data ── */
  function generateInsights(trades) {
    const insights = [];
    if (!trades.length) return insights;

    const wins   = trades.filter(t => (t.pnl||0) > 0);
    const losses = trades.filter(t => (t.pnl||0) < 0);
    const wr     = wins.length / trades.length;

    // Win rate
    if (wr >= 0.65) insights.push({ type: 'positive', icon: '📈', title: 'Strong Win Rate', body: `${Math.round(wr*100)}% — your process is working. Focus on increasing size on your A+ setups.` });
    else if (wr < 0.40) insights.push({ type: 'warning', icon: '⚠️', title: 'Win Rate Below 40%', body: `${Math.round(wr*100)}% — consider tightening your entry criteria or reducing setup diversity.` });

    // Best setup by P&L
    const bySetup = {};
    trades.forEach(t => {
      if (!t.setup) return;
      if (!bySetup[t.setup]) bySetup[t.setup] = { pnl: 0, count: 0, wins: 0 };
      bySetup[t.setup].pnl   += (t.pnl||0);
      bySetup[t.setup].count++;
      if ((t.pnl||0) > 0) bySetup[t.setup].wins++;
    });
    const setupEntries = Object.entries(bySetup);
    if (setupEntries.length) {
      const best  = setupEntries.sort((a,b) => b[1].pnl - a[1].pnl)[0];
      const worst = setupEntries.sort((a,b) => a[1].pnl - b[1].pnl)[0];
      insights.push({ type: 'positive', icon: '🎯', title: `Best Setup: ${best[0]}`, body: `${fmt$(best[1].pnl)} total, ${Math.round(best[1].wins/best[1].count*100)}% WR across ${best[1].count} trades. Double down here.` });
      if (worst[1].pnl < 0) insights.push({ type: 'negative', icon: '🔴', title: `Leaking on: ${worst[0]}`, body: `${fmt$(worst[1].pnl)} total P&L on this setup. Consider cutting it or paper-trading until the edge is clearer.` });
    }

    // Average R
    const rTrades = trades.filter(t => t.r != null);
    if (rTrades.length >= 5) {
      const avgR = rTrades.reduce((s,t)=>s+t.r,0) / rTrades.length;
      if (avgR < 0.5) insights.push({ type: 'warning', icon: '📐', title: 'Low Avg R', body: `${avgR.toFixed(2)}R average. Your stops may be too wide or your targets too conservative. Aim for 1R+ on winners.` });
      else if (avgR > 2) insights.push({ type: 'positive', icon: '🏆', title: `Excellent R: ${avgR.toFixed(2)}R avg`, body: `You are letting winners run. This is where sustainable accounts are built.` });
    }

    // Revenge trading pattern (multiple losses same day)
    const byDate = {};
    trades.forEach(t => { if (!t.date) return; byDate[t.date] = byDate[t.date] || []; byDate[t.date].push(t); });
    const revengeDays = Object.values(byDate).filter(dayTrades => {
      let consecutive = 0; let maxConsec = 0;
      dayTrades.sort((a,b)=>a.id.localeCompare(b.id)).forEach(t => {
        if ((t.pnl||0) < 0) { consecutive++; maxConsec = Math.max(maxConsec, consecutive); }
        else consecutive = 0;
      });
      return maxConsec >= 3;
    });
    if (revengeDays.length) insights.push({ type: 'warning', icon: '🎰', title: 'Revenge Trading Detected', body: `${revengeDays.length} day(s) with 3+ consecutive losses. Consider a hard stop after 2 losses.` });

    // Profit factor
    const grossW = wins.reduce((s,t)=>s+(t.pnl||0),0);
    const grossL = Math.abs(losses.reduce((s,t)=>s+(t.pnl||0),0));
    const pf = grossL > 0 ? grossW/grossL : null;
    if (pf !== null && pf < 1.0) insights.push({ type: 'negative', icon: '💸', title: 'Profit Factor Below 1.0', body: `${pf.toFixed(2)}PF — you are losing more than you make. Every trade needs edge. Stop trading setups you can't defend.` });
    else if (pf !== null && pf > 2.0) insights.push({ type: 'positive', icon: '💰', title: `Profit Factor: ${pf.toFixed(2)}`, body: `Elite level. Keep doing what you're doing — focus on consistency and position sizing.` });

    // Consistency (daily P&L variance)
    const dailyPnls = Object.values(byDate).map(d => d.reduce((s,t)=>s+(t.pnl||0),0));
    if (dailyPnls.length >= 5) {
      const avg = dailyPnls.reduce((s,v)=>s+v,0)/dailyPnls.length;
      const std = Math.sqrt(dailyPnls.reduce((s,v)=>s+Math.pow(v-avg,2),0)/dailyPnls.length);
      if (std > Math.abs(avg) * 3 && std > 200) {
        insights.push({ type: 'warning', icon: '📊', title: 'High P&L Volatility', body: `Your daily results are inconsistent (σ ${fmt$(std)}). This often signals random sizing or chasing. Pick a max size and stick to it.` });
      }
    }

    // Goals check
    const config = DB.getConfig();
    const goals  = config.goals || {};
    if (goals.dailyLossLimit) {
      const todayPnl = (byDate[todayStr()] || []).reduce((s,t)=>s+(t.pnl||0),0);
      if (todayPnl < -Math.abs(goals.dailyLossLimit)) {
        insights.unshift({ type: 'alert', icon: '🛑', title: 'DAILY LOSS LIMIT HIT', body: `You are down ${fmt$(todayPnl)} today vs your limit of ${fmt$(-Math.abs(goals.dailyLossLimit))}. Step away now.` });
      }
    }

    return insights;
  }

  /* ── Render insights panel ── */
  function renderInsights() {
    const trades   = DB.getTrades();
    const insights = generateInsights(trades);
    const el       = document.getElementById('coachInsights');
    if (!el) return;

    if (!insights.length) {
      el.innerHTML = '<div class="coach-empty">Log at least 5 trades to unlock coach insights.</div>';
      return;
    }

    el.innerHTML = insights.map(i => `
      <div class="insight-card insight-${i.type}">
        <div class="insight-icon">${i.icon}</div>
        <div>
          <div class="insight-title">${i.title}</div>
          <div class="insight-body">${i.body}</div>
        </div>
      </div>
    `).join('');
  }

  /* ── Weekly summary ── */
  function renderWeeklySummary() {
    const el = document.getElementById('coachWeekly');
    if (!el) return;

    const trades = DB.getTrades();
    const now    = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - now.getDay() + 1);
    const weekStart = monday.toISOString().slice(0,10);

    const weekTrades = trades.filter(t => t.date >= weekStart);
    if (!weekTrades.length) { el.innerHTML = '<div class="coach-empty">No trades logged this week yet.</div>'; return; }

    const pnl  = weekTrades.reduce((s,t)=>s+(t.pnl||0),0);
    const wins = weekTrades.filter(t=>(t.pnl||0)>0).length;
    const wr   = Math.round(wins/weekTrades.length*100);

    const journal = DB.getJournal();
    const scores  = Object.values(journal)
      .filter(e => e.updatedAt >= weekStart)
      .map(e => e.mindset)
      .filter(Boolean);
    const avgMindset = scores.length ? (scores.reduce((s,v)=>s+v,0)/scores.length).toFixed(1) : '—';

    const setupMap = {};
    weekTrades.forEach(t => { if(t.setup) setupMap[t.setup] = (setupMap[t.setup]||0)+1; });
    const topSetup = Object.entries(setupMap).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';

    el.innerHTML = `
      <div class="weekly-grid">
        <div class="weekly-stat"><div class="weekly-label">This Week P&L</div><div class="weekly-value ${pnlClass(pnl)}">${fmt$(pnl)}</div></div>
        <div class="weekly-stat"><div class="weekly-label">Trades</div><div class="weekly-value">${weekTrades.length}</div></div>
        <div class="weekly-stat"><div class="weekly-label">Win Rate</div><div class="weekly-value">${wr}%</div></div>
        <div class="weekly-stat"><div class="weekly-label">Avg Mindset</div><div class="weekly-value accent">${avgMindset}/10</div></div>
        <div class="weekly-stat"><div class="weekly-label">Top Setup</div><div class="weekly-value" style="font-size:14px">${topSetup}</div></div>
      </div>
    `;
  }

  /* ── Claude AI Chat ── */
  async function sendChat() {
    const input = document.getElementById('coachInput');
    const msg   = input?.value.trim();
    if (!msg) return;

    const config = DB.getConfig();
    const apiKey = config.claudeApiKey || '';
    if (!apiKey) {
      appendMessage('coach', "Add your Anthropic API key in Settings to enable AI coaching.");
      return;
    }

    input.value = '';
    appendMessage('user', msg);
    chatHistory.push({ role: 'user', content: msg });

    const trades   = DB.getTrades().slice(-50);
    const journal  = DB.getJournal();
    const goals    = config.goals || {};

    const systemPrompt = `You are a professional trading coach reviewing the user's personal trading dashboard data. Be direct, specific, and honest — this is not motivational speaking, it's performance analysis.

CURRENT TRADE DATA SUMMARY:
- Total trades: ${trades.length}
- Win rate: ${trades.length ? Math.round(trades.filter(t=>(t.pnl||0)>0).length/trades.length*100) : 0}%
- Total P&L: ${fmt$(trades.reduce((s,t)=>s+(t.pnl||0),0))}
- Setups used: ${[...new Set(trades.map(t=>t.setup).filter(Boolean))].join(', ') || 'none tagged yet'}
- Recent trades (last 10): ${JSON.stringify(trades.slice(-10).map(t=>({date:t.date,ticker:t.ticker,side:t.side,pnl:t.pnl,r:t.r,setup:t.setup})))}

GOALS: daily loss limit ${goals.dailyLossLimit ? fmt$(goals.dailyLossLimit) : 'not set'}, daily target ${goals.dailyTarget ? fmt$(goals.dailyTarget) : 'not set'}

USER TRADES ICT / KITT ICT concepts. Provide specific, actionable feedback. Keep responses under 150 words unless a deeper analysis is explicitly requested. Never be vague.`;

    const loadingId = appendMessage('coach', '...', true);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 400,
          system:     systemPrompt,
          messages:   chatHistory.slice(-10),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || res.statusText);

      const reply = data.content?.[0]?.text || '(no response)';
      chatHistory.push({ role: 'assistant', content: reply });
      updateMessage(loadingId, reply);
    } catch (err) {
      updateMessage(loadingId, `Error: ${err.message}`);
    }
  }

  function appendMessage(role, text, isLoading = false) {
    const log = document.getElementById('coachChatLog');
    if (!log) return null;
    const id  = 'msg-' + genId();
    const div = document.createElement('div');
    div.id        = id;
    div.className = `chat-msg chat-${role}${isLoading ? ' chat-loading' : ''}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return id;
  }

  function updateMessage(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('chat-loading');
  }

  /* ── Performance heatmap by day-of-week ── */
  function renderDowChart() {
    const el = document.getElementById('coachDowChart');
    if (!el) return;

    const trades = DB.getTrades();
    const days   = ['Mon','Tue','Wed','Thu','Fri'];
    const dayMap = { 1:'Mon',2:'Tue',3:'Wed',4:'Thu',5:'Fri' };

    const stats = {};
    days.forEach(d => { stats[d] = { pnl: 0, count: 0, wins: 0 }; });
    trades.forEach(t => {
      if (!t.date) return;
      const dow = new Date(t.date + 'T12:00:00').getDay();
      const d   = dayMap[dow];
      if (!d) return;
      stats[d].pnl   += (t.pnl||0);
      stats[d].count++;
      if ((t.pnl||0) > 0) stats[d].wins++;
    });

    el.innerHTML = days.map(d => {
      const s   = stats[d];
      const wr  = s.count ? Math.round(s.wins/s.count*100) : null;
      const cls = pnlClass(s.pnl);
      return `
        <div class="dow-col">
          <div class="dow-label">${d}</div>
          <div class="dow-pnl ${cls}">${s.count ? fmt$(s.pnl) : '—'}</div>
          <div class="dow-wr">${wr !== null ? wr+'% WR' : '—'}</div>
          <div class="dow-count">${s.count} trades</div>
        </div>
      `;
    }).join('');
  }

  /* ── Full render ── */
  function render() {
    renderInsights();
    renderWeeklySummary();
    renderDowChart();
  }

  /* ── Init ── */
  function init() {
    document.getElementById('coachSendBtn')?.addEventListener('click', sendChat);
    document.getElementById('coachInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  window.Coach = { render };
})();
