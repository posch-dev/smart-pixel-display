'use strict';

const MODES = ['clock','verse_of_day','nowplaying','dashboard'];
const LABELS = { clock:'Clock', verse_of_day:'Verse', nowplaying:'NowPlaying', dashboard:'Dashboard' };
const MODULE_PREFIX = { clock:'cl', verse_of_day:'v', nowplaying:'np', dashboard:'md' };
const TRIG_ICONS = { clock:'#ico-clock', verse_of_day:'#ico-cross', nowplaying:'#ico-music', dashboard:'#ico-calendar' };
const PANEL_KEY = { clock:'clock', verse_of_day:'verse', nowplaying:'np', dashboard:'dash' };
const PANEL_DESC = {
  clock:        'Digital Clock',
  verse_of_day: 'Daily Bible Verse',
  nowplaying:   'Song Cover, Song Infos and Beat Visualizer',
  dashboard:    'Weather, Time and Calendar',
};

let cfg = {};
let statusData = {};
let _displayOn = true;

const manuals  = new Set();

const HOLD_THRESHOLD_MS = 350;
let _pressMode  = null;
let _pressedAt  = 0;
let _segHolding = null;

function _applyPreviewMode(mode) {
  _previewMode = mode;
  document.documentElement.dataset.preview = mode;
  applyActivePreview(_bpMode);
  document.getElementById('prev-web')?.classList.toggle('on', mode === 'web');
  document.getElementById('prev-pixel')?.classList.toggle('on', mode === 'pixel');
}

function _paintPreviewRow(mode) {
  const pre = MODULE_PREFIX[mode];
  const c = cfg[mode] || {};
  const useGlobal = c.use_global_preview ?? true;
  const which = c.preview_mode || _previewMode;
  const box = document.getElementById(pre + '_prev_row');
  if (box) box.classList.toggle('global', useGlobal);
  const label = document.getElementById(pre + '_prev_label');
  if (label) label.textContent = useGlobal ? 'Global' : 'Local';
  const toggle = document.getElementById(pre + '_use_global_preview');
  if (toggle) toggle.checked = useGlobal;
  document.getElementById(pre + '_prev_web')?.classList.toggle('on', which === 'web');
  document.getElementById(pre + '_prev_pixel')?.classList.toggle('on', which === 'pixel');
}

function setPanelPreview(mode, which) {
  cfg[mode] = cfg[mode] || {};
  cfg[mode].preview_mode = which;
  _paintPreviewRow(mode);
  applyActivePreview(_bpMode || mode);
  save(mode, 'preview_mode', which);
}

function togglePanelPreview(mode, useGlobal) {
  cfg[mode] = cfg[mode] || {};
  cfg[mode].use_global_preview = useGlobal;
  if (!useGlobal && !cfg[mode].preview_mode) cfg[mode].preview_mode = _previewMode;
  _paintPreviewRow(mode);
  applyActivePreview(_bpMode || mode);
  save(mode, 'use_global_preview', useGlobal);
}

// the twin is what the home tile shows: the same state in a web face of its own
function setTwinInHome(on) {
  setCookie('spd_twin', on ? 'on' : 'off');
  applyTwin(on);
}

function applyTwin(on) {
  document.body.classList.toggle('no-twin', !on);
  const box = document.getElementById('twin_in_home');
  if (box) box.checked = on;
  if (on) pollHome();
}

function twinOn() {
  return getCookie('spd_twin') !== 'off';
}

function toggleTwinPanels() {
  const open = document.getElementById('twin-panels').classList.toggle('open');
  document.getElementById('twin-more').classList.toggle('on', open);
}

// the same row the panels tab used to carry, so _paintPreviewRow still finds its ids
function buildTwinPanels() {
  const box = document.getElementById('twin-panels');
  if (!box) return;
  box.innerHTML = MODES.map(m => {
    const pre = MODULE_PREFIX[m];
    return `<div class="row">
      <div class="row-left"><div class="row-label">${LABELS[m]}</div></div>
      <div class="row-right prev-row" id="${pre}_prev_row">
        <div class="seg">
          <button onclick="setPanelPreview('${m}','web')" id="${pre}_prev_web">Web</button>
          <button onclick="setPanelPreview('${m}','pixel')" id="${pre}_prev_pixel">Pixel</button>
        </div>
        <span class="bright-div"></span>
        <span class="bright-label" id="${pre}_prev_label">Global</span>
        <label class="toggle"><input type="checkbox" id="${pre}_use_global_preview"
          onchange="togglePanelPreview('${m}',this.checked)"><div class="t-track"></div><div class="t-thumb"></div></label>
      </div>
    </div>`;
  }).join('');
  MODES.forEach(_paintPreviewRow);
}

function setPreviewMode(mode) {
  _applyPreviewMode(mode);
  setCookie('spd_preview', mode);
  _bpMode = null;
  pollHome();
}

function setThemeMode(mode) {
  document.documentElement.dataset.theme = mode;
  applyMapTheme();
  document.getElementById('theme-dark').classList.toggle('on', mode === 'dark');
  document.getElementById('theme-light').classList.toggle('on', mode === 'light');
  setCookie('spd_theme', mode);
}

function setAccent(hex) {
  hex = clampAccent(hex);
  previewAccent(hex);
  const pick = document.getElementById('accent-pick');
  if (pick) pick.value = hex;
  setCookie('spd_accent', hex);
}

function showTab(id, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('tab-' + id);
  if (pane) pane.classList.add('active');
  if (btn) btn.classList.add('active');
  document.getElementById('panel-tabs').classList.toggle('visible', id === 'modules');
  const set = document.getElementById('settings-tabs');
  set.classList.toggle('visible', id === 'device');
  // the settings nav comes back where it was, Device when there is nothing to come back to
  if (id === 'device') showSetting(currentSetting());
}

function currentSetting() {
  const id = getCookie('spd_setting');
  return document.getElementById('set-' + id) ? id : 'device';
}

function showSetting(id, btn) {
  if (!document.getElementById('set-' + id)) id = 'device';
  // the button is looked up, not trusted, so a call without one still marks the nav
  const tab = btn || document.querySelector(`#settings-tabs .panel-tab-btn[data-set="${id}"]`);
  document.querySelectorAll('.set-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('set-' + id).classList.add('active');
  document.querySelectorAll('#settings-tabs .panel-tab-btn')
          .forEach(b => b.classList.toggle('active', b === tab));
  setCookie('spd_setting', id);
}

function showPanel(id, btn) {
  document.querySelectorAll('.panel-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.panel-tab-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('panel-' + id);
  if (pane) pane.classList.add('active');
  if (btn) btn.classList.add('active');
}

function goPanel(mode) {
  showTab('modules', document.querySelector('.tab-btn[data-tab="modules"]'));
  const key = PANEL_KEY[mode] || mode;
  showPanel(key, document.querySelector(`.panel-tab-btn[data-panel="${key}"]`));
}

function buildPanelTabs() {
  const bar = document.getElementById('panel-tabs');
  if (!bar) return;
  const current = document.querySelector('.panel-pane.active')?.id.replace('panel-', '');
  const enabled = MODES.filter(m => cfg[m] ? (cfg[m].enabled ?? true) : true);
  bar.innerHTML = '';
  enabled.forEach(m => {
    const key = PANEL_KEY[m];
    const b = document.createElement('button');
    b.className = 'panel-tab-btn';
    b.dataset.panel = key;
    b.innerHTML = `<svg class="ico"><use href="${TRIG_ICONS[m]}"/></svg><span>${LABELS[m]}</span>`;
    b.onclick = () => showPanel(key, b);
    bar.appendChild(b);
  });
  // the open pane may belong to a panel that was just switched off
  const keys = enabled.map(m => PANEL_KEY[m]);
  const target = keys.includes(current) ? current : keys[0];
  if (target) showPanel(target, bar.querySelector(`.panel-tab-btn[data-panel="${target}"]`));
  markScrollEdges(bar);
}

function markScrollEdges(bar) {
  if (!bar) return;
  const max = bar.scrollWidth - bar.clientWidth;
  bar.classList.toggle('can-l', max > 1 && bar.scrollLeft > 1);
  bar.classList.toggle('can-r', max > 1 && bar.scrollLeft < max - 1);
}

// a rebuilt bar keeps its listener, the element is the same one
function initScrollEdges() {
  document.querySelectorAll('.tab-bar, .panel-tabs').forEach(bar => {
    bar.addEventListener('scroll', () => markScrollEdges(bar), { passive: true });
    new ResizeObserver(() => markScrollEdges(bar)).observe(bar);
    markScrollEdges(bar);
  });
}

function buildPanelIcons() {
  const bar = document.getElementById('panel-icons');
  if (!bar) return;
  bar.innerHTML = '';
  // least important on the left, so the right end is what matters most
  modesByPriority().reverse().filter(m => cfg[m] ? (cfg[m].enabled ?? true) : true).forEach(m => {
    const b = document.createElement('button');
    b.className = 'panel-ico';
    b.dataset.panel = PANEL_KEY[m];
    b.title = LABELS[m];
    b.innerHTML = `<svg class="ico"><use href="${TRIG_ICONS[m]}"/></svg>`;
    b.onclick = () => goPanel(m);
    bar.appendChild(b);
  });
  updatePanelIcons(statusData.active_mode);
}

// the list runs top down from the most important panel
function modesByPriority() {
  return [...MODES].sort((a, b) => (cfg[b]?.priority ?? 0) - (cfg[a]?.priority ?? 0));
}

function buildEnabledList() {
  const list = document.getElementById('panel-enabled-list');
  if (!list) return;
  list.innerHTML = modesByPriority().map(m => {
    const on = cfg[m] ? (cfg[m].enabled ?? true) : true;
    return `<div class="prow${on ? '' : ' off'}" data-mode="${m}">
      <svg class="ico prow-grip"><use href="#ico-grip"/></svg>
      <svg class="ico prow-ico"><use href="${TRIG_ICONS[m]}"/></svg>
      <div class="prow-text">
        <div class="prow-name">${LABELS[m]}</div>
        <div class="row-sub">${PANEL_DESC[m]}</div>
      </div>
      <div class="prow-prio"></div>
      <label class="toggle"><input type="checkbox" ${on ? 'checked' : ''}
        onchange="toggleEnabled('${m}',this.checked)"><div class="t-track"></div><div class="t-thumb"></div></label>
    </div>`;
  }).join('');
  paintPrioLabels();
  list.querySelectorAll('.prow-grip').forEach(grip => {
    grip.addEventListener('pointerdown', e => gripDown(e, grip.closest('.prow')));
  });
}

const PRIO_LABELS = {4: 'Ultra', 3: 'High', 2: 'Medium', 1: 'Low'};

function paintPrioLabels() {
  const rows = [...document.querySelectorAll('#panel-enabled-list .prow')];
  rows.forEach((row, i) => {
    const prio = rows.length - i;
    row.querySelector('.prow-prio').textContent = PRIO_LABELS[prio] ?? prio;
  });
}

// pointer based, because HTML5 drag never fires on touch
let _dragRow = null, _dragY = 0, _dragMoved = 0;

function gripDown(e, row) {
  e.preventDefault();
  _dragRow = row; _dragY = e.clientY; _dragMoved = 0;
  row.classList.add('dragging');
  e.target.setPointerCapture?.(e.pointerId);
  e.target.addEventListener('pointermove', gripMove);
  e.target.addEventListener('pointerup', gripUp, {once: true});
  e.target.addEventListener('pointercancel', gripUp, {once: true});
}

function gripMove(e) {
  if (!_dragRow) return;
  _dragMoved += e.clientY - _dragY;
  _dragY = e.clientY;
  _dragRow.style.transform = `translateY(${_dragMoved}px)`;
  const box = _dragRow.getBoundingClientRect();
  const mid = box.top + box.height / 2;
  const prev = _dragRow.previousElementSibling;
  const next = _dragRow.nextElementSibling;
  // swapping at the neighbour midpoint keeps the finger over the row it moves
  if (prev && mid < prev.getBoundingClientRect().top + prev.offsetHeight / 2) {
    _dragRow.parentNode.insertBefore(_dragRow, prev);
    _dragMoved += prev.offsetHeight;
    paintPrioLabels();
  } else if (next && mid > next.getBoundingClientRect().top + next.offsetHeight / 2) {
    _dragRow.parentNode.insertBefore(next, _dragRow);
    _dragMoved -= next.offsetHeight;
    paintPrioLabels();
  }
  _dragRow.style.transform = `translateY(${_dragMoved}px)`;
}

async function gripUp(e) {
  if (!_dragRow) return;
  e.target.removeEventListener('pointermove', gripMove);
  _dragRow.classList.remove('dragging');
  _dragRow.style.transform = '';
  _dragRow = null;
  await savePriorityOrder();
}

// top row takes the highest number, the scheduler reads bigger as more important
async function savePriorityOrder() {
  const rows = [...document.querySelectorAll('#panel-enabled-list .prow')];
  for (let i = 0; i < rows.length; i++) {
    const mode = rows[i].dataset.mode;
    const prio = rows.length - i;
    if (cfg[mode]?.priority === prio) continue;
    cfg[mode] = cfg[mode] || {};
    cfg[mode].priority = prio;
    await save(mode, 'priority', prio);
  }
  buildPanelIcons();
  buildPanelGrid();
}

function updatePanelIcons(activeMode) {
  const map = {clock:'clock', verse_of_day:'verse', nowplaying:'np', dashboard:'dash'};
  const panel = map[activeMode] || activeMode;
  document.querySelectorAll('.panel-ico').forEach(btn => {
    const on = btn.dataset.panel === panel;
    btn.classList.toggle('manual', on && _userDriving(activeMode));
    syncPulse(btn, btn.classList.toggle('active', on && !_userDriving(activeMode)));
  });
}

function nxt(el, fmt) {
  const val = el.parentElement.querySelector('.val');
  if (val) val.textContent = fmt(el.value);
}
function fmtUptime(s) {
  s = Math.max(0, Math.round(s));
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600);
  const m = Math.floor(s % 3600 / 60), sec = s % 60;
  if (d >= 364) return `${Math.floor(d / 364)}y ${Math.floor(d % 364 / 7)}w ${d % 7}d`;
  if (d >= 7)   return `${Math.floor(d / 7)}w ${d % 7}d ${h}h`;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show ' + type;
  clearTimeout(el._t); el._t = setTimeout(() => el.className = '', 2200);
}

// every api failure answers with json, an html error page would land in the toast
async function errorText(response) {
  const detail = await response.json().catch(() => null);
  return (detail && detail.error) || ('HTTP ' + response.status);
}

async function togglePower() {
  const next = !_displayOn;
  try {
    const r = await fetch('/display/power', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({on: next})
    });
    if (!r.ok) throw new Error(await errorText(r));
    _displayOn = next;
    toast(next ? 'Display On' : 'Display Off');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
  updatePowerBtn();
}

let _uptimeBase  = 0;
let _uptimeAt    = 0;
let _linkUp      = true;
let _retryAt     = 0;
let _retrying    = false;

function tickHeaderClock() {
  const el = document.getElementById('s-time');
  if (!el) return;
  if (!_linkUp) {
    if (_retrying)     el.textContent = 'Reconnecting';
    else if (_retryAt) el.textContent = 'Reconnecting in ' + Math.max(0, Math.round((_retryAt - Date.now()) / 1000)) + 's';
    else               el.textContent = 'Disconnected';
    return;
  }
  el.textContent = _uptimeAt ? fmtUptime(_uptimeBase + (Date.now() - _uptimeAt) / 1000) : '\u2014';
}

// the tab icon is the status dot the header gave up: green up, blue clearing, red down
let _favState = null;

function paintFavicon(state) {
  const link = document.getElementById('favicon');
  if (!link || state === _favState) return;
  _favState = state;
  const col = getComputedStyle(document.documentElement).getPropertyValue('--' + state).trim();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`
            + `<circle cx="16" cy="16" r="11" fill="${col || '#4ade80'}"/></svg>`;
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function paintLink() {
  const clearing = _linkUp && !!statusData.clearing;
  const pill = document.getElementById('status-pill');
  if (pill) {
    pill.classList.toggle('offline', !_linkUp);
    pill.classList.toggle('clearing', clearing);
  }
  // the power ring is the status dot now: green up, blue clearing, red down
  const head = document.querySelector('.header-center');
  if (head) {
    head.classList.toggle('down', !_linkUp);
    head.classList.toggle('clearing', clearing);
  }
  paintFavicon(!_linkUp ? 'red' : clearing ? 'blue' : 'green');
}

function updatePowerBtn() {
  const btn = document.getElementById('power-btn');
  if (!btn) return;
  btn.classList.toggle('off', !_displayOn);
  btn.title = _displayOn ? 'Turn Off Display' : 'Turn On Display';
}

function toggleEnabled(mode, enabled) {
  cfg[mode] = cfg[mode] || {};
  cfg[mode].enabled = enabled;
  save(mode, 'enabled', enabled);
  buildPanelGrid();
  buildPanelTabs();
  buildPanelIcons();
  const prow = document.querySelector(`.prow[data-mode="${mode}"]`);
  if (prow) prow.classList.toggle('off', !enabled);
}

function toggleUseGlobal(mode, useGlobal) {
  _paintBrightnessRow(MODULE_PREFIX[mode], useGlobal);
  save(mode, 'use_global_brightness', useGlobal);
}

function _paintBrightnessRow(prefix, useGlobal) {
  const row = document.getElementById(prefix + '_bright_row');
  if (row) row.classList.toggle('global', useGlobal);
  const label = document.getElementById(prefix + '_global_label');
  if (label) label.textContent = useGlobal ? 'Global' : 'Local';
}

function toggleBeforeEvent(on) {
  const row = document.getElementById('md_hours_before_row');
  if (row) row.style.display = on ? 'flex' : 'none';
  save('dashboard', 'auto_trigger_before_event', on);
}

function toggleGrace(on) {
  const row = document.getElementById('md_grace_row');
  if (row) row.style.display = on ? 'flex' : 'none';
  save('dashboard', 'grace_minutes', on ? (+document.getElementById('md_grace_minutes').value || 10) : 0);
}

async function save(section, key, value) {
  if (section === 'clock' && key === 'blink_interval') {
    cfg.clock = cfg.clock || {};
    cfg.clock.blink_interval = value;
    applyBlinkRate();
  }
  try {
    const r = await fetch(`/config/${section}/${key}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({value})
    });
    if (!r.ok) throw new Error(await errorText(r));
    toast('Saved');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

async function apiTrigger(mode) {
  await fetch(`/mode/trigger/${mode}`, {method: 'POST'});
}
async function apiUntrigger(mode) { await fetch(`/mode/${mode}`, {method:'DELETE'}); }

async function setManual(mode, on) {
  if (on) {
    for (const m of [...manuals]) {
      if (m !== mode) {
        manuals.delete(m);
        await apiUntrigger(m);
        syncTriggerControls(m);
      }
    }
    if (mode !== 'nowplaying') await apiUntrigger('nowplaying');
    manuals.add(mode);
    await apiTrigger(mode);
    toast('Manual: ' + LABELS[mode]);
  } else {
    manuals.delete(mode);
    await apiUntrigger(mode);
    toast('Released: ' + LABELS[mode]);
  }
  syncTriggerControls(mode);
  updateTriggerUI();
  loadStatus();
}

function updateModeBtn(auto) {
  const btn = document.getElementById('mode-btn');
  if (!btn) return;
  btn.classList.toggle('auto', auto);
  btn.classList.toggle('manual', !auto);
  document.querySelector('.header-center')?.classList.toggle('manual', !auto);
  btn.title = auto ? 'Scheduler, click to hold the current panel' : 'Manual, click to hand back to the scheduler';
}

// from the header the override latches whatever is on screen right now
async function toggleAutoMode() {
  const auto = manuals.size === 0;
  if (!auto) return resetAll();
  const mode = statusData.active_mode;
  if (mode) await setManual(mode, true);
}

async function resetAll() {
  for (const mode of MODES) {
    manuals.delete(mode);
    syncTriggerControls(mode);
  }
  await fetch('/mode/reset', {method: 'POST'});
  toast('All triggers reset, scheduler takes over');
  updateTriggerUI(); loadStatus();
}

function syncTriggerControls() {
  updateTriggerUI();
}

function buildPanelGrid() {
  const grid = document.getElementById('panel-grid');
  if (!grid) return;
  grid.innerHTML = '';
  // reading order is priority order, highest top left
  modesByPriority().filter(m => cfg[m] ? (cfg[m].enabled ?? true) : true).forEach(mode => {
    const tile = document.createElement('button');
    tile.className = 'pgrid-tile';
    tile.dataset.mode = mode;
    tile.innerHTML = `<svg class="ico"><use href="${TRIG_ICONS[mode]}"/></svg>` +
      `<span class="pgrid-label">${LABELS[mode]}</span>`;
    tile.addEventListener('pointerdown', e => pressStart(mode, tile, e));
    tile.addEventListener('pointerup', () => pressEnd(mode, tile));
    tile.addEventListener('pointerleave', () => pressCancel(tile));
    tile.addEventListener('pointercancel', () => pressCancel(tile));
    tile.addEventListener('contextmenu', e => e.preventDefault());
    grid.appendChild(tile);
  });
  updateTriggerUI();
}

function initTriggerSegs() {
  document.querySelectorAll('.trig-seg').forEach(seg => {
    const mode = seg.dataset.mode;
    const hold = seg.querySelector('.trig-seg-hold');
    const always = seg.querySelector('.trig-seg-always');
    hold.addEventListener('pointerdown', e => {
      e.preventDefault();
      hold.setPointerCapture?.(e.pointerId);
      segHoldStart(mode, hold);
    });
    hold.addEventListener('pointerup', () => segHoldEnd(mode, hold));
    hold.addEventListener('pointercancel', () => segHoldEnd(mode, hold));
    hold.addEventListener('contextmenu', e => e.preventDefault());
    always.addEventListener('click', () => setManual(mode, !manuals.has(mode)));
  });
}

async function segHoldStart(mode, btn) {
  _segHolding = mode;
  btn.classList.add('on');
  await apiTrigger(mode);
  loadStatus();
}

async function segHoldEnd(mode, btn) {
  if (_segHolding !== mode) return;
  _segHolding = null;
  btn.classList.remove('on');
  if (!manuals.has(mode)) { await apiUntrigger(mode); loadStatus(); }
}

async function pressStart(mode, tile, e) {
  e.preventDefault();
  tile.setPointerCapture?.(e.pointerId);
  _pressMode = mode;
  _pressedAt = Date.now();
  tile.classList.add('pressing');
  // fire straight away so a hold lights the panel the instant it is touched
  if (!manuals.has(mode)) { await apiTrigger(mode); loadStatus(); }
}

function pressCancel(tile) {
  if (_pressMode === null) return;
  tile.classList.remove('pressing');
}

async function pressEnd(mode, tile) {
  if (_pressMode !== mode) return;
  const held = Date.now() - _pressedAt;
  _pressMode = null;
  tile.classList.remove('pressing');
  if (manuals.has(mode)) {
    if (held < HOLD_THRESHOLD_MS) await setManual(mode, false);
    return;
  }
  if (held < HOLD_THRESHOLD_MS) await setManual(mode, true);
  else { await apiUntrigger(mode); loadStatus(); }
  updateTriggerUI();
}

let _bpFullAnchor = null;

// the preview is moved, never copied, because the renderers address it by id
function openBlueprintFull() {
  const bp = document.getElementById('home-blueprint');
  const slot = document.getElementById('bp-full-slot');
  if (!bp || !slot) return;
  _bpFullAnchor = bp.nextElementSibling;
  slot.appendChild(bp);
  document.getElementById('bp-full-overlay').classList.add('show');
}

function closeBlueprintFull() {
  const bp = document.getElementById('home-blueprint');
  const pane = document.querySelector('#tab-home .pane-inner');
  document.getElementById('bp-full-overlay').classList.remove('show');
  if (bp && pane) pane.insertBefore(bp, _bpFullAnchor);
}

function pollHome() {
  if (exFrozen()) return;
  if (!twinOn()) return;
  if (document.getElementById('tab-home')?.classList.contains('active') && !document.hidden) {
    fetch('/home').then(r => r.json()).then(data => {
      updateBlueprint(data);
      updatePanelIcons(data.active_mode);
    }).catch(() => {});
  }
}

// every pulse shares one period, and a late starter is dialled back into phase
const PULSE_S = 3.4;

function syncPulse(el, on) {
  if (!on) { el.style.animationDelay = ''; delete el.dataset.pulsing; return; }
  if (el.dataset.pulsing) return;
  el.dataset.pulsing = '1';
  el.style.animationDelay = '-' + ((performance.now() / 1000) % PULSE_S).toFixed(3) + 's';
}

// a live hold drives the panel just as much as a latched trigger does
function _userDriving(mode) {
  return manuals.has(mode) || _pressMode === mode || _segHolding === mode;
}

function updateTriggerUI() {
  const active = statusData.active_mode;
  // nothing latched means the scheduler is driving
  const auto = manuals.size === 0;
  updateModeBtn(auto);
  document.querySelectorAll('.trig-seg').forEach(seg => {
    const always = seg.querySelector('.trig-seg-always');
    if (always) always.classList.toggle('on', manuals.has(seg.dataset.mode));
  });
  document.querySelectorAll('.pgrid-tile[data-mode]').forEach(tile => {
    const m = tile.dataset.mode;
    syncPulse(tile, tile.classList.toggle('active', m === active && !_userDriving(m)));
    tile.classList.toggle('held', manuals.has(m));
  });
  updatePanelIcons(active);
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else if (el.type === 'color') {
    el.value = Array.isArray(value) ? rgbToHex(value) : '#000000';
    const hexEl = document.getElementById(id + '_hex');
    if (hexEl) hexEl.textContent = el.value.toUpperCase();
  }
  else if (el.type === 'range') {
    el.value = value;
    const v = el.parentElement.querySelector('.val');
    if (v) v.textContent = String(v.textContent).endsWith('%')
      ? Math.round(value*100) + '%'
      : String(v.textContent).endsWith('s') ? value + 's' : value;
  }
  else el.value = value ?? '';
}

function _applyVisibility(prefix, mode, cfg_section) {
  const useGlobal = cfg_section.use_global_brightness ?? false;
  document.getElementById(prefix + '_use_global').checked = useGlobal;
  _paintBrightnessRow(prefix, useGlobal);
  _paintPreviewRow(mode);
}

function populate() {
  const d  = cfg.device            || {};
  const cl = cfg.clock             || {};
  const v  = cfg.verse_of_day      || {};
  const np = cfg.nowplaying        || {};
  const md = cfg.dashboard         || {};
  const w  = md.weather            || {};

  setField('d_brightness',  d.brightness ?? 50); nxt(document.getElementById('d_brightness'), x=>x);
  const mac = (d.mac_address || '').toUpperCase();
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById('mac' + i);
    if (el) el.value = mac.split(':')[i] || '';
  }
  setField('d_direct_connect', d.direct_connect ?? false);
  document.getElementById('flip_h').classList.toggle('on', !!d.flip_horizontal);
  document.getElementById('flip_v').classList.toggle('on', !!d.flip_vertical);
  setField('d_start_powered_off', d.start_powered_off ?? false);
  if (d.active_hours) {
    document.getElementById('d_always_on').checked = false;
    document.getElementById('d_hours_row').style.display = 'flex';
    document.getElementById('d_after_hours_sleep_row').style.display = '';
    setField('d_hour_from', d.active_hours[0]);
    setField('d_hour_to',   d.active_hours[1]);
  } else {
    document.getElementById('d_always_on').checked = true;
    document.getElementById('d_hours_row').style.display = 'none';
    document.getElementById('d_after_hours_sleep_row').style.display = 'none';
  }
  const sleepEnabled = d.after_hours_sleep_timer_enabled ?? false;
  setField('d_after_hours_sleep_enabled', sleepEnabled);
  document.getElementById('d_after_hours_sleep_slider').style.display = sleepEnabled ? 'flex' : 'none';
  setField('d_after_hours_sleep_minutes', d.after_hours_sleep_timer_minutes ?? 30);
  nxt(document.getElementById('d_after_hours_sleep_minutes'), x=>x+'m');
  _applyVisibility('cl', 'clock', cl);
  setField('cl_brightness', cl.brightness ?? 1); nxt(document.getElementById('cl_brightness'), x=>x);
  document.getElementById('cl_blink').value = cl.blink_interval ?? 1;
  setField('cl_color',      cl.color || [0,255,0]);
  document.getElementById('v_translation').value = v.translation ?? 'bibleapi:kjv';
  setField('v_duration',   Math.round((v.min_duration_s ?? 120) / 60));
  document.getElementById('v_prob').value = Math.round((v.probability ?? 0.3)*100);
  _applyVisibility('v', 'verse_of_day', v);
  setField('v_brightness', v.brightness ?? 100); nxt(document.getElementById('v_brightness'), x=>x);
  setField('v_color', v.color || [125,40,125]);
  if (v.active_hours) {
    document.getElementById('v_allhours').checked = false;
    document.getElementById('v_hours_row').style.display = 'flex';
    setField('v_hour_from', v.active_hours[0]);
    setField('v_hour_to',   v.active_hours[1]);
  }

  paintScrobbler(np.scrobbler ?? 'lastfm');
  _applyVisibility('np', 'nowplaying', np);
  setField('np_brightness',np.brightness ?? 50); nxt(document.getElementById('np_brightness'), x=>x);
  setField('np_font',      np.font ?? 3);
  setField('md_duration',  Math.round((md.min_duration_s ?? 3600) / 60));
  _applyVisibility('md', 'dashboard', md);
  setField('md_brightness',md.brightness ?? 50); nxt(document.getElementById('md_brightness'), x=>x);
  setField('md_auto_cal',     md.auto_trigger_on_calendar ?? true);
  setField('md_before_event', md.auto_trigger_before_event ?? false);
  setField('md_hours_before', md.hours_before_event ?? 2.0);
  document.getElementById('md_hours_before_row').style.display = (md.auto_trigger_before_event ?? false) ? 'flex' : 'none';
  const graceMin = md.grace_minutes ?? 0;
  setField('md_grace', graceMin > 0);
  setField('md_grace_minutes', graceMin || 10);
  document.getElementById('md_grace_row').style.display = graceMin > 0 ? 'flex' : 'none';

  const provider = w.provider ?? 'openmeteo';
  setField('w_provider', provider);
  const units = w.units ?? 'metric';
  document.getElementById('w_u_metric').classList.toggle('on', units === 'metric');
  document.getElementById('w_u_imperial').classList.toggle('on', units === 'imperial');
  setField('w_lat',      w.lat ?? '');
  setField('w_lon',      w.lon ?? '');
  setLocationName(w.location ?? '');
  paintLocationMode(w.location_mode === 'city' ? 'city' : 'coords');
}

function _reconcileTriggerState() {
  const triggered = new Set(statusData.triggered || []);
  const sources   = statusData.trigger_sources || {};

  MODES.forEach(mode => {
    // A "Hold to Trigger" press is a brief, local-only interaction, don't let a status poll landing mid-press reclassify it as a manual lock.
    if (mode === _pressMode || mode === _segHolding) return;

    const isUserTriggered = triggered.has(mode) && sources[mode] === 'user';

    if (!isUserTriggered) {
      manuals.delete(mode);
      syncTriggerControls(mode);
      return;
    }

    // Indefinite user trigger with no local record (like after a page reload). Recover it as a manual lock instead of leaving it stuck untracked in the UI while the server keeps it triggered forever.
    manuals.add(mode);
    syncTriggerControls(mode);
  });
}

async function loadStatus() {
  try {
    statusData = await fetch('/status').then(r => r.json());
    _linkUp   = !!statusData.connected;
    _retrying = !!statusData.reconnecting;
    _retryAt  = statusData.reconnect_in_s != null ? Date.now() + statusData.reconnect_in_s * 1000 : 0;
    if (statusData.connected) {
      const forS = statusData.connected_for_s;
      // re-anchoring every poll would pin the readout at zero, only correct real drift
      if (forS == null) {
        if (!_uptimeAt) { _uptimeBase = 0; _uptimeAt = Date.now(); }
      } else if (!_uptimeAt || Math.abs(_uptimeBase + (Date.now() - _uptimeAt) / 1000 - forS) > 3) {
        _uptimeBase = forS;
        _uptimeAt   = Date.now();
      }
    } else {
      _uptimeBase = 0;
      _uptimeAt   = 0;
    }
    paintLink();
    tickHeaderClock();
    // display_on is the scheduler's own flag, a dropped link says nothing about it
    const serverDisplayOn = statusData.display_on ?? true;
    if (serverDisplayOn !== _displayOn) {
      _displayOn = serverDisplayOn;
      updatePowerBtn();
    }
    const clearing = !!statusData.clearing;
    ['clearing-badge', 'clearing-badge-trigger'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = clearing ? '' : 'none';
    });
    _reconcileTriggerState();
    updateTriggerUI();
  } catch {
    _linkUp = false;
    paintLink();
    tickHeaderClock();
  }
}

function toggleAfterHoursSleepTimer(enabled) {
  const slider = document.getElementById('d_after_hours_sleep_slider');
  if (slider) slider.style.display = enabled ? 'flex' : 'none';
  save('device', 'after_hours_sleep_timer_enabled', enabled);
}

function toggleActiveHours(alwaysOn) {
  const row = document.getElementById('d_hours_row');
  if (row) row.style.display = alwaysOn ? 'none' : 'flex';
  if (alwaysOn) save('device', 'active_hours', null);
  else saveActiveHours();
}
function saveActiveHours() {
  const from = +document.getElementById('d_hour_from').value;
  const to   = +document.getElementById('d_hour_to').value;
  if (!isNaN(from) && !isNaN(to)) save('device', 'active_hours', [from, to]);
}

function toggleHours(allHours) {
  document.getElementById('v_hours_row').style.display = allHours ? 'none' : 'flex';
  if (allHours) save('verse_of_day','active_hours',null);
}
function saveHours() {
  save('verse_of_day','active_hours',[
    +document.getElementById('v_hour_from').value,
    +document.getElementById('v_hour_to').value
  ]);
}
function paintScrobbler(which) {
  document.getElementById('np_sc_lastfm').classList.toggle('on', which === 'lastfm');
  document.getElementById('np_sc_librefm').classList.toggle('on', which === 'librefm');
}
function setScrobbler(which) {
  paintScrobbler(which);
  save('nowplaying', 'scrobbler', which);
}
function setUnits(units) {
  document.getElementById('w_u_metric').classList.toggle('on', units === 'metric');
  document.getElementById('w_u_imperial').classList.toggle('on', units === 'imperial');
  saveWeather();
}
function onWeatherProviderChange() {
  saveWeather();
}
let _locationName = '';

function setLocationName(name) {
  _locationName = name;
  const el = document.getElementById('w_location');
  el.textContent = name || 'Not set';
  el.classList.toggle('unset', !name);
}

function locationMode() {
  return document.getElementById('w_m_city').classList.contains('on') ? 'city' : 'coords';
}
function paintLocationMode(mode) {
  document.getElementById('w_m_coords').classList.toggle('on', mode === 'coords');
  document.getElementById('w_m_city').classList.toggle('on', mode === 'city');
  document.getElementById('w_coords_row').style.display   = mode === 'coords' ? '' : 'none';
  document.getElementById('w_location_row').style.display = mode === 'city'   ? '' : 'none';
  const lat = document.getElementById('w_lat').value.trim();
  const lon = document.getElementById('w_lon').value.trim();
  document.getElementById('w_location_coords').textContent = lat && lon ? `${lat}, ${lon}` : '';
}
function setLocationMode(mode) {
  paintLocationMode(mode);
  saveWeather();
}
function saveWeather() {
  const units = document.getElementById('w_u_imperial').classList.contains('on') ? 'imperial' : 'metric';
  const weather = {
    provider:      document.getElementById('w_provider').value,
    units:         units,
    location_mode: locationMode(),
  };
  // an empty field leaves its key out, toml has no null to store
  const lat      = document.getElementById('w_lat').value.trim();
  const lon      = document.getElementById('w_lon').value.trim();
  if (lat)      weather.lat      = +lat;
  if (lon)      weather.lon      = +lon;
  weather.location = _locationName;
  paintLocationMode(weather.location_mode);
  save('dashboard', 'weather', weather);
}

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const ESRI_CANVAS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas';
const TILE_URLS   = {
  light: `${ESRI_CANVAS}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  dark:  `${ESRI_CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
};
const TILE_ATTRIB = 'Tiles &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin,'
                  + ' &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// leaflet's own prefix carries a flag, ours carries the credit and nothing else
const LEAFLET_PREFIX = '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>';

let _locMap    = null;
let _locTiles  = null;
let _locMarker = null;
let _locPick   = null;
let _locSeq    = 0;

const coord = n => (+n).toFixed(4);

function openLocationPicker() {
  const overlay = document.getElementById('loc-overlay');
  overlay.classList.add('show');
  const lat = +document.getElementById('w_lat').value || 0;
  const lon = +document.getElementById('w_lon').value || 0;
  _locPick = null;
  _locSeq++;
  clearLocResults();
  document.getElementById('loc-confirm').disabled = true;
  document.getElementById('loc-picked').textContent = 'Nothing picked yet';
  document.getElementById('loc-picked').classList.add('empty');
  if (!_locMap) {
    _locMap = L.map('loc-map', { attributionControl: true }).setView([lat, lon], 9);
    _locTiles = L.tileLayer(TILE_URLS[mapTheme()], {
      maxZoom: 18, maxNativeZoom: 16, attribution: TILE_ATTRIB,
    }).on('tileerror', () => document.getElementById('loc-offline').style.display = 'flex')
      .addTo(_locMap);
    _locMap.attributionControl.setPrefix(LEAFLET_PREFIX);
    _locMap.on('click', e => pickAt(e.latlng.lat, e.latlng.lng));
    document.getElementById('loc-results').addEventListener(
      'scroll', markLocResults, { passive: true });
  } else {
    _locMap.setView([lat, lon], 9);
  }
  if (_locMarker) { _locMap.removeLayer(_locMarker); _locMarker = null; }
  // leaflet measured a hidden box before the overlay opened
  setTimeout(() => _locMap.invalidateSize(), 0);
}

function mapTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function applyMapTheme() {
  if (_locTiles) _locTiles.setUrl(TILE_URLS[mapTheme()]);
}

function closeLocationPicker() {
  _locSeq++;
  document.getElementById('loc-overlay').classList.remove('show');
}

function placeMarker(lat, lon) {
  if (_locMarker) {
    _locMarker.setLatLng([lat, lon]);
  } else {
    const icon = L.divIcon({
      className: 'loc-pin', iconSize: [26, 26], iconAnchor: [13, 26],
      html: '<svg viewBox="0 0 24 24"><use href="#ico-pin"/></svg>',
    });
    _locMarker = L.marker([lat, lon], { draggable: true, icon }).addTo(_locMap);
    _locMarker.on('dragend', () => {
      const p = _locMarker.getLatLng();
      pickAt(p.lat, p.lng);
    });
  }
}

// nominatim wants a referer or user agent, the browser sends both by itself
async function pickAt(lat, lon) {
  const seq = ++_locSeq;
  _locPick = { lat: +lat, lon: +lon, name: '' };
  placeMarker(lat, lon);
  const el = document.getElementById('loc-picked');
  el.textContent = 'Loading...';
  el.classList.remove('empty');
  document.getElementById('loc-confirm').disabled = false;
  try {
    const url = `${REVERSE_URL}?format=jsonv2&zoom=10&accept-language=en&lat=${lat}&lon=${lon}`;
    const d = await fetch(url).then(r => r.json());
    if (seq !== _locSeq) return;
    _locPick.name = reverseName(d);
  } catch (e) {
    if (seq !== _locSeq) return;
  }
  paintPicked();
}

function reverseName(d) {
  const a = d.address || {};
  const place = a.city || a.town || a.village || a.municipality || a.county || d.name || '';
  return [place, a.country].filter(Boolean).join(', ');
}

function paintPicked() {
  if (!_locPick) return;
  const { lat, lon, name } = _locPick;
  const el = document.getElementById('loc-picked');
  el.classList.remove('empty');
  el.textContent = name ? `${name} (${coord(lat)}, ${coord(lon)})` : `${coord(lat)}, ${coord(lon)}`;
}

async function geocodeName(name) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=20&language=en&format=json`;
  return (await fetch(url).then(r => r.json())).results || [];
}

// every part gets tried as the place, so both orders of "country, city" land
async function geocodePlace(query) {
  const parts = query.split(',').map(s => s.trim()).filter(Boolean);
  let first = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const rest = parts.filter((_, pos) => pos !== i).map(p => p.toLowerCase());
    const hits = await geocodeName(parts[i]);
    if (!first.length) first = hits;
    const kept = hits.filter(h => rest.every(p => [h.country, h.admin1, h.admin2]
                                  .some(v => (v || '').toLowerCase().includes(p))));
    if (kept.length) return kept.slice(0, 8);
  }
  return first.slice(0, 8);
}

function clearLocResults() {
  const box = document.getElementById('loc-results');
  box.innerHTML = '';
  box.classList.remove('has-head', 'collapsed');
  document.getElementById('loc-results-head').style.display = 'none';
  markLocResults();
}

function showLocResultsHead(count) {
  const head = document.getElementById('loc-results-head');
  head.style.display = 'flex';
  head.classList.remove('collapsed');
  document.getElementById('loc-results').classList.remove('collapsed');
  document.getElementById('loc-results').classList.add('has-head');
  document.getElementById('loc-results-count').textContent =
    count === 1 ? '1 result' : `${count} results`;
}

function toggleLocResults() {
  const head = document.getElementById('loc-results-head');
  const box  = document.getElementById('loc-results');
  const open = head.classList.toggle('collapsed');
  box.classList.toggle('collapsed', open);
  markLocResults();
}

// the list scrolls with a hidden scrollbar, same trap as the tab bars
function markLocResults() {
  const box = document.getElementById('loc-results');
  const max = box.scrollHeight - box.clientHeight;
  box.classList.toggle('can-t', max > 1 && box.scrollTop > 1);
  box.classList.toggle('can-b', max > 1 && box.scrollTop < max - 1);
}

async function searchLocation() {
  const box = document.getElementById('loc-results');
  const q   = document.getElementById('loc-search').value.trim();
  if (!q) { clearLocResults(); return; }
  clearLocResults();
  box.innerHTML = '<div class="loc-none">Searching...</div>';
  let hits = [];
  try {
    hits = await geocodePlace(q);
  } catch (e) {
    box.innerHTML = '<div class="loc-none">Search failed, no connection.</div>';
    return;
  }
  if (!hits.length) { box.innerHTML = '<div class="loc-none">Nothing found.</div>'; return; }
  box.innerHTML = '';
  hits.forEach(h => {
    const where = [h.admin1, h.country].filter(Boolean).join(', ');
    const div = document.createElement('div');
    div.className = 'loc-hit';
    div.innerHTML = `${h.name} <span>${where}</span>`;
    div.onclick = () => takeHit(h);
    box.appendChild(div);
  });
  showLocResultsHead(hits.length);
  box.scrollTop = 0;
  markLocResults();
}

function takeHit(hit) {
  _locSeq++;
  _locPick = {
    lat:  hit.latitude,
    lon:  hit.longitude,
    name: [hit.name, hit.country].filter(Boolean).join(', '),
  };
  placeMarker(hit.latitude, hit.longitude);
  _locMap.setView([hit.latitude, hit.longitude], 11);
  document.getElementById('loc-confirm').disabled = false;
  clearLocResults();
  paintPicked();
}

function confirmLocation() {
  if (!_locPick) return;
  setField('w_lat', coord(_locPick.lat));
  setField('w_lon', coord(_locPick.lon));
  setLocationName(_locPick.name);
  closeLocationPicker();
  saveWeather();
}

const POLL_ACTIVE  = 1000;
const POLL_IDLE    = 3 * 60 * 1000;
const IDLE_AFTER   = 1 * 60 * 1000;

let _pollTimer  = null;
let _pollMs     = POLL_ACTIVE;
let _lastActive = Date.now();

function bumpActivity() {
  _lastActive = Date.now();
  if (_pollMs !== POLL_ACTIVE) {
    _pollMs = POLL_ACTIVE;
    clearInterval(_pollTimer);
    _pollTimer = setInterval(_tick, POLL_ACTIVE);
  }
}

function _tick() {
  if (document.hidden) return;
  if (_pollMs === POLL_ACTIVE && Date.now() - _lastActive > IDLE_AFTER) {
    _pollMs = POLL_IDLE;
    clearInterval(_pollTimer);
    _pollTimer = setInterval(_tick, POLL_IDLE);
  }
  loadStatus();
}

document.addEventListener('click',      bumpActivity);
document.addEventListener('input',      bumpActivity);
document.addEventListener('change',     bumpActivity);
document.addEventListener('keydown',    bumpActivity);
document.addEventListener('touchstart', bumpActivity, {passive: true});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { bumpActivity(); loadStatus(); }
});

const WH_TRIGGERS = {
  clock:        ['on_enter', 'on_exit'],
  verse_of_day: ['on_enter', 'on_exit', 'on_verse_change'],
  nowplaying:   ['on_enter', 'on_exit', 'on_song_change'],
  dashboard:    ['on_enter', 'on_exit'],
  device:       ['on_power_on', 'on_power_off', 'on_active_start', 'on_active_end'],
};
const WH_TRIGGER_LABELS = {
  on_enter: 'On Enter', on_exit: 'On Exit', on_song_change: 'On Song Change',
  on_verse_change: 'On Verse Change',
  on_power_on: 'Power On', on_power_off: 'Power Off',
  on_active_start: 'Active Hours Start', on_active_end: 'Active Hours End',
};
const WH_VAR_GROUPS = [
  { label: 'Track', vars: ['title','artist','album'] },
  { label: 'Hex', vars: ['accent1_hex','accent2_hex','accent3_hex'] },
  { label: 'RGB', vars: ['accent1_rgb','accent2_rgb','accent3_rgb'] },
  { label: 'R / G / B', vars: [
    'accent1_r','accent1_g','accent1_b',
    'accent2_r','accent2_g','accent2_b',
    'accent3_r','accent3_g','accent3_b',
  ]},
  { label: 'HSV', vars: ['accent1_hsv','accent2_hsv','accent3_hsv'] },
  { label: 'H / S / V', vars: [
    'accent1_h','accent1_s','accent1_v',
    'accent2_h','accent2_s','accent2_v',
    'accent3_h','accent3_s','accent3_v',
  ]},
  { label: 'Full Brightness Hex', vars: ['accent1_full_hex','accent2_full_hex','accent3_full_hex'] },
  { label: 'Full Brightness RGB', vars: ['accent1_full_rgb','accent2_full_rgb','accent3_full_rgb'] },
  { label: 'Full Brightness R / G / B', vars: [
    'accent1_full_r','accent1_full_g','accent1_full_b',
    'accent2_full_r','accent2_full_g','accent2_full_b',
    'accent3_full_r','accent3_full_g','accent3_full_b',
  ]},
];
const WH_VAR_GROUPS_VERSE = [
  { label: 'Verse', vars: ['reference', 'text'] },
  { label: 'Color', vars: ['accent1_hex','accent1_rgb','accent1_r','accent1_g','accent1_b'] },
  { label: 'HSV', vars: ['accent1_hsv','accent1_h','accent1_s','accent1_v'] },
  { label: 'Full Brightness', vars: ['accent1_full_hex','accent1_full_rgb','accent1_full_r','accent1_full_g','accent1_full_b'] },
];
const METHODS_WITH_BODY = new Set(['POST','PUT','PATCH']);

function toggleWebhooksEnabled(section, enabled) {
  cfg[section] = cfg[section] || {};
  cfg[section].webhooks_enabled = enabled;
  save(section, 'webhooks_enabled', enabled);
  const card = document.getElementById('wh-' + _whContainerId(section));
  const inner = card?.querySelector('.wh-card-inner');
  if (inner) inner.style.display = enabled ? '' : 'none';
}

function _whTitle(section) {
  return {clock:'Clock', verse_of_day:'Verse', nowplaying:'NowPlaying', dashboard:'Dashboard', device:'Device'}[section] + ' Webhooks';
}

function _whContainerId(section) {
  return {clock:'clock', verse_of_day:'verse', nowplaying:'np', dashboard:'dash', device:'device'}[section] || section;
}

function buildWebhookCard(section, containerId) {
  const hooks = cfg[section]?.webhooks || [];
  const enabled = cfg[section]?.webhooks_enabled ?? false;
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'card wh-card';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.innerHTML = `${_whTitle(section)}
    <label class="toggle" style="margin-left:auto">
      <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleWebhooksEnabled('${section}',this.checked)">
      <div class="t-track"></div><div class="t-thumb"></div>
    </label>`;
  card.appendChild(title);

  const inner = document.createElement('div');
  inner.className = 'wh-card-inner';
  inner.style.display = enabled ? '' : 'none';

  if (hooks.length === 0) {
    inner.innerHTML = `<div style="padding:12px 16px;font-size:12px;color:var(--muted)">No webhooks configured</div>`;
  }
  hooks.forEach((h, i) => {
    const item = document.createElement('div');
    item.className = 'wh-item';
    item.innerHTML = `
      <div class="wh-item-method">${(h.method||'GET').toUpperCase()}</div>
      <div class="wh-item-info" style="cursor:pointer" onclick="openWebhookModal('${section}',${i})">
        <div class="wh-item-trigger">${WH_TRIGGER_LABELS[h.trigger] || h.trigger}</div>
        <div class="wh-item-url">${h.url || '(no url)'}</div>
      </div>
      <button class="wh-del" onclick="deleteWebhook('${section}',${i})">×</button>
    `;
    inner.appendChild(item);
  });

  const addRow = document.createElement('div');
  addRow.style.cssText = 'padding:8px 16px;border-top:1px solid var(--border)';
  addRow.innerHTML = `<button class="btn btn-accent btn-sm" onclick="openWebhookModal('${section}',-1)">+ Add Webhook</button>`;
  inner.appendChild(addRow);

  card.appendChild(inner);
  container.appendChild(card);
}

function addHeaderRow(key, value) {
  const list = document.getElementById('wh-headers-list');
  const row = document.createElement('div');
  row.className = 'wh-header-row';
  row.innerHTML = `
    <input type="text" placeholder="Key" value="${key || ''}" style="flex:1">
    <input type="text" placeholder="Value" value="${value || ''}" style="flex:1.5">
    <button class="wh-header-del" onclick="this.parentElement.remove()">×</button>
  `;
  list.appendChild(row);
}

function _getHeadersFromUI() {
  const obj = {};
  document.querySelectorAll('#wh-headers-list .wh-header-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const k = inputs[0].value.trim();
    const v = inputs[1].value.trim();
    if (k) obj[k] = v;
  });
  return obj;
}

function onWhMethodChange() {
  const method = document.getElementById('wh-method').value;
  document.getElementById('wh-body-row').style.display = METHODS_WITH_BODY.has(method) ? '' : 'none';
}

let _varsOpen = false;

function _buildVarButtons(section) {
  const container = document.getElementById('wh-vars');
  const row = document.getElementById('wh-vars-row');
  container.innerHTML = '';
  _varsOpen = false;
  container.style.display = 'none';
  document.getElementById('wh-vars-btn').textContent = 'Variables ▸';

  const groups = section === 'nowplaying' ? WH_VAR_GROUPS
    : section === 'verse_of_day' ? WH_VAR_GROUPS_VERSE
    : null;
  if (!groups) {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  groups.forEach(group => {
    const sec = document.createElement('div');
    sec.className = 'wh-vars-group';
    sec.innerHTML = `<div class="wh-vars-group-label">${group.label}</div>`;
    const wrap = document.createElement('div');
    wrap.className = 'wh-vars';
    group.vars.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'wh-var-btn';
      btn.textContent = `{{${v}}}`;
      btn.onclick = () => _insertVar(v);
      wrap.appendChild(btn);
    });
    sec.appendChild(wrap);
    container.appendChild(sec);
  });
}

function toggleVarPanel() {
  _varsOpen = !_varsOpen;
  document.getElementById('wh-vars').style.display = _varsOpen ? '' : 'none';
  document.getElementById('wh-vars-btn').textContent = _varsOpen ? 'Variables ▾' : 'Variables ▸';
}

function _insertVar(name) {
  const ta = document.getElementById('wh-body');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = `{{${name}}}`;
  ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
}

function openWebhookModal(section, idx) {
  document.getElementById('wh-edit-section').value = section;
  document.getElementById('wh-edit-idx').value = idx;

  const sel = document.getElementById('wh-trigger');
  sel.innerHTML = '';
  (WH_TRIGGERS[section] || []).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = WH_TRIGGER_LABELS[t] || t;
    sel.appendChild(opt);
  });

  document.getElementById('wh-headers-list').innerHTML = '';

  if (idx >= 0) {
    const hook = (cfg[section]?.webhooks || [])[idx] || {};
    sel.value = hook.trigger || '';
    document.getElementById('wh-method').value = (hook.method || 'GET').toUpperCase();
    document.getElementById('wh-url').value = hook.url || '';
    document.getElementById('wh-body').value = hook.body || '';
    if (hook.headers && typeof hook.headers === 'object') {
      Object.entries(hook.headers).forEach(([k, v]) => addHeaderRow(k, v));
    }
  } else {
    document.getElementById('wh-method').value = 'POST';
    document.getElementById('wh-url').value = '';
    document.getElementById('wh-body').value = '';
  }

  onWhMethodChange();
  _buildVarButtons(section);
  document.getElementById('wh-modal-overlay').classList.add('show');
}

function closeWebhookModal() {
  document.getElementById('wh-modal-overlay').classList.remove('show');
}

async function saveWebhook() {
  const section = document.getElementById('wh-edit-section').value;
  const idx = +document.getElementById('wh-edit-idx').value;
  const method = document.getElementById('wh-method').value;
  const headers = _getHeadersFromUI();

  const hook = {
    trigger: document.getElementById('wh-trigger').value,
    method,
    url: document.getElementById('wh-url').value,
  };
  if (Object.keys(headers).length) hook.headers = headers;
  if (METHODS_WITH_BODY.has(method)) {
    const body = document.getElementById('wh-body').value;
    if (body) hook.body = body;
  }

  cfg[section] = cfg[section] || {};
  cfg[section].webhooks = cfg[section].webhooks || [];
  if (idx >= 0 && idx < cfg[section].webhooks.length) {
    cfg[section].webhooks[idx] = hook;
  } else {
    cfg[section].webhooks.push(hook);
  }

  await save(section, 'webhooks', cfg[section].webhooks);
  closeWebhookModal();
  refreshAllWebhookCards();
}

let _whPendingDelete = null;

function deleteWebhook(section, idx) {
  const wh = (cfg[section]?.webhooks || [])[idx];
  _whPendingDelete = {section, idx};
  const what = document.getElementById('wh-del-what');
  if (what) what.textContent = wh
    ? `${wh.method || 'GET'} ${wh.url || ''} on ${wh.trigger || 'this trigger'}`
    : 'This webhook';
  document.getElementById('wh-del-overlay').classList.add('show');
}

function closeDeleteWebhook() {
  _whPendingDelete = null;
  document.getElementById('wh-del-overlay').classList.remove('show');
}

async function confirmDeleteWebhook() {
  if (!_whPendingDelete) return;
  const {section, idx} = _whPendingDelete;
  closeDeleteWebhook();
  cfg[section] = cfg[section] || {};
  cfg[section].webhooks = cfg[section].webhooks || [];
  cfg[section].webhooks.splice(idx, 1);
  await save(section, 'webhooks', cfg[section].webhooks);
  refreshAllWebhookCards();
}

function refreshAllWebhookCards() {
  buildWebhookCard('clock', 'wh-clock');
  buildWebhookCard('verse_of_day', 'wh-verse');
  buildWebhookCard('nowplaying', 'wh-np');
  buildWebhookCard('dashboard', 'wh-dash');
  buildWebhookCard('device', 'wh-device');
}

// the header grows a row on mobile, so the sticky offsets have to be measured
// stacked, the second word is grown until it spans the first one exactly
function fitLogo() {
  const w1 = document.querySelector('.logo-w1');
  const w2 = document.querySelector('.logo-w2');
  if (!w1 || !w2) return;
  w2.style.fontSize = '';
  if (getComputedStyle(w2).display !== 'block') return;
  const base = parseFloat(getComputedStyle(w2).fontSize);
  const wide = w2.getBoundingClientRect().width;
  if (wide > 0) w2.style.fontSize = (base * w1.getBoundingClientRect().width / wide).toFixed(2) + 'px';
}

function measureChrome() {
  fitLogo();
  const root = document.documentElement;
  const hdr = document.querySelector('header');
  const bar = document.querySelector('.tab-bar');
  if (hdr) root.style.setProperty('--hdr-h', hdr.offsetHeight + 'px');
  if (bar) root.style.setProperty('--tabbar-h', bar.offsetHeight + 'px');
}

async function init() {
  try {
    cfg = await fetch('/config').then(r => r.json());
    populate();
    buildPanelGrid();
    buildPanelTabs();
    buildPanelIcons();
    buildEnabledList();
    initTriggerSegs();
    initHexLabels();
    refreshAllWebhookCards();
    initMacFields();
    initAppearance();
    initScrollEdges();
    measureChrome();
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBlueprintFull(); });
    new ResizeObserver(measureChrome).observe(document.querySelector('header'));
    await loadStatus();
    _pollTimer = setInterval(_tick, POLL_ACTIVE);
    setInterval(pollHome, 1000);
    showVersion();
    showUpdate();
    tickHeaderClock();
    setInterval(tickHeaderClock, 1000);
  } catch (e) {
    console.error('init failed:', e);
  }
}

const REPO_URL = 'https://github.com/posch-dev/smart-pixel-display';

// the about block stays blank until the pi answers, a wrong version is worse than none
function showVersion() {
  const el = document.getElementById('about-version');
  if (!el) return;
  fetch('/version').then(r => r.json()).then(d => {
    if (!d.version) return;
    el.textContent = 'v' + d.version;
    el.href = REPO_URL + '/releases/tag/v' + d.version;
  }).catch(() => {});
}

let _runningVersion = '';

// pi-hole style: the card stays hidden until the pi says there is something newer
function showUpdate() {
  const card = document.getElementById('update-card');
  if (!card) return;
  fetch('/update/status').then(r => r.json()).then(d => {
    _runningVersion = d.version || '';
    if (!d.newer) return;
    const shown = d.url ? '<a href="' + d.url + '" target="_blank" rel="noopener">' + d.latest + '</a>' : d.latest;
    document.getElementById('update-line').innerHTML = 'Newer version ' + shown + ' available.';
    document.getElementById('update-cmd').textContent = d.command;
    document.getElementById('update-btn').hidden = !d.can_install;
    card.hidden = false;
  }).catch(() => {});
}

function startUpdate() {
  const btn = document.getElementById('update-btn');
  btn.disabled = true;
  btn.textContent = 'Installing';
  fetch('/update', { method: 'POST' })
    .then(r => r.json())
    .then(d => { if (d.ok) _waitForRestart(); else btn.textContent = 'Failed'; })
    .catch(() => { btn.textContent = 'Failed'; });
}

// the pi goes away mid update, so a failed poll is the normal case here
function _waitForRestart() {
  const started = Date.now();
  const poll = setInterval(() => {
    if (Date.now() - started > 300000) { clearInterval(poll); return; }
    fetch('/version', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (d.version && d.version !== _runningVersion) { clearInterval(poll); location.reload(); }
    }).catch(() => {});
  }, 5000);
}

function initAppearance() {
  setThemeMode(getCookie('spd_theme') || localStorage.getItem('theme') || 'dark');
  setAccent(getCookie('spd_accent') || localStorage.getItem('accent') || DEFAULT_ACCENT);
  _applyPreviewMode(getCookie('spd_preview') || 'web');
  buildTwinPanels();
  applyTwin(twinOn());
  showSetting(currentSetting());
}

function flipToggle(key) {
  const el = document.getElementById(key === 'flip_horizontal' ? 'flip_h' : 'flip_v');
  const on = !el.classList.contains('on');
  el.classList.toggle('on', on);
  save('device', key, on);
}

function initHexLabels() {
  document.querySelectorAll('.color-hex').forEach(el => {
    el.addEventListener('mouseenter', () => {
      const hex = el.textContent.trim();
      if (!hex.startsWith('#') || hex.length !== 7) return;
      el.dataset.hex = hex;
      el.textContent = 'RGB(' + hexToRgb(hex).join(', ') + ')';
    });
    el.addEventListener('mouseleave', () => {
      if (!el.dataset.hex) return;
      el.textContent = el.dataset.hex;
      delete el.dataset.hex;
    });
  });
}

function initMacFields() {
  const inputs = [];
  for (let i = 0; i < 6; i++) inputs.push(document.getElementById('mac' + i));
  inputs.forEach((inp, i) => {
    if (!inp) return;
    inp.addEventListener('input', function() {
      let v = this.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase().slice(0, 2);
      this.value = v;
      if (v.length === 2 && i < 5) inputs[i + 1].focus();
      trySaveMac();
    });
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && this.value === '' && i > 0) inputs[i - 1].focus();
    });
    inp.addEventListener('paste', function(e) {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
      for (let k = 0; k < 6 && k * 2 < text.length; k++) {
        if (inputs[k]) inputs[k].value = text.slice(k * 2, k * 2 + 2);
      }
      trySaveMac();
    });
    inp.addEventListener('blur', trySaveMac);
  });
}

function trySaveMac() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const v = document.getElementById('mac' + i)?.value || '';
    if (v.length < 2) return;
    parts.push(v);
  }
  save('device', 'mac_address', parts.join(':'));
}

init();
