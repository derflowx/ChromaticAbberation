// Headless render of the web shaders through Dawn, for testing without a browser.
//
//   node render.mjs <in.png> <out.png> [key=value ...] [--bench N]
//
// Keys mirror the web UI state (amount, falloff, anchor, curve, palette, ...).
// Linux without a GPU: install mesa-vulkan-drivers and run with
//   VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json

import fs from 'node:fs';
import { PNG } from 'pngjs';
import { create, globals } from 'webgpu';
import { buildFringeLUT, LUT_SIZE } from '../web/src/spectrum.js';

Object.assign(globalThis, globals);

const args = process.argv.slice(2);
const [inPath, outPath] = args;
if (!inPath || !outPath) {
  console.error('usage: node render.mjs <in.png> <out.png> [key=value ...] [--bench N]');
  process.exit(1);
}

const state = {
  amount: 12, centerX: 0, centerY: 0, falloff: 1, anchor: 550, curve: 1,
  palette: 'spectral', saturation: 1, colA: '#3a2bff', colB: '#20ff60', colC: '#ff2a10',
  softness: 0, spacing: 2, maxSamples: 256, jitter: false, inputTransfer: 'srgb',
};
let bench = 0;
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--bench') { bench = parseInt(args[++i], 10); continue; }
  const [k, v] = args[i].split('=');
  state[k] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(+v) ? +v : v;
}

const shader = (name) => fs.readFileSync(new URL(`../web/src/shaders/${name}`, import.meta.url), 'utf8');

const gpu = create([]);
const adapter = await gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter (on Linux, install mesa-vulkan-drivers).');
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
device.addEventListener('uncapturederror', (e) => { console.error('GPU error:', e.error.message); process.exit(2); });

async function module(name) {
  const m = device.createShaderModule({ code: shader(name) });
  const info = await m.getCompilationInfo();
  for (const msg of info.messages) console.log(`${name} ${msg.type} ${msg.lineNum}:${msg.linePos} ${msg.message}`);
  if (info.messages.some((x) => x.type === 'error')) process.exit(3);
  return m;
}

const png = PNG.sync.read(fs.readFileSync(inPath));
const { width: w, height: h } = png;

const srcTex = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
device.queue.writeTexture({ texture: srcTex }, png.data, { bytesPerRow: w * 4 }, [w, h]);
const BLUR_SIGMAS = [1, 2, 4];
const f16 = (extra = 0, layers = 1) => device.createTexture({ size: [w, h, layers], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | extra });
const linTex = f16(0, 1 + BLUR_SIGMAS.length);
const tmpTex = f16();
const outTex = f16(GPUTextureUsage.COPY_SRC);
const layer = (i) => linTex.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 });

const lut = buildFringeLUT(state);
const kernelBuf = device.createBuffer({ size: lut.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(kernelBuf, 0, lut.data);

const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
const ub = (data) => {
  const b = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 0, data);
  return b;
};

const linPipe = device.createComputePipeline({ layout: 'auto', compute: { module: await module('linearize.wgsl'), entryPoint: 'main' } });
const caPipe = device.createComputePipeline({ layout: 'auto', compute: { module: await module('lateral_ca.wgsl'), entryPoint: 'main' } });
const blurPipe = device.createComputePipeline({ layout: 'auto', compute: { module: await module('blur.wgsl'), entryPoint: 'main' } });
await module('display.wgsl'); // compile check only

const center = [w / 2 + state.centerX * w, h / 2 - state.centerY * h];
const caParams = ub(new Float32Array([
  center[0], center[1], w, h,
  Math.hypot(w, h) / 2, state.amount, state.anchor, state.curve,
  state.falloff, LUT_SIZE, state.spacing, state.maxSamples,
  state.palette === 'classic' ? 1 : 0, state.jitter ? 1 : 0, lut.xMin, lut.xMax,
]));
const linParams = ub(new Uint32Array([state.inputTransfer === 'srgb' ? 1 : 0, 0, 0, 0]));

const linBG = device.createBindGroup({ layout: linPipe.getBindGroupLayout(0), entries: [
  { binding: 0, resource: srcTex.createView() }, { binding: 1, resource: layer(0) }, { binding: 2, resource: { buffer: linParams } },
] });
const caBG = device.createBindGroup({ layout: caPipe.getBindGroupLayout(0), entries: [
  { binding: 0, resource: linTex.createView({ dimension: '2d-array' }) }, { binding: 1, resource: sampler }, { binding: 2, resource: outTex.createView() },
  { binding: 3, resource: { buffer: caParams } }, { binding: 4, resource: { buffer: kernelBuf } },
] });

function pass(enc, pipe, bg, desc = {}, pw = w, ph = h) {
  const p = enc.beginComputePass(desc);
  p.setPipeline(pipe);
  p.setBindGroup(0, bg);
  p.dispatchWorkgroups(Math.ceil(pw / 8), Math.ceil(ph / 8));
  p.end();
}

let enc = device.createCommandEncoder();
pass(enc, linPipe, linBG);
BLUR_SIGMAS.forEach((sigma, i) => {
  for (const [dir, src, dst] of [[[1, 0], layer(0), tmpTex.createView()], [[0, 1], tmpTex.createView(), layer(i + 1)]]) {
    const d = new DataView(new ArrayBuffer(16));
    d.setInt32(0, dir[0], true); d.setInt32(4, dir[1], true);
    d.setInt32(8, Math.ceil(sigma * 3), true); d.setFloat32(12, sigma, true);
    const bg = device.createBindGroup({ layout: blurPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: src }, { binding: 1, resource: dst }, { binding: 2, resource: { buffer: ub(new Uint8Array(d.buffer)) } },
    ] });
    pass(enc, blurPipe, bg);
  }
});
pass(enc, caPipe, caBG);
device.queue.submit([enc.finish()]);
await device.queue.onSubmittedWorkDone();

if (bench > 0) {
  const t0 = performance.now();
  for (let i = 0; i < bench; i++) {
    enc = device.createCommandEncoder();
    pass(enc, caPipe, caBG);
    device.queue.submit([enc.finish()]);
  }
  await device.queue.onSubmittedWorkDone();
  console.log(`CA pass: ${((performance.now() - t0) / bench).toFixed(2)} ms avg over ${bench} (wall clock, ${w}x${h})`);
}

// Read back half floats → sRGB 8-bit PNG.
const bpr = Math.ceil((w * 8) / 256) * 256;
const rb = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
enc = device.createCommandEncoder();
enc.copyTextureToBuffer({ texture: outTex }, { buffer: rb, bytesPerRow: bpr }, [w, h]);
device.queue.submit([enc.finish()]);
await rb.mapAsync(GPUMapMode.READ);
const half = new Uint16Array(rb.getMappedRange());

function h2f(x) {
  const s = x & 0x8000 ? -1 : 1;
  const e = (x >> 10) & 0x1f;
  const m = x & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
const enc8 = (v) => {
  const c = Math.min(1, Math.max(0, v));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};

// Same gamut compression as display.wgsl: desaturate toward luma just enough
// to bring negative (out-of-sRGB) channels to zero.
function gamut(c) {
  if (state.gamut === 'clip') return c;
  const m = Math.min(...c);
  if (m >= 0) return c;
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (y <= 0) return [0, 0, 0];
  const k = y / (y - m);
  return c.map((v) => y + (v - y) * k);
}

const out = new PNG({ width: w, height: h });
let nonFinite = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * bpr) / 2 + x * 4;
    const o = (y * w + x) * 4;
    const c = gamut([h2f(half[i]), h2f(half[i + 1]), h2f(half[i + 2])]);
    for (let k = 0; k < 3; k++) {
      if (!Number.isFinite(c[k])) nonFinite++;
      out.data[o + k] = enc8(c[k]);
    }
    out.data[o + 3] = 255;
  }
}
rb.unmap();
fs.writeFileSync(outPath, PNG.sync.write(out));
console.log(`wrote ${outPath}${nonFinite ? ` (WARNING: ${nonFinite} non-finite values)` : ''}`);
process.exit(0);
