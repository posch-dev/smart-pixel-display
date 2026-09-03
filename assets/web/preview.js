// The preview on a page of its own. It starts from what the dashboard saved in its
// cookies and overrides from there for as long as the page is open. Nothing is kept:
// a reload lands where opening it fresh from the dashboard lands.

const PV_MODES = ['clock', 'verse_of_day', 'nowplaying', 'dashboard'];
const PV_LABELS = {clock: 'Clock', verse_of_day: 'Verse', nowplaying: 'NowPlaying', dashboard: 'Dashboard'};

let cfg = {};
let pv = {follow: 'live', theme: null, accent: null, panels: {},
          on: {raster: true, glow: true, album: true, trans: true, date: true,
               ddate: true, ddiv: true, dextra: true, dwhen: true, dblink: true,
               dacce: true, dacct: true},
          dicon: null, dinfo: null, dpick: 'none', dhh: null, dmm: null,
          np: [{auto: true, hex: '#87a878'}, {auto: true, hex: '#87a878'}],
          col: {}};

// not saved on purpose, a page opened tomorrow should not still hold yesterday's song
let _pvFrozen = false;
let _pvActive = null;
let _pvDashLayout = null;
let _pvLast = null;
let _pvSimError = false;

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
  pv.col = pvBlankColors();
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
                    total: '--np-total',
                    ddate: '--d-date', ddiv: '--d-div', dtemp: '--d-temp',
                    dhigh: '--d-high', dlow: '--d-low', dclock: '--d-clock',
                    dicon: '--d-icon', dmins: '--d-mins', dat: '--d-at',
                    dcar: '--d-car', dcal: '--d-cal', dlabel: '--d-title',
                    dwhen: '--d-when', dlate: '--d-late', dnow: '--d-now',
                    dnow2: '--d-now-alt'};

// what a picker shows before one is chosen, read off the rule the part falls back to
const PV_COL_FALLBACK = {track: '--border', album: '--muted', trans: '--muted',
                         date: '--muted', artist: '--muted-hi', total: '--muted',
                         ddate: '--muted', ddiv: '--border', dtemp: '--text',
                         dhigh: '--accent', dlow: '--accent-c', dclock: '--accent',
                         dicon: '--text', dmins: '--text', dat: '--muted',
                         dcar: '--muted', dcal: '--accent', dlabel: '--text',
                         dwhen: '--muted', dlate: '--muted', dnow: '--accent',
                         dnow2: '--accent-c'};

// every colour starts unpicked, and a theme change hands them all back
function pvBlankColors() {
  return Object.fromEntries(Object.keys(PV_COL_VAR).map(k => [k, null]));
}

// these three only open and close a group, so nothing is rebuilt and the fold can run
const PV_FOLD_KEYS = ['dacce', 'dacct', 'dextra', 'dblink'];

function setPvColOn(key, on) {
  pv.on[key] = on;
  applyPvColOn();
  if (PV_FOLD_KEYS.includes(key)) {
    _pvSyncFolds();
    if (key === 'dacce' || key === 'dacct') pvDashSim();
    else pollPreview();
    return;
  }
  _pvKeepRow(key, () => { buildPvColors(); buildPvPanels(); });
}

function applyPvColOn() {
  const set = document.documentElement.dataset;
  set.raster = pv.on.raster ? '' : 'off';
  set.glow = pv.on.glow ? '' : 'off';
  set.album = pv.on.album ? '' : 'off';
  set.trans = pv.on.trans ? '' : 'off';
  set.date = pv.on.date ? '' : 'off';
  set.dDate = pv.on.ddate ? '' : 'off';
  set.dDiv = pv.on.ddiv ? '' : 'off';
  set.dExtra = pv.on.dextra ? '' : 'off';
  set.dWhen = pv.on.dwhen ? '' : 'off';
  set.dBlink = pv.on.dblink ? '' : 'off';
  set.dInfo = pv.dinfo || '';
  set.dIconLook = pv.dicon || '';
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
  const fallback = PV_COL_FALLBACK[key];
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
  return `<div class="row" data-row="${key}"><div class="row-left"><div class="row-label">${label}</div></div>
    <div class="row-right bright-row">${pick}${sw}</div></div>`;
}

// a rebuild that drops rows shortens the drawer and the browser pulls the scroll up
// with it. the row that was touched keeps its place on screen, the rest moves around it
function _pvRowTop(key) {
  const el = document.querySelector(`.row[data-row="${key}"]`);
  return el ? el.getBoundingClientRect().top : null;
}

function _pvKeepRow(key, rebuild) {
  const box = document.getElementById('pv-menu');
  const before = _pvRowTop(key);
  rebuild();
  const after = _pvRowTop(key);
  if (box && before !== null && after !== null) box.scrollTop += after - before;
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

// a row that only carries a switch
function _pvSwitchRow(key, label) {
  return `<div class="row" data-row="${key}"><div class="row-left"><div class="row-label">${label}</div></div>
    <div class="row-right bright-row">
      <label class="toggle"><input type="checkbox" ${pv.on[key] ? 'checked' : ''}
        onchange="setPvColOn('${key}', this.checked)"><div class="t-track"></div><div class="t-thumb"></div></label>
    </div></div>`;
}

// the weather icon answers to its own look, and only the drawn one takes a colour
function _pvIconRow() {
  const own = pv.dicon || previewModeFor('dashboard');
  const btn = (v, label) =>
    `<button onclick="setPvDashIcon('${v}')" class="${own === v ? 'on' : ''}">${label}</button>`;
  const pick = own === 'web' ? `<button class="pv-undo" data-k="dicon" ${pv.col.dicon ? '' : 'disabled'}
      onclick="resetPvColor('dicon')" title="Back to the theme colour">
      <svg class="ico"><use href="#ico-undo"/></svg></button>
    <input type="color" data-k="dicon" value="${pvColorNow('dicon')}"
      oninput="setPvColor('dicon', this.value)"><span class="bright-div"></span>` : '';
  return `<div class="row" data-row="dicon"><div class="row-left"><div class="row-label">Weather Icon</div></div>
    <div class="row-right bright-row">${pick}<div class="seg">${btn('web', 'Web')}${btn('pixel', 'Pixel')}</div></div>
  </div>`;
}

function _pvFold(id, open, inner) {
  return `<div class="pv-fold" id="${id}" data-open="${open ? 1 : 0}">
    <div class="pv-fold-in">${inner}</div></div>`;
}

// the drawer shows the layout that is running, so the rows for a departure only turn
// up while one is on the board. every group that a switch can close is a fold, so it
// runs shut instead of vanishing from under the switch
function _pvDashOpts() {
  const sc = bpDashNow();
  let html = _pvSwitchRow('dacce', 'Accurate Event')
           + _pvFold('pv-fold-pick', !pv.on.dacce, _pvPickRow())
           + _pvSwitchRow('dacct', 'Accurate Time')
           + _pvFold('pv-fold-time', !pv.on.dacct, _pvTimeRow())
           + _pvColorRow('ddate', 'Date', true)
           + _pvColorRow('dclock', 'Clock') + _pvColorRow('dtemp', 'Current')
           + _pvColorRow('dhigh', 'High') + _pvColorRow('dlow', 'Low')
           + _pvIconRow() + _pvInfoRow();
  if (sc.rawMode === 1) return html;
  let ev = '<div class="card-title">Event</div>' + _pvColorRow('ddiv', 'Divider', true);
  if (sc.rawMode === 2) {
    ev += _pvColorRow('dwhen', 'Timespan', true);
  }
  ev += _pvColorRow('dcal', 'Calendar Icon') + _pvColorRow('dlabel', 'Event Label');
  if (sc.rawMode === 3) {
    const extra = sc.late
      ? _pvSwitchRow('dblink', 'NOW Blink') + _pvColorRow('dnow', 'NOW Primary')
        + _pvFold('pv-fold-blink', pv.on.dblink, _pvColorRow('dnow2', 'NOW Secondary'))
        + _pvColorRow('dlate', 'Late Minutes') + _pvColorRow('dcar', 'Car Icon')
      : _pvColorRow('dmins', 'Leave Minutes') + _pvColorRow('dat', 'Departure Time')
        + _pvColorRow('dcar', 'Car Icon');
    ev += '<div class="card-title">Departure</div>'
        + _pvSwitchRow('dextra', 'Show Extra Information')
        + _pvFold('pv-fold-extra', pv.on.dextra, extra);
  }
  return html + ev;
}

// a fold only has to be told its new state, the drawer around it stays as it is
function _pvSyncFolds() {
  const set = (id, open) => {
    const el = document.getElementById(id);
    if (el) el.dataset.open = open ? '1' : '0';
  };
  set('pv-fold-pick', !pv.on.dacce);
  set('pv-fold-time', !pv.on.dacct);
  set('pv-fold-extra', pv.on.dextra);
  set('pv-fold-blink', pv.on.dblink);
}

const PV_INFO = [['weather', 'Weather'], ['both', 'Both'], ['event', 'Event']];

// with nothing on the calendar there is only weather to show, so the choice waits
function _pvInfoRow() {
  const live = bpDashNow().rawMode !== 1;
  const own = live ? (pv.dinfo || 'both') : 'weather';
  const btn = ([v, label]) =>
    `<button onclick="setPvDashInfo('${v}')" class="${own === v ? 'on' : ''}"
      ${live ? '' : 'disabled'}>${label}</button>`;
  return `<div class="row" data-row="dinfo"><div class="row-left"><div class="row-label">Information</div></div>
    <div class="row-right"><div class="seg">${PV_INFO.map(btn).join('')}</div></div></div>`;
}

function _pvEventLabel(ev, i) {
  const d = new Date(ev.start_time);
  const when = ev.is_all_day || ev.isAllDay || isNaN(d) ? 'All Day'
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return [ev.title || `Event ${i + 1}`, when, ev.location].filter(Boolean).join(' | ');
}

function _pvPickRow() {
  const list = (_pvLast && _pvLast.dashboard && _pvLast.dashboard.events) || [];
  const opt = (v, label) =>
    `<option value="${v}" ${String(pv.dpick) === String(v) ? 'selected' : ''}>${label}</option>`;
  const opts = opt('none', 'No event (weather)')
             + list.map((ev, i) => opt(i, _exEsc(_pvEventLabel(ev, i)))).join('');
  return `<div class="row" data-row="dpick"><div class="row-left"><div class="row-label">Event</div>${_pvSimNote(true)}</div>
    <div class="row-right"><select class="pv-sel" onchange="setPvDashPick(this.value)">${opts}</select></div></div>`;
}

// why the tile is not showing what was asked of it. the route is newer than the flask
// process that is running until startup.py is restarted, and then nothing comes back
function _pvSimNote(onPick) {
  if (onPick === !pv.on.dacce) {
    if (_pvSimError)
      return '<div class="pv-note pv-skip">No answer from the panel, restart startup.py</div>';
    if (bpDashNow().skipped)
      return '<div class="pv-note pv-skip">Grace expired, the panel would move on</div>';
  }
  return '';
}

function _pvTimeRow() {
  const now = new Date();
  const hh = pv.dhh === null ? now.getHours() : pv.dhh;
  const mm = pv.dmm === null ? now.getMinutes() : pv.dmm;
  const sel = (n, val, fn) => {
    let out = '';
    for (let i = 0; i < n; i++)
      out += `<option value="${i}" ${i === val ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`;
    return `<select class="pv-sel pv-sel-n" onchange="${fn}(this.value)">${out}</select>`;
  };
  return `<div class="row" data-row="dtime"><div class="row-left"><div class="row-label">Time</div>${_pvSimNote(false)}</div>
    <div class="row-right bright-row">${sel(24, hh, 'setPvDashHH')}<span class="pv-unit">h</span><span class="pv-colon">:</span>${sel(60, mm, 'setPvDashMM')}<span class="pv-unit">m</span></div></div>`;
}

function setPvDashInfo(which) {
  pv.dinfo = which;
  applyPvColOn();
  pvRepaint();
  _pvKeepRow('dinfo', buildPvPanels);
}

// what the rows are built from: the layout, whether the pick fell through, and how
// many events there are to choose between
function _pvDashSig() {
  const sc = bpDashNow();
  const n = ((_pvLast && _pvLast.dashboard && _pvLast.dashboard.events) || []).length;
  return `${sc.rawMode}|${sc.late}|${sc.skipped}|${n}|${_pvSimError}`;
}

function _pvSyncDashRows() {
  const sig = _pvDashSig();
  if (sig === _pvDashLayout) return;
  _pvDashLayout = sig;
  _pvKeepRow('dpick', buildPvPanels);
}

function setPvDashPick(v) {
  pv.dpick = v === 'none' ? 'none' : +v;
  pvDashSim();
}

function setPvDashHH(v) { pv.dhh = +v; pvDashSim(); }
function setPvDashMM(v) { pv.dmm = +v; pvDashSim(); }

// the picked layout is worked out where the rules live, and only when it changes
async function pvDashSim() {
  if (pv.on.dacce && pv.on.dacct) {
    setBpDashOverride(null);
    pvRepaint();
    _pvSyncDashRows();
    return;
  }
  const now = new Date();
  const hh = pv.dhh === null ? now.getHours() : pv.dhh;
  const mm = pv.dmm === null ? now.getMinutes() : pv.dmm;
  const q = [];
  if (!pv.on.dacct) q.push(`at=${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  if (!pv.on.dacce) q.push(`event=${pv.dpick}`);
  const layout = await fetch('/dashboard/layout?' + q.join('&'))
    .then(r => r.ok ? r.json() : null).catch(() => null);
  _pvSimError = !layout;
  if (layout) setBpDashOverride({layout, time: pv.on.dacct ? null : `${hh}:${mm}`});
  pvRepaint();
  _pvSyncDashRows();
}

// a paused tile is not polled, so the drawer paints it itself
function pvRepaint() {
  if (!_pvLast) return;
  updateBlueprint(pv.follow === 'live' ? _pvLast
                  : Object.assign({}, _pvLast, {active_mode: pv.follow}));
}

function setPvDashIcon(which) {
  pv.dicon = which;
  applyPvColOn();
  _pvKeepRow('dicon', buildPvPanels);
}

function _pvPanelOpts(mode) {
  if (mode === 'clock') return _pvColorRow('date', 'Date', true);
  if (mode === 'verse_of_day') return _pvColorRow('trans', 'Translation', true);
  if (mode === 'dashboard') return _pvDashOpts();
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
    _pvLast = data;
    if (pv.follow !== 'live') data = Object.assign({}, data, {active_mode: pv.follow});
    updateBlueprint(data);
    if (data.active_mode !== _pvActive) {
      _pvActive = data.active_mode;
      if (pv.follow === 'live') buildPvPanels();
    }
    // the dashboard rows follow the layout the panel decided on
    if (pvSubjectMode() === 'dashboard') _pvSyncDashRows();
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
