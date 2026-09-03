// The export dialog. It builds its own markup so both the dashboard and the preview
// page get the same one, pulls a fresh reading from /home, and hands the scene to
// render.js. Nothing here runs on the live clock, every frame is drawn for a time.

const EX_WIDTHS = [600, 720, 1080, 1280, 1440, 1920, 2160, 2560, 3840, 4096];
const EX_ANIMATED = ['nowplaying', 'clock'];
// the clock only turns a colon on and off, so two a second lands every change on a
// frame of its own and the file stays small
const EX_FPS = {nowplaying: 30, clock: 2};
// a track always has something to show even when no line overflows: the head runs the
// whole song inside one pass, not in real time
const EX_NP_SWEEP_S = 10;
const EX_LABELS = {clock: 'Clock', verse_of_day: 'Verse', nowplaying: 'NowPlaying', dashboard: 'Dashboard'};

let _exMode = 'clock';
let _exScene = null;
let _exOpen = false;
let _exAnimShown = false;
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
    <div class="row">
      <div class="row-left"><div class="row-label">Format</div></div>
      <div class="row-right"><select id="ex-format" onchange="_exPaint()">
        <option value="svg">SVG</option>
        <option value="png">PNG</option>
        <option value="gif">GIF</option>
        <option value="video">MP4</option>
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
      <div class="row-right"><label class="toggle"><input type="checkbox" id="ex-anim" onchange="_exPaint()">
        <div class="t-track"></div><div class="t-thumb"></div></label></div>
    </div>
    ${document.getElementById('tab-home') ? `<div class="row">
      <div class="row-left"><div class="row-sub">More customization available on the
        <a href="/preview" target="_blank" rel="noopener" class="ex-link">preview site</a></div></div>
    </div>` : ''}
    <div style="padding:12px 16px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border)">
      <button class="btn btn-ghost" onclick="closeExport()">Cancel</button>
      <button class="btn btn-accent" id="ex-go" onclick="runExport()">Export</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
}

// mp4 is a film either way, png is one frame either way, so only svg and gif ask
function _exPaint() {
  const fmt = document.getElementById('ex-format').value;
  document.getElementById('ex-width-row').style.display = fmt === 'svg' ? 'none' : '';
  const w = +document.getElementById('ex-width').value;
  const box = _exBox();
  document.getElementById('ex-size').textContent =
    `${w} x ${Math.round(w * box.h / box.w)} Pixel`;
  const canAnim = EX_ANIMATED.includes(_exMode) && (fmt === 'svg' || fmt === 'gif');
  document.getElementById('ex-anim-row').style.display = canAnim ? '' : 'none';
  // only propose a default when the row appears, a width change must not undo a tick
  if (canAnim && !_exAnimShown) document.getElementById('ex-anim').checked = _exMode === 'nowplaying';
  _exAnimShown = canAnim;
  // a panel with nothing long enough to scroll has no pass to write, and saying so
  // beats handing over a file that turns out to be a still
  // a still can stand anywhere in the track, a pass covers all of it anyway
  const headRow = document.getElementById('ex-head-row');
  const stillNp = _exMode === 'nowplaying' && !(canAnim && document.getElementById('ex-anim').checked)
               && fmt !== 'video';
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
  // a film of a panel that never moves is a still that takes longer to open
  const type = exVideoType();
  const opt = document.querySelector('#ex-format option[value="video"]');
  if (opt) {
    opt.textContent = type && type.startsWith('video/mp4') ? 'MP4' : 'WebM';
    opt.disabled = !type || !EX_ANIMATED.includes(_exMode);
    if (opt.disabled && fmt === 'video') {
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
  _exAnimShown = false;
  _exHeadCustom = false;
  _exPaint();
  document.getElementById('ex-panel').textContent = EX_LABELS[_exMode] || 'Export';
  document.getElementById('ex-what').textContent = '';
  document.getElementById('ex-overlay').classList.add('show');
  const data = await fetch('/home').then(r => r.json());
  _exScene = await exScene(_exMode, data);
  document.getElementById('ex-what').textContent = _exSubject(_exMode, _exScene);
  _exPaint();
}

function _exSubject(mode, scene) {
  if (mode === 'clock') return `${scene.hh}:${scene.mm}, ${scene.date}`;
  if (mode === 'nowplaying') {
    const who = scene.artist ? `${scene.title}, ${scene.artist}` : scene.title;
    return `${who}  ${scene.elapsedText} / ${scene.totalText}`;
  }
  if (mode === 'verse_of_day') return scene.ref.replace(/\s{2,}/g, ' ');
  return [scene.temp, scene.cond].filter(Boolean).join(', ');
}

function closeExport() {
  _exOpen = false;
  document.getElementById('ex-overlay')?.classList.remove('show');
}

// mp4 out of MediaRecorder is a maybe, webm is the one every engine writes
function exVideoType() {
  const want = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return want.find(t => window.MediaRecorder?.isTypeSupported(t)) || null;
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

async function _exCoverDataUri(etag) {
  if (!etag) return null;
  const blob = await fetch('/nowplaying/cover?e=' + etag).then(r => r.ok ? r.blob() : null);
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
  return {over: Math.max(0, over), dur: over > 0 ? 7 + over / 12 : 0, textW, boxW};
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
               + `  ${now.getFullYear()}`;
    scene.blink = (cfg.clock?.blink_interval ?? 1) * 2;
  } else if (mode === 'verse_of_day') {
    const v = data.verse || {};
    scene.ref = _verseReference(v.reference);
    scene.lines = _exWrap(v.text, 2.5 * CQ, 88 * CQ, 3);
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
    scene.cover = await _exCoverDataUri(np.cover_etag);
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
  return Math.max(p.title?.dur || 0, p.artist?.dur || 0, p.album?.dur || 0, EX_NP_SWEEP_S);
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

// one pass, sampled on the panel's own rate, each frame carrying its own delay
async function exFrames(mode, scene, width, onStep) {
  const fps = exFps(mode);
  const cycle = exCycle(mode, scene) || 1 / fps;
  const count = Math.max(1, Math.round(cycle * fps));
  const frames = [], delays = [];
  for (let i = 0; i < count; i++) {
    const cv = await exToCanvas(mode, scene, cycle * i / count, width, true);
    const ctx = cv.getContext('2d');
    frames.push(ctx.getImageData(0, 0, cv.width, cv.height).data);
    delays.push(100 * cycle / count);
    if (onStep) onStep(i + 1, count);
  }
  return {frames, delays, fps, cycle, count};
}

// the stream takes a frame only when it is pushed one, so the film runs off the frame
// clock and not off however fast the drawing happened to be. video always runs at
// thirty: the two a second the clock wants is fine for gif, where a frame carries its
// own delay, but players choke on it.
const EX_VIDEO_FPS = 30;

async function exRecord(mode, scene, width, onStep) {
  const type = exVideoType();
  if (!type) throw new Error('no video encoder in this browser');
  const fps = EX_VIDEO_FPS;
  const cycle = exCycle(mode, scene) || 1;
  // exactly one loop: a blink of two seconds gives four seconds of film, no more
  const perPass = Math.max(2, Math.round(cycle * fps));
  const count = perPass;

  const first = await exToCanvas(mode, scene, 0, width);
  const cv = document.createElement('canvas');
  cv.width = first.width;
  cv.height = first.height;
  const ctx = cv.getContext('2d');
  const stream = cv.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, {mimeType: type, videoBitsPerSecond: 12e6});
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(res => { rec.onstop = res; });
  rec.start();

  // frames are drawn once per pass and replayed, redrawing every loop is wasted work
  const shots = [];
  for (let i = 0; i < perPass; i++)
    shots.push(await exToCanvas(mode, scene, cycle * i / perPass, width, true));

  // the recorder stamps frames as they arrive, so this cannot run faster than the clip
  // the recorder stamps a frame when it arrives, so every late timer shows up as a
  // speed change. each frame is aimed at its own deadline instead of sleeping a step.
  const step = 1000 / fps;
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    const due = t0 + i * step;
    let wait = due - performance.now();
    while (wait > 0) {
      await new Promise(r => setTimeout(r, wait));
      wait = due - performance.now();
    }
    ctx.drawImage(shots[i], 0, 0);
    track.requestFrame();
    if (onStep) onStep((count - i) / fps);
  }
  // the encoder needs the last frame to sit still for a moment before the file closes
  await new Promise(r => setTimeout(r, 4 * step));
  rec.stop();
  await done;
  return {blob: new Blob(chunks, {type}), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm'};
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

async function exToCanvas(mode, scene, t, width, animate) {
  let ops = rBuildOps(mode, _exFrameScene(mode, scene, t, animate), t, animate, false);
  let box = {w: R_W, h: R_H};
  if (_exWantsBg()) {
    const f = rFramed(ops, scene.pal);
    ops = f.ops;
    box = {w: f.w, h: f.h};
  }
  const images = await _exLoadImages(ops, {});
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = Math.round(width * box.h / box.w);
  const ctx = cv.getContext('2d');
  ctx.scale(width / box.w, width / box.w);
  rOpsToCanvas(ctx, ops, images);
  return cv;
}

async function runExport() {
  const btn = document.getElementById('ex-go');
  btn.disabled = true;
  try {
    const fmt = document.getElementById('ex-format').value;
    const width = +document.getElementById('ex-width').value;
    const scene = _exScene || await exScene(_exMode, await fetch('/home').then(r => r.json()));
    if (fmt === 'svg') {
      const anim = _exAnimOn();
      // a vector file costs nothing per second, so it runs the track in real time
      scene.sweep = anim ? Math.max(exCycle(_exMode, scene), scene.duration || 0) : 0;
      if (!anim) _exPlaceHead(scene);
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
      const first = await exToCanvas(_exMode, scene, 0, width);
      scene.sweep = _exAnimOn() ? exCycle(_exMode, scene) : 0;
      if (!scene.sweep) _exPlaceHead(scene);
      const {frames, delays} = _exAnimOn()
        ? await exFrames(_exMode, scene, width, (i, n) => { btn.textContent = `Frame ${i} of ${n}`; })
        : {frames: [first.getContext('2d').getImageData(0, 0, first.width, first.height).data],
           delays: [100]};
      btn.textContent = 'Packing';
      const blob = gifEncode(frames, first.width, first.height, delays);
      _exDownload(blob, _exName(_exMode, 'gif'));
    } else if (fmt === 'video') {
      btn.textContent = 'Drawing';
      scene.sweep = exCycle(_exMode, scene);
      const {blob, ext} = await exRecord(_exMode, scene, width,
        left => { btn.textContent = `Recording ${Math.ceil(left)}s`; });
      _exDownload(blob, _exName(_exMode, ext));
    } else {
      _exPlaceHead(scene);
      const cv = await exToCanvas(_exMode, scene, 0, width);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      _exDownload(blob, _exName(_exMode, 'png'));
    }
    closeExport();
  } catch (e) {
    console.error('export failed:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export';
  }
}
