// The back of the twin tile: the frames the panel really sent, not a redrawing of them.
// Nothing is fetched until something asks, so a tile that is not flipped costs nothing.

const LIVE_POLL_MS = 400;

let _liveTimer  = null;
let _liveFaces  = [];
let _liveSeen   = -1;
let _liveKey    = '';
let _liveBlink  = null;
let _livePaused = false;
let _liveOff    = '';

function liveRunning() { return _liveTimer !== null; }
function livePaused()  { return _livePaused; }

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

function livePause(on) {
  _livePaused = on;
  if (on) {
    _liveFaces.forEach(face => {
      const shot = face.querySelector('.live-shot');
      const held = face.querySelector('.live-frozen');
      if (!shot || !held) return;
      // there is no way to stop a gif in an img, so the frame on screen is copied out
      held.width  = shot.naturalWidth  || 128;
      held.height = shot.naturalHeight || 32;
      held.getContext('2d').drawImage(shot, 0, 0);
    });
    _liveStopBlink();
  }
  _livePaintFaces();
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
  if (every > 0) _liveBlink = setInterval(paint, every * 1000);
}

function _liveTick() {
  if (_livePaused) return;
  if (_liveFaces.some(face => face.offsetParent === null)) return;   // not on screen, not worth a byte
  fetch('/live/state', { cache: 'no-store' }).then(r => r.json()).then(state => {
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
