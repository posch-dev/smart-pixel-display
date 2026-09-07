// The export dialog. It builds its own markup so both the dashboard and the preview
// page get the same one, pulls a fresh reading from /home, and hands the scene to
// render.js. Nothing here runs on the live clock, every frame is drawn for a time.

const EX_WIDTHS = [600, 720, 1080, 1280, 1440, 1920, 2160, 2560, 3840, 4096];
const EX_ANIMATED = ['nowplaying', 'clock', 'dashboard'];
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
const EX_STATES = {clock: 2, dashboard: 2};
// a track always has something to show even when no line overflows: the head runs the
// whole song inside one pass, not in real time
const EX_NP_SWEEP_S = 10;
const EX_LABELS = {clock: 'Clock', verse_of_day: 'Verse', nowplaying: 'NowPlaying', dashboard: 'Dashboard'};

let _exWindow = null;
let _exAnimKind = null;
let _exLapse = {from: null, to: null};
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
    <div class="row" id="ex-lapse-row">
      <div class="row-left"><div class="row-label">Animation</div>
        <div class="row-sub" id="ex-lapse-why"></div></div>
      <div class="row-right"><div class="seg" id="ex-kind"></div></div>
    </div>
    <div id="ex-lapse-box" style="display:none">
      <div class="row"><div class="row-left"><div class="row-label">From</div></div>
        <div class="row-right bright-row" id="ex-from"></div></div>
      <div class="row"><div class="row-left"><div class="row-label">To</div></div>
        <div class="row-right bright-row" id="ex-to"></div></div>
      <div class="row"><div class="row-left"><div class="row-label">This Event Only</div>
          <div class="row-sub">Off lets the panel move on to the next one</div></div>
        <div class="row-right"><label class="toggle"><input type="checkbox" id="ex-lapse-one"
          checked onchange="_exPaint()"><div class="t-track"></div><div class="t-thumb"></div></label></div>
      </div>
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

// a run of minutes is only offered where the panel has an event to run through, and
// only in the formats that carry one picture after another
function exLapsable(fmt) {
  return _exMode === 'dashboard' && !!_exWindow && (fmt === 'gif' || _exIsVideo(fmt));
}

// three ways for this panel to come out: standing still, NOW taking turns between its
// colours, or the day running past. a film cannot stand still, and anything that is
// not on offer falls back to what is
function exAnimKind(fmt) {
  const blink = exAnimatable(_exMode, _exScene), lapse = exLapsable(fmt);
  const want = _exAnimKind || 'blink';
  if (want === 'still') return _exIsVideo(fmt) ? (blink ? 'blink' : 'lapse') : 'still';
  if (want === 'lapse' && lapse) return 'lapse';
  if (want === 'blink' && blink) return 'blink';
  return blink ? 'blink' : lapse ? 'lapse' : 'still';
}

function exDashMotion(fmt) {
  return fmt !== 'png' && (exAnimatable(_exMode, _exScene) || exLapsable(fmt));
}

function setExAnimKind(kind) {
  _exAnimKind = kind;
  _exPaint();
}

function _exKindSeg(fmt) {
  const kind = exAnimKind(fmt);
  const btn = (v, label, live) =>
    `<button onclick="setExAnimKind('${v}')" class="${kind === v ? 'on' : ''}"
      ${live ? '' : 'disabled'}>${label}</button>`;
  return btn('still', 'Still', !_exIsVideo(fmt))
       + btn('blink', 'Blink', exAnimatable(_exMode, _exScene))
       + btn('lapse', 'Timelapse', exLapsable(fmt));
}

function _exLapseOn(fmt) {
  return exLapsable(fmt) && exAnimKind(fmt) === 'lapse';
}

function _exMinutes(hhmm) {
  const [h, m] = hhmm.split(':');
  return +h * 60 + +m;
}

function _exHhmm(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function _exLapseSpan() {
  if (!_exWindow) return 0;
  const a = _exMinutes(_exLapse.from || _exWindow.from);
  const b = _exMinutes(_exLapse.to || _exWindow.to);
  return Math.max(1, b - a + 1);
}

// the dials never leave the window the panel gave, so a run cannot be asked for that
// the panel would never have shown
function _exTimeDial(which) {
  const lo = _exMinutes(_exWindow.from), hi = _exMinutes(_exWindow.to);
  const at = _exMinutes(_exLapse[which] || _exWindow[which]);
  let hours = '';
  for (let h = Math.floor(lo / 60); h <= Math.floor(hi / 60); h++)
    hours += `<option value="${h}" ${h === Math.floor(at / 60) ? 'selected' : ''}>${String(h).padStart(2, '0')}</option>`;
  let mins = '';
  for (let m = 0; m < 60; m++) {
    const v = Math.floor(at / 60) * 60 + m;
    if (v < lo || v > hi) continue;
    mins += `<option value="${m}" ${m === at % 60 ? 'selected' : ''}>${String(m).padStart(2, '0')}</option>`;
  }
  return `<select class="pv-sel pv-sel-n" onchange="setExLapseAt('${which}','h',this.value)">${hours}</select>`
       + `<span class="pv-unit">h</span><span class="pv-colon">:</span>`
       + `<select class="pv-sel pv-sel-n" onchange="setExLapseAt('${which}','m',this.value)">${mins}</select>`
       + `<span class="pv-unit">m</span>`;
}

function setExLapseAt(which, part, v) {
  const cur = _exMinutes(_exLapse[which] || _exWindow[which]);
  const mins = part === 'h' ? +v * 60 + cur % 60 : Math.floor(cur / 60) * 60 + +v;
  const lo = _exMinutes(_exWindow.from), hi = _exMinutes(_exWindow.to);
  _exLapse[which] = _exHhmm(Math.min(hi, Math.max(lo, mins)));
  if (_exMinutes(_exLapse.to || _exWindow.to) < _exMinutes(_exLapse.from || _exWindow.from))
    _exLapse[which === 'from' ? 'to' : 'from'] = _exLapse[which];
  _exPaint();
}

// how many pictures and how fast, said the same way wherever it is said
function _exFrameLabel(frames, sweep) {
  const one = `${frames} frame${frames === 1 ? '' : 's'}`;
  if (!frames || !sweep) return one;
  const fps = frames / sweep;
  return `${one} @ ${(Math.round(fps * 10) / 10)} fps`;
}

// mp4 is a film either way, png is one frame either way, so only svg and gif ask
function _exPaint() {
  const fmt = document.getElementById('ex-format').value;
  document.getElementById('ex-width-row').style.display = fmt === 'svg' ? 'none' : '';
  const w = +document.getElementById('ex-width').value;
  const box = _exBox();
  let size = `${w} x ${2 * Math.round(w * box.h / box.w / 2)} Pixel`;
  if (_exIsVideo(fmt) && _exScene)
    size += `, ${fmtClock(exSweep(_exMode, _exScene))} @ ${exVideoFps(_exMode, _exScene)} fps`;
  document.getElementById('ex-size').textContent = size;
  // the dashboard says it in one row of three, the other panels keep their tick
  const dash = _exMode === 'dashboard', motion = dash && exDashMotion(fmt);
  const canAnim = !dash && exAnimatable(_exMode, _exScene) && (fmt === 'svg' || fmt === 'gif');
  document.getElementById('ex-anim-row').style.display = canAnim ? '' : 'none';
  document.getElementById('ex-lapse-row').style.display = motion ? '' : 'none';
  const lapse = _exLapseOn(fmt);
  document.getElementById('ex-lapse-box').style.display = lapse ? '' : 'none';
  if (lapse) {
    document.getElementById('ex-from').innerHTML = _exTimeDial('from');
    document.getElementById('ex-to').innerHTML = _exTimeDial('to');
  }
  if (_exScene) _exScene.lapse = lapse ? _exLapsePlan() : null;
  if (motion) {
    const kind = exAnimKind(fmt);
    document.getElementById('ex-kind').innerHTML = _exKindSeg(fmt);
    const sweep = _exScene && kind !== 'still' ? exSweep(_exMode, _exScene) : 0;
    const n = kind === 'still' ? 1
            : _exScene ? exGifCount(_exMode, sweep, _exScene) : 0;
    document.getElementById('ex-lapse-why').textContent = _exFrameLabel(n, sweep);
  }
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
    why.textContent = _exFrameLabel(exGifCount(_exMode, sweep, _exScene), sweep);
  }
  // a film of a panel that never moves is a still that takes longer to open
  for (const f of EX_VIDEO_FMTS) {
    const opt = document.querySelector(`#ex-format option[value="${f}"]`);
    if (!opt) continue;
    opt.disabled = _exVideoAsked[f] === false
      || !(exAnimatable(_exMode, _exScene) || exLapsable(f));
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
  const data = blueprintFrozenData() || await fetch('/home').then(r => r.json());
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
  const w = [scene.temp != null ? scene.temp + '\u00b0' : '-', scene.condition].filter(Boolean);
  return [['Weather', _exEsc(w.join('  '))],
          ['High Low', [scene.high, scene.low].every(v => v == null) ? '-'
                       : `${scene.high}\u00b0  ${scene.low}\u00b0`],
          ['Time', `${scene.hh}:${scene.mm}`],
          ['Date', _exEsc(scene.date)],
          ['Event', _exEsc(scene.title) || '-'],
          ['Leaving', scene.mode === 3 && scene.extra ? _exEsc(_rLeaveParts(scene).join(' ')) : '-']];
}

function _exFrameCount(fmt, sweep) {
  if (fmt === 'gif') return exGifCount(_exMode, sweep, _exScene);
  if (_exIsVideo(fmt)) return Math.max(2, Math.round(sweep * exVideoFps(_exMode, _exScene)));
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
  return [scene.temp != null ? scene.temp + '°' : null, scene.condition, scene.title]
         .filter(Boolean).join(', ');
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
  return await _exDataUri(bpCoverUrl(url));
}

// a file cannot point at the pi, every picture it carries has to be inlined
async function _exDataUri(src) {
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
    Object.assign(scene, bpDashScene(data.dashboard || {}));
    _exWindow = scene.index === null || scene.index === undefined ? null
      : await fetch('/dashboard/window?event=' + scene.index)
          .then(r => r.ok ? r.json() : null).catch(() => null);
    if (_exWindow && !_exWindow.from) _exWindow = null;
    scene.date = bpLongDateText(new Date());
    scene.blink = (cfg.clock?.blink_interval ?? 1) * 2;
    scene.pixel = previewModeFor('dashboard') === 'pixel';
    scene.snap = bpDashSnapshot();
    // a file cannot point at the pi, a picture the tile is still loading is inlined here
    for (const o of (scene.snap ? scene.snap.ops : []))
      if (o.op === 'image' && !o.src.startsWith('data:'))
        o.src = await bpWeatherPng(o.src) || o.src;
  }
  return scene;
}

// how long one full pass takes, zero when nothing moves
// the dashboard holds still unless NOW is blinking, which is the only thing on it
// that moves. one pass is one blink period, two pictures, like the clock
function exAnimatable(mode, scene) {
  if (mode !== 'dashboard') return EX_ANIMATED.includes(mode);
  return !!(scene && scene.mode === 3 && scene.late && scene.extra && scene.blinkNow);
}

function exCycle(mode, scene) {
  // a minute of the day per second, so the pass is as long as the run of minutes
  if (mode === 'dashboard' && scene.lapse) return scene.lapse.mins;
  if (mode === 'dashboard') return exAnimatable(mode, scene) ? (scene.blink || 0) : 0;
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
  const fmt = document.getElementById('ex-format').value;
  if (_exMode === 'dashboard') return exDashMotion(fmt) && exAnimKind(fmt) !== 'still';
  return document.getElementById('ex-anim').checked
      && document.getElementById('ex-anim-row').style.display !== 'none';
}

function _exLapsePlan() {
  return {from: _exLapse.from || _exWindow.from, to: _exLapse.to || _exWindow.to,
          only: document.getElementById('ex-lapse-one').checked,
          mins: _exLapseSpan()};
}

// ---- frames ---------------------------------------------------------------

function exFps(mode) { return EX_FPS[mode] || 30; }

// three and a half minutes is the mark: ten frames a second, so 2100 of them. a
// shorter track samples faster out of the same budget, a longer one slower, and four
// a second is the floor whatever the length
const GIF_FRAME_BUDGET = 2100;
const GIF_FPS_MIN = 4;
const GIF_FPS_MAX = 20;

function exStates(mode, scene) {
  // a run through the day is as many pictures as it has minutes
  if (scene && scene.lapse) return scene.lapse.mins;
  return EX_STATES[mode] || 0;
}

// thirty a second is for a head sliding along a bar. a picture a minute needs one
function exVideoFps(mode, scene) {
  return scene && scene.lapse ? 1 : EX_VIDEO_FPS;
}

function exGifCount(mode, sweep, scene) {
  if (!sweep) return 1;
  if (scene && scene.lapse) return scene.lapse.mins;
  return exStates(mode, scene) || Math.max(1, Math.round(sweep * exGifFps(mode, sweep)));
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
  const count = exGifCount(mode, sweep, scene);
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
  const fps = exVideoFps(mode, scene);
  const count = Math.max(2, Math.round(sweep * fps));
  const lib = pick.ext === 'mp4' ? Mp4Muxer : WebMMuxer;
  const target = new lib.ArrayBufferTarget();
  const muxer = new lib.Muxer(pick.ext === 'mp4'
    ? {target, fastStart: 'in-memory',
       video: {codec: 'avc', width: cv.width, height: cv.height}}
    : {target,
       video: {codec: pick.mux, width: cv.width, height: cv.height, frameRate: fps}});
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => console.error('encoder failed:', e),
  });
  encoder.configure(pick.cfg);

  const step = 1e6 / fps;
  const states = exStates(mode, scene);
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
      encoder.encode(frame, {keyFrame: i % Math.max(2, 2 * fps) === 0});
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

// every minute of the run is a picture of the tile, so the tile has to be walked
// through them. it is put out of sight while that happens
async function _exBuildLapse(scene) {
  const plan = scene.lapse;
  const q = `from=${plan.from}&to=${plan.to}` + (plan.only ? `&event=${scene.index}` : '');
  const layouts = await fetch('/dashboard/layouts?' + q)
    .then(r => r.ok ? r.json() : null).catch(() => null);
  if (!layouts || !layouts.length) return null;
  const tile = document.getElementById('home-blueprint');
  const held = bpDashOverride();
  // out of sight but not hidden: visibility inherits and the snapshot skips what is
  // hidden, so hiding it that way would measure nothing at all
  if (tile) tile.style.opacity = '0';
  const frames = [];
  const first = _exMinutes(plan.from);
  try {
    for (let i = 0; i < layouts.length; i++) {
      exAbortCheck();
      setBpDashOverride({layout: layouts[i], time: _exHhmm(first + i)});
      bpRepaint();
      await new Promise(requestAnimationFrame);
      const snap = bpDashSnapshot();
      for (const o of (snap ? snap.ops : []))
        if (o.op === 'image' && !o.src.startsWith('data:'))
          o.src = await bpWeatherPng(o.src) || o.src;
      frames.push(snap);
      if (_exStep) _exStep(i + 1, layouts.length, 'Walking the day');
    }
  } finally {
    setBpDashOverride(held);
    bpRepaint();
    if (tile) tile.style.opacity = '';
  }
  return frames;
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
    const scene = _exScene
      || await exScene(_exMode, blueprintFrozenData() || await fetch('/home').then(r => r.json()));
    // one place decides whether anything moves, the head is placed when nothing does
    const anim = _exIsVideo(fmt) || (fmt !== 'png' && _exAnimOn());
    scene.lapse = _exLapseOn(fmt) ? _exLapsePlan() : null;
    scene.sweep = anim ? exSweep(_exMode, scene) : 0;
    if (!scene.sweep) _exPlaceHead(scene);
    _exShowRun(fmt, width, scene);
    if (scene.lapse && scene.sweep) {
      scene.frames = await _exBuildLapse(scene);
      if (!scene.frames) { scene.lapse = null; scene.sweep = 0; }
    }

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
