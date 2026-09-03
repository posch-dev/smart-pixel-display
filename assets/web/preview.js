// The preview on a page of its own. It starts from what the dashboard saved in its
// cookies and then keeps its own overrides, so changing anything here leaves the
// dashboard alone.

const PV_MODES = ['clock', 'verse_of_day', 'nowplaying', 'dashboard'];
const PV_LABELS = {clock: 'Clock', verse_of_day: 'Verse', nowplaying: 'NowPlaying', dashboard: 'Dashboard'};

let cfg = {};
let pv = {follow: 'live', theme: null, accent: null, grid: true, panels: {}, np: null};

// not saved on purpose, a page opened tomorrow should not still hold yesterday's song
let _pvFrozen = false;
let _pvActive = null;

function loadPv() {
  try { pv = Object.assign(pv, JSON.parse(localStorage.getItem('spd_pv') || '{}')); } catch {}
  pv.panels = pv.panels || {};
  pv.grid = pv.grid !== false;
  if (!Array.isArray(pv.np) || pv.np.length !== 2)
    pv.np = [{auto: true, hex: '#87a878'}, {auto: true, hex: '#87a878'}];
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
  paintPvFavicon();
  savePv();
}

function setPvFollow(what) {
  pv.follow = what;
  savePv();
  buildPvPanels();
  pollPreview();
}

// a real still: no reading, no scroll, no playhead
function togglePvFreeze() {
  _pvFrozen = !_pvFrozen;
  setBlueprintFrozen(_pvFrozen);
  document.getElementById('pv-freeze-use')
    .setAttribute('href', _pvFrozen ? '#ico-play' : '#ico-pause');
  document.getElementById('pv-freeze-label').textContent = _pvFrozen ? 'Resume' : 'Pause';
  document.getElementById('pv-freeze').classList.toggle('on', _pvFrozen);
  document.getElementById('pv-follow').disabled = _pvFrozen;
  if (!_pvFrozen) pollPreview();
}

function setPvGrid(on) {
  pv.grid = on;
  savePv();
  applyPvGrid();
}

function applyPvGrid() {
  document.documentElement.dataset.raster = pv.grid ? '' : 'off';
  const el = document.getElementById('pv-grid');
  if (el) el.checked = pv.grid;
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

// following the display shows every switch and the settings of whatever is on screen,
// a fixed pick shows that one panel and nothing else
function pvShownModes() {
  return pv.follow === 'live' ? PV_MODES : [pv.follow];
}

function pvSubjectMode() {
  return pv.follow === 'live' ? (_pvActive || 'clock') : pv.follow;
}

const PV_ACCENT_LABELS = ['Primary Accent', 'Secondary Accent'];

function _pvPanelOpts(mode) {
  if (mode !== 'nowplaying') return '';
  let html = `<div class="row">
    <div class="row-left"><div class="row-label">Playhead</div></div>
    <div class="row-right"><div class="slider-wrap"><input type="range" id="pv-head"
      min="0" max="1000" value="${Math.round(1000 * blueprintPlayhead())}"
      oninput="setPvHead(this.value)"></div></div>
  </div>`;
  if (pv.panels.nowplaying !== 'pixel') return html;
  PV_ACCENT_LABELS.forEach((label, i) => {
    const a = pv.np[i];
    html += `<div class="row">
      <div class="row-left"><div class="row-label">${label}</div></div>
      <div class="row-right bright-row acc-row">
        ${a.auto ? '<span class="pv-auto">AutoGen</span>'
                 : `<input type="color" id="pv-np${i}" value="${a.hex}"
                      oninput="setPvNpAccent(${i}, this.value)">`}
        <span class="bright-div"></span>
        <label class="toggle"><input type="checkbox" ${a.auto ? 'checked' : ''}
          onchange="setPvNpAuto(${i}, this.checked)"><div class="t-track"></div><div class="t-thumb"></div></label>
      </div>
    </div>`;
  });
  return html;
}

function buildPvPanels() {
  const box = document.getElementById('pv-panels');
  const subject = pvSubjectMode();
  const switches = pvShownModes().map(m => {
    const own = pv.panels[m];
    const btn = (v, label) =>
      `<button onclick="setPvPanel('${m}','${v}')" class="${own === v ? 'on' : ''}">${label}</button>`;
    return `<div class="row"><div class="row-left"><div class="row-label">${PV_LABELS[m]}</div></div>
      <div class="row-right"><div class="seg">${btn('web', 'Web')}${btn('pixel', 'Pixel')}</div></div>
    </div>`;
  }).join('');
  const opts = _pvPanelOpts(subject);
  // a panel with nothing of its own keeps its heading out of the way
  box.innerHTML = `<div class="card-title">Panel Appearance</div>${switches}`
    + (opts ? `<div class="card-title">${PV_LABELS[subject]} Customizations</div>${opts}` : '');
}

// the toggle says the delivered colour wins, so the picker only shows what arrived
function setPvNpAuto(i, auto) {
  pv.np[i].auto = auto;
  savePv();
  applyPvNp();
  buildPvPanels();
}

function setPvNpAccent(i, hex) {
  pv.np[i].hex = hex;
  savePv();
  applyPvNp();
}

function applyPvNp() {
  for (let i = 0; i < 2; i++) setNpAccent(i, pv.np[i].auto ? null : pv.np[i].hex);
}

// dragging the head means holding the picture still, otherwise the next reading wins
function setPvHead(v) {
  if (!_pvFrozen) togglePvFreeze();
  setBlueprintPlayhead(+v / 1000);
}

function paintPvHead() {
  const el = document.getElementById('pv-head');
  if (el && !_pvFrozen) el.value = Math.round(1000 * blueprintPlayhead());
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

// the page has no link of its own, so its tab carries the accent instead
function paintPvFavicon() {
  const link = document.getElementById('favicon');
  if (!link) return;
  const col = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`
            + `<rect x="2" y="9" width="28" height="14" rx="3"`
            + ` fill="${col || '#4ade80'}"/></svg>`;
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function pollPreview() {
  if (exFrozen() || _pvFrozen) return;
  fetch('/home').then(r => r.json()).then(data => {
    if (pv.follow !== 'live') data = Object.assign({}, data, {active_mode: pv.follow});
    updateBlueprint(data);
    if (data.active_mode !== _pvActive) {
      _pvActive = data.active_mode;
      if (pv.follow === 'live') buildPvPanels();
    }
    paintPvHead();
  }).catch(() => {});
}

async function initPreview() {
  loadPv();
  await loadSprite();
  setPvTheme(pv.theme || getCookie('spd_theme') || 'dark');
  setPvAccent(pv.accent || getCookie('spd_accent') || '#87a878');
  _applyPvPreviewMode(getCookie('spd_preview') || 'web');
  applyPvGrid();
  cfg = await fetch('/config').then(r => r.json());
  adoptPvPanels();
  applyPvPanels();
  applyPvNp();
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
