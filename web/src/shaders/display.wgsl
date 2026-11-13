// Draws the result into the canvas with zoom/pan, A/B views and sRGB encoding.

struct View {
  canvasSize : vec2f,
  imageSize  : vec2f,
  pan        : vec2f, // image pixel shown at the canvas centre
  zoom       : f32,
  mode       : f32,   // 0 result, 1 original, 2 split, 3 difference
  split      : f32,   // 0..1
  exposure   : f32,   // stops
  diffGain   : f32,
  _pad       : f32,
};

@group(0) @binding(0) var resultTex : texture_2d<f32>;
@group(0) @binding(1) var origTex   : texture_2d<f32>;
@group(0) @binding(2) var linSamp   : sampler;
@group(0) @binding(3) var<uniform> V : View;

@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn fetch(t : texture_2d<f32>, ip : vec2f) -> vec4f {
  if (V.zoom >= 1.0) {
    let c = clamp(vec2i(floor(ip)), vec2i(0), vec2i(V.imageSize) - 1);
    return textureLoad(t, c, 0);
  }
  return textureSampleLevel(t, linSamp, ip / V.imageSize, 0.0);
}

fn linearToSrgb(c : vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

@fragment
fn fs(@builtin(position) pos : vec4f) -> @location(0) vec4f {
  let ip = (pos.xy - V.canvasSize * 0.5) / V.zoom + V.pan;

  if (any(ip < vec2f(0.0)) || any(ip >= V.imageSize)) {
    let ch = (u32(floor(pos.x / 12.0)) + u32(floor(pos.y / 12.0))) & 1u;
    return vec4f(vec3f(select(0.075, 0.095, ch == 1u)), 1.0);
  }

  let res = fetch(resultTex, ip).rgb;
  var c = res;
  if (V.mode > 0.5 && V.mode < 1.5) {
    c = fetch(origTex, ip).rgb;
  } else if (V.mode > 1.5 && V.mode < 2.5) {
    let sx = V.split * V.imageSize.x;
    if (ip.x < sx) { c = fetch(origTex, ip).rgb; }
    if (abs(ip.x - sx) * V.zoom < 1.0) { return vec4f(1.0, 0.8, 0.2, 1.0); }
  } else if (V.mode > 2.5) {
    c = abs(res - fetch(origTex, ip).rgb) * V.diffGain;
    return vec4f(linearToSrgb(c), 1.0);
  }

  return vec4f(linearToSrgb(c * exp2(V.exposure)), 1.0);
}
