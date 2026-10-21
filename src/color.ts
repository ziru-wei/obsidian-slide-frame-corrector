export type Tone = 'color'|'gray'|'bw';
export type ColorMode = 'off'|'soft'|'standard'|'strong';
export const COLOR_STRENGTH: Record<ColorMode, number> = { off: 0, soft: 0.5, standard: 0.8, strong: 1 };

/** Auto levels + S-curve, applied in place. `strength` (0..1) blends with the original pixels.
 *  1. Black/white points are measured per channel from the photo's own histogram, which removes a
 *     colour cast (white balance) at the same time. On a light slide the white point is the 92nd
 *     percentile (the slide background, so it ends up pure white and glare above it is clipped);
 *     on a dark slide it is the 99.5th percentile so highlights are not blown out.
 *  2. A smoothstep S-curve then pushes darks darker and lights lighter (the "curve" step). */
export function autoColor(img: ImageData, strength: number): void {
  if (strength <= 0) return;
  const d = img.data, n = d.length / 4;
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
  const lightSlide = percentile(luma, 0.5) > 120;
  const hiP = lightSlide ? 0.92 : 0.995;
  const CONTRAST = 0.75; // 0 = linear levels only, 1 = full smoothstep
  const luts: Uint8ClampedArray[] = [];
  for (let c = 0; c < 3; c++) {
    const lo = percentile(hist[c], 0.005), hi = percentile(hist[c], hiP);
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
