/* ── App Core — tab routing, sidebar, localStorage helpers, shared utilities ── */

const DB_KEYS = {
  journal:  'tv_journal',
  trades:   'tv_trades',
  bestOpps: 'tv_bestOpps',
  patterns: 'tv_patterns',
  config:   'tv_config',
  rules:    'tv_rules',
};

/* ── localStorage helpers ── */
const DB = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  getJournal()  { return DB.get(DB_KEYS.journal,  {}); },
  getTrades()   { return DB.get(DB_KEYS.trades,   []); },
  getBestOpps() { return DB.get(DB_KEYS.bestOpps, []); },
  getPatterns() { return DB.get(DB_KEYS.patterns, null); },
  getConfig()   { return DB.get(DB_KEYS.config,   {}); },
  getRules()    { return DB.get(DB_KEYS.rules,     []); },
};

/* ── ID generator ── */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ── Today's date as YYYY-MM-DD ── */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Format currency ── */
function fmt$(n) {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : abs.toFixed(2);
  return (n < 0 ? '-' : '') + '$' + s;
}

/* ── Format R-multiple ── */
function fmtR(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + 'R';
}

/* ── Color class based on P&L value ── */
function pnlClass(v) { return v >= 0 ? 'profit' : 'loss'; }

/* ── Toast notification ── */
function toast(msg, type = 'info', duration = 2800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ── Show / hide modal ── */
function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

/* ── Lightbox ── */
function openLightbox(src) {
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  img.src = src;
  lb.classList.remove('hidden');
}

/* ── Image file → base64 ── */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ── Render image preview grid ── */
function renderImagePreviews(gridId, images, onRemove) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '';
  images.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-img-wrap';

    const img = document.createElement('img');
    img.src = src;
    img.onclick = () => openLightbox(src);

    const rm = document.createElement('button');
    rm.className = 'preview-img-remove';
    rm.textContent = '✕';
    rm.onclick = (e) => { e.stopPropagation(); onRemove(i); };

    wrap.appendChild(img);
    wrap.appendChild(rm);
    grid.appendChild(wrap);
  });
}

/* ── Wire up image upload zone for drag-drop + file input ── */
function wireImageUpload(zoneId, inputId, getImages, setImages, gridId) {
  const zone  = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;

  async function handleFiles(files) {
    const imgs = getImages();
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const b64 = await fileToBase64(f);
      imgs.push(b64);
    }
    setImages(imgs);
    renderImagePreviews(gridId, imgs, (i) => {
      const updated = getImages();
      updated.splice(i, 1);
      setImages(updated);
      renderImagePreviews(gridId, getImages(), arguments.callee);
    });
  }

  input.onchange = () => handleFiles(input.files);

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
}

/* ── Tab routing ── */
function activateTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${tabId}`);
  });

  if (tabId === 'stats') window.Stats?.render();
}

/* ── Category badge HTML ── */
function categoryBadge(cat) {
  const labels = { 'ict-core': 'ICT Core', 'ict-time': 'ICT Time', kitt: 'KITT ICT', custom: 'Custom' };
  return `<span class="badge badge-${cat}">${labels[cat] || cat}</span>`;
}

/* ── Sidebar collapse ── */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle  = document.getElementById('sidebarToggle');
  toggle?.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
}

/* ── Modal close buttons ── */
function initModalCloseButtons() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
}

/* ── Lightbox close ── */
function initLightbox() {
  document.getElementById('lightboxClose')?.addEventListener('click', () => {
    document.getElementById('lightbox').classList.add('hidden');
  });
  document.getElementById('lightboxBackdrop')?.addEventListener('click', () => {
    document.getElementById('lightbox').classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.getElementById('lightbox')?.classList.add('hidden');
  });
}

/* ── Export all data to JSON ── */
function exportData() {
  const data = {
    journal:  DB.getJournal(),
    trades:   DB.getTrades(),
    bestOpps: DB.getBestOpps(),
    patterns: DB.getPatterns(),
    rules:    DB.getRules(),
    config:   DB.getConfig(),
    exported: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `tradervue-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Data exported successfully', 'success');
}

/* ── Expose globals for cross-module access ── */
window.DB      = DB;
window.DB_KEYS = DB_KEYS;
window.genId   = genId;
window.todayStr = todayStr;
window.fmt$    = fmt$;
window.fmtR    = fmtR;
window.pnlClass = pnlClass;
window.toast   = toast;
window.openModal  = openModal;
window.closeModal = closeModal;
window.openLightbox = openLightbox;
window.fileToBase64 = fileToBase64;
window.renderImagePreviews = renderImagePreviews;
window.wireImageUpload = wireImageUpload;
window.categoryBadge = categoryBadge;
window.activateTab = activateTab;

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initModalCloseButtons();
  initLightbox();

  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      activateTab(el.dataset.tab);
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
  });
});
