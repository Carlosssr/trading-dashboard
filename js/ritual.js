/* ── Daily Ritual System — Morning + Evening auto-prompts, browser notifications ── */

(function () {
  const RITUAL_KEY       = 'tv_ritual_done';
  const EVENING_KEY      = 'tv_evening_done';
  const NOTIF_PERM_KEY   = 'tv_notif_asked';

  const MORNING_CHECKLIST = [
    'Check overnight levels and gap',
    'Mark BSL and SSL on SPY/QQQ',
    'Note today\'s expected AMD direction',
    'Review any earnings or macro events',
    'Set daily loss limit and target',
    'Mental state check — ready to wait patiently?',
    'Only trade A+ setups in kill zones',
  ];

  const EVENING_CHECKLIST = [
    'Log all trades in Trade Log',
    'Review best missed play today',
    'Record EOD reflection in Journal',
    'Screenshot top setups for Pattern Library',
    'Note tomorrow\'s pre-market focus',
    'Rate today\'s discipline score (1-10)',
  ];

  /* ── Check if ritual was done today ── */
  function isDoneToday(key) {
    const v = localStorage.getItem(key);
    return v === todayStr();
  }

  function markDone(key) {
    localStorage.setItem(key, todayStr());
  }

  /* ── Auto-trigger logic ── */
  function checkAutoTrigger() {
    const now  = new Date();
    const hour = now.getHours();
    const min  = now.getMinutes();

    // Morning: 7:00–9:30 AM, not yet done
    if (hour >= 7 && (hour < 9 || (hour === 9 && min < 30))) {
      if (!isDoneToday(RITUAL_KEY)) {
        openMorningRitual();
        return;
      }
    }

    // Evening: 3:45–4:30 PM, not yet done
    if ((hour === 15 && min >= 45) || hour === 16) {
      if (!isDoneToday(EVENING_KEY)) {
        openEveningRitual();
        return;
      }
    }
  }

  /* ── Morning ritual modal ── */
  function openMorningRitual() {
    const modal = document.getElementById('ritualModal');
    if (!modal) return;

    document.getElementById('ritualTitle').textContent    = '🌅 Morning Ritual';
    document.getElementById('ritualSubtitle').textContent = 'Complete your pre-market routine before the open.';

    const journal = DB.getJournal();
    const today   = journal[todayStr()] || {};
    const config  = DB.getConfig();
    const goals   = config.goals || {};

    document.getElementById('ritualBody').innerHTML = `
      <div class="ritual-section">
        <div class="ritual-section-title">Today's Goals</div>
        <div class="ritual-goals-row">
          <div class="ritual-goal">
            <span class="ritual-goal-label">Loss Limit</span>
            <span class="ritual-goal-value loss">${goals.dailyLossLimit ? fmt$(-Math.abs(goals.dailyLossLimit)) : 'Not set'}</span>
          </div>
          <div class="ritual-goal">
            <span class="ritual-goal-label">Daily Target</span>
            <span class="ritual-goal-value profit">${goals.dailyTarget ? fmt$(goals.dailyTarget) : 'Not set'}</span>
          </div>
          <div class="ritual-goal">
            <span class="ritual-goal-label">Max Trades</span>
            <span class="ritual-goal-value">${goals.maxTrades || '—'}</span>
          </div>
        </div>
      </div>

      <div class="ritual-section">
        <div class="ritual-section-title">Mindset Check</div>
        <div class="score-row" style="margin-bottom:8px">
          <input type="range" class="score-slider" id="ritualMindset" min="1" max="10" value="${today.mindset || 7}" />
          <span class="score-display" id="ritualMindsetDisplay">${today.mindset || 7}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted)">Below 6? Consider paper trading or reduced size today.</div>
      </div>

      <div class="ritual-section">
        <div class="ritual-section-title">Pre-Market Checklist</div>
        <ul class="ritual-checklist" id="morningChecklist">
          ${MORNING_CHECKLIST.map((item, i) => `
            <li class="ritual-check-item">
              <input type="checkbox" class="rule-checkbox" id="mc-${i}" />
              <label for="mc-${i}" class="rule-text">${item}</label>
            </li>
          `).join('')}
        </ul>
      </div>

      <div class="ritual-section">
        <div class="ritual-section-title">Today's Market Focus</div>
        <textarea class="textarea" id="ritualFocus" rows="3" placeholder="What's the plan? Bias, key levels, target setups for today's kill zones...">${today.biasNotes || ''}</textarea>
      </div>
    `;

    document.getElementById('ritualMindset')?.addEventListener('input', function () {
      document.getElementById('ritualMindsetDisplay').textContent = this.value;
    });

    document.getElementById('ritualCompleteBtn').onclick = completeMorningRitual;
    document.getElementById('ritualSkipBtn').onclick = () => {
      markDone(RITUAL_KEY);
      closeModal('ritualModal');
    };

    modal.classList.remove('hidden');
  }

  function completeMorningRitual() {
    const focus   = document.getElementById('ritualFocus')?.value.trim();
    const mindset = Number(document.getElementById('ritualMindset')?.value || 7);
    const checked = [...document.querySelectorAll('#morningChecklist .rule-checkbox')]
      .filter(c => c.checked).length;
    const total   = MORNING_CHECKLIST.length;

    if (focus) {
      const journal = DB.getJournal();
      journal[todayStr()] = {
        ...(journal[todayStr()] || {}),
        biasNotes: focus,
        mindset,
        updatedAt: new Date().toISOString(),
      };
      DB.set(DB_KEYS.journal, journal);
    }

    markDone(RITUAL_KEY);
    closeModal('ritualModal');
    toast(`Morning ritual complete — ${checked}/${total} items checked. Good trading.`, 'success', 4000);
  }

  /* ── Evening ritual modal ── */
  function openEveningRitual() {
    const modal = document.getElementById('ritualModal');
    if (!modal) return;

    const trades  = DB.getTrades().filter(t => t.date === todayStr());
    const todayPnl = trades.reduce((s,t)=>s+(t.pnl||0),0);

    document.getElementById('ritualTitle').textContent    = '🌆 Evening Ritual';
    document.getElementById('ritualSubtitle').textContent = 'Close out the session properly. This is where growth happens.';

    document.getElementById('ritualBody').innerHTML = `
      <div class="ritual-section">
        <div class="ritual-section-title">Today's Session</div>
        <div class="ritual-goals-row">
          <div class="ritual-goal">
            <span class="ritual-goal-label">Today P&L</span>
            <span class="ritual-goal-value ${pnlClass(todayPnl)}">${fmt$(todayPnl)}</span>
          </div>
          <div class="ritual-goal">
            <span class="ritual-goal-label">Trades Taken</span>
            <span class="ritual-goal-value">${trades.length}</span>
          </div>
          <div class="ritual-goal">
            <span class="ritual-goal-label">Win Rate</span>
            <span class="ritual-goal-value">${trades.length ? Math.round(trades.filter(t=>(t.pnl||0)>0).length/trades.length*100)+'%' : '—'}</span>
          </div>
        </div>
      </div>

      <div class="ritual-section">
        <div class="ritual-section-title">EOD Checklist</div>
        <ul class="ritual-checklist" id="eveningChecklist">
          ${EVENING_CHECKLIST.map((item, i) => `
            <li class="ritual-check-item">
              <input type="checkbox" class="rule-checkbox" id="ec-${i}" />
              <label for="ec-${i}" class="rule-text">${item}</label>
            </li>
          `).join('')}
        </ul>
      </div>

      <div class="ritual-section">
        <div class="ritual-section-title">Key Lesson Today</div>
        <textarea class="textarea" id="ritualLesson" rows="3" placeholder="One thing you learned or will do differently tomorrow..."></textarea>
      </div>
    `;

    document.getElementById('ritualCompleteBtn').onclick = completeEveningRitual;
    document.getElementById('ritualSkipBtn').onclick = () => {
      markDone(EVENING_KEY);
      closeModal('ritualModal');
    };

    modal.classList.remove('hidden');
  }

  function completeEveningRitual() {
    const lesson = document.getElementById('ritualLesson')?.value.trim();
    if (lesson) {
      const journal = DB.getJournal();
      journal[todayStr()] = {
        ...(journal[todayStr()] || {}),
        lesson,
        updatedAt: new Date().toISOString(),
      };
      DB.set(DB_KEYS.journal, journal);
    }
    markDone(EVENING_KEY);
    closeModal('ritualModal');
    toast('Evening ritual complete. See you tomorrow.', 'success', 4000);
  }

  /* ── Browser notifications ── */
  async function requestNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return;
    if (localStorage.getItem(NOTIF_PERM_KEY)) return;

    localStorage.setItem(NOTIF_PERM_KEY, '1');
    const perm = await Notification.requestPermission();
    if (perm === 'granted') toast('Notifications enabled — you\'ll get kill zone reminders.', 'success');
  }

  function scheduleNotifications() {
    if (Notification.permission !== 'granted') return;

    const REMINDERS = [
      { hour: 7,  min: 0,  msg: '🌅 Pre-market ritual — open TraderVue and plan the session.' },
      { hour: 9,  min: 55, msg: '⚡ NY AM Kill Zone opens in 5 minutes — is your plan locked?' },
      { hour: 10, min: 0,  msg: '🎯 Silver Bullet AM window opens NOW (10:00–11:00 AM EST).' },
      { hour: 14, min: 0,  msg: '🎯 Silver Bullet PM window opens NOW (2:00–3:00 PM EST).' },
      { hour: 15, min: 45, msg: '🌆 Evening ritual time — log your trades and close out properly.' },
    ];

    function checkReminders() {
      const now = new Date();
      const h   = now.getHours();
      const m   = now.getMinutes();
      REMINDERS.forEach(r => {
        if (h === r.hour && m === r.min) {
          const sentKey = `tv_notif_sent_${r.hour}_${r.min}_${todayStr()}`;
          if (!localStorage.getItem(sentKey)) {
            new Notification('TraderVue', { body: r.msg, icon: '' });
            localStorage.setItem(sentKey, '1');
          }
        }
      });
    }

    setInterval(checkReminders, 60000);
    checkReminders();
  }

  /* ── Expose manual triggers for Settings buttons ── */
  window.Ritual = {
    openMorning: openMorningRitual,
    openEvening: openEveningRitual,
    isDoneToday,
    RITUAL_KEY,
    EVENING_KEY,
  };

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', () => {
    // Auto-trigger after 3s delay (let the app finish rendering)
    setTimeout(checkAutoTrigger, 3000);

    // Check every 5 minutes for the evening trigger
    setInterval(checkAutoTrigger, 5 * 60 * 1000);

    // Request notifications after 10s
    setTimeout(requestNotifications, 10000);
    setTimeout(scheduleNotifications, 1000);
  });
})();
