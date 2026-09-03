// The preview on a page of its own. It starts from what the dashboard saved in its
// cookies and then keeps its own overrides, so changing anything here leaves the
// dashboard alone.

const PV_MODES = ['clock', 'verse_of_day', 'nowplaying', 'dashboard'];
const PV_LABELS = {clock: 'Clock', verse_of_day: 'Verse', nowplaying: 'NowPlaying', dashboard: 'Dashboard'};

let cfg = {};
let pv = {follow: 'live', theme: null, accent: null, panels: {}};

function loadPv() {
  try { pv = Object.assign(pv, JSON.parse(localStorage.getItem('spd_pv') || '{}')); } catch {}
  pv.panels = pv.panels || {};
}

function savePv() {
  localStorage.setItem('spd_pv', JSON.stringify(pv));
}

// one sprite, kept in index.html, pulled in so the two never drift apart
async function loadSprite() {
  const html = await fetch('/').then(r => r.text());
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sprite = doc.querySelector('svg[style*="display:none"]');
  if (sprite) document.getElementById('pv-sprite').appendChild(sprite);
}

function setPvTheme(mode) {
  pv.theme = mode;
  document.documentElement.dataset.theme = mode;
  document.getElementById('pv-theme-dark').classList.toggle('on', mode === 'dark');
  document.getElementById('pv-theme-light').classList.toggle('on', mode === 'light');
  savePv();
}

function setPvAccent(hex) {
  pv.accent = clampAccent(hex);
  previewAccent(pv.accent);
  document.getElementById('pv-accent').value = pv.accent;
  savePv();
}

function setPvFollow(what) {
  pv.follow = what;
  savePv();
  pollPreview();
}

// the renderers read the panel choice off cfg, so the override is written there
function setPvPanel(mode, which) {
  pv.panels[mode] = which;
  applyPvPanels();
  savePv();
  buildPvPanels();
  _bpMode = null;
  pollPreview();
}

// a panel this page has never been asked about starts on whatever the dashboard
// resolves for it, global or local, and is its own from then on
function adoptPvPanels() {
  for (const m of PV_MODES) {
    // anything but the two real modes counts as unasked, stale values included
    if (pv.panels[m] !== 'web' && pv.panels[m] !== 'pixel') pv.panels[m] = previewModeFor(m);
  }
  savePv();
}

function applyPvPanels() {
  for (const m of PV_MODES) {
    cfg[m] = cfg[m] || {};
    cfg[m].use_global_preview = false;
    cfg[m].preview_mode = pv.panels[m];
  }
}

function buildPvPanels() {
  const box = document.getElementById('pv-panels');
  box.innerHTML = PV_MODES.map(m => {
    const own = pv.panels[m];
    const btn = (v, label) =>
      `<button onclick="setPvPanel('${m}','${v}')" class="${own === v ? 'on' : ''}">${label}</button>`;
    return `<div class="row"><div class="row-left"><div class="row-label">${PV_LABELS[m]}</div></div>
      <div class="row-right"><div class="seg">${btn('web', 'Web')}${btn('pixel', 'Pixel')}</div></div>
    </div>`;
  }).join('');
}

function togglePvMenu() {
  document.getElementById('pv-menu').classList.toggle('show');
}

document.addEventListener('pointerdown', e => {
  const menu = document.getElementById('pv-menu');
  if (!menu.classList.contains('show')) return;
  if (menu.contains(e.target) || document.getElementById('pv-burger').contains(e.target)) return;
  menu.classList.remove('show');
});

function pollPreview() {
  if (exFrozen()) return;
  fetch('/home').then(r => r.json()).then(data => {
    if (pv.follow !== 'live') data = Object.assign({}, data, {active_mode: pv.follow});
    updateBlueprint(data);
  }).catch(() => {});
}

async function initPreview() {
  loadPv();
  await loadSprite();
  setPvTheme(pv.theme || getCookie('spd_theme') || 'dark');
  setPvAccent(pv.accent || getCookie('spd_accent') || '#87a878');
  _applyPvPreviewMode(getCookie('spd_preview') || 'web');
  cfg = await fetch('/config').then(r => r.json());
  adoptPvPanels();
  applyPvPanels();
  buildPvPanels();
  document.getElementById('pv-follow').value = pv.follow;
  applyBlinkRate();
  pollPreview();
  setInterval(pollPreview, 1000);
}

function _applyPvPreviewMode(mode) {
  _previewMode = mode;
  document.documentElement.dataset.preview = mode;
}

initPreview();
