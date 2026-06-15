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

function toggleUseGlobal(mode, useGlobal) {
  const prefix = MODULE_PREFIX[mode];
  document.getElementById(prefix + '_local_slider').style.display = useGlobal ? 'none' : '';
  save(mode, 'use_global_brightness', useGlobal);
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

function _applyUseGlobal(prefix, useGlobal) {
  document.getElementById(prefix + '_local_slider').style.display = useGlobal ? 'none' : '';
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
    document.getElementById('d_hour_range').style.display = 'flex';
    setField('d_hour_from', d.active_hours[0]);
    setField('d_hour_to',   d.active_hours[1]);
  } else {
    document.getElementById('d_always_on').checked = true;
    document.getElementById('d_hour_range').style.display = 'none';
  }

  setField('cl_enabled',    cl.enabled);
  document.getElementById('prio-sel-clock').value = cl.priority ?? 1;
  const clGlobal = cl.use_global_brightness ?? false;
  document.getElementById('cl_use_global').checked = clGlobal;
  _applyUseGlobal('cl', clGlobal);
  setField('cl_brightness', cl.brightness ?? 1); nxt(document.getElementById('cl_brightness'), x=>x);
  setField('cl_blink',      cl.blink_interval ?? 2); nxt(document.getElementById('cl_blink'), x=>x+'s');
  setField('cl_color',      cl.color || [0,255,0]);

  setField('v_enabled',    v.enabled);
  document.getElementById('prio-sel-verse_of_day').value = v.priority ?? 2;
  setField('v_duration',   Math.round((v.min_duration_s ?? 120) / 60));
  const prob = Math.round((v.probability ?? 0.3)*100);
  setField('v_prob', prob); document.querySelector('#v_prob+.val').textContent = prob + '%';
  const vGlobal = v.use_global_brightness ?? false;
  document.getElementById('v_use_global').checked = vGlobal;
  _applyUseGlobal('v', vGlobal);
  setField('v_brightness', v.brightness ?? 100); nxt(document.getElementById('v_brightness'), x=>x);
  setField('v_color', v.color || [125,40,125]);
  if (v.active_hours) {
    document.getElementById('v_allhours').checked = false;
    toggleHours(false);
    setField('v_hour_from', v.active_hours[0]);
    setField('v_hour_to',   v.active_hours[1]);
  }

  setField('np_enabled',   np.enabled);
  setField('np_scrobbler', np.scrobbler ?? 'lastfm');
  document.getElementById('prio-sel-nowplaying').value = np.priority ?? 3;
  const npGlobal = np.use_global_brightness ?? false;
  document.getElementById('np_use_global').checked = npGlobal;
  _applyUseGlobal('np', npGlobal);
  setField('np_brightness',np.brightness ?? 50); nxt(document.getElementById('np_brightness'), x=>x);
  setField('np_font',      np.font ?? 3);
  setField('np_slot_a',    np.slot_a ?? 0);
  setField('np_slot_b',    np.slot_b ?? 1);
  setField('np_chunk_s',   np.chunk_s ?? 20);
  setField('np_poll_s',    np.poll_s ?? 0.5);

  setField('md_enabled',   md.enabled);
  document.getElementById('prio-sel-dashboard').value = md.priority ?? 4;
  setField('md_duration',  Math.round((md.min_duration_s ?? 3600) / 60));
  const mdGlobal = md.use_global_brightness ?? false;
  document.getElementById('md_use_global').checked = mdGlobal;
  _applyUseGlobal('md', mdGlobal);
  setField('md_brightness',md.brightness ?? 50); nxt(document.getElementById('md_brightness'), x=>x);

  setField('w_provider', w.provider ?? 'openmeteo');
  setField('w_units',    w.units    ?? 'metric');
  setField('w_lat',      w.lat ?? '');
  setField('w_lon',      w.lon ?? '');
  setField('w_location', w.location ?? '');
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
  document.getElementById('d_hour_range').style.display = alwaysOn ? 'none' : 'flex';
  if (alwaysOn) save('device', 'active_hours', null);
  else saveActiveHours();
}
function saveActiveHours() {
  const from = +document.getElementById('d_hour_from').value;
  const to   = +document.getElementById('d_hour_to').value;
  if (!isNaN(from) && !isNaN(to)) save('device', 'active_hours', [from, to]);
}

function toggleHours(allHours) {
  document.getElementById('v_hour_range').style.display = allHours ? 'none' : 'flex';
  if (allHours) save('verse_of_day','active_hours',null);
}
function saveHours() {
  save('verse_of_day','active_hours',[
    +document.getElementById('v_hour_from').value,
    +document.getElementById('v_hour_to').value
  ]);
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

async function init() {
  cfg = await fetch('/config').then(r => r.json());
  populate();
  buildTriggerCards();
  await loadStatus();
  _pollTimer = setInterval(_tick, POLL_ACTIVE);
}

init();
