export type Tone = 'color'|'gray'|'bw';
export type ColorMode = 'off'|'soft'|'standard'|'strong'|'max';
/** 'max' is full strength plus a purer background (see autoColor's `pure`). */
export const COLOR_STRENGTH: Record<ColorMode, number> = { off: 0, soft: 0.5, standard: 0.8, strong: 1, max: 1 };

/** Histograms (sampled) of the three channels and of luma. */
function stats(d: Uint8ClampedArray) {
  const n = d.length / 4;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const luma = new Uint32Array(256);
  const step = Math.max(1, Math.floor(n / 200000));
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const r = d[4*i], g = d[4*i+1], b = d[4*i+2];
    hist[0][r]++; hist[1][g]++; hist[2][b]++;
    luma[Math.round(.2126*r + .7152*g + .0722*b)]++; count++;
  }
  const percentile = (h: Uint32Array, p: number): number => {
    const cut = count * p; let acc = 0;
    for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= cut) return v; }
    return 255;
  };
  return { hist, luma, percentile };
}

/** Flat-field correction for a light slide: estimates the slide background in a coarse grid (a high percentile
 *  per cell and channel; a cell darker than its neighbourhood borrows the neighbourhood median,
 *  then smoothed) and divides it out. Uneven lighting and colour tints that vary across the photo (a blue top,
 *  a warm bottom) end up as an even white. Works in place; `strength` blends with the original. */
export function flattenBackground(img: ImageData, strength: number, fine = false): void {
  const { width: w, height: h, data: d } = img;
  if (w < 8 || h < 8) return;
  const cell = fine ? 36 : 60; // finer grid follows lighting gradients more closely
  const gx = Math.max(4, Math.min(fine ? 32 : 20, Math.round(w / cell))), gy = Math.max(3, Math.min(fine ? 22 : 14, Math.round(h / cell)));
  const nb = gx * gy;
  const hist = new Uint32Array(nb * 3 * 256), counts = new Uint32Array(nb);
  const sx = Math.max(1, Math.floor(Math.sqrt(w * h / 250000)));
  for (let y = 0; y < h; y += sx) {
    const by = Math.min(gy - 1, Math.floor(y * gy / h));
    for (let x = 0; x < w; x += sx) {
      const b = by * gx + Math.min(gx - 1, Math.floor(x * gx / w));
      const i = 4 * (y * w + x);
      counts[b]++;
      hist[(b * 3) * 256 + d[i]]++; hist[(b * 3 + 1) * 256 + d[i+1]]++; hist[(b * 3 + 2) * 256 + d[i+2]]++;
    }
  }
  // per cell/channel background level = 85th percentile
  let bg: number[] = new Array(nb * 3).fill(255);
  for (let b = 0; b < nb; b++) for (let c = 0; c < 3; c++) {
    if (!counts[b]) { bg[b*3+c] = 255; continue; }
    const cut = counts[b] * (fine ? 0.78 : 0.85); let acc = 0, v = 0;
    for (; v < 255; v++) { acc += hist[(b * 3 + c) * 256 + v]; if (acc >= cut) break; }
    bg[b*3+c] = v;
  }
  const filter = (src: number[], pick: (vals: number[]) => number): number[] => {
    const out: number[] = new Array(src.length).fill(0);
    for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) for (let c = 0; c < 3; c++) {
      const vals: number[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(gy - 1, Math.max(0, y + dy)), xx = Math.min(gx - 1, Math.max(0, x + dx));
        vals.push(src[(yy * gx + xx) * 3 + c]);
      }
      out[(y * gx + x) * 3 + c] = pick(vals);
    }
    return out;
  };
  // Cells that are not slide background at all (a large dark or strongly coloured picture) must not be "corrected":
  // dividing a photo by its own brightness blows it out. Detect them and fill their background estimate from the
  // surrounding background cells instead.
  const lum = (b: number): number => .2126 * bg[b*3] + .7152 * bg[b*3+1] + .0722 * bg[b*3+2];
  const sat = (b: number): number => { const mx = Math.max(bg[b*3], bg[b*3+1], bg[b*3+2]); return mx > 0 ? (mx - Math.min(bg[b*3], bg[b*3+1], bg[b*3+2])) / mx : 0; };
  const lums: number[] = [];
  for (let b = 0; b < nb; b++) lums.push(lum(b));
  const ref95 = [...lums].sort((a, b) => a - b)[Math.floor(nb * 0.95)] || 255;
  const valid: boolean[] = [];
  for (let b = 0; b < nb; b++) // slide background is neutral or only faintly tinted; anything clearly coloured and not near-white is a picture
    valid.push(!(lums[b] < 0.45 * ref95 || (sat(b) > 0.25 && lums[b] < 0.85 * ref95)));
  if (valid.filter(Boolean).length < Math.max(3, nb * 0.2)) return; // no clear background to learn from
  for (let pass = 0; pass < gx + gy && valid.some(v => !v); pass++) {
    const fill: [number, number[]][] = [];
    for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
      const b = y * gx + x;
      if (valid[b]) continue;
      const acc = [0, 0, 0]; let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= gy || xx < 0 || xx >= gx || !valid[yy * gx + xx]) continue;
        const nb2 = yy * gx + xx;
        acc[0] += bg[nb2*3]; acc[1] += bg[nb2*3+1]; acc[2] += bg[nb2*3+2]; cnt++;
      }
      if (cnt) fill.push([b, acc.map(v => v / cnt)]);
    }
    if (!fill.length) break;
    for (const [b, v] of fill) { bg[b*3] = v[0]; bg[b*3+1] = v[1]; bg[b*3+2] = v[2]; valid[b] = true; }
  }
  // a cell darker than its neighbourhood is mostly picture/text, not background: lift it to the neighbourhood median
  bg = filter(bg, v => Math.max(v[4], [...v].sort((a, b) => a - b)[4]));
  bg = filter(bg, v => v.reduce((a, b) => a + b, 0) / v.length);
  // bilinear sampling of the grid at every pixel (cell centres)
  const gxs = new Float32Array(w), gx0 = new Int32Array(w), gx1 = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const f = Math.min(gx - 1, Math.max(0, (x + 0.5) * gx / w - 0.5));
    gx0[x] = Math.floor(f); gx1[x] = Math.min(gx - 1, gx0[x] + 1); gxs[x] = f - gx0[x];
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gy - 1, Math.max(0, (y + 0.5) * gy / h - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(gy - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      for (let c = 0; c < 3; c++) {
        const a = bg[(y0 * gx + gx0[x]) * 3 + c] * (1 - gxs[x]) + bg[(y0 * gx + gx1[x]) * 3 + c] * gxs[x];
        const b = bg[(y1 * gx + gx0[x]) * 3 + c] * (1 - gxs[x]) + bg[(y1 * gx + gx1[x]) * 3 + c] * gxs[x];
        const level = Math.max(1, a * (1 - ty) + b * ty);
        const gain = Math.min(fine ? 4 : 3, Math.max(1, 255 / level));
        const v = d[i + c];
        d[i + c] = v + (Math.min(255, v * gain) - v) * strength;
      }
    }
  }
}

/** Auto colour correction, applied in place. `strength` (0..1) blends with the original pixels.
 *  0. Light slides only: flatten the background (see flattenBackground), so lighting and tint that vary across the photo are evened out first.
 *  1. Black/white points are measured per channel from the photo's own histogram, which removes a
 *     colour cast (white balance) at the same time. On a light slide the white point is the 92nd
 *     percentile (the slide background, so it ends up pure white and glare above it is clipped);
 *     on a dark slide it is the 99.5th percentile so highlights are not blown out.
 *  2. A smoothstep S-curve then pushes darks darker and lights lighter (the "curve" step). */
export function autoColor(img: ImageData, strength: number, pure = false): void {
  if (strength <= 0) return;
  let st = stats(img.data);
  // 70th percentile, not the median: a slide with large dark pictures can have a dark median but a white background
  const lightSlide = st.percentile(st.luma, 0.7) > 150;
  if (lightSlide) {
    flattenBackground(img, strength, pure);
    st = stats(img.data);
  }
  const d = img.data, n = d.length / 4;
  const hiP = lightSlide ? (pure ? 0.9 : 0.92) : 0.995;
  const CONTRAST = pure && lightSlide ? 0.9 : 0.75; // 0 = linear levels only, 1 = full smoothstep
  const luts: Uint8ClampedArray[] = [];
  for (let c = 0; c < 3; c++) {
    const lo = st.percentile(st.hist[c], 0.005), hi = st.percentile(st.hist[c], hiP);
    const range = Math.max(hi - lo, 90); // never amplify a flat image by more than ~2.8x
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const t = Math.min(1, Math.max(0, (v - lo) / range));
      const curved = t + CONTRAST * (t * t * (3 - 2 * t) - t);
      lut[v] = v * (1 - strength) + curved * 255 * strength;
    }
    luts.push(lut);
  }
  for (let i = 0; i < n; i++) {
    d[4*i] = luts[0][d[4*i]]; d[4*i+1] = luts[1][d[4*i+1]]; d[4*i+2] = luts[2][d[4*i+2]];
  }
  if (pure && lightSlide) snapBackground(img);
}

/** Pushes near-white pixels to pure white: how white a pixel is = its darkest channel, so text, lines and pictures
 *  (dark in at least one channel) are untouched while the faint grey/tinted background becomes clean white. */
function snapBackground(img: ImageData): void {
  const d = img.data, n = d.length / 4;
  for (let i = 0; i < n; i++) {
    const m = Math.min(d[4*i], d[4*i+1], d[4*i+2]);
    if (m <= 205) continue;
    const t = Math.min(1, (m - 205) / 30), s = t * t * (3 - 2 * t);
    d[4*i] += (255 - d[4*i]) * s; d[4*i+1] += (255 - d[4*i+1]) * s; d[4*i+2] += (255 - d[4*i+2]) * s;
  }
}

/** Monochrome output: 'gray' keeps the tones, 'bw' is pure black/white split at the Otsu threshold. In place. */
export function applyTone(img: ImageData, tone: Tone): void {
  if (tone === 'color') return;
  const d = img.data, n = d.length / 4;
  const y = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    y[i] = .2126 * d[4*i] + .7152 * d[4*i+1] + .0722 * d[4*i+2];
    hist[y[i]]++;
  }
  let threshold = 128;
  if (tone === 'bw') {
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * hist[v];
    let wB = 0, sumB = 0, best = -1;
    for (let v = 0; v < 256; v++) {
      wB += hist[v]; if (!wB) continue;
      const wF = n - wB; if (!wF) break;
      sumB += v * hist[v];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = v; }
    }
  }
  for (let i = 0; i < n; i++) {
    const v = tone === 'bw' ? (y[i] > threshold ? 255 : 0) : y[i];
    d[4*i] = d[4*i+1] = d[4*i+2] = v;
  }
}
