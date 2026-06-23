'use strict';

const MODES = ['clock','verse_of_day','nowplaying','dashboard'];
const LABELS = { clock:'Clock', verse_of_day:'Verse of Day', nowplaying:'NowPlaying', dashboard:'Dashboard' };
const MODULE_PREFIX = { clock:'cl', verse_of_day:'v', nowplaying:'np', dashboard:'md' };

let cfg = {};
let statusData = {};
let _displayOn = true;

const manuals  = new Set();
const timeds   = {};

function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  document.getElementById('theme-btn').textContent = next === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('theme', next);
}

function setAccent(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const root = document.documentElement;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-d', `rgba(${r},${g},${b},.12)`);
  document.getElementById('accent-pick').value = hex;
  localStorage.setItem('accent', hex);
}

(function initAppearance() {
  const theme  = localStorage.getItem('theme')  || 'dark';
  const accent = localStorage.getItem('accent') || '#87a878';
  document.documentElement.dataset.theme = theme;
  document.getElementById('theme-btn').textContent = theme === 'dark' ? '🌙' : '☀️';
  setAccent(accent);
})();

function showTab(id) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  event.currentTarget.classList.add('active');
  document.getElementById('panel-tabs').classList.toggle('visible', id === 'modules');
}

function showPanel(id) {
  document.querySelectorAll('.panel-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.panel-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  event.currentTarget.classList.add('active');
}

function rgbToHex([r,g,b]) { return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join(''); }
function hexToRgb(hex) { return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)); }
function nxt(el, fmt) { el.nextElementSibling.textContent = fmt(el.value); }
function fmtDur(s) {
  if (s <= 0) return '0s';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return sec + 's';
}
function fmtMs(ms) { return fmtDur(Math.max(0, Math.round((ms - Date.now()) / 1000))); }

function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show ' + type;
  clearTimeout(el._t); el._t = setTimeout(() => el.className = '', 2200);
}

async function togglePower() {
  const next = !_displayOn;
  try {
    const r = await fetch('/display/power', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({on: next})
    });
    if (!r.ok) throw new Error(await r.text());
    _displayOn = next;
    toast(next ? 'Display On' : 'Display Off');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
  updatePowerBtn();
}

function updatePowerBtn() {
  const btn = document.getElementById('power-btn');
  if (!btn) return;
  btn.classList.toggle('off', !_displayOn);
  btn.title = _displayOn ? 'Turn Off Display' : 'Turn On Display';
}

function toggleEnabled(mode, enabled) {
  const prefix = MODULE_PREFIX[mode];
  const el = document.getElementById(prefix + '_settings');
  if (el) el.style.display = enabled ? '' : 'none';
  cfg[mode] = cfg[mode] || {};
  cfg[mode].enabled = enabled;
  save(mode, 'enabled', enabled);
  updateTriggerCardStates();
}

function toggleUseGlobal(mode, useGlobal) {
  const prefix = MODULE_PREFIX[mode];
  document.getElementById(prefix + '_brightness_row').style.display = useGlobal ? 'none' : '';
  save(mode, 'use_global_brightness', useGlobal);
}

function toggleBeforeEvent(on) {
  document.getElementById('md_hours_before_row').style.display = on ? '' : 'none';
  save('dashboard', 'auto_trigger_before_event', on);
}

async function savePriority(mode, newPrio) {
  const oldPrio = cfg[mode]?.priority;
  const conflict = MODES.find(m => m !== mode && cfg[m]?.priority === newPrio);
  if (conflict && oldPrio !== undefined && oldPrio !== newPrio) {
    cfg[conflict] = cfg[conflict] || {};
    cfg[conflict].priority = oldPrio;
    await save(conflict, 'priority', oldPrio);
    document.getElementById('prio-sel-' + conflict).value = oldPrio;
  }
  cfg[mode] = cfg[mode] || {};
  cfg[mode].priority = newPrio;
  await save(mode, 'priority', newPrio);
  document.getElementById('prio-sel-' + mode).value = newPrio;
}

const _DOTS = ['.', '..', '...'];
let _dotIdx = 0, _dotTimer = null;

function _showConnecting() {
  document.getElementById('connecting-overlay').classList.add('show');
  if (!_dotTimer) _dotTimer = setInterval(() => {
    document.getElementById('connecting-dots').textContent = _DOTS[_dotIdx++ % _DOTS.length];
  }, 500);
}
function _hideConnecting() {
  document.getElementById('connecting-overlay').classList.remove('show');
  clearInterval(_dotTimer); _dotTimer = null; _dotIdx = 0;
}

async function save(section, key, value) {
  try {
    const r = await fetch(`/config/${section}/${key}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({value})
    });
    if (!r.ok) throw new Error(await r.text());
    toast('Saved');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

async function apiTrigger(mode)   { await fetch(`/mode/trigger/${mode}`, {method:'POST'}); }
async function apiUntrigger(mode) { await fetch(`/mode/${mode}`, {method:'DELETE'}); }

async function setManual(mode, on) {
  if (on) {
    for (const m of [...manuals]) {
      if (m !== mode) {
        manuals.delete(m);
        if (!timeds[m]) await apiUntrigger(m);
        syncTriggerControls(m);
      }
    }
    if (timeds[mode]) { clearInterval(timeds[mode].intervalId); delete timeds[mode]; }
    if (mode !== 'nowplaying') await apiUntrigger('nowplaying');
    manuals.add(mode);
    await apiTrigger(mode);
    toast('Manual: ' + LABELS[mode]);
  } else {
    manuals.delete(mode);
    if (!timeds[mode]) await apiUntrigger(mode);
    toast('Released: ' + LABELS[mode]);
  }
  syncTriggerControls(mode);
  updateTriggerUI();
  loadStatus();
}

async function startTimed(mode, totalMs) {
  for (const m of Object.keys(timeds)) {
    if (m !== mode) {
      clearInterval(timeds[m].intervalId);
      delete timeds[m];
      if (!manuals.has(m)) await apiUntrigger(m);
      syncTriggerControls(m);
    }
  }
  if (timeds[mode]) { clearInterval(timeds[mode].intervalId); delete timeds[mode]; }
  if (mode !== 'nowplaying') await apiUntrigger('nowplaying');
  const expiresAt = Date.now() + totalMs;
  await apiTrigger(mode);
  const intervalId = setInterval(async () => {
    if (Date.now() >= expiresAt) {
      clearInterval(timeds[mode]?.intervalId);
      delete timeds[mode];
      if (!manuals.has(mode)) await apiUntrigger(mode);
      syncTriggerControls(mode);
      updateTriggerUI(); loadStatus();
    } else {
      updateTriggerUI();
    }
  }, 1000);
  timeds[mode] = {expiresAt, intervalId};
  toast('Timed: ' + LABELS[mode] + ' for ' + fmtDur(Math.round(totalMs/1000)));
  updateTriggerUI(); loadStatus();
}

async function holdStart(mode, btn) {
  btn.classList.add('holding');
  if (mode !== 'nowplaying') await apiUntrigger('nowplaying');
  await apiTrigger(mode);
  updateTriggerUI(); loadStatus();
}

async function holdEnd(mode, btn) {
  btn.classList.remove('holding');
  if (!manuals.has(mode) && !timeds[mode]) await apiUntrigger(mode);
  updateTriggerUI(); loadStatus();
}

async function resetAll() {
  for (const mode of MODES) {
    manuals.delete(mode);
    if (timeds[mode]) { clearInterval(timeds[mode].intervalId); delete timeds[mode]; }
    syncTriggerControls(mode);
  }
  await fetch('/mode/reset', {method: 'POST'});
  toast('All triggers reset — scheduler takes over');
  updateTriggerUI(); loadStatus();
}

function syncTriggerControls(mode) {
  const manualOn = manuals.has(mode);
  const timedRow = document.getElementById('timed-row-' + mode);
  const manualCb = document.getElementById('manual-cb-' + mode);
  if (timedRow)  timedRow.classList.toggle('trig-row-disabled', manualOn);
  if (manualCb)  manualCb.checked = manualOn;
}

function buildTriggerCards() {
  const container = document.getElementById('trigger-cards');
  container.innerHTML = '';
  MODES.forEach(mode => {
    const card = document.createElement('div');
    card.className = 'mode-trigger-card';
    card.id = 'tcard-' + mode;
    card.innerHTML = `
      <div class="mode-trigger-header">
        <div class="badge-active-dot"></div>
        <div class="mode-trigger-name">${LABELS[mode]}</div>
        <span class="disabled-badge" style="display:none;font-size:10px;color:var(--muted);margin-left:auto">disabled</span>
      </div>

      <div class="trig-row">
        <div class="trig-row-label">Manual</div>
        <div class="trig-row-content">
          <label class="toggle">
            <input type="checkbox" id="manual-cb-${mode}" class="manual-toggle"
              onchange="setManual('${mode}', this.checked)">
            <div class="t-track"></div><div class="t-thumb"></div>
          </label>
          <span style="font-size:12px;color:var(--muted)">Hold indefinitely</span>
        </div>
      </div>

      <div class="trig-row" id="timed-row-${mode}">
        <div class="trig-row-label">Timed</div>
        <div class="trig-row-content" style="flex-wrap:wrap;row-gap:6px">
          <input type="number" min="0" max="23" style="width:46px"
            id="th-${mode}" placeholder="HH">
          <input type="number" min="0" max="59" style="width:46px"
            id="tm-${mode}" placeholder="MM">
          <input type="number" min="0" max="59" style="width:46px"
            id="ts-${mode}" placeholder="SS">
          <button class="btn btn-accent btn-sm"
            onclick="startTimedFromInputs('${mode}')">▶</button>
          <span id="tcountdown-${mode}" style="font-size:11px;color:var(--blue);width:100%;line-height:1"></span>
        </div>
      </div>

      <div class="trig-row">
        <div class="trig-row-label">Hold</div>
        <div class="trig-row-content">
          <button class="btn-hold"
            onmousedown="holdStart('${mode}',this)"
            onmouseup="holdEnd('${mode}',this)"
            onmouseleave="holdEnd('${mode}',this)"
            ontouchstart="holdStart('${mode}',this);event.preventDefault()"
            ontouchend="holdEnd('${mode}',this)"
            ontouchcancel="holdEnd('${mode}',this)">
            Hold to Trigger
          </button>
          <span style="font-size:12px;color:var(--muted)">Active while pressed</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
  updateTriggerCardStates();
}

function updateTriggerCardStates() {
  MODES.forEach(mode => {
    const card = document.getElementById('tcard-' + mode);
    if (!card) return;
    const section = mode === 'clock' ? 'clock' : mode;
    const enabled = cfg[section]?.enabled ?? true;
    card.classList.toggle('trig-disabled', !enabled);
    const badge = card.querySelector('.disabled-badge');
    if (badge) badge.style.display = enabled ? 'none' : '';
    card.querySelectorAll('input, button.btn-hold, button.btn-accent').forEach(el => {
      if (!enabled) el.disabled = true;
      else el.disabled = false;
    });
  });
}

function startTimedFromInputs(mode) {
  const h = +document.getElementById('th-' + mode).value || 0;
  const m = +document.getElementById('tm-' + mode).value || 0;
  const s = +document.getElementById('ts-' + mode).value || 0;
  const ms = (h * 3600 + m * 60 + s) * 1000;
  if (ms <= 0) { toast('Enter a duration first', 'err'); return; }
  startTimed(mode, ms);
}

function updateTriggerUI() {
  const activeMode = statusData.active_mode || '—';

  MODES.forEach(mode => {
    const el = document.getElementById('tcountdown-' + mode);
    if (!el) return;
    if (timeds[mode]) {
      const rem = timeds[mode].expiresAt - Date.now();
      el.textContent = rem > 0 ? fmtMs(timeds[mode].expiresAt) + ' remaining' : '';
    } else {
      el.textContent = '';
    }
    const card = document.getElementById('tcard-' + mode);
    if (card) {
      const isActive = activeMode === mode;
      card.classList.toggle('is-active', isActive);
      const isAuto = isActive && statusData.trigger_sources && statusData.trigger_sources[mode] === 'auto';
      card.classList.toggle('auto-triggered', isAuto);
    }
  });

  const modeText = LABELS[activeMode] || activeMode;
  document.getElementById('trig-mode-text').textContent = modeText;

  let typeText = 'auto (scheduler)';
  let countdown = null;

  if (manuals.has(activeMode)) {
    typeText = 'Manual lock — indefinite';
  } else if (timeds[activeMode]) {
    const rem = timeds[activeMode].expiresAt - Date.now();
    typeText = 'Timed';
    countdown = rem > 0 ? fmtMs(timeds[activeMode].expiresAt) + ' remaining' : 'Expired';
  } else {
    const holdBtn = document.querySelector('.btn-hold.holding');
    if (holdBtn) typeText = 'Hold — while pressed';
  }

  document.getElementById('trig-type-text').textContent = typeText;
  const cdEl = document.getElementById('trig-countdown');
  if (countdown) { cdEl.textContent = countdown; cdEl.style.display = ''; }
  else { cdEl.style.display = 'none'; }
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else if (el.type === 'color') el.value = Array.isArray(value) ? rgbToHex(value) : '#000000';
  else if (el.type === 'range') {
    el.value = value;
    const v = el.nextElementSibling;
    if (v) v.textContent = String(v.textContent).endsWith('%')
      ? Math.round(value*100) + '%'
      : String(v.textContent).endsWith('s') ? value + 's' : value;
  }
  else el.value = value ?? '';
}

function _applyVisibility(prefix, mode, cfg_section) {
  const enabled = cfg_section.enabled ?? true;
  const el = document.getElementById(prefix + '_settings');
  if (el) el.style.display = enabled ? '' : 'none';
  const useGlobal = cfg_section.use_global_brightness ?? false;
  document.getElementById(prefix + '_use_global').checked = useGlobal;
  document.getElementById(prefix + '_brightness_row').style.display = useGlobal ? 'none' : '';
}

function populate() {
  const d  = cfg.device            || {};
  const cl = cfg.clock             || {};
  const v  = cfg.verse_of_day      || {};
  const np = cfg.nowplaying        || {};
  const md = cfg.dashboard         || {};
  const w  = md.weather            || {};

  setField('mac_address',   d.mac_address);
  setField('d_brightness',  d.brightness ?? 50); nxt(document.getElementById('d_brightness'), x=>x);
  setField('flip_v',        d.flip_vertical);
  setField('flip_h',        d.flip_horizontal);
  setField('reconnect_delay', d.reconnect_delay ?? 3);
  if (d.active_hours) {
    document.getElementById('d_always_on').checked = false;
    document.getElementById('d_hours_row').style.display = '';
    setField('d_hour_from', d.active_hours[0]);
    setField('d_hour_to',   d.active_hours[1]);
  } else {
    document.getElementById('d_always_on').checked = true;
    document.getElementById('d_hours_row').style.display = 'none';
  }

  setField('cl_enabled',    cl.enabled);
  document.getElementById('prio-sel-clock').value = cl.priority ?? 1;
  _applyVisibility('cl', 'clock', cl);
  setField('cl_brightness', cl.brightness ?? 1); nxt(document.getElementById('cl_brightness'), x=>x);
  setField('cl_blink',      cl.blink_interval ?? 2); nxt(document.getElementById('cl_blink'), x=>x+'s');
  setField('cl_color',      cl.color || [0,255,0]);

  setField('v_enabled',    v.enabled);
  document.getElementById('prio-sel-verse_of_day').value = v.priority ?? 2;
  setField('v_duration',   Math.round((v.min_duration_s ?? 120) / 60));
  const prob = Math.round((v.probability ?? 0.3)*100);
  setField('v_prob', prob); document.querySelector('#v_prob+.val').textContent = prob + '%';
  _applyVisibility('v', 'verse_of_day', v);
  setField('v_brightness', v.brightness ?? 100); nxt(document.getElementById('v_brightness'), x=>x);
  setField('v_color', v.color || [125,40,125]);
  if (v.active_hours) {
    document.getElementById('v_allhours').checked = false;
    document.getElementById('v_hours_row').style.display = '';
    setField('v_hour_from', v.active_hours[0]);
    setField('v_hour_to',   v.active_hours[1]);
  }

  setField('np_enabled',   np.enabled);
  setField('np_scrobbler', np.scrobbler ?? 'lastfm');
  document.getElementById('prio-sel-nowplaying').value = np.priority ?? 3;
  _applyVisibility('np', 'nowplaying', np);
  setField('np_brightness',np.brightness ?? 50); nxt(document.getElementById('np_brightness'), x=>x);
  setField('np_font',      np.font ?? 3);
  setField('np_slot_a',    np.slot_a ?? 0);
  setField('np_slot_b',    np.slot_b ?? 1);
  setField('np_chunk_s',   np.chunk_s ?? 20);
  setField('np_poll_s',    np.poll_s ?? 0.5);

  setField('md_enabled',   md.enabled);
  document.getElementById('prio-sel-dashboard').value = md.priority ?? 4;
  setField('md_duration',  Math.round((md.min_duration_s ?? 3600) / 60));
  _applyVisibility('md', 'dashboard', md);
  setField('md_brightness',md.brightness ?? 50); nxt(document.getElementById('md_brightness'), x=>x);
  setField('md_auto_cal',     md.auto_trigger_on_calendar ?? true);
  setField('md_before_event', md.auto_trigger_before_event ?? false);
  setField('md_hours_before', md.hours_before_event ?? 2.0);
  document.getElementById('md_hours_before_row').style.display = (md.auto_trigger_before_event ?? false) ? '' : 'none';

  const provider = w.provider ?? 'openmeteo';
  setField('w_provider', provider);
  setField('w_units',    w.units    ?? 'metric');
  setField('w_lat',      w.lat ?? '');
  setField('w_lon',      w.lon ?? '');
  setField('w_location', w.location ?? '');
  document.getElementById('w_location_row').style.display = provider === 'wttr' ? '' : 'none';
}

async function loadStatus() {
  try {
    statusData = await fetch('/status').then(r => r.json());
    document.getElementById('s-mode').textContent  = (statusData.active_mode || '—').replace(/_/g,' ');
    document.getElementById('s-since').textContent = fmtDur(Math.round(statusData.active_for_s || 0));
    if (!statusData.connected && statusData.in_active_hours) {
      _showConnecting();
    } else {
      _hideConnecting();
    }
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
    updateTriggerUI();
  } catch {
    _showConnecting();
  }
}

function toggleActiveHours(alwaysOn) {
  document.getElementById('d_hours_row').style.display = alwaysOn ? 'none' : '';
  if (alwaysOn) save('device', 'active_hours', null);
  else saveActiveHours();
}
function saveActiveHours() {
  const from = +document.getElementById('d_hour_from').value;
  const to   = +document.getElementById('d_hour_to').value;
  if (!isNaN(from) && !isNaN(to)) save('device', 'active_hours', [from, to]);
}

function toggleHours(allHours) {
  document.getElementById('v_hours_row').style.display = allHours ? 'none' : '';
  if (allHours) save('verse_of_day','active_hours',null);
}
function saveHours() {
  save('verse_of_day','active_hours',[
    +document.getElementById('v_hour_from').value,
    +document.getElementById('v_hour_to').value
  ]);
}
function onWeatherProviderChange() {
  const provider = document.getElementById('w_provider').value;
  document.getElementById('w_location_row').style.display = provider === 'wttr' ? '' : 'none';
  saveWeather();
}
function saveWeather() {
  save('dashboard','weather',{
    provider: document.getElementById('w_provider').value,
    units:    document.getElementById('w_units').value,
    lat:      +document.getElementById('w_lat').value || null,
    lon:      +document.getElementById('w_lon').value || null,
    location: document.getElementById('w_location').value || null,
  });
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
  verse_of_day: ['on_enter', 'on_exit'],
  nowplaying:   ['on_enter', 'on_exit', 'on_song_change'],
  dashboard:    ['on_enter', 'on_exit'],
  device:       ['on_power_on', 'on_power_off', 'on_active_start', 'on_active_end'],
};
const WH_TRIGGER_LABELS = {
  on_enter: 'On Enter', on_exit: 'On Exit', on_song_change: 'On Song Change',
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
const METHODS_WITH_BODY = new Set(['POST','PUT','PATCH']);

function toggleWebhooksEnabled(section, enabled) {
  cfg[section] = cfg[section] || {};
  cfg[section].webhooks_enabled = enabled;
  save(section, 'webhooks_enabled', enabled);
  const card = document.getElementById('wh-' + _whContainerId(section));
  const inner = card?.querySelector('.wh-card-inner');
  if (inner) inner.style.display = enabled ? '' : 'none';
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
  title.innerHTML = `Webhooks
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

  if (section !== 'nowplaying') {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  WH_VAR_GROUPS.forEach(group => {
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

async function deleteWebhook(section, idx) {
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

async function init() {
  cfg = await fetch('/config').then(r => r.json());
  populate();
  buildTriggerCards();
  refreshAllWebhookCards();
  await loadStatus();
  _pollTimer = setInterval(_tick, POLL_ACTIVE);
}

init();
