// Draws the same panel the preview shows, but into an op list instead of the DOM.
// Two backends read that list, one writes SVG, one paints a canvas, so PNG, GIF and
// video all come out of the same layout as the vector export.
//
// User space is 1000 by 250, which is the 4:1 tile at ten units per cqw. Nothing in
// here reads the clock: a frame is drawn for the time it is handed.

const R_W = 1000, R_H = 250, CQ = 10, R_PAD = 3.5 * CQ;
const R_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const R_SEG  = "'SevenSegment', ui-monospace, monospace";

const _rMeasure = document.createElement('canvas').getContext('2d');

function _rFont(size, weight, family) {
  return `${weight || 400} ${size}px ${family || R_SANS}`;
}

function rTextWidth(text, size, weight, family) {
  _rMeasure.font = _rFont(size, weight, family);
  return _rMeasure.measureText(text).width;
}

// alphabetic baseline everywhere, so svg and canvas agree without baseline keywords.
// css centres the glyph box inside the line box, half the leading above and below,
// so the ink ascent is the wrong number to place a line by.
function rFontBox(size, weight, family) {
  _rMeasure.font = _rFont(size, weight, family);
  const m = _rMeasure.measureText('Hg');
  const asc = m.fontBoundingBoxAscent || size * 0.8;
  const desc = m.fontBoundingBoxDescent || size * 0.2;
  return {asc, desc, h: asc + desc};
}

function rAscent(size, weight, family) {
  return rFontBox(size, weight, family).asc;
}

// where the baseline of a line box of height lineH starting at top ends up
function rBase(top, lineH, size, weight, family) {
  const box = rFontBox(size, weight, family);
  return top + (lineH - box.h) / 2 + box.asc;
}

// _tint writes the panel colours onto the panel element, not onto the tile, so the
// palette has to be read from there or every export comes out in the ui accent
const R_PANEL_EL = {clock: 'bp-clock-wrap', verse_of_day: 'bp-verse',
                    nowplaying: 'bp-np', dashboard: 'bp-dash'};

let _rStyleEl = null;

function _rVar(name, fallback) {
  const el = _rStyleEl || document.getElementById('home-blueprint') || document.documentElement;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function rPalette(mode) {
  _rStyleEl = document.getElementById(R_PANEL_EL[mode] || '')
           || document.getElementById('home-blueprint');
  return {
    card:   _rVar('--card', '#161616'),
    border: _rVar('--border', '#2a2a2a'),
    text:   _rVar('--text', '#e8e8e8'),
    muted:  _rVar('--muted', '#606060'),
    mutedHi: _rVar('--muted-hi', '#9c9c9c'),
    input:  _rVar('--input', '#121212'),
    raster: _rVar('--raster', '#2c2c2c'),
    bg:     _rVar('--bg', '#0d0d0d'),
    accent: _rVar('--accent', '#87a878'),
    np1: _rVar('--np1', '') || _rVar('--accent', '#87a878'),
    glow: _rVar('--np-glow', '') || _rVar('--np1', '') || _rVar('--accent', '#87a878'),
    track: _rVar('--np-track', '') || _rVar('--border', '#2a2a2a'),
    title: _rVar('--np-title', '') || _rVar('--np1', '') || _rVar('--accent', '#87a878'),
    album: _rVar('--np-album', '') || _rVar('--muted', '#606060'),
    artist: _rVar('--np-artist', '') || _rVar('--muted-hi', '#9c9c9c'),
    total: _rVar('--np-total', '') || _rVar('--muted', '#606060'),
    trans: _rVar('--vs-trans', '') || _rVar('--muted', '#606060'),
    date: _rVar('--cl-date', '') || _rVar('--muted', '#606060'),
    np2: _rVar('--np2', '') || _rVar('--accent-hd', '') || _rVar('--accent', '#87a878'),
    np3: _rVar('--np3', '') || _rVar('--np1', '') || _rVar('--accent', '#87a878'),
    cl:  _rVar('--cl', '') || _rVar('--accent', '#87a878'),
    vs:  _rVar('--vs', '') || _rVar('--accent', '#87a878'),
    ds:  _rVar('--ds', '') || _rVar('--accent', '#87a878'),
  };
}

function _rRgb(color) {
  const m = String(color).match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(',').map(v => parseFloat(v));
  if (String(color)[0] === '#') return hexToRgb(color);
  return [0, 0, 0];
}

function rAlpha(color, a) {
  const [r, g, b] = _rRgb(color);
  return `rgba(${r},${g},${b},${a})`;
}

// what color-mix does in the stylesheet, for the two backends that cannot read it
function rMix(a, b, p) {
  const x = _rRgb(a), y = _rRgb(b);
  return `rgb(${[0, 1, 2].map(i => Math.round(x[i] * p + y[i] * (1 - p))).join(',')})`;
}

// ---- ops ------------------------------------------------------------------

const rect   = (x, y, w, h, fill, r = 0) => ({op: 'rect', x, y, w, h, fill, r});
const circle = (cx, cy, r, fill) => ({op: 'circle', cx, cy, r, fill});

function text(x, y, str, size, fill, opt = {}) {
  return {op: 'text', x, y, text: str, size, fill,
          weight: opt.weight || 400, family: opt.family || R_SANS,
          anchor: opt.anchor || 'start', spacing: opt.spacing || 0,
          width: opt.width ?? rTextWidth(str, size, opt.weight, opt.family)};
}

const group = (x, y, children) => ({op: 'group', x, y, children});

// marks an op that looks the same at every t
const still = o => (o.st = true, o);

// the leading run of unchanging ops. a run rather than a pick, because an op lifted
// out from under a moving one would come back on top of it
function rStaticRun(ops) {
  let n = 0;
  while (n < ops.length && ops[n].st) n++;
  return n;
}
const glow = (x, y, w, h, r, fill, blur) => ({op: 'glow', x, y, w, h, r, fill, blur});
const gradient = (x, y, w, h, r, from, to) => ({op: 'gradient', x, y, w, h, r, from, to});
const ring = (x, y, w, h, r, stroke, width) => ({op: 'ring', x, y, w, h, r, stroke, width});

// the tile on the page ground, the way the preview page shows it
const R_FRAME_PAD = 0.05;

function rFramed(ops, pal, splitAt) {
  const w = R_W / (1 - 2 * R_FRAME_PAD);
  const pad = w * R_FRAME_PAD;
  const h = R_H + 2 * pad;
  const n = splitAt == null ? ops.length : splitAt;
  const out = [still(rect(0, 0, w, h, pal.bg))];
  if (n) out.push(still(group(pad, pad, ops.slice(0, n))));
  if (n < ops.length) out.push(group(pad, pad, ops.slice(n)));
  return {w, h, ops: out};
}

// a group that clips its children and slides them, the scrolling line
const clip = (x, y, w, h, dx, children, anim) =>
  ({op: 'clip', x, y, w, h, dx, children, anim});

function icon(href, x, y, w, h, fill) {
  const sym = document.querySelector(href);
  if (!sym) return null;
  const box = (sym.getAttribute('viewBox') || '0 0 24 24').split(/\s+/).map(Number);
  const paths = [...sym.querySelectorAll('path')].map(p => p.getAttribute('d'));
  return {op: 'icon', x, y, w, h, fill, box, paths};
}

// ---- the scroll, same curve the preview runs -------------------------------

function rScrollPlan(textW, boxW) {
  const over = textW - boxW;
  if (over <= 1) return {over: 0, dur: 0};
  return {over, dur: 7 + over / 12};
}

function _ease(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); }

// the artist takes what its name needs and no more than three fifths of the row, the
// album gets the rest and only travels when that is not enough
const NP_ARTIST_MAX = 0.6;
const NP_GAP_SPACES = 5;

function rNpRowGap(size) { return rTextWidth(' '.repeat(NP_GAP_SPACES), size); }

function rNpRowSplit(mw, artNat, size, full) {
  const gap = rNpRowGap(size);
  const artW = Math.min(artNat, full ? mw : mw * NP_ARTIST_MAX);
  return {gap, artW, albW: full ? 0 : Math.max(0, mw - artW - gap)};
}

// keyframes 0 and 14 percent at rest, 50 and 64 percent at the far end
function rScrollAt(plan, t) {
  if (!plan.over) return 0;
  const u = (t % plan.dur) / plan.dur;
  if (u < 0.14) return 0;
  if (u < 0.50) return -plan.over * _ease((u - 0.14) / 0.36);
  if (u < 0.64) return -plan.over;
  return -plan.over * (1 - _ease((u - 0.64) / 0.36));
}

// ---- panels ---------------------------------------------------------------

// the raster is 4 css pixels wherever it is drawn, so its density depends on how wide
// the tile happens to be. the export pins it to the dashboard preview, 688 css pixels
// at the pane width, and the file is that tile blown up whatever it was measured on.
// laid on plainly, not blended: overlay against a light card washes the dots out
const R_RASTER_REF = 688;

function rRasterCell() {
  return 4 * R_W / R_RASTER_REF;
}

// 12px on a 688px tile, carried into the 1000 unit space
const R_RADIUS = R_W * 12 / R_RASTER_REF;

function _rBackground(pal) {
  const ops = [still(rect(0, 0, R_W, R_H, pal.card, R_RADIUS))];
  if (document.documentElement.dataset.raster !== 'off')
    ops.push(still({op: 'raster', cell: rRasterCell(), fill: pal.raster,
                    opacity: 0.5, r: R_RADIUS}));
  return ops;
}

function _rClock(scene, t, pal, animate, decl) {
  const ops = [];
  const noDate = document.documentElement.dataset.date === 'off';
  const size = (noDate ? 20 : 15.5) * CQ, dateSize = 3.2 * CQ;
  const dateLine = dateSize * 1.25;
  const blockH = noDate ? size : size + CQ + dateLine;
  const top = (R_H - blockH) / 2 - size * 0.0723;

  const blink = animate && decl && scene.blink;
  const on = blink || scene.colonOn;
  // letter-spacing is .05em resolved on the clock, so it inherits as one length and
  // follows every character, the colon included. the colon itself is 1.5em and rides
  // up .088 of its own size. laying the glyphs out one by one is the only way both
  // backends land where the browser puts them.
  const sp = size * 0.05;
  const colonSize = size * 1.5;
  const colonLift = colonSize * 0.088;
  const glyphs = [
    {ch: scene.hh[0], size}, {ch: scene.hh[1], size},
    {ch: ':', size: colonSize, colon: true},
    {ch: scene.mm[0], size}, {ch: scene.mm[1], size},
  ];
  for (const g of glyphs) g.adv = rTextWidth(g.ch, g.size, 400, R_SEG) + sp;
  const total = glyphs.reduce((a, g) => a + g.adv, 0);
  let x = (R_W - total) / 2;
  const base = rBase(top, size, size, 400, R_SEG);
  for (const g of glyphs) {
    if (!g.colon || on) {
      const t = text(x, g.colon ? base - colonLift : base, g.ch, g.size, pal.cl, {family: R_SEG});
      if (g.colon && blink) t.anim = {type: 'blink', dur: scene.blink};
      ops.push(t);
    }
    x += g.adv;
  }

  if (noDate) return ops;
  const dBase = rBase(top + size + CQ, dateLine, dateSize);
  ops.push(text(R_W / 2, dBase, scene.date, dateSize, pal.date, {anchor: 'middle'}));
  return ops;
}

// without the translation under it the block grows rather than drifting down
const VS_NO_TRANS_SCALE = 1.15;

function _rVerse(scene, t, pal) {
  const ops = [];
  const noTrans = document.documentElement.dataset.trans === 'off';
  const k = noTrans ? VS_NO_TRANS_SCALE : 1;
  const refSize = 4 * CQ * k, bodySize = 2.5 * CQ * k, transSize = 2.4 * CQ;
  const lines = scene.lines;
  const refLine = rFontBox(refSize, 600).h;
  const bodyLine = bodySize * 1.25, transLine = noTrans ? 0 : transSize * 1.25;
  const blockH = refLine + 6 + lines.length * bodyLine + (noTrans ? 0 : 6 + transLine);
  let top = (R_H - blockH) / 2;
  ops.push(text(R_W / 2, rBase(top, refLine, refSize, 600), scene.ref, refSize, pal.vs,
                {anchor: 'middle', weight: 600}));
  top += refLine + 6;
  for (const line of lines) {
    ops.push(text(R_W / 2, rBase(top, bodyLine, bodySize), line, bodySize, pal.text, {anchor: 'middle'}));
    top += bodyLine;
  }
  if (noTrans) return ops;
  top += 6;
  ops.push(text(R_W / 2, rBase(top, transLine, transSize), scene.translation, transSize, pal.trans,
                {anchor: 'middle'}));
  return ops;
}

// a counter cannot tween, so it is written out and switched
const R_SWEEP_STEPS = 240;

function _rScrollAnim(plan, animate) {
  return animate && plan.over ? {type: 'scroll', over: plan.over, dur: plan.dur} : null;
}

function _rNowPlaying(scene, t, pal, animate, decl) {
  const ops = [];
  const cov = 18 * CQ, gap = 3.5 * CQ;
  const covY = (R_H - cov) / 2;
  const covR = 1.6 * CQ;
  if (scene.cover) {
    // the artwork throws the panel colour outwards, the placeholder carries it instead
    if (document.documentElement.dataset.glow !== 'off')
      ops.push(still(glow(R_PAD, covY, cov, cov, covR, rAlpha(pal.glow, 0.415), 4.15 * CQ)));
    ops.push(still({op: 'image', x: R_PAD, y: covY, w: cov, h: cov, r: covR, href: scene.cover}));
  } else {
    ops.push(still(gradient(R_PAD, covY, cov, cov, covR,
                            rMix(pal.np1, pal.input, 0.22), rMix(pal.np3, pal.input, 0.06))));
    ops.push(still(ring(R_PAD, covY, cov, cov, covR, rAlpha(pal.np1, 0.4), 0.2 * CQ)));
    const note = icon('#ico-music', R_PAD + (cov - 7 * CQ) / 2, covY + (cov - 7 * CQ) / 2,
                      7 * CQ, 7 * CQ, pal.np1);
    if (note) ops.push(still(note));
  }

  const mx = R_PAD + cov + gap;
  const mw = R_W - R_PAD - mx;
  const trackSize = 4.2 * CQ, artSize = 2.8 * CQ, albSize = 2.4 * CQ, timeSize = 2.2 * CQ;
  const barTop = 2.6 * CQ, barH = 0.9 * CQ, head = 1.7 * CQ, timesTop = 0.9 * CQ;

  const trackLine = trackSize * 1.25, rowH = artSize * 1.25, timeLine = timeSize * 1.25;
  const blockH = trackLine + rowH + barTop + barH + timesTop + timeLine;
  let y = (R_H - blockH) / 2;

  // the live preview already measured the overflow with the real layout engine, so
  // its numbers win over anything a canvas ruler works out here
  const plans = scene.plans || {};
  const decling = animate && decl;
  const tPlan = plans.title || rScrollPlan(rTextWidth(scene.title, trackSize, 700), mw);
  ops.push(clip(mx, y, mw, trackLine, rScrollAt(tPlan, t),
    [text(0, rBase(0, trackLine, trackSize, 700), scene.title, trackSize, pal.title,
          {weight: 700, width: tPlan.textW})],
    _rScrollAnim(tPlan, decling)));
  y += trackLine;

  const noAlbum = document.documentElement.dataset.album === 'off';
  const artNat = plans.artist?.textW ?? rTextWidth(scene.artist, artSize);
  const split = rNpRowSplit(mw, artNat, artSize, noAlbum);
  const artW = noAlbum ? split.artW : (plans.artist?.boxW ?? split.artW);
  const albW = noAlbum ? 0 : (plans.album?.boxW ?? Math.max(0, mw - artW - split.gap));
  const aPlan = plans.artist || rScrollPlan(rTextWidth(scene.artist, artSize), artW);
  const lPlan = plans.album || rScrollPlan(rTextWidth(scene.album, albSize), albW);
  // both sit on the artist baseline, the row aligns on it
  const rowBase = rBase(0, rowH, artSize);
  ops.push(clip(mx, y, artW, rowH, rScrollAt(aPlan, t),
    [text(0, rowBase, scene.artist, artSize, pal.artist, {width: aPlan.textW})],
    _rScrollAnim(aPlan, decling)));
  if (!noAlbum)
    ops.push(clip(mx + mw - albW, y, albW, rowH, rScrollAt(lPlan, t),
      [text(0, rowBase, scene.album, albSize, pal.album, {width: lPlan.textW})],
      _rScrollAnim(lPlan, decling)));
  y += rowH + barTop;

  const sweep = animate && decl && scene.sweep;
  const pct = Math.min(1, scene.elapsed / scene.duration);
  ops.push(rect(mx, y, mw, barH, pal.track, barH / 2));
  const fill = rect(mx, y, Math.max(0, mw * pct), barH, pal.np1, barH / 2);
  if (sweep) fill.anim = {type: 'grow', from: 0, to: mw, dur: sweep};
  ops.push(fill);
  const hx0 = mx + head / 2, hx1 = mx + mw - head / 2;
  const hx = mx + Math.min(Math.max(mw * pct, head / 2), mw - head / 2);
  const dot = circle(hx, y + barH / 2, head / 2, pal.np2);
  if (sweep) dot.anim = {type: 'slide', from: hx0, to: hx1, dur: sweep};
  ops.push(dot);

  const tBase = rBase(y + barH + timesTop, timeLine, timeSize);
  if (sweep) {
    // one label per second of the song, each shown for its own slice of the pass
    const steps = Math.min(R_SWEEP_STEPS, Math.max(1, Math.round(scene.duration)));
    for (let i = 0; i < steps; i++) {
      const label = text(mx, tBase, fmtClock(scene.duration * i / steps), timeSize, pal.np2);
      label.anim = {type: 'window', from: i / steps, to: (i + 1) / steps, dur: sweep};
      ops.push(label);
    }
  } else {
    ops.push(text(mx, tBase, scene.elapsedText, timeSize, pal.np2));
  }
  ops.push(text(mx + mw, tBase, scene.totalText, timeSize, pal.total, {anchor: 'end'}));
  return ops;
}

function _rDashboard(scene, t, pal) {
  const ops = [];
  const ico = 10 * CQ, gap = 4 * CQ;
  const tempSize = 10 * CQ, condSize = 2.8 * CQ, evSize = 3 * CQ;

  const nowW = Math.max(rTextWidth(scene.temp, tempSize, 700), rTextWidth(scene.cond, condSize));
  const evW = Math.min(R_W * 0.44, 300);
  const total = ico + gap + nowW + gap + 1 + gap + evW;
  let x = (R_W - total) / 2;

  const wi = icon(scene.icon, x, (R_H - ico) / 2, ico, ico, pal.ds);
  if (wi) ops.push(wi);
  x += ico + gap;

  const condLine = condSize * 1.25;
  const nowH = tempSize + 6 + condLine;
  let ny = (R_H - nowH) / 2;
  ops.push(text(x, rBase(ny, tempSize, tempSize, 700), scene.temp, tempSize, pal.text, {weight: 700}));
  ops.push(text(x, rBase(ny + tempSize + 6, condLine, condSize), scene.cond, condSize, pal.muted));
  x += nowW + gap;

  ops.push(rect(x, (R_H - ico) / 2, 1, ico, pal.border));
  x += 1 + gap;

  const evLine = evSize * 1.25;
  const evH = evLine + 6 + condLine;
  const ey = (R_H - evH) / 2;
  ops.push(clip(x, ey, evW, evLine, 0,
    [text(0, rBase(0, evLine, evSize, 600), scene.event, evSize, pal.text, {weight: 600})]));
  ops.push(text(x, rBase(ey + evLine + 6, condLine, condSize), scene.eventWhen, condSize, pal.muted));
  return ops;
}

const R_PANELS = {clock: _rClock, verse_of_day: _rVerse,
                  nowplaying: _rNowPlaying, dashboard: _rDashboard};

// decl says the file will carry the movement itself. a canvas cannot, it gets one
// frame drawn for the time it was handed, so it must not be given the whole set.
function rBuildOps(mode, scene, t, animate, decl) {
  const pal = scene.pal;
  const draw = R_PANELS[mode] || _rClock;
  return _rBackground(pal).concat(draw(scene, t, pal, animate, decl).filter(Boolean));
}

// ---- svg backend ----------------------------------------------------------

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;');
}

let _clipSeq = 0;

function _opToSvg(o, defs) {
  if (o.op === 'rect') {
    const body = `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}"`
               + (o.r ? ` rx="${o.r}"` : '') + ` fill="${o.fill}"`;
    if (o.anim && o.anim.type === 'grow')
      return body + `><animate attributeName="width" values="${o.anim.from};${o.anim.to}"`
           + ` dur="${o.anim.dur.toFixed(2)}s" repeatCount="indefinite"/></rect>`;
    return body + '/>';
  }
  if (o.op === 'glow') {
    const id = 'g' + (++_clipSeq);
    defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">`
            + `<feDropShadow dx="0" dy="0" stdDeviation="${o.blur / 2}" flood-color="${o.fill}"/>`
            + `</filter>`);
    return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.r}"`
         + ` fill="${o.fill}" filter="url(#${id})"/>`;
  }
  if (o.op === 'gradient') {
    const id = 'l' + (++_clipSeq);
    defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">`
            + `<stop offset="0" stop-color="${o.from}"/><stop offset="1" stop-color="${o.to}"/>`
            + `</linearGradient>`);
    return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.r}" fill="url(#${id})"/>`;
  }
  if (o.op === 'ring')
    return `<rect x="${o.x + o.width / 2}" y="${o.y + o.width / 2}" width="${o.w - o.width}"`
         + ` height="${o.h - o.width}" rx="${o.r}" fill="none" stroke="${o.stroke}"`
         + ` stroke-width="${o.width}"/>`;
  if (o.op === 'circle') {
    const body = `<circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" fill="${o.fill}"`;
    if (o.anim && o.anim.type === 'slide')
      return body + `><animate attributeName="cx" values="${o.anim.from};${o.anim.to}"`
           + ` dur="${o.anim.dur.toFixed(2)}s" repeatCount="indefinite"/></circle>`;
    return body + '/>';
  }
  if (o.op === 'text') {
    const anchor = o.anchor === 'start' ? '' : ` text-anchor="${o.anchor}"`;
    if (o.anim && o.anim.type === 'window') {
      const plain = Object.assign({}, o, {anim: null});
      return `<g opacity="0">${_opToSvg(plain, defs)}<animate attributeName="opacity"`
           + ` calcMode="discrete" values="0;1;0"`
           + ` keyTimes="0;${o.anim.from.toFixed(5)};${Math.min(1, o.anim.to).toFixed(5)}"`
           + ` dur="${o.anim.dur.toFixed(2)}s" repeatCount="indefinite"/></g>`;
    }
    if (o.anim && o.anim.type === 'blink') {
      const plain = Object.assign({}, o, {anim: null});
      return `<g>${_opToSvg(plain, defs)}<animate attributeName="opacity" calcMode="discrete"`
           + ` values="1;0" keyTimes="0;0.5" dur="${o.anim.dur}s" repeatCount="indefinite"/></g>`;
    }
    // the width is pinned so a substitute font cannot break the layout
    return `<text x="${o.x}" y="${o.y}" font-family="${_esc(o.family)}" font-size="${o.size}"`
         + ` font-weight="${o.weight}" fill="${o.fill}"${anchor}`
         + ` textLength="${o.width.toFixed(2)}" lengthAdjust="spacingAndGlyphs">${_esc(o.text)}</text>`;
  }
  if (o.op === 'image')
    return `<image x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" href="${o.href}"`
         + ` preserveAspectRatio="xMidYMid slice"/>`;
  if (o.op === 'icon') {
    const [bx, by, bw, bh] = o.box;
    const s = Math.min(o.w / bw, o.h / bh);
    const body = o.paths.map(d => `<path d="${d}"/>`).join('');
    return `<g fill="${o.fill}" transform="translate(${o.x} ${o.y}) scale(${s}) translate(${-bx} ${-by})">`
         + `${body}</g>`;
  }
  if (o.op === 'raster') {
    const id = 'r' + (++_clipSeq);
    defs.push(`<pattern id="${id}" width="${o.cell}" height="${o.cell}" patternUnits="userSpaceOnUse">`
            + `<circle cx="${o.cell / 2}" cy="${o.cell / 2}" r="${o.cell / 4}" fill="${o.fill}"/></pattern>`);
    return `<rect x="0" y="0" width="${R_W}" height="${R_H}" rx="${o.r}" fill="url(#${id})"`
         + ` opacity="${o.opacity}"/>`;
  }
  if (o.op === 'group')
    return `<g transform="translate(${o.x} ${o.y})">`
         + o.children.map(c => _opToSvg(c, defs)).join('') + '</g>';
  if (o.op === 'clip') {
    const id = 'c' + (++_clipSeq);
    defs.push(`<clipPath id="${id}"><rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}"/></clipPath>`);
    const inner = o.children.map(c => _opToSvg(c, defs)).join('');
    if (o.anim && o.anim.type === 'scroll') {
      const over = o.anim.over;
      // the same shape the css keyframes have: rest, travel, rest, travel back
      const move = `<animateTransform attributeName="transform" type="translate" additive="sum"`
        + ` values="0 0;0 0;${-over} 0;${-over} 0;0 0" keyTimes="0;0.14;0.5;0.64;1"`
        + ` calcMode="spline" keySplines="0 0 1 1;.42 0 .58 1;0 0 1 1;.42 0 .58 1"`
        + ` dur="${o.anim.dur.toFixed(2)}s" repeatCount="indefinite"/>`;
      return `<g clip-path="url(#${id})"><g transform="translate(${o.x} ${o.y})">`
           + `${inner}${move}</g></g>`;
    }
    return `<g clip-path="url(#${id})"><g transform="translate(${o.x + o.dx} ${o.y})">${inner}</g></g>`;
  }
  return '';
}

function rOpsToSvg(ops, width, css, box) {
  _clipSeq = 0;
  const defs = [];
  const b = box || {w: R_W, h: R_H};
  const body = ops.map(o => _opToSvg(o, defs)).join('');
  const height = Math.round(width * b.h / b.w);
  if (css) defs.unshift(`<style>${css}</style>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`
       + ` viewBox="0 0 ${b.w} ${b.h}">`
       + (defs.length ? `<defs>${defs.join('')}</defs>` : '')
       + body + '</svg>';
}

// ---- canvas backend -------------------------------------------------------

// the shine off the cover never changes, so the gaussian runs once and the result is
// stamped from then on
let _rGlow = null;

function _rGlowStamp(o, k) {
  const key = [o.w, o.h, o.r, o.fill, o.blur, k.toFixed(3)].join('|');
  if (_rGlow && _rGlow.key === key) return _rGlow;
  const pad = 2 * o.blur;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((o.w + 2 * pad) * k);
  cv.height = Math.ceil((o.h + 2 * pad) * k);
  const c = cv.getContext('2d');
  c.scale(k, k);
  c.shadowColor = o.fill;
  c.shadowBlur = o.blur * k;
  c.fillStyle = o.fill;
  _roundRect(c, pad, pad, o.w, o.h, o.r);
  c.fill();
  _rGlow = {key, cv, pad, w: cv.width / k, h: cv.height / k};
  return _rGlow;
}

// the dots are one tile the browser stamps, not seven thousand arcs on every frame
let _rRaster = null;

function _rRasterFill(ctx, o, k) {
  const key = [o.cell.toFixed(3), o.fill, k.toFixed(3)].join('|');
  if (!_rRaster || _rRaster.key !== key) {
    const px = Math.max(2, Math.round(o.cell * k));
    const tile = document.createElement('canvas');
    tile.width = tile.height = px;
    const t = tile.getContext('2d');
    t.fillStyle = o.fill;
    t.beginPath();
    t.arc(px / 2, px / 2, px / 4, 0, Math.PI * 2);
    t.fill();
    const pat = ctx.createPattern(tile, 'repeat');
    pat.setTransform(new DOMMatrix([o.cell / px, 0, 0, o.cell / px, 0, 0]));
    _rRaster = {key, pat};
  }
  return _rRaster.pat;
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (r) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

function rOpsToCanvas(ctx, ops, images) {
  // a canvas shadow is laid on in output pixels and ignores the transform, so the blur
  // is scaled by hand or the glow tightens the wider the file gets
  const k = ctx.getTransform().a;
  for (const o of ops) {
    if (o.op === 'rect') {
      ctx.fillStyle = o.fill;
      _roundRect(ctx, o.x, o.y, o.w, o.h, o.r);
      ctx.fill();
    } else if (o.op === 'glow') {
      const g = _rGlowStamp(o, k);
      ctx.drawImage(g.cv, o.x - g.pad, o.y - g.pad, g.w, g.h);
    } else if (o.op === 'gradient') {
      const g = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
      g.addColorStop(0, o.from);
      g.addColorStop(1, o.to);
      ctx.fillStyle = g;
      _roundRect(ctx, o.x, o.y, o.w, o.h, o.r);
      ctx.fill();
    } else if (o.op === 'ring') {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.width;
      _roundRect(ctx, o.x + o.width / 2, o.y + o.width / 2, o.w - o.width, o.h - o.width, o.r);
      ctx.stroke();
    } else if (o.op === 'circle') {
      ctx.fillStyle = o.fill;
      ctx.beginPath();
      ctx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (o.op === 'text') {
      ctx.fillStyle = o.fill;
      ctx.font = _rFont(o.size, o.weight, o.family);
      ctx.textAlign = o.anchor === 'middle' ? 'center' : o.anchor === 'end' ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(o.text, o.x, o.y);
    } else if (o.op === 'image') {
      const img = images[o.href];
      if (!img) continue;
      ctx.save();
      _roundRect(ctx, o.x, o.y, o.w, o.h, o.r);
      ctx.clip();
      ctx.drawImage(img, o.x, o.y, o.w, o.h);
      ctx.restore();
    } else if (o.op === 'icon') {
      const [bx, by, bw, bh] = o.box;
      const s = Math.min(o.w / bw, o.h / bh);
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.scale(s, s);
      ctx.translate(-bx, -by);
      ctx.fillStyle = o.fill;
      for (const d of o.paths) ctx.fill(new Path2D(d));
      ctx.restore();
    } else if (o.op === 'raster') {
      ctx.save();
      _roundRect(ctx, 0, 0, R_W, R_H, o.r);
      ctx.clip();
      ctx.globalAlpha = o.opacity;
      ctx.fillStyle = _rRasterFill(ctx, o, k);
      ctx.fillRect(0, 0, R_W, R_H);
      ctx.restore();
    } else if (o.op === 'group') {
      ctx.save();
      ctx.translate(o.x, o.y);
      rOpsToCanvas(ctx, o.children, images);
      ctx.restore();
    } else if (o.op === 'clip') {
      ctx.save();
      _roundRect(ctx, o.x, o.y, o.w, o.h, 0);
      ctx.clip();
      ctx.translate(o.x + o.dx, o.y);
      rOpsToCanvas(ctx, o.children, images);
      ctx.restore();
    }
  }
}
