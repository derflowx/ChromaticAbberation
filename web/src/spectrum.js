// Spectral fringe kernel.
//
// Physical model per output pixel:
//   1. Uplift: each source pixel's RGB becomes a smooth spectrum
//        S(λ) = B(λ) · rgb   (B = 3 smooth basis functions, a partition of unity,
//                             so white → flat spectrum)
//   2. Each wavelength is displaced radially by its dispersion d(λ).
//   3. Project back: out = Σ_λ W(λ) S_λ, with W(λ) = sRGB ← XYZ ← CIE 1931 CMF.
//      W is signed: spectral colours lie outside sRGB. Nothing is clipped per
//      wavelength; gamut is handled only when the result is displayed.
//
// Because S is linear in rgb, all of that collapses into a 3×3 matrix kernel
// K(x) over the radial offset x: out = Σ_taps K(x_i) · rgb(x_i). It's baked here
// (with softness as a box blur along x) into LUT_SIZE bins. The shader samples
// stored cumulatively; each shader tap integrates its own interval, so any flat
// colour region is reproduced exactly regardless of the tap count.
//
// CIE 1931 2° CMFs: analytic fit from Wyman, Sloan & Shirley 2013,
// "Simple Analytic Approximations to the CIE XYZ Color Matching Functions", JCGT 2(2).

export const LAMBDA_MIN = 380;
export const LAMBDA_MAX = 730;
export const LUT_SIZE = 512;
const LAMBDA_STEPS = 2048;

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

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** RGB → spectrum basis [b_R, b_G, b_B](λ). Smooth, positive, sums to 1. */
export function upliftBasis(l) {
  const blue = 1 - sigmoid((l - 490) / 10);
  const red = sigmoid((l - 590) / 10);
  return [red, Math.max(0, 1 - red - blue), blue];
}

export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Projection weights W(λ) → linear sRGB, for the palette in `settings`. */
export function projectionFn(settings) {
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
    return c.map((v) => y + (v - y) * sat);
  };
}

function inverse3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/**
 * Bake the cumulative 3×3 kernel. Returns { data: Float32Array((LUT_SIZE + 1) * 12), xMin, xMax }.
 * Entry i holds 3 vec4 rows (output R, G, B) = Σ of bins < i, weights for input (r, g, b).
 */
export function buildFringeLUT(settings) {
  const { anchor, curve, softness = 0 } = settings;
  const proj = projectionFn(settings);

  // Sample W and B over λ; balance so that Σ W Bᵀ = I (flat colour → unchanged).
  const W = [];
  const Bs = [];
  const D = [];
  const A = new Array(9).fill(0);
  for (let j = 0; j < LAMBDA_STEPS; j++) {
    const t = (j + 0.5) / LAMBDA_STEPS;
    const l = LAMBDA_MIN + (LAMBDA_MAX - LAMBDA_MIN) * t;
    const w = proj(t);
    const b = upliftBasis(l);
    W.push(w);
    Bs.push(b);
    D.push(dispersion(l, anchor, curve));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) A[r * 3 + c] += w[r] * b[c];
  }
  const Ainv = inverse3(A);

  const dHi = dispersion(LAMBDA_MIN, anchor, curve);
  const dLo = dispersion(LAMBDA_MAX, anchor, curve);
  const span = dHi - dLo;
  const half = (softness * span) / 2;
  const xMin = dLo - half;
  const xMax = dHi + half;
  const binW = (xMax - xMin) / LUT_SIZE;
  const hw = Math.max(half, binW / 2); // box half-width, at least one bin

  const acc = new Float64Array(LUT_SIZE * 9);
  for (let j = 0; j < LAMBDA_STEPS; j++) {
    const w = W[j];
    const wb = [0, 1, 2].map((r) => Ainv[r * 3] * w[0] + Ainv[r * 3 + 1] * w[1] + Ainv[r * 3 + 2] * w[2]);
    const b = Bs[j];
    const a = D[j] - hw;
    const e = D[j] + hw;
    const i0 = Math.max(0, Math.floor((a - xMin) / binW));
    const i1 = Math.min(LUT_SIZE - 1, Math.floor((e - xMin) / binW));
    for (let i = i0; i <= i1; i++) {
      const lo = Math.max(a, xMin + i * binW);
      const hi = Math.min(e, xMin + (i + 1) * binW);
      const cover = Math.max(0, hi - lo) / (2 * hw);
      if (cover <= 0) continue;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) acc[i * 9 + r * 3 + c] += wb[r] * b[c] * cover;
    }
  }

  // Store the running total C(t), so a tap covering [t0, t1] gets C(t1) − C(t0):
  // exact integration for any tap count, and all taps together sum to I.
  const data = new Float32Array((LUT_SIZE + 1) * 12);
  const run = new Float64Array(9);
  for (let i = 0; i < LUT_SIZE; i++) {
    for (let m = 0; m < 9; m++) run[m] += acc[i * 9 + m];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) data[(i + 1) * 12 + r * 4 + c] = run[r * 3 + c];
    }
  }
  return { data, xMin, xMax };
}
