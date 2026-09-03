// Everything that draws the live preview. Loaded before script.js and shared with
// the standalone preview page, so nothing in here may touch the settings ui.

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function rgbToHex([r,g,b]) { return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join(''); }
function hexToRgb(hex) { return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)); }

// the accent is drawn as text on both card colours, so it has to clear
// a floor against each of them
const ACCENT_MIN_ON_LIGHT = 2.4;
const ACCENT_MIN_ON_DARK  = 3.0;
const LUM_LIGHT_CARD = 1.0;
const LUM_DARK_CARD  = _luminance([30, 30, 30]);

function _luminance([r, g, b]) {
  const f = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function _contrast(a, b) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = t => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(v => Math.round(v * 255));
}

function _accentLegible(h, s, l) {
  if (l < 0 || l > 1) return false;
  const lum = _luminance(hslToRgb(h, s, l));
  return _contrast(lum, LUM_LIGHT_CARD) >= ACCENT_MIN_ON_LIGHT
      && _contrast(lum, LUM_DARK_CARD) >= ACCENT_MIN_ON_DARK;
}

function clampAccent(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  let best = null, bestDist = Infinity;
  // hue and saturation stay, only lightness moves into the legible band
  for (let i = 0; i <= 100; i++) {
    const cand = i / 100;
    if (!_accentLegible(h, s, cand)) continue;
    const d = Math.abs(cand - l);
    if (d < bestDist) { bestDist = d; best = cand; }
  }
  return best === null ? hex : rgbToHex(hslToRgb(h, s, best));
}

// lighter by preference, darker when lighter would leave the legible band
function accentVariant(hex, delta) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  for (const cand of [l + delta, l - delta]) {
    if (_accentLegible(h, s, cand)) return rgbToHex(hslToRgb(h, s, cand));
  }
  return hex;
}

function complementAccent(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return clampAccent(rgbToHex(hslToRgb((h + 0.5) % 1, s, l)));
}

function previewAccent(hex) {
  const [r, g, b] = hexToRgb(hex);
  const root = document.documentElement;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-d', `rgba(${r},${g},${b},.12)`);
  root.style.setProperty('--accent-c', complementAccent(hex));
  root.style.setProperty('--accent-hd', accentVariant(hex, 0.22));
  const hexLabel = document.getElementById('accent-hex');
  if (hexLabel) hexLabel.textContent = hex.toUpperCase();
}

// 'pixel' paints the tile in the colours the matrix uses, 'web' in the ui accent
let _previewMode = 'web';

let _activePreview = 'web';

// a panel may opt out of the global choice and carry its own
function previewModeFor(mode) {
  const c = cfg[mode];
  if (c && c.use_global_preview === false) return c.preview_mode || _previewMode;
  return _previewMode;
}

// only the blueprint follows the panel, the rest of the ui stays on the device choice
function applyActivePreview(mode) {
  _activePreview = previewModeFor(mode);
  const bp = document.getElementById('home-blueprint');
  if (bp) bp.dataset.preview = _activePreview;
}

const BP_WEATHER_ICONS = {
  'clear': '#ico-sun', 'partly cloudy': '#ico-cloud-sun', 'overcast': '#ico-cloud',
  'fog': '#ico-fog', 'drizzle': '#ico-rain', 'rain': '#ico-rain',
  'snow': '#ico-snow', 'thunderstorm': '#ico-thunder', 'windy': '#ico-wind',
};

const BP_TEMPLATES = {
  clock: '<div class="bp-clock-wrap" id="bp-clock-wrap"><div class="bp-clock"><span id="bp-hh">--</span><span class="bp-colon" id="bp-colon">:</span><span id="bp-mm">--</span></div>' +
         '<div class="bp-sub bp-date" id="bp-date"></div></div>',
  verse_of_day: '<div class="bp-verse" id="bp-verse">' +
         '<span class="bp-title bp-ref" id="bp-ref">\u2014</span>' +
         '<div class="bp-sub bp-clamp" id="bp-text"></div>' +
         '<div class="bp-sub bp-trans" id="bp-trans"></div></div>',
  nowplaying: '<div class="bp-np" id="bp-np">' +
         '<div class="bp-cover-wrap">' +
           '<img class="bp-cover" id="bp-cover" alt="" hidden>' +
           '<div class="bp-cover-ph" id="bp-cover-ph"><svg class="ico"><use href="#ico-music"/></svg></div>' +
         '</div>' +
         '<div class="bp-np-meta">' +
           '<div class="bp-track bp-scroll" id="bp-track"><span>Nothing playing</span></div>' +
           '<div class="bp-np-row">' +
             '<div class="bp-sub bp-artist bp-scroll" id="bp-artist"><span></span></div>' +
             '<div class="bp-album bp-scroll" id="bp-album"><span></span></div></div>' +
           '<div class="bp-bar" id="bp-bar"><div class="bp-bar-fill" id="bp-progress"></div>' +
           '<span class="bp-bar-head"></span></div>' +
           '<div class="bp-times"><span id="bp-elapsed">0:00</span><span id="bp-total">0:00</span></div>' +
         '</div></div>',
  dashboard: '<div class="bp-dash" id="bp-dash">' +
         '<svg class="ico bp-wico" id="bp-wico"><use href="#ico-cloud"/></svg>' +
         '<div class="bp-dash-now"><div class="bp-temp" id="bp-temp">\u2014</div>' +
         '<div class="bp-sub" id="bp-cond"></div></div>' +
         '<div class="bp-dash-ev"><div class="bp-ev-title" id="bp-event">No upcoming events</div>' +
         '<div class="bp-sub" id="bp-event-when"></div></div></div>',
};

const BP_TRANSLATIONS = {
  'bibleapi:kjv': 'KJV', 'bibleapi:web': 'WEB', 'bibleapi:asv': 'ASV', 'bolls:ESV': 'ESV',
};

let _bpMode = null;

function updateBlueprint(data) {
  const el = document.getElementById('blueprint-content');
  if (!el) return;
  const mode = data.active_mode || 'clock';
  applyActivePreview(mode);
  if (mode !== _bpMode) {
    _bpMode = mode;
    el.innerHTML = BP_TEMPLATES[mode] || '';
    applyBlinkRate();
  }
  if (mode === 'clock')             _bpClock(data.colors);
  else if (mode === 'verse_of_day') _bpVerse(data.verse, data.colors);
  else if (mode === 'nowplaying')   _bpNowPlaying(data.nowplaying);
  else if (mode === 'dashboard')    _bpDashboard(data.dashboard, data.colors);
}

function applyBlinkRate() {
  const bp = document.getElementById('home-blueprint');
  if (!bp) return;
  const interval = cfg.clock?.blink_interval ?? 1;
  // the rate lives on the container so a template rebuild cannot drop it
  bp.classList.toggle('no-blink', !interval);
  bp.style.setProperty('--bp-blink-s', `${(interval || 1) * 2}s`);
}

function _tint(id, prop, rgb) {
  const el = document.getElementById(id);
  if (!el) return;
  if (_activePreview === 'pixel' && Array.isArray(rgb) && rgb.length === 3) {
    el.style.setProperty(prop, `rgb(${rgb.join(',')})`);
  } else {
    el.style.removeProperty(prop);
  }
}

function _bpClock(colors) {
  _tint('bp-clock-wrap', '--cl', colors && colors.clock);
  const now = new Date();
  _bpText('bp-hh', String(now.getHours()).padStart(2, '0'));
  _bpText('bp-mm', String(now.getMinutes()).padStart(2, '0'));
  const weekday = now.toLocaleDateString('en-US', {weekday: 'long'});
  const month = now.toLocaleDateString('en-US', {month: 'long'});
  const day = now.getDate();
  // raised suffix needs markup, so this one line is built rather than set as text
  const html = `${weekday}, ${month} ${day}<sup class="bp-ord">${_ordinalSuffix(day)}</sup>  ${now.getFullYear()}`;
  const dateEl = document.getElementById('bp-date');
  if (dateEl && dateEl.innerHTML !== html) dateEl.innerHTML = html;
}

function _ordinalSuffix(n) {
  const tail = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return tail[(v - 20) % 10] || tail[v] || tail[0];
}

function _bpVerse(v, colors) {
  _tint('bp-verse', '--vs', colors && colors.verse_of_day);
  _bpText('bp-ref', _verseReference(v && v.reference));
  _bpText('bp-text', (v && v.text) || '');
  const t = v && v.translation;
  _bpText('bp-trans', t ? '(' + (BP_TRANSLATIONS[t] || t.split(':').pop().toUpperCase()) + ')' : '');
}

function _verseReference(ref) {
  if (!ref) return '\u2014';
  // widen the gap before the chapter:verse, the element keeps the run of spaces
  return ref.replace(/\s+(\d+\s*:\s*[\d\u2013,\- ]+)$/, '  $1');
}

function fmtClock(s) {
  if (s == null) return '0:00';
  s = Math.max(0, Math.round(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// the panel runs the bar against 3:20 when the source gives no length, so does the preview
const NP_FALLBACK_DURATION_S = 200;

// a line only travels the distance it actually overflows, so short ones stay still
function _bpScroll(id, text) {
  const el = document.getElementById(id);
  const span = el && el.firstElementChild;
  if (!span) return;
  if (span.textContent !== text) span.textContent = text;
  const over = span.offsetWidth - el.clientWidth;
  el.classList.toggle('on', over > 1);
  if (over > 1) {
    el.style.setProperty('--shift', -over + 'px');
    el.style.setProperty('--dur', (7 + over / 12).toFixed(1) + 's');
  }
}

function _bpNowPlaying(np) {
  const playing = !!(np && np.playing && np.title);
  _bpScroll('bp-track', (np && np.title) || 'Nothing playing');
  _bpScroll('bp-artist', (np && np.artist) || '');
  _bpScroll('bp-album', (np && np.album) || '');

  const img = document.getElementById('bp-cover');
  const ph = document.getElementById('bp-cover-ph');
  const etag = np && np.cover_etag;
  if (img && ph) {
    if (etag) {
      if (img.dataset.etag !== etag) {
        img.dataset.etag = etag;
        img.src = '/nowplaying/cover?e=' + etag;
      }
      img.hidden = false;
      ph.hidden = true;
    } else {
      img.hidden = true;
      ph.hidden = false;
      delete img.dataset.etag;
    }
  }

  // the same three colours the matrix pulls out of the cover
  const wrap = document.getElementById('bp-np');
  if (wrap) {
    const acc = _activePreview === 'pixel' && np && np.accents;
    for (let i = 0; i < 3; i++) {
      const name = '--np' + (i + 1);
      if (acc && acc[i]) wrap.style.setProperty(name, `rgb(${acc[i].join(',')})`);
      else wrap.style.removeProperty(name);
    }
  }

  _npDur     = (np && np.duration_s > 0) ? np.duration_s : NP_FALLBACK_DURATION_S;
  _npElapsed = (np && np.elapsed_s) || 0;
  _npPlaying = playing;
  _npAt      = performance.now();
  _bpText('bp-total', fmtClock(_npDur));
  _paintPlayhead();
}

// the server rounds elapsed to whole seconds and the poll is a second apart, so the
// head is carried between readings instead of stepping on each one
let _npDur = NP_FALLBACK_DURATION_S, _npElapsed = 0, _npAt = 0, _npPlaying = false;

function _paintPlayhead() {
  const bar = document.getElementById('bp-progress');
  if (!bar) return;
  const run = _npPlaying ? _npElapsed + (performance.now() - _npAt) / 1000 : 0;
  const el = Math.min(run, _npDur);
  const pct = el / _npDur * 100;
  bar.style.width = pct + '%';
  document.getElementById('bp-bar')?.style.setProperty('--pct', pct + '%');
  _bpText('bp-elapsed', fmtClock(Math.floor(el)));
}

function _playheadLoop() {
  if (document.getElementById('bp-progress')) _paintPlayhead();
  requestAnimationFrame(_playheadLoop);
}
requestAnimationFrame(_playheadLoop);

function _bpDashboard(dash, colors) {
  _tint('bp-dash', '--ds', colors && colors.dashboard);
  const w = (dash && dash.weather) || {};
  _bpText('bp-temp', w.temp_now != null ? Math.round(w.temp_now) + '\u00b0' : '\u2014');
  const parts = [];
  if (w.condition) parts.push(w.condition);
  if (w.temp_high != null) parts.push('H ' + Math.round(w.temp_high) + '\u00b0');
  if (w.temp_low != null) parts.push('L ' + Math.round(w.temp_low) + '\u00b0');
  _bpText('bp-cond', parts.join('  \u00b7  '));
  const use = document.querySelector('#bp-wico use');
  if (use) use.setAttribute('href', BP_WEATHER_ICONS[w.condition] || '#ico-cloud');
  const ev = ((dash && dash.events) || [])[0];
  _bpText('bp-event', (ev && ev.title) || 'No upcoming events');
  _bpText('bp-event-when', ev ? _eventWhen(ev) : '');
}

function _eventWhen(ev) {
  const d = new Date(ev.start_time);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-GB',
    {weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false});
}

function _bpText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}
