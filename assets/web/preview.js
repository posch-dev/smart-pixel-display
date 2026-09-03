// The preview on a page of its own. It starts from what the dashboard saved in its
// cookies and overrides from there for as long as the page is open. Nothing is kept:
// a reload lands where opening it fresh from the dashboard lands.

const PV_MODES = ['clock', 'verse_of_day', 'nowplaying', 'dashboard'];
const PV_LABELS = {clock: 'Clock', verse_of_day: 'Verse', nowplaying: 'NowPlaying', dashboard: 'Dashboard'};

let cfg = {};
let pv = {follow: 'live', theme: null, accent: null, panels: {}, on: {raster: true, glow: true, album: true, trans: true, date: true},
          np: [{auto: true, hex: '#87a878'}, {auto: true, hex: '#87a878'}],
          col: {raster: null, card: null, bg: null, glow: null, track: null,
                title: null, album: null, trans: null, date: null, artist: null,
                total: null}};

// not saved on purpose, a page opened tomorrow should not still hold yesterday's song
let _pvFrozen = false;
let _pvActive = null;

// one sprite, kept in index.html, pulled in so the two never drift apart
async function loadSprite() {
  const html = await fetch('/').then(r => r.text());
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sprite = doc.querySelector('svg[style*="display:none"]');
  if (sprite) document.getElementById('pv-sprite').appendChild(sprite);
}

// the three colours belong to the theme, so switching it hands them back
function setPvTheme(mode) {
  pv.theme = mode;
  document.documentElement.dataset.theme = mode;
  document.getElementById('pv-theme-dark').classList.toggle('on', mode === 'dark');
  document.getElementById('pv-theme-light').classList.toggle('on', mode === 'light');
  pv.col = {raster: null, card: null, bg: null, glow: null, track: null,
            title: null, album: null, trans: null, date: null, artist: null,
            total: null};
  applyPvColors();
  buildPvColors();
  buildPvPanels();
}

function setPvAccent(hex) {
  pv.accent = clampAccent(hex);
  previewAccent(pv.accent);
  document.getElementById('pv-accent').value = pv.accent;
  paintPvFavicon();
}

function setPvFollow(what) {
  pv.follow = what;
  buildPvPanels();
  pollPreview();
}

// a real still: no reading, no scroll, no playhead
function togglePvFreeze() {
  _pvFrozen = !_pvFrozen;
  setBlueprintFrozen(_pvFrozen);
  document.getElementById('pv-freeze-use')
    .setAttribute('href', _pvFrozen ? '#ico-play' : '#ico-pause');
  const btn = document.getElementById('pv-freeze');
  btn.title = _pvFrozen ? 'Resume Preview' : 'Pause Preview';
  btn.classList.toggle('on', _pvFrozen);
  document.getElementById('pv-follow').disabled = _pvFrozen;
  if (!_pvFrozen) pollPreview();
}

// card and grain sit on the tile so the menu keeps the theme, the ground has to be the
// page or the colour would not show around the tile at all. the third field says the row
// carries a switch as well as a colour.
const PV_COLS = [['raster', 'Grid', true], ['card', 'Card'], ['bg', 'Background']];
const PV_COL_VAR = {raster: '--raster', card: '--card', bg: '--bg', glow: '--np-glow',
                    track: '--np-track', title: '--np-title', album: '--np-album',
                    trans: '--vs-trans', date: '--cl-date', artist: '--np-artist',
                    total: '--np-total'};

function setPvColOn(key, on) {
  pv.on[key] = on;
  applyPvColOn();
  buildPvColors();
  buildPvPanels();
}

function applyPvColOn() {
  const set = document.documentElement.dataset;
  set.raster = pv.on.raster ? '' : 'off';
  set.glow = pv.on.glow ? '' : 'off';
  set.album = pv.on.album ? '' : 'off';
  set.trans = pv.on.trans ? '' : 'off';
  set.date = pv.on.date ? '' : 'off';
}

function _pvColHost(key) {
  return key === 'bg' ? document.documentElement : document.getElementById('home-blueprint');
}

function applyPvColors() {
  for (const key of Object.keys(PV_COL_VAR)) {
    const host = _pvColHost(key);
    if (!host) continue;
    if (pv.col[key]) host.style.setProperty(PV_COL_VAR[key], pv.col[key]);
    else host.style.removeProperty(PV_COL_VAR[key]);
  }
}

function pvColorNow(key) {
  if (pv.col[key]) return pv.col[key];
  // neither the shine nor the track carries a colour until one is picked
  if (key === 'glow') return npAccentNow(0);
  if (key === 'title') return npAccentNow(0);
  const fallback = {track: '--border', album: '--muted', trans: '--muted',
                    date: '--muted', artist: '--muted-hi', total: '--muted'}[key];
  if (fallback) return cssHex(getComputedStyle(_pvColHost(key)).getPropertyValue(fallback));
  const host = _pvColHost(key);
  return host ? cssHex(getComputedStyle(host).getPropertyValue(PV_COL_VAR[key])) : '#000000';
}

function setPvColor(key, hex) {
  pv.col[key] = hex;
  applyPvColors();
  paintPvUndo(key);
}

function resetPvColor(key) {
  pv.col[key] = null;
  applyPvColors();
  const el = document.querySelector(`input[type=color][data-k="${key}"]`);
  if (el) el.value = pvColorNow(key);
  paintPvUndo(key);
}

// the shine follows the panel accent until one is picked, and in pixel mode that
// accent arrives with the song rather than with the page
function paintPvGlow() {
  const el = document.querySelector('input[type=color][data-k="glow"]');
  if (el && !pv.col.glow) el.value = pvColorNow('glow');
}

function paintPvUndo(key) {
  const b = document.querySelector(`.pv-undo[data-k="${key}"]`);
  if (!b) return;
  b.disabled = !pv.col[key];
}

// the picker is not rebuilt while it is open, only the arrow beside it is repainted
function _pvColorRow(key, label, hasSwitch) {
  const shown = !hasSwitch || pv.on[key];
  const pick = shown ? `<button class="pv-undo" data-k="${key}" ${pv.col[key] ? '' : 'disabled'}
      onclick="resetPvColor('${key}')" title="Back to the theme colour">
      <svg class="ico"><use href="#ico-undo"/></svg></button>
    <input type="color" data-k="${key}" value="${pvColorNow(key)}"
      oninput="setPvColor('${key}', this.value)">` : '';
  const sw = hasSwitch
    ? `${shown ? '<span class="bright-div"></span>' : ''}
       <label class="toggle"><input type="checkbox" ${pv.on[key] ? 'checked' : ''}
         onchange="setPvColOn('${key}', this.checked)"><div class="t-track"></div><div class="t-thumb"></div></label>`
    : '';
  return `<div class="row"><div class="row-left"><div class="row-label">${label}</div></div>
    <div class="row-right bright-row">${pick}${sw}</div></div>`;
}

function buildPvColors() {
  const box = document.getElementById('pv-colors');
  if (!box) return;
  box.innerHTML = PV_COLS.map(c => _pvColorRow(...c)).join('');
}

// the renderers read the panel choice off cfg, so the override is written there
function setPvPanel(mode, which) {
  pv.panels[mode] = which;
  applyPvPanels();
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
}

function applyPvPanels() {
  for (const m of PV_MODES) {
    cfg[m] = cfg[m] || {};
    cfg[m].use_global_preview = false;
    cfg[m].preview_mode = pv.panels[m];
  }
}

// live means live: the panel on the display and nothing beside it
function pvShownModes() {
  return [pvSubjectMode()];
}

function pvSubjectMode() {
  return pv.follow === 'live' ? (_pvActive || 'clock') : pv.follow;
}

const PV_ACCENT_LABELS = ['Primary Accent', 'Secondary Accent'];

function _pvPanelOpts(mode) {
  if (mode === 'clock') return _pvColorRow('date', 'Date', true);
  if (mode === 'verse_of_day') return _pvColorRow('trans', 'Translation', true);
  if (mode !== 'nowplaying') return '';
  let html = `<div class="row">
    <div class="row-left"><div class="row-label">Playhead</div></div>
    <div class="row-right"><div class="slider-wrap"><input type="range" id="pv-head"
      min="0" max="1000" value="${Math.round(1000 * blueprintPlayhead())}"
      oninput="setPvHead(this.value)"></div></div>
  </div>`;
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
  return html + _pvColorRow('title', 'Title') + _pvColorRow('artist', 'Artist')
              + _pvColorRow('album', 'Album', true) + _pvColorRow('track', 'Track')
              + _pvColorRow('total', 'Total Time') + _pvColorRow('glow', 'Glow', true);
}

function buildPvPanels() {
  const box = document.getElementById('pv-panels');
  if (!Object.keys(pv.panels).length) return;
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
  paintPvGlow();
}

// the toggle says the delivered colour wins, so the picker only shows what arrived
function setPvNpAuto(i, auto) {
  // taking it over by hand starts on the colour that is on screen, not on a stale one
  if (!auto) pv.np[i].hex = npAccentNow(i);
  pv.np[i].auto = auto;
  applyPvNp();
  buildPvPanels();
}

function setPvNpAccent(i, hex) {
  pv.np[i].hex = hex;
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
  document.body.classList.toggle('menu-open');
}

document.addEventListener('pointerdown', e => {
  const body = document.body;
  if (!body.classList.contains('menu-open')) return;
  const menu = document.getElementById('pv-menu');
  // the export sits on top of the drawer, a click in it is not a click beside it
  if (menu.contains(e.target) || e.target.closest('.modal-overlay')) return;
  // the two floating buttons live outside the drawer but belong to it
  if (e.target.closest('#pv-burger, #pv-freeze')) return;
  body.classList.remove('menu-open');
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
    paintPvGlow();
  }).catch(() => {});
}

// there is room for it on a desktop, so it starts open there and closed on a phone
const PV_WIDE_PX = 900;

async function initPreview() {
  if (window.innerWidth > PV_WIDE_PX) document.body.classList.add('menu-open');
  await loadSprite();
  setPvTheme(pv.theme || getCookie('spd_theme') || 'dark');
  setPvAccent(pv.accent || getCookie('spd_accent') || '#87a878');
  _applyPvPreviewMode(getCookie('spd_preview') || 'web');
  applyPvColOn();
  applyPvColors();
  buildPvColors();
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
