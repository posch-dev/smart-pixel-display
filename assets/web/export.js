// The export dialog. It builds its own markup so both the dashboard and the preview
// page get the same one, pulls a fresh reading from /home, and hands the scene to
// render.js. Nothing here runs on the live clock, every frame is drawn for a time.

const EX_WIDTHS = [600, 720, 1080, 1280, 1440, 1920, 2160, 2560, 3840, 4096];
const EX_ANIMATED = ['nowplaying', 'clock'];
const EX_VIDEO_FMTS = ['webm', 'mp4'];

function _exIsVideo(fmt) { return EX_VIDEO_FMTS.includes(fmt); }
// the clock only turns a colon on and off, so two a second lands every change on a
// frame of its own and the file stays small
const EX_FPS = {nowplaying: 30, clock: 2};
// a film always runs at thirty: two a second is fine for a gif, where every frame
// carries its own delay, but players choke on it
const EX_VIDEO_FPS = 30;
// the clock has two pictures in a pass, colon on and colon off, so sampling it any
// faster only writes the same two over and over
const EX_STATES = {clock: 2};
// a track always has something to show even when no line overflows: the head runs the
// whole song inside one pass, not in real time
const EX_NP_SWEEP_S = 10;
const EX_LABELS = {clock: 'Clock', verse_of_day: 'Verse', nowplaying: 'NowPlaying', dashboard: 'Dashboard'};

let _exMode = 'clock';
let _exScene = null;
let _exOpen = false;
let _exAnimTouched = false;
let _exRunning = false;
let _exAbort = false;

// thrown out of the frame loops when cancel is pressed, caught in runExport
const EX_ABORT = 'export aborted';

function exAbortCheck() {
  if (_exAbort) throw new Error(EX_ABORT);
}
let _exHeadCustom = false;

// the pollers ask before they redraw, so the panel on screen stays the one being written
function exFrozen() { return _exOpen; }

function _exBuildDialog() {
  if (document.getElementById('ex-overlay')) return;
  const wrap = document.createElement('div');
  wrap.id = 'ex-overlay';
  wrap.className = 'modal-overlay';
  wrap.onclick = e => { if (e.target === wrap) closeExport(); };
  wrap.innerHTML = `<div class="modal">
    <div class="modal-title">
      <div class="ex-head">
        <div class="ex-panel" id="ex-panel"></div>
        <div class="ex-what" id="ex-what"></div>
      </div>
      <svg class="ico" style="width:16px;height:16px"><use href="#ico-download"/></svg>
    </div>
    <div id="ex-form">
    <div class="row">
      <div class="row-left"><div class="row-label">Format</div></div>
      <div class="row-right"><select id="ex-format" onchange="_exPaint()">
        <option value="svg">SVG</option>
        <option value="png">PNG</option>
        <option value="gif">GIF</option>
        <option value="webm">WebM</option>
        <option value="mp4">MP4</option>
      </select></div>
    </div>
    <div class="row" id="ex-width-row">
      <div class="row-left"><div class="row-label">Width</div><div class="row-sub" id="ex-size"></div></div>
      <div class="row-right"><select id="ex-width" onchange="_exPaint()">
        ${EX_WIDTHS.map(w => `<option value="${w}"${w === 1920 ? ' selected' : ''}>${w}</option>`).join('')}
      </select></div>
    </div>
    <div class="row">
      <div class="row-left"><div class="row-label">Background</div></div>
      <div class="row-right"><label class="toggle"><input type="checkbox" id="ex-bg" onchange="_exPaint()">
        <div class="t-track"></div><div class="t-thumb"></div></label></div>
    </div>
    <div class="row" id="ex-head-row">
      <div class="row-left"><div class="row-label">Playhead</div>
        <div class="row-sub" id="ex-head-at"></div></div>
      <div class="row-right bright-row" id="ex-head-ctl">
        <div class="slider-wrap" id="ex-head-wrap"><input type="range" id="ex-head"
          min="0" max="1000" value="0" oninput="_exPaint()"></div>
        <span class="bright-div"></span>
        <div class="seg">
          <button onclick="setExHead('now')" id="ex-head-now">Now</button>
          <button onclick="setExHead('custom')" id="ex-head-custom">Custom</button>
        </div>
      </div>
    </div>
    <div class="row" id="ex-anim-row">
      <div class="row-left"><div class="row-label">Animated</div>
        <div class="row-sub" id="ex-anim-why"></div></div>
      <div class="row-right"><label class="toggle"><input type="checkbox" id="ex-anim" onchange="setExAnim()">
        <div class="t-track"></div><div class="t-thumb"></div></label></div>
    </div>
    ${document.getElementById('tab-home') ? `<a href="/preview" target="_blank"
      rel="noopener" class="row ex-more">
      <span>More customization in the <b>Twin</b> Viewer &amp; Editor</span>
      <svg class="ico"><use href="#ico-external"/></svg>
    </a>` : ''}
    </div>
    <div id="ex-run" style="display:none">
      <div class="ex-sum" id="ex-sum"></div>
      <div class="ex-prog">
        <div class="ex-bar" id="ex-bar-wrap"><div class="ex-bar-fill" id="ex-bar"></div></div>
        <div class="ex-prog-line"><span id="ex-phase"></span><span id="ex-pct"></span></div>
      </div>
    </div>
    <div style="padding:12px 16px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border)">
      <button class="btn btn-ghost" onclick="closeExport()">Cancel</button>
      <button class="btn btn-accent" id="ex-go" onclick="runExport()">Export</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  exVideoProbe();
}

// mp4 is a film either way, png is one frame either way, so only svg and gif ask
function _exPaint() {
  const fmt = document.getElementById('ex-format').value;
  document.getElementById('ex-width-row').style.display = fmt === 'svg' ? 'none' : '';
  const w = +document.getElementById('ex-width').value;
  const box = _exBox();
  let size = `${w} x ${2 * Math.round(w * box.h / box.w / 2)} Pixel`;
  if (_exIsVideo(fmt) && _exScene)
    size += `, ${fmtClock(exSweep(_exMode, _exScene))} at ${EX_VIDEO_FPS} fps`;
  document.getElementById('ex-size').textContent = size;
  const canAnim = EX_ANIMATED.includes(_exMode) && (fmt === 'svg' || fmt === 'gif');
  document.getElementById('ex-anim-row').style.display = canAnim ? '' : 'none';
  // a movable panel is offered moving, until the tick is taken off by hand
  if (canAnim && !_exAnimTouched) document.getElementById('ex-anim').checked = true;
  // a panel with nothing long enough to scroll has no pass to write, and saying so
  // beats handing over a file that turns out to be a still
  // a still can stand anywhere in the track, a pass covers all of it anyway
  const headRow = document.getElementById('ex-head-row');
  const stillNp = _exMode === 'nowplaying' && !(canAnim && document.getElementById('ex-anim').checked)
               && !_exIsVideo(fmt);
  headRow.style.display = stillNp ? '' : 'none';
  document.getElementById('ex-head-ctl').classList.toggle('global', !_exHeadCustom);
  document.getElementById('ex-head-now').classList.toggle('on', !_exHeadCustom);
  document.getElementById('ex-head-custom').classList.toggle('on', _exHeadCustom);
  if (stillNp && _exScene)
    document.getElementById('ex-head-at').textContent =
      `${fmtClock(_exHeadAt(_exScene))} of ${_exScene.totalText}`;

  const animBox = document.getElementById('ex-anim');
  const why = document.getElementById('ex-anim-why');
  const idle = _exScene && !exCycle(_exMode, _exScene);
  animBox.disabled = !!idle;
  if (idle) animBox.checked = false;
  why.textContent = idle ? 'Nothing on this panel is long enough to scroll' : '';
  if (!idle && _exScene && fmt === 'gif' && animBox.checked) {
    const sweep = exSweep(_exMode, _exScene);
    const frames = exGifCount(_exMode, sweep);
    why.textContent = `${frames} frame${frames === 1 ? '' : 's'}`
      + (exStates(_exMode) ? '' : ` at ${exGifFps(_exMode, sweep)} fps`);
  }
  // a film of a panel that never moves is a still that takes longer to open
  for (const f of EX_VIDEO_FMTS) {
    const opt = document.querySelector(`#ex-format option[value="${f}"]`);
    if (!opt) continue;
    opt.disabled = _exVideoAsked[f] === false || !EX_ANIMATED.includes(_exMode);
    if (opt.disabled && fmt === f) {
      document.getElementById('ex-format').value = 'png';
      return _exPaint();
    }
  }
}

// what goes into the file is read once here, so the title names the very frame
// the export will draw and no second reading can slip in between
async function openExport() {
  _exBuildDialog();
  _exMode = _bpMode || 'clock';
  _exScene = null;
  _exOpen = true;
  _exAnimTouched = false;
  _exHeadCustom = false;
  _exAbort = false;
  _exShowForm();
  _exPaint();
  document.getElementById('ex-panel').textContent = EX_LABELS[_exMode] || 'Export';
  document.getElementById('ex-what').textContent = '';
  document.getElementById('ex-overlay').classList.add('show');
  const data = await fetch('/home').then(r => r.json());
  _exScene = await exScene(_exMode, data);
  document.getElementById('ex-what').textContent = _exSubject(_exMode, _exScene);
  _exPaint();
}

function _exEsc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _exAccent() {
  const hex = cssHex(getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  return {hex: hex.toUpperCase(), rgb: hexToRgb(hex)};
}

function _exPanelRows(scene) {
  if (_exMode === 'clock')
    return [['Time', `${scene.hh}:${scene.mm}`],
            ['Date', _exEsc(scene.date.replace(/\s{2,}/g, ' '))]];
  if (_exMode === 'nowplaying')
    return [['Title', _exEsc(scene.title)],
            ['Artist', _exEsc(scene.artist) || '-'],
            ['Album', _exEsc(scene.album) || '-'],
            ['Length', scene.totalText]];
  if (_exMode === 'verse_of_day')
    return [['Reference', _exEsc(scene.ref.replace(/\s{2,}/g, ' '))],
            ['Translation', _exEsc(scene.translation.replace(/[()]/g, '')) || '-'],
            ['Text', _exEsc(scene.lines.join(' '))]];
  return [['Weather', _exEsc([scene.temp, scene.cond].filter(Boolean).join('  '))],
          ['Event', _exEsc([scene.event, scene.eventWhen].filter(Boolean).join(', '))]];
}

function _exFrameCount(fmt, sweep) {
  if (fmt === 'gif') return exGifCount(_exMode, sweep);
  if (_exIsVideo(fmt)) return Math.max(2, Math.round(sweep * EX_VIDEO_FPS));
  return 0;
}

// what is going into the file, read off the same scene the renderer draws from
function _exSummary(fmt, width, scene) {
  const rows = [['Panel', EX_LABELS[_exMode] || _exMode]].concat(_exPanelRows(scene));
  const look = previewModeFor(_exMode);
  rows.push(['Appearance', look === 'pixel' ? 'Pixel' : 'Web']);
  rows.push(['Theme', document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark']);
  if (look !== 'pixel') {
    const a = _exAccent();
    rows.push(['Accent', `<span class="ex-swatch" style="background:${a.hex}"></span>`
                       + `${a.hex}  rgb(${a.rgb.join(', ')})`]);
  }
  rows.push(['Format', _exIsVideo(fmt)
    ? `${fmt.toUpperCase()}, ${(_exVideoAsked[fmt] || {}).codec || 'unknown'}`
    : fmt.toUpperCase()]);
  if (fmt !== 'svg') {
    const box = _exBox();
    rows.push(['Size', `${width} x ${2 * Math.round(width * box.h / box.w / 2)} Pixel`]);
  }
  rows.push(['Background', _exWantsBg() ? 'On' : 'Off']);
  if (!scene.sweep) {
    rows.push(['Motion', 'Still']);
    if (_exMode === 'nowplaying') rows.push(['Playhead', fmtClock(scene.elapsed)]);
    return rows;
  }
  rows.push(['Motion', 'Full pass']);
  rows.push(['Runtime', fmtClock(scene.sweep)]);
  const frames = _exFrameCount(fmt, scene.sweep);
  if (frames) rows.push(['Frames', String(frames)]);
  return rows;
}

function _exShowRun(fmt, width, scene) {
  document.getElementById('ex-form').style.display = 'none';
  document.getElementById('ex-run').style.display = '';
  document.getElementById('ex-sum').innerHTML = _exSummary(fmt, width, scene)
    .map(([k, v]) => `<div class="ex-sum-row"><span class="ex-sum-k">${k}</span>`
                   + `<span class="ex-sum-v">${v}</span></div>`).join('');
  // a still is written in one go, there is nothing to count off
  const stepped = fmt === 'gif' || _exIsVideo(fmt);
  document.getElementById('ex-bar-wrap').style.display = stepped ? '' : 'none';
  document.getElementById('ex-bar').style.width = '0%';
  document.getElementById('ex-pct').textContent = '';
  document.getElementById('ex-phase').textContent = stepped ? 'Drawing' : 'Writing';
}

function _exShowForm() {
  const form = document.getElementById('ex-form');
  if (!form) return;
  form.style.display = '';
  document.getElementById('ex-run').style.display = 'none';
}

// awaiting a resolved promise only drains microtasks, and the page paints between
// tasks, so a long loop has to hand the event loop a turn or the bar never moves
let _exYieldAt = 0;

async function _exBreathe() {
  if (performance.now() - _exYieldAt < 150) return;
  _exYieldAt = performance.now();
  await new Promise(r => requestAnimationFrame(r));
}

function _exStep(i, n, phase) {
  const pct = Math.round(100 * i / Math.max(1, n));
  document.getElementById('ex-bar').style.width = pct + '%';
  document.getElementById('ex-pct').textContent = pct + '%';
  if (phase) document.getElementById('ex-phase').textContent = phase;
}

function _exSubject(mode, scene) {
  if (mode === 'clock') return `${scene.hh}:${scene.mm}, ${scene.date}`;
  if (mode === 'nowplaying') {
    const who = scene.artist ? `${scene.artist} - ${scene.title}` : scene.title;
    return `${who}   ${scene.elapsedText} / ${scene.totalText}`;
  }
  if (mode === 'verse_of_day') return scene.ref.replace(/\s{2,}/g, ' ');
  return [scene.temp, scene.cond].filter(Boolean).join(', ');
}

// cancel during a render is an abort, the loops unwind on their own
function closeExport() {
  if (_exRunning) _exAbort = true;
  _exOpen = false;
  document.getElementById('ex-overlay')?.classList.remove('show');
}

// vp9 in 4:4:4 first: h264 in a browser is always 4:2:0, and half the colour
// resolution is what frays coloured text and eats a one pixel progress bar. h264
// stays behind it because that file plays anywhere, 4:2:0 chroma and all.
const EX_VIDEO_CODECS = [
  {ext: 'webm', codec: 'vp09.01.10.08.03', mux: 'V_VP9'},
  {ext: 'webm', codec: 'vp09.01.30.08.03', mux: 'V_VP9'},
  {ext: 'mp4',  codec: 'avc1.640034',      mux: 'avc'},
  {ext: 'mp4',  codec: 'avc1.4d0034',      mux: 'avc'},
  {ext: 'webm', codec: 'vp09.00.10.08',    mux: 'V_VP9'},
  {ext: 'webm', codec: 'vp8',              mux: 'V_VP8'},
];

// 0.15 is a camera number, a panel is hard edges and a dot raster and wants far more
const EX_BITS_PER_PIXEL = 0.6;

function _exBitrate(w, h) {
  return Math.max(2e6, Math.min(80e6, Math.round(w * h * EX_VIDEO_FPS * EX_BITS_PER_PIXEL)));
}

async function exVideoPick(width, height, want) {
  if (!window.VideoEncoder) return null;
  for (const c of EX_VIDEO_CODECS.filter(c => !want || c.ext === want)) {
    const cfg = {codec: c.codec, width, height, framerate: EX_VIDEO_FPS,
                 bitrate: _exBitrate(width, height)};
    try {
      const {supported} = await VideoEncoder.isConfigSupported(cfg);
      if (supported) return Object.assign({cfg}, c);
    } catch {}
  }
  return null;
}

// the dialog has to grey an entry out before a width is picked, so both containers
// are asked once at a common size
const _exVideoAsked = {};

async function exVideoProbe() {
  for (const f of EX_VIDEO_FMTS)
    if (_exVideoAsked[f] === undefined) _exVideoAsked[f] = await exVideoPick(1920, 480, f) || false;
  _exPaint();
  return _exVideoAsked;
}

function _exWantsBg() {
  return document.getElementById('ex-bg')?.checked;
}

function _exBox() {
  if (!_exWantsBg()) return {w: R_W, h: R_H};
  const w = R_W / (1 - 2 * R_FRAME_PAD);
  return {w, h: R_H + 2 * w * R_FRAME_PAD};
}

// ---- the scene ------------------------------------------------------------

function _exWrap(str, size, maxW, maxLines) {
  const words = String(str || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (rTextWidth(next, size) <= maxW || !line) { line = next; continue; }
    lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines.slice(0, maxLines);
}

async function _exCoverDataUri(url) {
  const src = bpCoverUrl(url);
  if (!src) return null;
  const blob = await fetch(src).then(r => r.ok ? r.blob() : null).catch(() => null);
  if (!blob) return null;
  return await new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => res(null);
    fr.readAsDataURL(blob);
  });
}

// what the browser laid out, carried into the 1000 unit space
function _exPlanFromDom(id) {
  const el = document.getElementById(id);
  const bp = document.getElementById('home-blueprint');
  const span = el && el.firstElementChild;
  if (!el || !span || !bp || !bp.clientWidth) return null;
  const k = R_W / bp.clientWidth;
  const boxW = el.clientWidth * k, textW = span.offsetWidth * k;
  const over = el.classList.contains('on') ? textW - boxW : 0;
  return {over: Math.max(0, over), textW, boxW};
}

async function exScene(mode, data) {
  const pal = rPalette(mode);
  const scene = {pal};
  if (mode === 'clock') {
    const now = new Date();
    scene.hh = String(now.getHours()).padStart(2, '0');
    scene.mm = String(now.getMinutes()).padStart(2, '0');
    const day = now.getDate();
    scene.date = `${now.toLocaleDateString('en-US', {weekday: 'long'})}, `
               + `${now.toLocaleDateString('en-US', {month: 'long'})} ${day}${_ordinalSuffix(day)}`
               + ` ${now.getFullYear()}`;
    scene.blink = (cfg.clock?.blink_interval ?? 1) * 2;
  } else if (mode === 'verse_of_day') {
    const v = data.verse || {};
    scene.ref = _verseReference(v.reference);
    const noTrans = document.documentElement.dataset.trans === 'off';
    scene.lines = _exWrap(v.reference ? bpPassage(v.reference, v.translation) : '',
                          2.5 * CQ * (noTrans ? VS_NO_TRANS_SCALE : 1),
                          88 * CQ, noTrans ? 4 : 3);
    scene.translation = v.translation
      ? '(' + (BP_TRANSLATIONS[v.translation] || v.translation.split(':').pop().toUpperCase()) + ')'
      : '';
  } else if (mode === 'nowplaying') {
    const np = data.nowplaying || {};
    scene.title  = np.title || 'Nothing playing';
    scene.artist = np.artist || '';
    scene.album  = np.album || '';
    scene.duration = np.duration_s > 0 ? np.duration_s : NP_FALLBACK_DURATION_S;
    scene.elapsed = np.playing ? (np.elapsed_s || 0) : 0;
    scene.elapsedText = fmtClock(scene.elapsed);
    scene.totalText = fmtClock(scene.duration);
    scene.cover = await _exCoverDataUri(np.cover_url);
    scene.plans = {title: _exPlanFromDom('bp-track'), artist: _exPlanFromDom('bp-artist'),
                   album: _exPlanFromDom('bp-album')};
  } else {
    const dash = data.dashboard || {};
    const w = dash.weather || {};
    scene.temp = w.temp_now != null ? Math.round(w.temp_now) + '°' : '—';
    const parts = [];
    if (w.condition) parts.push(w.condition);
    if (w.temp_high != null) parts.push('H ' + Math.round(w.temp_high) + '°');
    if (w.temp_low != null) parts.push('L ' + Math.round(w.temp_low) + '°');
    scene.cond = parts.join('  ·  ');
    scene.icon = BP_WEATHER_ICONS[w.condition] || '#ico-cloud';
    const ev = (dash.events || [])[0];
    scene.event = (ev && ev.title) || 'No upcoming events';
    scene.eventWhen = ev ? _eventWhen(ev) : '';
  }
  return scene;
}

// how long one full pass takes, zero when nothing moves
function exCycle(mode, scene) {
  if (mode === 'clock') return scene.blink || 0;
  if (mode !== 'nowplaying') return 0;
  const p = scene.plans || {};
  return Math.max(rScrollCycle([p.title, p.artist, p.album]), EX_NP_SWEEP_S);
}

// what an animated file covers: the pass that carries the scrolling, or the song if
// that runs longer, so the head moves at the speed it has on the panel
function exSweep(mode, scene) {
  const cycle = exCycle(mode, scene);
  if (mode !== 'nowplaying') return cycle;
  return Math.max(cycle, scene.duration || 0);
}

function _exFrameScene(mode, scene, t, animate) {
  // a still keeps the colon: a clock caught mid blink reads as a broken one
  if (mode === 'clock')
    return Object.assign({}, scene,
      {colonOn: !animate || !scene.blink || (t % scene.blink) < scene.blink / 2});
  if (mode === 'nowplaying' && scene.sweep) {
    const el = scene.duration * ((t % scene.sweep) / scene.sweep);
    return Object.assign({}, scene, {elapsed: el, elapsedText: fmtClock(el)});
  }
  return scene;
}

// a standalone file has no stylesheet, so the seven segment face rides along as a
// data uri. the proportional text keeps the system stack on purpose.
let _exFontCss = null;

async function exFontCss() {
  if (_exFontCss !== null) return _exFontCss;
  try {
    const blob = await fetch('/assets/fonts/SevenSegment.ttf').then(r => r.blob());
    const uri = await new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => res(null);
      fr.readAsDataURL(blob);
    });
    _exFontCss = uri ? `@font-face{font-family:'SevenSegment';src:url(${uri}) format('truetype');}` : '';
  } catch {
    _exFontCss = '';
  }
  return _exFontCss;
}

function setExAnim() {
  _exAnimTouched = true;
  _exPaint();
}

function setExHead(which) {
  _exHeadCustom = which === 'custom';
  _exPaint();
}

// where the head stands in the still, either the moment of export or a picked spot
function _exHeadAt(scene) {
  if (!_exHeadCustom) return scene.elapsed;
  return scene.duration * (+document.getElementById('ex-head').value / 1000);
}

function _exPlaceHead(scene) {
  if (_exMode !== 'nowplaying') return;
  scene.elapsed = _exHeadAt(scene);
  scene.elapsedText = fmtClock(scene.elapsed);
}

function _exAnimOn() {
  return document.getElementById('ex-anim').checked
      && document.getElementById('ex-anim-row').style.display !== 'none';
}

// ---- frames ---------------------------------------------------------------

function exFps(mode) { return EX_FPS[mode] || 30; }

// three and a half minutes is the mark: ten frames a second, so 2100 of them. a
// shorter track samples faster out of the same budget, a longer one slower, and four
// a second is the floor whatever the length
const GIF_FRAME_BUDGET = 2100;
const GIF_FPS_MIN = 4;
const GIF_FPS_MAX = 20;

function exStates(mode) { return EX_STATES[mode] || 0; }

function exGifCount(mode, sweep) {
  if (!sweep) return 1;
  return exStates(mode) || Math.max(1, Math.round(sweep * exGifFps(mode, sweep)));
}

function exGifFps(mode, sweep) {
  const top = Math.min(exFps(mode), GIF_FPS_MAX);
  if (!sweep) return top;
  return Math.max(GIF_FPS_MIN, Math.min(top, Math.floor(GIF_FRAME_BUDGET / sweep)));
}

async function _exShot(mode, scene, t, width, animate, cv, layer) {
  const c = await exToCanvas(mode, scene, t, width, animate, cv, layer);
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
}

// the palette is picked from a handful of frames spread over the pass, so a colour
// that only turns up late still gets a slot
const GIF_PALETTE_FRAMES = 8;

// drawn and written frame by frame, holding a whole track as pixels would not fit
async function exGif(mode, scene, width, onStep) {
  const sweep = scene.sweep || 0;
  const count = exGifCount(mode, sweep);
  const cv = document.createElement('canvas');
  const layer = {};
  const probes = Math.min(GIF_PALETTE_FRAMES, count);
  const seen = [];
  for (let i = 0; i < probes; i++) {
    exAbortCheck();
    seen.push(await _exShot(mode, scene, sweep * i / probes, width, !!sweep, cv, layer));
    if (onStep) onStep(i + 1, probes, 'Reading colours');
  }
  const palette = gifPalette(seen);

  const gif = gifStart();
  const delay = sweep ? 1000 * sweep / count : 100;
  for (let i = 0; i < count; i++) {
    exAbortCheck();
    const data = await _exShot(mode, scene, sweep * i / count, width, !!sweep, cv, layer);
    gifWrite(gif, data, cv.width, cv.height, palette, delay);
    if (onStep) onStep(i + 1, count, 'Writing frames');
    await _exBreathe();
  }
  return gifFinish(gif);
}

// nothing here waits on a clock any more. WebCodecs takes a frame with the timestamp
// it is given, so the film is written as fast as the frames can be drawn.
async function exEncode(mode, scene, width, onStep, want) {
  const cv = document.createElement('canvas');
  const layer = {};
  await exToCanvas(mode, scene, 0, width, true, cv, layer);
  const pick = await exVideoPick(cv.width, cv.height, want);
  if (!pick) throw new Error('this browser cannot encode ' + want);

  const sweep = scene.sweep || exCycle(mode, scene) || 1;
  const count = Math.max(2, Math.round(sweep * EX_VIDEO_FPS));
  const lib = pick.ext === 'mp4' ? Mp4Muxer : WebMMuxer;
  const target = new lib.ArrayBufferTarget();
  const muxer = new lib.Muxer(pick.ext === 'mp4'
    ? {target, fastStart: 'in-memory',
       video: {codec: 'avc', width: cv.width, height: cv.height}}
    : {target,
       video: {codec: pick.mux, width: cv.width, height: cv.height, frameRate: EX_VIDEO_FPS}});
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => console.error('encoder failed:', e),
  });
  encoder.configure(pick.cfg);

  const step = 1e6 / EX_VIDEO_FPS;
  const states = exStates(mode);
  let drawn = -1;
  try {
    for (let i = 0; i < count; i++) {
      exAbortCheck();
      const t = sweep * i / count;
      // a panel with a handful of pictures is drawn once per picture, not per frame
      const at = states ? Math.floor(t / sweep * states) : i;
      if (at !== drawn) { await exToCanvas(mode, scene, t, width, true, cv, layer); drawn = at; }
      const frame = new VideoFrame(cv, {timestamp: Math.round(i * step),
                                        duration: Math.round(step)});
      encoder.encode(frame, {keyFrame: i % (2 * EX_VIDEO_FPS) === 0});
      frame.close();
      // the queue is the only backpressure there is, letting it run away eats the tab
      while (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r));
      if (onStep) onStep(i + 1, count, 'Drawing');
      await _exBreathe();
    }
    if (onStep) onStep(count, count, 'Finishing');
    await encoder.flush();
  } catch (e) {
    encoder.close();
    throw e;
  }
  muxer.finalize();
  return {blob: new Blob([target.buffer], {type: 'video/' + pick.ext}), ext: pick.ext};
}

// ---- writing the file -----------------------------------------------------

function _exDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function _exSlug(str) {
  return String(str || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
}

function _exName(mode, ext) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
              + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const parts = [EX_LABELS[mode] || mode];
  if (mode === 'nowplaying' && _exScene) {
    if (_exScene.artist) parts.push(_exSlug(_exScene.artist));
    if (_exScene.title) parts.push(_exSlug(_exScene.title));
  }
  return `${parts.join('-')}_${stamp}.${ext}`;
}

// decoded once and kept, a film asks for the same cover a few hundred times
const _exImages = new Map();

async function _exLoadImages(ops, into) {
  for (const o of ops) {
    if (o.op === 'clip' || o.op === 'group') { await _exLoadImages(o.children, into); continue; }
    if (o.op !== 'image' || into[o.href]) continue;
    if (!_exImages.has(o.href)) {
      _exImages.set(o.href, await new Promise(res => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = o.href;
      }));
    }
    into[o.href] = _exImages.get(o.href);
  }
  return into;
}

// layer is an empty object handed in by a run of frames. the first frame fills it with
// the still part of the picture, every frame after that copies it and draws the rest.
async function exToCanvas(mode, scene, t, width, animate, into, layer) {
  let ops = rBuildOps(mode, _exFrameScene(mode, scene, t, animate), t, animate, false);
  let box = {w: R_W, h: R_H};
  const split = layer ? rStaticRun(ops) : 0;
  if (_exWantsBg()) {
    const f = rFramed(ops, scene.pal, layer ? split : undefined);
    ops = f.ops;
    box = {w: f.w, h: f.h};
  }
  const run = layer ? rStaticRun(ops) : 0;
  const images = await _exLoadImages(ops, {});
  const cv = into || document.createElement('canvas');
  cv.width = width;
  // an even height is what the video encoders ask for, scaling each axis on its own
  // keeps the panel filling the canvas exactly
  cv.height = 2 * Math.round(width * box.h / box.w / 2);
  const kx = cv.width / box.w, ky = cv.height / box.h;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!run) {
    ctx.scale(kx, ky);
    rOpsToCanvas(ctx, ops, images);
    return cv;
  }
  if (!layer.img) {
    layer.img = document.createElement('canvas');
    layer.img.width = cv.width;
    layer.img.height = cv.height;
    const lc = layer.img.getContext('2d');
    lc.scale(kx, ky);
    rOpsToCanvas(lc, ops.slice(0, run), images);
  }
  ctx.drawImage(layer.img, 0, 0);
  ctx.scale(kx, ky);
  rOpsToCanvas(ctx, ops.slice(run), images);
  return cv;
}

async function runExport() {
  const btn = document.getElementById('ex-go');
  const fmt = document.getElementById('ex-format').value;
  const width = +document.getElementById('ex-width').value;
  _exAbort = false;
  _exRunning = true;
  btn.disabled = true;
  btn.textContent = 'Rendering';
  try {
    const scene = _exScene || await exScene(_exMode, await fetch('/home').then(r => r.json()));
    // one place decides whether anything moves, the head is placed when nothing does
    const anim = _exIsVideo(fmt) || (fmt !== 'png' && _exAnimOn());
    scene.sweep = anim ? exSweep(_exMode, scene) : 0;
    if (!scene.sweep) _exPlaceHead(scene);
    _exShowRun(fmt, width, scene);

    if (fmt === 'svg') {
      let ops = rBuildOps(_exMode, _exFrameScene(_exMode, scene, 0, anim), 0, anim, true);
      let box = null;
      if (_exWantsBg()) {
        const f = rFramed(ops, scene.pal);
        ops = f.ops;
        box = {w: f.w, h: f.h};
      }
      const svg = rOpsToSvg(ops, width, _exMode === 'clock' ? await exFontCss() : '', box);
      _exDownload(new Blob([svg], {type: 'image/svg+xml'}), _exName(_exMode, 'svg'));
    } else if (fmt === 'gif') {
      const blob = await exGif(_exMode, scene, width, _exStep);
      _exDownload(blob, _exName(_exMode, 'gif'));
    } else if (_exIsVideo(fmt)) {
      const {blob, ext} = await exEncode(_exMode, scene, width, _exStep, fmt);
      _exDownload(blob, _exName(_exMode, ext));
    } else {
      const cv = await exToCanvas(_exMode, scene, 0, width);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      _exDownload(blob, _exName(_exMode, 'png'));
    }
    closeExport();
  } catch (e) {
    if (!e || e.message !== EX_ABORT) console.error('export failed:', e);
  } finally {
    _exRunning = false;
    _exAbort = false;
    btn.disabled = false;
    btn.textContent = 'Export';
    _exShowForm();
  }
}
