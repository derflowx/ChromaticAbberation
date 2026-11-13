// Converts the 8-bit input into linear-light half float.

struct Params { srgb : u32, _a : u32, _b : u32, _c : u32 };

@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var dst : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> P : Params;

fn srgbToLinear(c : vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  var c = textureLoad(src, vec2i(gid.xy), 0);
  if (P.srgb == 1u) { c = vec4f(srgbToLinear(c.rgb), c.a); }
  textureStore(dst, gid.xy, c);
}
