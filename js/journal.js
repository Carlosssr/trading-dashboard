/* ── Daily Journal Tab ── */

(function () {
  let currentImages = [];
  let defaultRules = [
    'Trade only in kill zones',
    'Wait for liquidity sweep before entry',
    'Confirm MSS before entering',
    'Risk no more than 1R per trade',
    'No revenge trading after 2 losses',
    'Log every trade in real time',
  ];

  function getDate() {
    return document.getElementById('journalDate').value || todayStr();
  }

  function loadEntry(dateStr) {
    const journal = DB.getJournal();
    const entry   = journal[dateStr] || {};

    // Bias
    document.querySelectorAll('.bias-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bias === (entry.bias || ''));
    });

    // Mindset score
    const score = entry.mindset || 7;
    document.getElementById('mindsetScore').value   = score;
    document.getElementById('mindsetDisplay').textContent = score;

    // Emotion tags
    document.querySelectorAll('#emotionTags .tag-btn').forEach(btn => {
      btn.classList.toggle('active', (entry.emotionTags || []).includes(btn.dataset.tag));
    });

    // Notes
    document.getElementById('journalBiasNotes').value  = entry.biasNotes  || '';
    document.getElementById('journalWorked').value     = entry.worked     || '';
    document.getElementById('journalImprove').value    = entry.improve    || '';
    document.getElementById('journalLesson').value     = entry.lesson     || '';

    // Images
    currentImages = entry.images || [];
    renderImagePreviews('journalImageGrid', currentImages, removeImage);

    // Rules
    renderRules(entry.rules ?? null);
  }

  function removeImage(i) {
    currentImages.splice(i, 1);
    renderImagePreviews('journalImageGrid', currentImages, removeImage);
  }

  function saveEntry() {
    const dateStr = getDate();
    const journal = DB.getJournal();

    const selectedBias = document.querySelector('.bias-btn.active')?.dataset.bias || '';
    const selectedTags = [...document.querySelectorAll('#emotionTags .tag-btn.active')]
      .map(b => b.dataset.tag);
    const checkedRules = [...document.querySelectorAll('#rulesList .rule-item')].map(li => ({
      text:    li.querySelector('.rule-text').textContent,
      checked: li.querySelector('.rule-checkbox').checked,
    }));

    journal[dateStr] = {
      bias:        selectedBias,
      biasNotes:   document.getElementById('journalBiasNotes').value,
      mindset:     Number(document.getElementById('mindsetScore').value),
      emotionTags: selectedTags,
      rules:       checkedRules,
      worked:      document.getElementById('journalWorked').value,
      improve:     document.getElementById('journalImprove').value,
      lesson:      document.getElementById('journalLesson').value,
      images:      currentImages,
      updatedAt:   new Date().toISOString(),
    };

    DB.set(DB_KEYS.journal, journal);
    toast('Journal entry saved', 'success');
    renderPastEntries();
  }

  /* ── Rules ── */
  function getRulesForDate(overrideRules) {
    if (overrideRules !== null && overrideRules !== undefined) return overrideRules;
    const stored = DB.getRules();
    return (stored.length ? stored : defaultRules).map(r => ({
      text:    typeof r === 'string' ? r : r.text,
      checked: typeof r === 'object' ? r.checked : false,
    }));
  }

  function renderRules(overrideRules) {
    const list  = document.getElementById('rulesList');
    const rules = getRulesForDate(overrideRules);
    list.innerHTML = '';

    rules.forEach((rule, i) => {
      const text    = typeof rule === 'string' ? rule : rule.text;
      const checked = typeof rule === 'object' ? rule.checked : false;

      const li = document.createElement('li');
      li.className = 'rule-item';
      li.innerHTML = `
        <input type="checkbox" class="rule-checkbox" ${checked ? 'checked' : ''} data-index="${i}" />
        <span class="rule-text ${checked ? 'checked' : ''}">${escHtml(text)}</span>
        <button class="rule-delete" data-index="${i}" title="Remove rule">✕</button>
      `;
      li.querySelector('.rule-checkbox').addEventListener('change', function () {
        li.querySelector('.rule-text').classList.toggle('checked', this.checked);
      });
      li.querySelector('.rule-delete').addEventListener('click', function () {
        deleteRule(i);
      });
      list.appendChild(li);
    });
  }

  function deleteRule(index) {
    const stored = DB.getRules();
    const rules  = stored.length ? stored : defaultRules.map(r => ({ text: r, checked: false }));
    rules.splice(index, 1);
    DB.set(DB_KEYS.rules, rules);
    renderRules(null);
  }

  function addRule(text) {
    if (!text.trim()) return;
    const stored = DB.getRules();
    const rules  = stored.length ? stored : defaultRules.map(r => ({ text: r, checked: false }));
    rules.push({ text: text.trim(), checked: false });
    DB.set(DB_KEYS.rules, rules);
    renderRules(null);
  }

  /* ── Past entries list ── */
  function renderPastEntries() {
    const journal = DB.getJournal();
    const list    = document.getElementById('journalEntriesList');
    const dates   = Object.keys(journal).sort().reverse();

    if (!dates.length) {
      list.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">No entries yet.</p>';
      return;
    }

    list.innerHTML = dates.map(d => {
      const e = journal[d];
      const bias = e.bias ? `<span class="badge badge-${e.bias === 'bullish' ? 'ict-time' : e.bias === 'bearish' ? 'kitt' : 'custom'}">${e.bias}</span>` : '';
      const preview = e.biasNotes?.slice(0, 80) || e.lesson?.slice(0, 80) || 'No notes';
      const score = e.mindset ? `<span class="accent" style="font-size:12px;font-weight:700">${e.mindset}/10</span>` : '';
      return `
        <div class="journal-entry-card" data-date="${d}">
          <div class="journal-entry-header">
            <span class="journal-entry-date">${formatDisplayDate(d)}</span>
            <div style="display:flex;gap:8px;align-items:center">${score}${bias}</div>
          </div>
          <div class="journal-entry-preview">${escHtml(preview)}</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.journal-entry-card').forEach(card => {
      card.addEventListener('click', () => {
        document.getElementById('journalDate').value = card.dataset.date;
        loadEntry(card.dataset.date);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function formatDisplayDate(str) {
    const [y, m, d] = str.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[Number(m)-1]} ${Number(d)}, ${y}`;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Init ── */
  function init() {
    // Date picker — default today
    const datePicker = document.getElementById('journalDate');
    datePicker.value = todayStr();
    datePicker.addEventListener('change', () => loadEntry(getDate()));

    // Save button
    document.getElementById('journalSaveBtn')?.addEventListener('click', saveEntry);

    // Bias buttons
    document.querySelectorAll('.bias-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        document.querySelectorAll('.bias-btn').forEach(b => b.classList.remove('active'));
        if (!wasActive) btn.classList.add('active');
      });
    });

    // Mindset slider
    const slider  = document.getElementById('mindsetScore');
    const display = document.getElementById('mindsetDisplay');
    slider?.addEventListener('input', () => { display.textContent = slider.value; });

    // Emotion tags
    document.querySelectorAll('#emotionTags .tag-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });

    // Add rule button
    document.getElementById('addRuleBtn')?.addEventListener('click', () => {
      document.getElementById('addRuleForm').classList.toggle('hidden');
      document.getElementById('newRuleInput')?.focus();
    });

    document.getElementById('saveRuleBtn')?.addEventListener('click', () => {
      const input = document.getElementById('newRuleInput');
      addRule(input.value);
      input.value = '';
      document.getElementById('addRuleForm').classList.add('hidden');
    });

    document.getElementById('newRuleInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('saveRuleBtn').click();
    });

    // Image upload
    wireImageUpload(
      'journalImageZone', 'journalImageInput',
      () => currentImages,
      imgs => { currentImages = imgs; },
      'journalImageGrid'
    );
    // Re-wire remove with correct reference
    document.getElementById('journalImageInput')?.addEventListener('change', async function () {
      for (const f of Array.from(this.files)) {
        const b64 = await fileToBase64(f);
        currentImages.push(b64);
      }
      renderImagePreviews('journalImageGrid', currentImages, removeImage);
    });

    // Load today's entry
    loadEntry(todayStr());
    renderPastEntries();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
