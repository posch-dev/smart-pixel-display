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

// a css colour comes back as a hex or as rgb(), both have to answer with a hex
function cssHex(raw) {
  const m = String(raw).match(/rgba?\(([^)]+)\)/);
  if (!m) return String(raw).trim();
  return rgbToHex(m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number));
}
function hexToRgb(hex) { return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)); }

// the stylesheet owns the accent, read it once before anything overrides it inline
const DEFAULT_ACCENT = cssHex(getComputedStyle(document.documentElement).getPropertyValue('--accent'));

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

// the pixel look draws the very files the matrix draws, same mapping as _CONDITION_ICON
const BP_WEATHER_PNG = {
  'clear': 'sunny.png', 'partly cloudy': 'partially_cloudy.png', 'overcast': 'cloudy.png',
  'fog': 'cloudy.png', 'drizzle': 'rainy.png', 'rain': 'rainy.png',
  'snow': 'snowy.png', 'thunderstorm': 'lightning.png', 'windy': 'windy.png',
};

// what the panel puts on a temperature, warm tone first and the freezing one behind it
const BP_TEMP_COLORS = {
  temp: ['255,200,0', '100,190,255'], high: ['0,255,0', '40,80,220'],
  low: ['220,50,50', '170,60,220'],
};
const BP_DASH_COLORS = {white: '180,180,180', red: '220,50,50', purple: '170,60,220',
                        orange: '255,140,0', turquoise: '0,200,180'};
// a pixel this dark in a panel icon is background, the palettes are not exactly black
const BP_PNG_BLACK = 12;
// how much wider than the temperature the clock runs, centred over it
const BP_CLOCK_SCALE = 0.94;

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
         '<div class="bp-ddate" id="bp-ddate"></div>' +
         '<div class="bp-dash-left">' +
           '<div class="bp-dclock" id="bp-dclock"><span id="bp-dhh">--</span>' +
           '<span class="bp-colon" id="bp-dcolon">:</span><span id="bp-dmm">--</span></div>' +
           '<svg class="ico bp-wico" id="bp-wico"><use href="#ico-cloud"/></svg>' +
           '<img class="bp-wpng" id="bp-wpng" alt="">' +
           '<div class="bp-temp" id="bp-temp">\u2014</div>' +
           '<div class="bp-hilo"><span id="bp-high"></span><span id="bp-low"></span></div>' +
         '</div>' +
         '<div class="bp-dash-ev" id="bp-dash-ev">' +
           '<div class="bp-leave" id="bp-leave"></div>' +
           '<div class="bp-ev-row">' +
             '<svg class="ico bp-evico" id="bp-evico"><use href="#ico-calendar"/></svg>' +
             '<div class="bp-ev-title" id="bp-event"></div>' +
           '</div>' +
           '<div class="bp-sub bp-ev-when" id="bp-event-when"></div>' +
         '</div></div>',
};

const BP_TRANSLATIONS = {
  'bibleapi:kjv': 'KJV', 'bibleapi:web': 'WEB', 'bibleapi:asv': 'ASV', 'bolls:ESV': 'ESV',
};

let _bpMode = null;

let _bpLastData = null;

// the tile can be asked to draw itself again from the last reading, which is what the
// drawer needs while it is paused and what the timelapse needs between two minutes
function bpRepaint() {
  if (_bpLastData) updateBlueprint(_bpLastData);
}

function updateBlueprint(data) {
  const el = document.getElementById('blueprint-content');
  if (!el) return;
  _bpLastData = data;
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
  const html = `${weekday}, ${month} ${day}<sup class="bp-ord">${_ordinalSuffix(day)}</sup> ${now.getFullYear()}`;
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
  _bpText('bp-text', v && v.reference ? bpPassage(v.reference, v.translation) : '');
  const t = v && v.translation;
  _bpText('bp-trans', t ? '(' + (BP_TRANSLATIONS[t] || t.split(':').pop().toUpperCase()) + ')' : '');
}

// the panel needs the reference only, so the passage never travels through the pi
const _bpPassages = {};
let _bpBooks = null;

function bpPassage(reference, translation) {
  const key = reference + '|' + translation;
  if (key in _bpPassages) return _bpPassages[key];
  _bpPassages[key] = '';
  _bpFetchPassage(translation, reference)
    .then(text => { _bpPassages[key] = text; _bpText('bp-text', text); })
    .catch(() => {});
  return '';
}

async function _bpFetchPassage(translation, reference) {
  const [backend, id] = String(translation || '').split(':');
  if (backend === 'bibleapi') {
    const r = await fetch(`https://bible-api.com/${encodeURIComponent(reference)}`
                        + `?translation=${encodeURIComponent(id)}`);
    return ((await r.json()).text || '').trim();
  }
  if (backend !== 'bolls') return '';
  const m = /^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*[-\u2013]\s*(\d+))?/.exec(reference || '');
  const book = m && await _bpBollsBook(id, m[1]);
  if (!book) return '';
  const parts = [];
  for (let v = +m[3]; v <= (+m[4] || +m[3]); v++) {
    const r = await fetch(`https://bolls.life/get-verse/${id}/${book}/${m[2]}/${v}/`);
    parts.push(((await r.json()).text || '').trim());
  }
  return parts.join(' ');
}

// the book list answers with names, so nothing here carries a table of sixty six
async function _bpBollsBook(id, name) {
  if (!_bpBooks) _bpBooks = fetch(`https://bolls.life/get-books/${id}/`).then(r => r.json());
  const want = _bpBookKey(name);
  const books = await _bpBooks;
  const hit = books.find(b => [want, want + 'S'].includes(_bpBookKey(b.name)));
  return hit ? hit.bookid : null;
}

function _bpBookKey(s) { return String(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

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

// one speed for every line, picked on the tile the preview was drawn at
const BP_SCROLL_REF_W  = 688;
const BP_SCROLL_PX_S   = 20;
const BP_SCROLL_HOLD_S = 1.2;
const BP_SCROLL_END_S  = 1.8;

function _bpLine(id, text) {
  const span = document.getElementById(id)?.firstElementChild;
  if (span && span.textContent !== text) span.textContent = text;
}

function bpScrollSpeed(width) {
  return BP_SCROLL_PX_S * (width || BP_SCROLL_REF_W) / BP_SCROLL_REF_W;
}

// every line travels its own distance at the same speed, so the longest one sets the
// cycle and the shorter ones stand at their end until it is done
function bpScrollCycle(overs, speed) {
  const worst = Math.max(0, ...overs);
  return worst ? BP_SCROLL_HOLD_S + worst / speed + BP_SCROLL_END_S : 0;
}

let _bpScrollKey = '';

function _bpScrollGroup(ids) {
  const bp = document.getElementById('home-blueprint');
  const speed = bpScrollSpeed(bp && bp.clientWidth);
  const lines = ids.map(id => document.getElementById(id)).filter(Boolean).map(el => {
    const over = el.firstElementChild ? el.firstElementChild.offsetWidth - el.clientWidth : 0;
    return {el, over: over > 1 ? over : 0};
  });
  const cycle = bpScrollCycle(lines.map(l => l.over), speed);
  for (const l of lines) {
    if (!l.over) continue;
    const p1 = BP_SCROLL_HOLD_S / cycle * 100;
    const p2 = (BP_SCROLL_HOLD_S + l.over / speed) / cycle * 100;
    l.el.style.setProperty('--shift', -Math.round(l.over) + 'px');
    l.el.style.setProperty('--cycle', cycle.toFixed(2) + 's');
    l.el.style.setProperty('--tf',
      `linear(0 0%, 0 ${p1.toFixed(2)}%, 1 ${p2.toFixed(2)}%, 1 100%)`);
  }
  const key = lines.map(l => Math.round(l.over)).join(',');
  if (key === _bpScrollKey) return;
  _bpScrollKey = key;
  // one clock for the group, so a changed line restarts every line in the same frame
  for (const l of lines) l.el.classList.remove('on');
  void document.body.offsetWidth;
  for (const l of lines) l.el.classList.toggle('on', l.over > 0);
}

// itunes renders any size on demand, the panel takes 32 and the preview this one
const BP_COVER_PX = 600;

function bpCoverUrl(url) {
  return url ? url.replace('100x100bb', `${BP_COVER_PX}x${BP_COVER_PX}bb`) : null;
}

let _npGap = null;

function _bpNowPlaying(np) {
  const playing = !!(np && np.playing && np.title);
  // five spaces between the two halves, measured in the face the artist is set in
  if (_npGap === null) _npGap = (rNpRowGap(2.8 * CQ) / CQ).toFixed(2) + 'cqw';
  const row = document.querySelector('.bp-np-row');
  if (row && row.style.getPropertyValue('--np-gap') !== _npGap)
    row.style.setProperty('--np-gap', _npGap);
  _bpLine('bp-track', (np && np.title) || 'Nothing playing');
  _bpLine('bp-artist', (np && np.artist) || '');
  _bpLine('bp-album', (np && np.album) || '');
  _bpScrollGroup(['bp-track', 'bp-artist', 'bp-album']);

  const img = document.getElementById('bp-cover');
  const ph = document.getElementById('bp-cover-ph');
  const src = bpCoverUrl(np && np.cover_url);
  if (img && ph) {
    if (src) {
      if (img.dataset.src !== src) {
        img.dataset.src = src;
        img.crossOrigin = 'anonymous';
        img.src = src;
      }
      img.hidden = false;
      ph.hidden = true;
    } else {
      img.hidden = true;
      ph.hidden = false;
      delete img.dataset.src;
      img.removeAttribute('src');
    }
  }

  _npAccents = (np && np.accents) || null;
  _applyNpAccents();

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

// the three colours the matrix pulls out of the cover, and what a page pinned by hand
let _npAccents = null;
const _npAccentOverride = {};

// what is painted right now, so taking a colour over by hand starts where it left off
function npAccentNow(i) {
  const wrap = document.getElementById('bp-np');
  const raw = wrap && getComputedStyle(wrap).getPropertyValue('--np' + (i + 1)).trim();
  if (raw) return cssHex(raw);
  const root = getComputedStyle(document.documentElement);
  return cssHex(root.getPropertyValue(i ? '--accent-hd' : '--accent')
             || root.getPropertyValue('--accent'));
}

function setNpAccent(i, hex) {
  if (hex) _npAccentOverride[i] = hex; else delete _npAccentOverride[i];
  _applyNpAccents();
}

function _applyNpAccents() {
  const wrap = document.getElementById('bp-np');
  if (!wrap) return;
  const pixel = _activePreview === 'pixel';
  for (let i = 0; i < 3; i++) {
    const name = '--np' + (i + 1);
    const own = _npAccentOverride[i];
    if (own) wrap.style.setProperty(name, own);
    else if (pixel && _npAccents && _npAccents[i]) wrap.style.setProperty(name, `rgb(${_npAccents[i].join(',')})`);
    else wrap.style.removeProperty(name);
  }
}

// a frozen page is a real still: no reading is carried forward
let _bpFrozen = false;
let _bpFrozenData = null;

function setBlueprintFrozen(on) {
  _bpFrozen = on;
  _bpFrozenData = on ? _bpLastData : null;
  document.documentElement.dataset.frozen = on ? 'on' : '';
  _paintPlayhead();
}

// what stands on the frozen page, so an export writes that and not the song since
function blueprintFrozenData() {
  return _bpFrozenData;
}

function blueprintPlayhead() {
  return _npDur ? Math.min(1, _npElapsed / _npDur) : 0;
}

function setBlueprintPlayhead(frac) {
  _npElapsed = _npDur * frac;
  _npAt = performance.now();
  _paintPlayhead();
}

function _paintPlayhead() {
  const bar = document.getElementById('bp-progress');
  if (!bar) return;
  const run = !_npPlaying ? 0
            : _bpFrozen ? _npElapsed
            : _npElapsed + (performance.now() - _npAt) / 1000;
  const el = Math.min(run, _npDur);
  const pct = el / _npDur * 100;
  bar.style.width = pct + '%';
  document.getElementById('bp-bar')?.style.setProperty('--pct', pct + '%');
  _bpText('bp-elapsed', fmtClock(Math.floor(el)));
}

function _playheadLoop() {
  if (!_bpFrozen && document.getElementById('bp-progress')) _paintPlayhead();
  requestAnimationFrame(_playheadLoop);
}
requestAnimationFrame(_playheadLoop);

// the drawer can stand a layout in for the running one, and a time of day with it
let _bpDashOv = null;

function setBpDashOverride(ov) {
  _bpDashOv = ov;
}

function bpDashOverride() {
  return _bpDashOv;
}

function bpDashScene(dash) {
  const w = (dash && dash.weather) || {};
  const ov = _bpDashOv;
  const lay = (ov && ov.layout) || (dash && dash.layout) || {mode: 1};
  const freeze = (dash && dash.units) === 'imperial' ? 32 : 0;
  const now = ov && ov.time ? _bpAtTime(ov.time) : new Date();
  const set = document.documentElement.dataset;
  const rawMode = lay.mode || 1;
  // weather stands alone when there is nothing else, and until then the choice waits
  const info = rawMode === 1 ? 'weather' : (set.dInfo || 'both');
  return {
    mode: info === 'weather' ? 1 : rawMode,
    rawMode,
    info,
    allDay: !!lay.all_day,
    skipped: !!lay.skipped,
    index: lay.index === undefined ? null : lay.index,
    extra: set.dExtra !== 'off',
    when: set.dWhen !== 'off',
    blinkNow: set.dBlink !== 'off',
    noDate: set.dDate === 'off',
    hh: String(now.getHours()).padStart(2, '0'),
    mm: String(now.getMinutes()).padStart(2, '0'),
    date: bpLongDate(now),
    temp: w.temp_now != null ? Math.round(w.temp_now) : null,
    high: w.temp_high != null ? Math.round(w.temp_high) : null,
    low: w.temp_low != null ? Math.round(w.temp_low) : null,
    cold: {temp: w.temp_now < freeze, high: w.temp_high < freeze, low: w.temp_low < freeze},
    condition: w.condition || '',
    icon: BP_WEATHER_ICONS[w.condition] || '#ico-cloud',
    png: '/assets/weather/' + (BP_WEATHER_PNG[w.condition] || 'cloudy.png'),
    title: lay.title || '',
    when: lay.all_day ? 'All Day'
        : lay.start ? (lay.end ? lay.start + ' \u2013 ' + lay.end : lay.start) : '',
    leaveIn: lay.leave_in, leaveTime: lay.leave_time || '', late: !!lay.late,
  };
}

function _bpAtTime(hhmm) {
  const [hh, mm] = hhmm.split(':');
  const d = new Date();
  d.setHours(+hh, +mm, 0, 0);
  return d;
}

// the panel switches to tenths of an hour once the wait passes an hour
function bpLeaveMinutes(leaveIn) {
  return leaveIn > 60 ? (leaveIn / 60).toFixed(1) : String(leaveIn);
}

function bpLongDate(d) {
  const day = d.getDate();
  return `${d.toLocaleDateString('en-US', {weekday: 'long'})}, `
       + `${d.toLocaleDateString('en-US', {month: 'long'})} ${day}`
       + `<sup class="bp-ord">${_ordinalSuffix(day)}</sup> ${d.getFullYear()}`;
}

// the renderer has no markup, the suffix rides on the line
function bpLongDateText(d) {
  const day = d.getDate();
  return `${d.toLocaleDateString('en-US', {weekday: 'long'})}, `
       + `${d.toLocaleDateString('en-US', {month: 'long'})} ${day}${_ordinalSuffix(day)}`
       + ` ${d.getFullYear()}`;
}

function bpLeaveHtml(sc) {
  const car = '<svg class="ico bp-carico"><use href="#ico-car"/></svg>';
  if (sc.late)
    return `<span class="bp-now">NOW!</span><span class="bp-late">${Math.abs(sc.leaveIn)}</span>${car}`;
  return `<span class="bp-mins">${bpLeaveMinutes(sc.leaveIn)}</span>`
       + `<span class="bp-leave-at">${sc.leaveTime}</span>${car}`;
}

const _bpPngCache = new Map();

// the panel icons are drawn on black and carry no alpha, so black becomes the hole
function bpWeatherPng(url) {
  if (_bpPngCache.has(url)) return _bpPngCache.get(url);
  const job = new Promise(done => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height);
      // the palettes hold near black as well, up to about (0,3,7), and those pixels
      // are background too
      for (let i = 0; i < px.data.length; i += 4)
        if (px.data[i] + px.data[i + 1] + px.data[i + 2] <= BP_PNG_BLACK) px.data[i + 3] = 0;
      g.putImageData(px, 0, 0);
      done(c.toDataURL('image/png'));
    };
    img.onerror = () => done(null);
    img.src = url;
  });
  _bpPngCache.set(url, job);
  return job;
}

function _bpPaintWeatherPng(url) {
  const el = document.getElementById('bp-wpng');
  if (!el || el.dataset.src === url) return;
  el.dataset.src = url;
  bpWeatherPng(url).then(data => {
    if (data && el.dataset.src === url) el.setAttribute('src', data);
  });
}

function _bpDashboard(dash, colors) {
  _tint('bp-dash', '--ds', colors && colors.dashboard);
  // the clock reads in the colour the clock panel runs in, not the dashboard's own
  _tint('bp-dash', '--p-clock', colors && colors.clock);
  const root = document.getElementById('bp-dash');
  if (!root) return;
  const sc = bpDashScene(dash);
  root.dataset.dmode = sc.mode;
  root.dataset.info = sc.info;
  _bpDashLast = sc;
  _bpDashColors(root, sc);
  _bpText('bp-dhh', sc.hh);
  _bpText('bp-dmm', sc.mm);
  _bpHtml('bp-ddate', sc.date);
  _bpHtml('bp-temp', (sc.temp != null ? sc.temp : '\u2014') + '<sup class="bp-deg">\u00b0</sup>');
  _bpText('bp-high', sc.high != null ? String(sc.high) : '');
  _bpText('bp-low', sc.low != null ? String(sc.low) : '');
  const use = document.querySelector('#bp-wico use');
  if (use) use.setAttribute('href', sc.icon);
  _bpPaintWeatherPng(sc.png);
  _bpText('bp-event', sc.title);
  _bpText('bp-event-when', sc.mode === 2 ? sc.when : '');
  _bpHtml('bp-leave', sc.mode === 3 ? bpLeaveHtml(sc) : '');
  _bpQueueFit(`${sc.hh}:${sc.mm}|${sc.temp}`,
              `${sc.leaveIn}|${sc.leaveTime}|${sc.title}`, sc.mode);
  _bpWatchDash();
}

// a template that was written this tick is not laid out yet, and measuring it there
// is what made a panel switch come out at a different size than a reload
function _bpQueueFit(clockKey, leaveKey, mode) {
  requestAnimationFrame(() => {
    _bpFitDashClock(clockKey);
    if (mode === 3) _bpFitLeave(leaveKey);
  });
}

function _bpDashColors(root, sc) {
  const pixel = _activePreview === 'pixel';
  const set = (name, rgb) => pixel ? root.style.setProperty(name, `rgb(${rgb})`)
                                   : root.style.removeProperty(name);
  set('--p-temp', BP_TEMP_COLORS.temp[sc.cold.temp ? 1 : 0]);
  set('--p-high', BP_TEMP_COLORS.high[sc.cold.high ? 1 : 0]);
  set('--p-low', BP_TEMP_COLORS.low[sc.cold.low ? 1 : 0]);
  set('--p-title', BP_DASH_COLORS.white);
  set('--p-when', BP_DASH_COLORS.turquoise);
  set('--p-mins', BP_DASH_COLORS.purple);
  set('--p-at', BP_DASH_COLORS.red);
  // the web look falls through to the accent and the tone the manual pill already uses
  set('--p-now', BP_DASH_COLORS.purple);
  set('--p-now-alt', BP_DASH_COLORS.orange);
}

const _bpMeasure = document.createElement('canvas').getContext('2d');

function _bpFontBox(cs) {
  _bpMeasure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = _bpMeasure.measureText('Hg');
  const size = parseFloat(cs.fontSize);
  const asc = m.fontBoundingBoxAscent || size * 0.8;
  const desc = m.fontBoundingBoxDescent || size * 0.2;
  return {asc, desc, h: asc + desc};
}

function _bpVisible(color) {
  const m = String(color).match(/rgba?\(([^)]+)\)/);
  return !m || (m[1].split(',')[3] || '1').trim() !== '0';
}

// NOW carries the only movement on this panel and its colour is animated, so the two
// phases have to be read off the variables rather than off the glyph
function _bpNowColors(root) {
  const cs = getComputedStyle(root);
  const pick = (...names) => {
    for (const n of names) {
      const v = cs.getPropertyValue(n).trim();
      if (v) return v;
    }
    return '';
  };
  return [pick('--d-now', '--p-now', '--accent'),
          pick('--d-now-alt', '--p-now-alt', '--accent-c', '--accent')];
}

// what the tile actually put on screen, in tile pixels. the file is then a copy of the
// tile rather than a second description of the same layout drifting away from it
function bpDashSnapshot() {
  const box = document.getElementById('home-blueprint');
  const root = document.getElementById('bp-dash');
  if (!box || !root || !box.clientWidth) return null;
  const b = box.getBoundingClientRect();
  const ops = [];
  _bpSnapNode(root, ops, b);
  return {w: b.width, h: b.height, ops, now: _bpNowColors(root)};
}

function _bpSnapNode(el, ops, b) {
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return;
  const r = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();
  if (tag === 'svg') {
    const use = el.querySelector('use');
    if (use && r.width)
      ops.push({op: 'icon', href: use.getAttribute('href'), fill: cs.color,
                x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height});
    return;
  }
  if (tag === 'img') {
    if (r.width && el.getAttribute('src'))
      ops.push({op: 'image', src: el.getAttribute('src'),
                x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height});
    return;
  }
  const bw = parseFloat(cs.borderLeftWidth) || 0;
  if (bw > 0 && cs.borderLeftStyle !== 'none' && _bpVisible(cs.borderLeftColor))
    ops.push({op: 'rect', fill: cs.borderLeftColor,
              x: r.left - b.left, y: r.top - b.top, w: bw, h: r.height});
  const inline = cs.display.startsWith('inline');
  const fb = _bpFontBox(cs);
  for (const node of el.childNodes) {
    if (node.nodeType === 1) { _bpSnapNode(node, ops, b); continue; }
    const raw = node.nodeValue;
    if (node.nodeType !== 3 || !raw.trim()) continue;
    // the space around a run is not ink. measuring it in shifts the run by a space
    // the drawing then adds a second time, and an svg drops it and shifts back
    const lead = raw.length - raw.replace(/^\s+/, '').length;
    const word = raw.trim();
    const range = document.createRange();
    range.setStart(node, lead);
    range.setEnd(node, lead + word.length);
    const tr = range.getBoundingClientRect();
    if (!tr.width) continue;
    // an inline box is as tall as its font, a block box as tall as its line
    const base = inline ? r.top + fb.asc : tr.top + (tr.height - fb.h) / 2 + fb.asc;
    ops.push({op: 'text', text: word, fill: cs.color, size: parseFloat(cs.fontSize),
              weight: cs.fontWeight, family: cs.fontFamily, width: tr.width,
              x: tr.left - b.left, y: base - b.top,
              now: el.classList.contains('bp-now')});
  }
}

function _bpSpaceWidth(el) {
  const cs = getComputedStyle(el);
  _bpMeasure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return _bpMeasure.measureText(' ').width;
}

// the clock spans exactly what the temperature spans, the way the panel lines them up
let _bpDashRO = null;
let _bpDashLast = null;

// the drawer builds its rows off the layout that is on the tile right now
function bpDashNow() {
  return _bpDashLast || {mode: 1, late: false};
}

// a measured size is only as good as the layout it was measured in, so it is taken
// again whenever the tile changes size or the seven segment font finally lands
function _bpRefitDash() {
  const key = 'refit' + performance.now();
  _bpFitDashClock(key);
  if (document.getElementById('bp-leave')?.firstChild) _bpFitLeave(key);
}

function _bpWatchDash() {
  const box = document.getElementById('home-blueprint');
  if (!box || _bpDashRO) return;
  _bpDashRO = new ResizeObserver(() => _bpRefitDash());
  _bpDashRO.observe(box);
  document.fonts?.ready.then(_bpRefitDash);
}

// one cqw in pixels, so a measured size can be written back in the unit the tile
// is built in and survives a resize
function _bpUnit(el) {
  const box = el.closest('.blueprint');
  return box ? box.getBoundingClientRect().width / 100 : 0;
}

function _bpFitDashClock(key) {
  const clk = document.getElementById('bp-dclock');
  const temp = document.getElementById('bp-temp');
  if (!clk || !temp || clk.dataset.fit === key) return;
  clk.dataset.fit = key;
  clk.style.fontSize = '';
  const base = parseFloat(getComputedStyle(clk).fontSize);
  // the last glyph still carries its letter spacing, that trailing gap is not ink
  const own = clk.getBoundingClientRect().width - base * 0.05;
  const want = temp.getBoundingClientRect().width * BP_CLOCK_SCALE;
  const unit = _bpUnit(clk);
  if (own > 0 && want > 0 && unit > 0)
    clk.style.fontSize = (base * want / own / unit).toFixed(3) + 'cqw';
}

// minutes, time and car span what the calendar row spans, both gaps equal and never
// tighter than the space that sits between the minutes and the time
function _bpFitLeave(key) {
  const leave = document.getElementById('bp-leave');
  const row = document.querySelector('#bp-dash-ev .bp-ev-row');
  if (!leave || !row || !leave.firstChild || leave.dataset.fit === key) return;
  leave.dataset.fit = key;
  leave.style.setProperty('--leave-gap', '0px');
  const own = leave.getBoundingClientRect().width;
  const want = row.getBoundingClientRect().width;
  const min = _bpSpaceWidth(leave);
  const unit = _bpUnit(leave);
  if (unit > 0)
    leave.style.setProperty('--leave-gap',
      (Math.max(min, (want - own) / 2) / unit).toFixed(3) + 'cqw');
}

// the source string is what gets compared, not the serialised markup: the browser
// writes <use> with a closing tag, so reading it back never matches and the write
// would repeat every poll, restarting every animation under it
function _bpHtml(id, html) {
  const el = document.getElementById(id);
  if (!el || el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

function _bpText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}
