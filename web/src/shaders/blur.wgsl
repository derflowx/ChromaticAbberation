// One direction of a separable Gaussian blur, used to build the pre-blurred
// copies of the input (built once per image, not per frame).

struct Params {
  dir    : vec2i, // (1,0) horizontal or (0,1) vertical
  radius : i32,
  sigma  : f32,
};

@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var dst : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> P : Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = vec2i(textureDimensions(src));
  let p = vec2i(gid.xy);
  if (p.x >= dims.x || p.y >= dims.y) { return; }
  var acc = vec4f(0.0);
  var wsum = 0.0;
  for (var i = -P.radius; i <= P.radius; i++) {
    let w = exp(-0.5 * f32(i * i) / (P.sigma * P.sigma));
    acc += textureLoad(src, clamp(p + P.dir * i, vec2i(0), dims - 1), 0) * w;
    wsum += w;
  }
  textureStore(dst, p, acc / wsum);
}
