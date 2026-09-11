// The back of the twin tile: the frames the panel really sent, not a redrawing of them.
// Nothing is fetched until something asks, so a tile that is not flipped costs nothing.

const LIVE_POLL_MS = 400;

// one tab is one viewer, and the poll is its heartbeat: the pi holds the chunk gifs of a
// song somebody is paused on, and lets go of them when the tab stops asking
const LIVE_VIEWER = (() => {
  const made = Math.random().toString(36).slice(2);
  try {
    return sessionStorage.getItem('spd_viewer')
        || (sessionStorage.setItem('spd_viewer', made), made);
  } catch (e) {
    return made;
  }
})();

let _liveTimer  = null;
let _liveFaces  = [];
let _liveSeen   = -1;
let _liveKey    = '';
let _liveBlink  = null;
let _livePaused = false;
let _liveOff    = '';
let _livePanel  = '';
let _liveHeldOn = '';
let _liveSong   = '';
let _liveChunk  = 0;
let _liveHeldSong = '';
let _liveHeldChunk = 0;

function liveRunning() { return _liveTimer !== null; }
function livePaused()  { return _livePaused; }
// which panel the held picture is of, which is not what the display moved on to
function liveHeldPanel() { return _liveHeldOn; }
function liveSong()      { return _liveSong; }
// the track and the chunk the held picture is of, which the pi still has because this tab
// pins them for as long as it keeps polling
function liveHeldSong()  { return _liveHeldSong; }
function liveHeldChunk() { return _liveHeldChunk; }

function liveFaceHtml() {
  return '<img class="live-shot" alt="" onerror="liveBroken(this)">'
       + '<canvas class="live-frozen" hidden></canvas>'
       + '<div class="live-off" hidden><b></b><span>No live view of the display</span></div>';
}

// a broken src draws the browser's own missing-file icon, no src draws nothing at all.
// hidden is not touched here, _livePaintFaces owns that flag.
function liveBroken(img) {
  img.removeAttribute('src');
}

// paused and display-off are two reasons to hide the live image, so one place decides
function _livePaintFaces() {
  _liveFaces.forEach(face => {
    const shot = face.querySelector('.live-shot');
    const held = face.querySelector('.live-frozen');
    const note = face.querySelector('.live-off');
    if (note) note.hidden = !_liveOff;
    if (held) held.hidden = _liveOff || !_livePaused;
    if (shot) shot.hidden = _liveOff || _livePaused;
  });
}

// the tile keeps its side and says why nothing is coming: switched off, or nothing to talk to
function liveShowOff(reason) {
  _liveOff = reason || '';
  _liveFaces.forEach(face => {
    const head = face.querySelector('.live-off b');
    if (head) head.textContent = _liveOff === 'nolink' ? 'No display connected' : 'Display is off';
  });
  _livePaintFaces();
}

// the panel turns the image for how the display hangs, so the screen has to turn it back
function liveUpright() {
  const device = (typeof cfg !== 'undefined' && cfg.device) || {};
  const x = device.flip_horizontal ? -1 : 1;
  const y = device.flip_vertical   ? -1 : 1;
  return x === 1 && y === 1 ? '' : `scaleX(${x}) scaleY(${y})`;
}

function liveApplyUpright() {
  const upright = liveUpright();
  _liveFaces.forEach(face => {
    face.querySelectorAll('.live-shot, .live-frozen').forEach(el => { el.style.transform = upright; });
  });
}

function liveStart(face) {
  _liveFaces = [face].filter(Boolean);
  if (_liveTimer) return;
  _liveSeen = -1;
  _liveKey  = '';
  liveApplyUpright();
  _liveTick();
  _liveTimer = setInterval(_liveTick, LIVE_POLL_MS);
}

function liveStop() {
  clearInterval(_liveTimer);
  _liveTimer = null;
  _liveStopBlink();
}

// there is no way to stop a gif in an img, so the frame on screen is copied out. a face
// turned to while the page is already frozen has none yet, so the copy waits for its first
function _liveHold(face) {
  const shot = face.querySelector('.live-shot');
  const held = face.querySelector('.live-frozen');
  if (!shot || !held) return;
  if (!shot.naturalWidth) {
    shot.addEventListener('load', () => { if (_livePaused) _liveHold(face); }, {once: true});
    return;
  }
  held.width  = shot.naturalWidth;
  held.height = shot.naturalHeight;
  held.getContext('2d').drawImage(shot, 0, 0);
}

function livePause(on) {
  _livePaused = on;
  if (on) {
    _liveHeldOn    = _livePanel;
    _liveHeldSong  = _liveSong;
    _liveHeldChunk = _liveChunk;
    _liveFaces.forEach(_liveHold);
    _liveStopBlink();
    _liveHoldLit();
  }
  // the blink died with the pause, and the key would tell the next tick it is still armed
  else { _liveKey = ''; _liveHeldOn = ''; _liveHeldSong = ''; }
  _livePaintFaces();
}

// a held clock shows the lit half, never the gap the blink happened to stop in. only the
// clock carries a key, so that is also what says this is one
function _liveHoldLit() {
  if (!_liveKey) return;
  const lit = new Image();
  lit.onload = () => _liveFaces.forEach(face => {
    const held = face.querySelector('.live-frozen');
    if (held && _livePaused) held.getContext('2d').drawImage(lit, 0, 0, held.width, held.height);
  });
  lit.src = _liveSrc('colon_on') + '&t=' + Date.now();
}

function _liveStopBlink() {
  clearInterval(_liveBlink);
  _liveBlink = null;
}

function _liveSrc(variant) {
  return '/live/frame' + (variant ? '?variant=' + variant : '');
}

// the clock blinks locally at the configured rate, which beats polling fast enough to catch it
function _liveClock(state) {
  if (state.clock_key === _liveKey || !state.has_pair) return;
  _liveSeen = state.version;
  _liveKey = state.clock_key;
  _liveStopBlink();
  const every = (cfg.clock && cfg.clock.blink_interval) || 1;
  const faces = _liveFaces.map(f => f.querySelector('.live-shot')).filter(Boolean);
  const stamp = Date.now();
  let on = true;
  const paint = () => {
    faces.forEach(img => { img.src = _liveSrc(on ? 'colon_on' : 'colon_off') + '&t=' + stamp; });
    on = !on;
  };
  paint();
  // paint() starts on the lit half, which is the one a frozen clock is meant to hold
  if (every > 0 && !_livePaused) _liveBlink = setInterval(paint, every * 1000);
}

function _liveTick() {
  if (_liveFaces.some(face => face.offsetParent === null)) return;   // not on screen, not worth a byte
  // frozen, the poll goes on as the heartbeat alone. a face just turned to has no frame at
  // all yet, so its first one still arrives
  const first = _liveSeen === -1;
  const holding = _livePaused ? `&song=${encodeURIComponent(_liveHeldSong)}` : '';
  fetch(`/live/state?viewer=${LIVE_VIEWER}&paused=${_livePaused ? 1 : 0}${holding}`,
        { cache: 'no-store' })
    .then(r => r.json()).then(state => {
    _livePanel = state.panel;
    _liveSong  = state.song || '';
    _liveChunk = state.chunk_at || 0;
    if (_livePaused && !first) return;
    if (state.panel === 'clock') return _liveClock(state);
    _liveStopBlink();
    _liveKey = '';
    if (!state.version || state.version === _liveSeen) return;   // nothing drawn yet, nothing to ask for
    _liveSeen = state.version;
    _liveFaces.forEach(face => {
      const shot = face.querySelector('.live-shot');
      if (shot) shot.src = _liveSrc('') + '?v=' + state.version;
    });
  }).catch(() => {});
}
