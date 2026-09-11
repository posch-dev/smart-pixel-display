const GIF_SAMPLE_PIXELS = 40000;

// one table for the whole file: a palette per frame costs more than it buys, the panel
// keeps its colours from the first frame to the last
function gifPalette(frames) {
  const pixels = frames.reduce((n, f) => n + f.length / 4, 0);
  const step = Math.max(1, Math.floor(pixels / GIF_SAMPLE_PIXELS)) * 4;
  const out = [];
  for (const f of frames)
    for (let i = 0; i < f.length; i += step) out.push(f[i], f[i + 1], f[i + 2], 255);
  return gifenc.quantize(new Uint8Array(out), 256, {format: 'rgb565'});
}

function gifStart() {
  return {enc: gifenc.GIFEncoder(), n: 0};
}

// the table rides on the first frame, every later frame reads the global one
function gifWrite(gif, rgba, width, height, palette, delayMs) {
  const index = gifenc.applyPalette(rgba, palette, 'rgb565');
  gif.enc.writeFrame(index, width, height,
                     {palette: gif.n++ ? undefined : palette, delay: delayMs, repeat: 0});
}

function gifFinish(gif) {
  gif.enc.finish();
  return new Blob([gif.enc.bytes()], {type: 'image/gif'});
}
