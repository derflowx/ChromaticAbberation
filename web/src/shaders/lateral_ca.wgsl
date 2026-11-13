// Spectral lateral (transverse) chromatic aberration.
//
// Each wavelength λ is magnified slightly differently around the optical centre:
//   src(λ) = c + v * (1 + k(r) * d(λ))
// d(λ) is a normalised dispersion curve (d(anchor) = 0, d(F) − d(C) = 1), so
// `amount` is the F–C shift in pixels at the reference radius (the corners).
//
// The RGB→spectrum uplift, dispersion, CIE projection and softness are baked on
// the CPU into a 3×3 matrix kernel K(x) over radial offset x (see spectrum.js).
// The kernel is stored cumulatively (C). Per pixel: n radial taps; tap i covers
// t ∈ [i/n, (i+1)/n] and gets weight C(t1) − C(t0), so taps always sum to I
// and flat colour regions are reproduced exactly for any n.
// n adapts to the local spread.
//
// Source filtering: srcTex is an array of the input, sharp (layer 0) and
// Gaussian-blurred with σ = 1, 2, 4 px (layers 1–3). Summing many taps along a
// straight line through the pixel grid of a *sharp* image makes thin features
// count differently depending on how the line meets the grid → stripes/spokes
// that no tap count fixes. So displaced taps read a slightly blurred copy
// (σ ≥ 1 px, invisible inside a smear), and σ also covers the gap between taps
// (σ ≈ 0.8 × spacing), so taps can be sparse without stepping. Taps within ~1 px
// of their original position stay sharp, so in-focus detail is untouched.

struct Params {
  center     : vec2f, // optical centre, pixels
  size       : vec2f, // image size, pixels
  refRadius  : f32,   // pixels
  amount     : f32,   // F–C shift in pixels at refRadius
  anchorNm   : f32,   // classic mode only
  curve      : f32,   // classic mode only
  falloff    : f32,   // radial exponent, 1 = physical (shift ∝ r)
  lutSize    : f32,
  spacing    : f32,   // target pixel distance between taps
  maxSamples : f32,
  mode       : f32,   // 0 = spectral kernel, 1 = classic 3-tap RGB shift
  jitter     : f32,   // 0/1
  xMin       : f32,   // kernel range, normalised dispersion units
  xMax       : f32,
};

@group(0) @binding(0) var srcTex  : texture_2d_array<f32>;
@group(0) @binding(1) var linSamp : sampler;
@group(0) @binding(2) var outTex  : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> P : Params;
@group(0) @binding(4) var<storage, read> K : array<vec4f>; // cumulative, 3 rows per entry

const LAMBDA_F = 0.4861; // µm
const LAMBDA_C = 0.6563; // µm

fn dispersion(lambdaNm : f32) -> f32 {
  let l  = lambdaNm * 0.001;
  let la = P.anchorNm * 0.001;
  let cauchy = (1.0 / (l * l) - 1.0 / (la * la)) /
               (1.0 / (LAMBDA_F * LAMBDA_F) - 1.0 / (LAMBDA_C * LAMBDA_C));
  let linear = (la - l) / (LAMBDA_C - LAMBDA_F);
  return mix(linear, cauchy, P.curve);
}

fn ign(p : vec2f) -> f32 {
  // Interleaved gradient noise (Jimenez 2014): cheap, well distributed dither.
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

struct Rows { r : vec3f, g : vec3f, b : vec3f };

// Cumulative kernel at t ∈ [0,1], linearly interpolated.
fn cum(t : f32) -> Rows {
  let f  = clamp(t, 0.0, 1.0) * P.lutSize;
  let i0 = min(u32(f), u32(P.lutSize) - 1u);
  let a  = f - f32(i0);
  let j0 = i0 * 3u;
  let j1 = j0 + 3u;
  return Rows(mix(K[j0].xyz, K[j1].xyz, a),
              mix(K[j0 + 1u].xyz, K[j1 + 1u].xyz, a),
              mix(K[j0 + 2u].xyz, K[j1 + 2u].xyz, a));
}

const BLUR_LAYERS = 3.0; // σ = 1, 2, 4

// Sample the input pre-blurred with Gaussian σ (pixels), interpolating layers.
fn sampleBlurred(uv : vec2f, sigma : f32) -> vec3f {
  var lf = 0.0;
  if (sigma >= 1.0) { lf = min(1.0 + log2(sigma), BLUR_LAYERS); } else { lf = max(sigma, 0.0); }
  let l0 = i32(floor(lf));
  let f  = lf - f32(l0);
  let a  = textureSampleLevel(srcTex, linSamp, uv, l0, 0.0).rgb;
  if (f < 0.001) { return a; }
  return mix(a, textureSampleLevel(srcTex, linSamp, uv, l0 + 1, 0.0).rgb, f);
}

// One radial tap at relative shift delta. gapSigma = blur that hides the gap
// between neighbouring taps. Where the image is stretched apart (neighbouring
// output pixels land |1+δ| px apart sideways, |1+f·δ| radially), blur to that
// footprint too.
fn tap(v : vec2f, delta : f32, gapSigma : f32) -> vec3f {
  let uv = (P.center + v * (1.0 + delta)) / P.size;
  let shiftPx = abs(delta) * length(v);
  let footprint = max(abs(1.0 + delta), abs(1.0 + P.falloff * delta));
  let wanted = max(max(1.0, gapSigma), 0.5 * footprint);
  let sigma = wanted * smoothstep(0.5, 2.0, shiftPx);
  return sampleBlurred(uv, sigma);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = vec2u(P.size);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let p   = vec2f(gid.xy) + 0.5;
  let v   = p - P.center;
  let rpx = length(v);
  let rn  = rpx / P.refRadius;
  let k   = P.amount / P.refRadius * pow(max(rn, 1e-6), P.falloff - 1.0);
  let alpha = textureLoad(srcTex, vec2i(gid.xy), 0, 0).a;

  if (P.mode > 0.5) {
    // Classic RGB shift, for comparison: three discrete wavelengths.
    let r = sampleBlurred((P.center + v * (1.0 + k * dispersion(610.0))) / P.size, 0.0).r;
    let g = sampleBlurred((P.center + v * (1.0 + k * dispersion(550.0))) / P.size, 0.0).g;
    let b = sampleBlurred((P.center + v * (1.0 + k * dispersion(465.0))) / P.size, 0.0).b;
    textureStore(outTex, gid.xy, vec4f(r, g, b, alpha));
    return;
  }

  let spread = rpx * abs(k) * (P.xMax - P.xMin); // pixels
  let n   = u32(clamp(ceil(spread / P.spacing) + 1.0, 3.0, P.maxSamples));
  let fnn = f32(n);
  let gapSigma = 0.8 * spread / fnn; // ~tap spacing, pixels
  let noise = select(0.5, ign(p), P.jitter > 0.5);

  var col  = vec3f(0.0);
  var prev = Rows(vec3f(0.0), vec3f(0.0), vec3f(0.0));
  for (var i = 0u; i < n; i++) {
    let next = cum(f32(i + 1u) / fnn);
    let kr = next.r - prev.r;
    let kg = next.g - prev.g;
    let kb = next.b - prev.b;
    prev = next;
    // Tap position jittered inside its own interval.
    let t = (f32(i) + noise) / fnn;
    let c = tap(v, k * mix(P.xMin, P.xMax, t), gapSigma);
    col += vec3f(dot(kr, c), dot(kg, c), dot(kb, c));
  }
  textureStore(outTex, gid.xy, vec4f(col, alpha));
}
