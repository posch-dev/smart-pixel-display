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

function setBlueprintFrozen(on) {
  _bpFrozen = on;
  document.documentElement.dataset.frozen = on ? 'on' : '';
  _paintPlayhead();
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
