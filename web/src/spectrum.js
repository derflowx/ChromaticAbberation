// Fringe kernel construction.
//
// The lateral-CA fringe at a pixel is a 1D radial kernel: each wavelength λ lands
// at radial offset d(λ) (dispersion) with colour w(λ) (spectrum → RGB). Softness
// widens every wavelength into a box. All of that is baked on the CPU into a
// small LUT over offset x ∈ [xMin, xMax], so the shader only takes evenly spaced
// taps along the radius and weights them. That's deterministic: no noise, no
// per-wavelength maths per pixel.
//
// CIE 1931 2° colour matching functions, analytic multi-lobe fit from
// Wyman, Sloan & Shirley 2013, "Simple Analytic Approximations to the CIE XYZ
// Color Matching Functions" (JCGT 2(2)).

export const LAMBDA_MIN = 400;
export const LAMBDA_MAX = 700;
export const LUT_SIZE = 512;
const LAMBDA_STEPS = 4096;

const LAMBDA_F = 0.4861; // µm, Fraunhofer F (blue)
const LAMBDA_C = 0.6563; // µm, Fraunhofer C (red)

/**
 * Normalised dispersion: d(anchor) = 0, d(F) − d(C) = 1.
 * curve 0 = linear in λ, 1 = glass (Cauchy, n ∝ 1/λ²).
 */
export function dispersion(nm, anchor, curve) {
  const l = nm / 1000;
  const la = anchor / 1000;
  const cauchy = (1 / (l * l) - 1 / (la * la)) / (1 / LAMBDA_F ** 2 - 1 / LAMBDA_C ** 2);
  const linear = (la - l) / (LAMBDA_C - LAMBDA_F);
  return linear + (cauchy - linear) * curve;
}

function lobe(x, mu, s1, s2) {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

export function cieXYZ(l) {
  return [
    1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
    0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
    1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
  ];
}

export function xyzToLinearSRGB([x, y, z]) {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

/** Colour of wavelength-parameter t ∈ [0,1] (0 = 400 nm, 1 = 700 nm). */
export function paletteFn(settings) {
  if (settings.palette === 'custom') {
    const cols = [settings.colA, settings.colB, settings.colC].map(hexToLinear);
    return (t) => {
      const u = t * (cols.length - 1);
      const j = Math.min(Math.floor(u), cols.length - 2);
      const f = u - j;
      return [0, 1, 2].map((k) => cols[j][k] * (1 - f) + cols[j + 1][k] * f);
    };
  }
  const sat = settings.saturation ?? 1;
  return (t) => {
    const c = xyzToLinearSRGB(cieXYZ(LAMBDA_MIN + (LAMBDA_MAX - LAMBDA_MIN) * t));
    const y = luma(c);
    return c.map((v) => Math.max(0, y + (v - y) * sat));
  };
}

/**
 * Bake the fringe kernel. Returns RGBA8 LUT data over x ∈ [xMin, xMax]
 * (units of normalised dispersion; the shader scales by the per-pixel shift).
 */
export function buildFringeLUT(settings) {
  const { anchor, curve, softness = 0 } = settings;
  const color = paletteFn(settings);
  const dHi = dispersion(LAMBDA_MIN, anchor, curve);
  const dLo = dispersion(LAMBDA_MAX, anchor, curve);
  const span = dHi - dLo;
  const half = (softness * span) / 2;
  const xMin = dLo - half;
  const xMax = dHi + half;
  const binW = (xMax - xMin) / LUT_SIZE;
  const hw = Math.max(half, binW / 2); // box half-width, at least one bin

  const acc = new Float64Array(LUT_SIZE * 3);
  for (let j = 0; j < LAMBDA_STEPS; j++) {
    const t = (j + 0.5) / LAMBDA_STEPS;
    const d = dispersion(LAMBDA_MIN + (LAMBDA_MAX - LAMBDA_MIN) * t, anchor, curve);
    const c = color(t);
    const a = d - hw;
    const b = d + hw;
    const i0 = Math.max(0, Math.floor((a - xMin) / binW));
    const i1 = Math.min(LUT_SIZE - 1, Math.floor((b - xMin) / binW));
    for (let i = i0; i <= i1; i++) {
      const lo = Math.max(a, xMin + i * binW);
      const hi = Math.min(b, xMin + (i + 1) * binW);
      const cover = Math.max(0, hi - lo) / (2 * hw);
      acc[i * 3] += c[0] * cover;
      acc[i * 3 + 1] += c[1] * cover;
      acc[i * 3 + 2] += c[2] * cover;
    }
  }

  let max = 1e-12;
  for (const v of acc) max = Math.max(max, v);
  const data = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round((acc[i * 3 + k] / max) * 255);
    data[i * 4 + 3] = 255;
  }
  return { data, xMin, xMax };
}
