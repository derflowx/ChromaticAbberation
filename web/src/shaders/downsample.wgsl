// Builds one mip level (2×2 box filter) of the linear input.

@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var dst : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dd = textureDimensions(dst);
  if (gid.x >= dd.x || gid.y >= dd.y) { return; }
  let sd = vec2i(textureDimensions(src)) - 1;
  let b = vec2i(gid.xy) * 2;
  let s = textureLoad(src, min(b, sd), 0)
        + textureLoad(src, min(b + vec2i(1, 0), sd), 0)
        + textureLoad(src, min(b + vec2i(0, 1), sd), 0)
        + textureLoad(src, min(b + vec2i(1, 1), sd), 0);
  textureStore(dst, gid.xy, s * 0.25);
}
