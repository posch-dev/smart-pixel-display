// A GIF89a writer. No library: one median cut palette shared by every frame, then
// LZW per frame. Delays are per frame in hundredths, so a clock can hold a colon for
// a full second while a track scrolls at thirty a second.

function _gifBits() {
  const bytes = [];
  let acc = 0, bits = 0;
  return {
    write(code, size) {
      acc |= code << bits;
      bits += size;
      while (bits >= 8) {
        bytes.push(acc & 0xff);
        acc >>= 8;
        bits -= 8;
      }
    },
    end() {
      if (bits > 0) bytes.push(acc & 0xff);
      return bytes;
    },
  };
}

function _gifLzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  const out = _gifBits();
  let dict = new Map(), next = eoi + 1, size = minCodeSize + 1;
  out.write(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    out.write(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else {
      out.write(clear, size);
      dict = new Map();
      next = eoi + 1;
      size = minCodeSize + 1;
    }
    prefix = k;
  }
  out.write(prefix, size);
  out.write(eoi, size);
  return out.end();
}

// ---- palette --------------------------------------------------------------

function _gifBox(pixels) {
  let rl = 255, rh = 0, gl = 255, gh = 0, bl = 255, bh = 0;
  for (const p of pixels) {
    if (p[0] < rl) rl = p[0]; if (p[0] > rh) rh = p[0];
    if (p[1] < gl) gl = p[1]; if (p[1] > gh) gh = p[1];
    if (p[2] < bl) bl = p[2]; if (p[2] > bh) bh = p[2];
  }
  const span = [rh - rl, gh - gl, bh - bl];
  const axis = span.indexOf(Math.max(...span));
  return {pixels, axis, span: span[axis]};
}

function _gifPalette(samples, want) {
  let boxes = [_gifBox(samples)];
  while (boxes.length < want) {
    boxes.sort((a, b) => b.span - a.span);
    const box = boxes.shift();
    if (!box || box.span === 0 || box.pixels.length < 2) { if (box) boxes.push(box); break; }
    const sorted = box.pixels.slice().sort((a, b) => a[box.axis] - b[box.axis]);
    const mid = sorted.length >> 1;
    boxes.push(_gifBox(sorted.slice(0, mid)), _gifBox(sorted.slice(mid)));
  }
  return boxes.map(box => {
    let r = 0, g = 0, b = 0;
    for (const p of box.pixels) { r += p[0]; g += p[1]; b += p[2]; }
    const n = box.pixels.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function _gifMapper(palette) {
  const cache = new Map();
  return (r, g, b) => {
    const key = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    cache.set(key, best);
    return best;
  };
}

// ---- the file -------------------------------------------------------------

function _gifStr(out, s) { for (const c of s) out.push(c.charCodeAt(0)); }
function _gifShort(out, n) { out.push(n & 0xff, (n >> 8) & 0xff); }

function _gifBlocks(out, bytes) {
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length);
    for (const b of chunk) out.push(b);
  }
  out.push(0);
}

// frames are RGBA buffers of the same size, delays are hundredths of a second
function gifEncode(frames, width, height, delays) {
  const samples = [];
  const step = Math.max(4, Math.floor(width * height / 12000)) * 4;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += step) samples.push([f[i], f[i + 1], f[i + 2]]);
  }
  const palette = _gifPalette(samples, 256);
  const map = _gifMapper(palette);

  const out = [];
  _gifStr(out, 'GIF89a');
  _gifShort(out, width);
  _gifShort(out, height);
  out.push(0xf7, 0, 0);                       // global table, 256 entries, 8 bits
  for (let i = 0; i < 256; i++) {
    const p = palette[i] || [0, 0, 0];
    out.push(p[0], p[1], p[2]);
  }
  out.push(0x21, 0xff, 0x0b);                 // netscape looping block
  _gifStr(out, 'NETSCAPE2.0');
  out.push(3, 1, 0, 0, 0);

  frames.forEach((f, n) => {
    out.push(0x21, 0xf9, 4, 0);               // graphic control, no transparency
    _gifShort(out, Math.max(2, Math.round(delays[n])));
    out.push(0, 0);
    out.push(0x2c);                           // image descriptor
    _gifShort(out, 0); _gifShort(out, 0);
    _gifShort(out, width); _gifShort(out, height);
    out.push(0);
    const idx = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < f.length; i += 4, p++) idx[p] = map(f[i], f[i + 1], f[i + 2]);
    out.push(8);
    _gifBlocks(out, _gifLzw(idx, 8));
  });

  out.push(0x3b);
  return new Blob([new Uint8Array(out)], {type: 'image/gif'});
}
