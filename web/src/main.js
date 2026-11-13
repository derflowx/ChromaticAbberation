import { buildFringeLUT, LUT_SIZE } from './spectrum.js';
import { makeTestChart } from './testchart.js';

// ---------------------------------------------------------------- settings

const DEFAULTS = {
  amount: 12,
  centerX: 0,
  centerY: 0,
  falloff: 1,
  anchor: 550,
  curve: 1,
  palette: 'spectral',
  saturation: 1,
  colA: '#3a2bff',
  colB: '#20ff60',
  colC: '#ff2a10',
  softness: 0,
  spacing: 1,
  maxSamples: 64,
  jitter: true,
  inputTransfer: 'srgb',
  view: 'result',
  split: 0.5,
  exposure: 0,
  diffGain: 4,
};

const STORE_KEY = 'spectral-ca-settings-v1';
const state = { ...DEFAULTS, ...loadSettings() };

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

// What each setting invalidates.
const VIEW_KEYS = new Set(['view', 'split', 'exposure', 'diffGain']);
const LUT_KEYS = new Set(['palette', 'saturation', 'colA', 'colB', 'colC', 'anchor', 'curve', 'softness']);

const CONTROLS = [
  { section: 'Lens' },
  { key: 'amount', label: 'Amount (px at corner)', type: 'range', min: -80, max: 80, step: 0.1 },
  { key: 'falloff', label: 'Edge falloff', type: 'range', min: 0.25, max: 4, step: 0.01, hint: '1 = physical (shift grows linearly with radius)' },
  { key: 'centerX', label: 'Centre X', type: 'range', min: -0.5, max: 0.5, step: 0.001 },
  { key: 'centerY', label: 'Centre Y', type: 'range', min: -0.5, max: 0.5, step: 0.001 },
  { key: 'anchor', label: 'Anchor wavelength (nm)', type: 'range', min: 400, max: 700, step: 1, hint: 'This colour stays in place; the others spread around it' },
  { key: 'curve', label: 'Dispersion: linear ↔ glass', type: 'range', min: 0, max: 1, step: 0.01 },
  { section: 'Fringe' },
  {
    key: 'palette', label: 'Palette', type: 'select',
    options: [['spectral', 'Spectral (physical)'], ['custom', 'Custom gradient'], ['classic', 'Classic RGB shift']],
  },
  { key: 'saturation', label: 'Spectral saturation', type: 'range', min: 0, max: 2, step: 0.01, show: (s) => s.palette === 'spectral' },
  { key: 'colA', label: 'Short λ (inner)', type: 'color', show: (s) => s.palette === 'custom' },
  { key: 'colB', label: 'Middle', type: 'color', show: (s) => s.palette === 'custom' },
  { key: 'colC', label: 'Long λ (outer)', type: 'color', show: (s) => s.palette === 'custom' },
  { key: 'softness', label: 'Softness', type: 'range', min: 0, max: 3, step: 0.01, show: (s) => s.palette !== 'classic' },
  { section: 'Quality' },
  { key: 'spacing', label: 'Sample spacing (px)', type: 'range', min: 0.25, max: 4, step: 0.05, show: (s) => s.palette !== 'classic' },
  { key: 'maxSamples', label: 'Max samples', type: 'range', min: 4, max: 256, step: 1, show: (s) => s.palette !== 'classic' },
  { key: 'jitter', label: 'Dither samples', type: 'checkbox', show: (s) => s.palette !== 'classic' },
  { section: 'View' },
  {
    key: 'view', label: 'Show', type: 'select',
    options: [['result', 'Result'], ['original', 'Original'], ['split', 'Split'], ['diff', 'Difference']],
  },
  { key: 'split', label: 'Split position', type: 'range', min: 0, max: 1, step: 0.001, show: (s) => s.view === 'split' },
  { key: 'diffGain', label: 'Difference gain', type: 'range', min: 1, max: 32, step: 0.1, show: (s) => s.view === 'diff' },
  { key: 'exposure', label: 'Exposure (stops)', type: 'range', min: -4, max: 4, step: 0.01 },
  { section: 'Input' },
  { key: 'inputTransfer', label: 'Input encoding', type: 'select', options: [['srgb', 'sRGB (most images)'], ['linear', 'Linear']] },
];

const VIEW_MODES = { result: 0, original: 1, split: 2, diff: 3 };

// ---------------------------------------------------------------- DOM

const $ = (s) => document.querySelector(s);
const canvas = $('#view');
const hud = $('#hud');
const statsEl = $('#stats');

function fail(msg) {
  const el = $('#error');
  el.hidden = false;
  el.textContent = msg;
}

const rows = [];
function buildControls() {
  const root = $('#controls');
  root.textContent = '';
  for (const c of CONTROLS) {
    if (c.section) {
      const h = document.createElement('h2');
      h.textContent = c.section;
      root.append(h);
      continue;
    }
    const row = document.createElement('label');
    row.className = `ctl ctl-${c.type}`;
    const name = document.createElement('span');
    name.className = 'ctl-label';
    name.textContent = c.label;
    if (c.hint) row.title = c.hint;
    row.append(name);

    let input;
    if (c.type === 'select') {
      input = document.createElement('select');
      for (const [v, t] of c.options) input.append(new Option(t, v));
      input.value = state[c.key];
      input.addEventListener('change', () => set(c.key, input.value));
    } else if (c.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!state[c.key];
      input.addEventListener('change', () => set(c.key, input.checked));
      row.prepend(input);
    } else if (c.type === 'color') {
      input = document.createElement('input');
      input.type = 'color';
      input.value = state[c.key];
      input.addEventListener('input', () => set(c.key, input.value));
    } else {
      input = document.createElement('input');
      input.type = 'range';
      Object.assign(input, { min: c.min, max: c.max, step: c.step });
      input.value = state[c.key];
      const num = document.createElement('input');
      num.type = 'number';
      num.className = 'num';
      Object.assign(num, { min: c.min, max: c.max, step: c.step });
      num.value = state[c.key];
      input.addEventListener('input', () => {
        num.value = input.value;
        set(c.key, parseFloat(input.value));
      });
      num.addEventListener('change', () => {
        const v = parseFloat(num.value);
        if (Number.isFinite(v)) {
          input.value = v;
          set(c.key, v);
        }
      });
      input.addEventListener('dblclick', () => {
        input.value = num.value = DEFAULTS[c.key];
        set(c.key, DEFAULTS[c.key]);
      });
      const wrap = document.createElement('span');
      wrap.className = 'range-wrap';
      wrap.append(input, num);
      input = wrap;
    }
    if (c.type !== 'checkbox') row.append(input);
    root.append(row);
    rows.push({ c, row });
  }
  updateVisibility();
}

function updateVisibility() {
  for (const { c, row } of rows) row.hidden = c.show ? !c.show(state) : false;
}

function set(key, value) {
  state[key] = value;
  saveSettings();
  if (VIEW_KEYS.has(key)) {
    dirty.view = true;
  } else {
    if (LUT_KEYS.has(key)) dirty.lut = true;
    if (key === 'inputTransfer') dirty.linearize = true;
    dirty.ca = true;
  }
  updateVisibility();
  requestRender();
}

// ---------------------------------------------------------------- GPU

let device, context, canvasFormat;
let caPipeline, linPipeline, dispPipeline;
let sampler, lutTex, caParams, linParams, viewParams;
let srcTex, linTex, outTex;
let caBG, linBG, dispBG;
let ts = null; // timestamp query resources
const img = { w: 0, h: 0, name: '' };
const dirty = { linearize: false, lut: true, ca: false, view: false };
const viewState = { zoom: 1, pan: [0, 0], fit: true };
let gpuMs = null;
let kernel = { xMin: -1, xMax: 1 }; // fringe kernel range from buildFringeLUT

async function loadShader(name) {
  const res = await fetch(new URL(`./shaders/${name}`, import.meta.url));
  const code = await res.text();
  const mod = device.createShaderModule({ label: name, code });
  const info = await mod.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error(`${name}:\n` + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  return mod;
}

async function initGPU() {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser. Try a recent Chrome or Edge.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter found.');
  const hasTS = adapter.features.has('timestamp-query');
  device = await adapter.requestDevice({
    requiredFeatures: hasTS ? ['timestamp-query'] : [],
    requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
  });
  device.lost.then((info) => fail(`GPU device lost: ${info.message}`));
  device.addEventListener('uncapturederror', (e) => {
    console.error(e.error);
    fail(`GPU error: ${e.error.message}`);
  });

  context = canvas.getContext('webgpu');
  canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

  const [caMod, linMod, dispMod] = await Promise.all([
    loadShader('lateral_ca.wgsl'),
    loadShader('linearize.wgsl'),
    loadShader('display.wgsl'),
  ]);
  caPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: caMod, entryPoint: 'main' } });
  linPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: linMod, entryPoint: 'main' } });
  dispPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: dispMod, entryPoint: 'vs' },
    fragment: { module: dispMod, entryPoint: 'fs', targets: [{ format: canvasFormat }] },
    primitive: { topology: 'triangle-list' },
  });

  sampler = device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });
  lutTex = device.createTexture({
    size: [LUT_SIZE, 1], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const ub = (size) => device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  caParams = ub(64);
  linParams = ub(16);
  viewParams = ub(48);

  if (hasTS) {
    ts = {
      set: device.createQuerySet({ type: 'timestamp', count: 2 }),
      resolve: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
      read: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
      busy: false,
    };
  }
  return adapter;
}

function setImage(source, name) {
  const max = device.limits.maxTextureDimension2D;
  const w = source.width;
  const h = source.height;
  if (w > max || h > max) {
    fail(`Image is ${w}×${h}; this GPU supports up to ${max}px per side.`);
    return;
  }
  $('#error').hidden = true;
  [srcTex, linTex, outTex].forEach((t) => t && t.destroy());
  srcTex = device.createTexture({
    size: [w, h], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source }, { texture: srcTex }, [w, h]);
  const f16 = () => device.createTexture({
    size: [w, h], format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });
  linTex = f16();
  outTex = f16();

  linBG = device.createBindGroup({
    layout: linPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: linTex.createView() },
      { binding: 2, resource: { buffer: linParams } },
    ],
  });
  caBG = device.createBindGroup({
    layout: caPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: linTex.createView() },
      { binding: 1, resource: sampler },
      { binding: 2, resource: outTex.createView() },
      { binding: 3, resource: { buffer: caParams } },
      { binding: 4, resource: lutTex.createView() },
    ],
  });
  dispBG = device.createBindGroup({
    layout: dispPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: outTex.createView() },
      { binding: 1, resource: linTex.createView() },
      { binding: 2, resource: sampler },
      { binding: 3, resource: { buffer: viewParams } },
    ],
  });

  img.w = w;
  img.h = h;
  img.name = name;
  dirty.linearize = dirty.ca = dirty.view = true;
  fitView();
}

// ---------------------------------------------------------------- params

function caGeometry() {
  const center = [img.w / 2 + state.centerX * img.w, img.h / 2 - state.centerY * img.h];
  const refRadius = Math.hypot(img.w, img.h) / 2;
  return { center, refRadius };
}

function writeCAParams() {
  const { center, refRadius } = caGeometry();
  const a = new Float32Array(16);
  a.set([
    center[0], center[1], img.w, img.h,
    refRadius, state.amount, state.anchor, state.curve,
    state.falloff, 0, state.spacing, state.maxSamples,
    state.palette === 'classic' ? 1 : 0, state.jitter ? 1 : 0, kernel.xMin, kernel.xMax,
  ]);
  device.queue.writeBuffer(caParams, 0, a);
}

/** Worst-case sample count (farthest corner), for the stats readout. */
function maxSamplesUsed() {
  if (state.palette === 'classic') return 3;
  const { center, refRadius } = caGeometry();
  const r = Math.max(
    Math.hypot(center[0], center[1]), Math.hypot(img.w - center[0], center[1]),
    Math.hypot(center[0], img.h - center[1]), Math.hypot(img.w - center[0], img.h - center[1]),
  );
  const rn = r / refRadius;
  const k = (state.amount / refRadius) * Math.pow(Math.max(rn, 1e-6), state.falloff - 1);
  const spread = r * Math.abs(k) * (kernel.xMax - kernel.xMin);
  return { n: Math.min(Math.max(Math.ceil(spread / state.spacing) + 1, 3), state.maxSamples), spread };
}

function writeLUT() {
  const lut = buildFringeLUT(state);
  kernel = { xMin: lut.xMin, xMax: lut.xMax };
  const data = lut.data;
  device.queue.writeTexture({ texture: lutTex }, data, { bytesPerRow: LUT_SIZE * 4 }, [LUT_SIZE, 1]);
}

function writeViewParams() {
  const showOriginal = holdingSpace && state.view !== 'diff';
  const a = new Float32Array(12);
  a.set([
    canvas.width, canvas.height, img.w, img.h,
    viewState.pan[0], viewState.pan[1], viewState.zoom,
    showOriginal ? 1 : VIEW_MODES[state.view], state.split, state.exposure, state.diffGain, 0,
  ]);
  device.queue.writeBuffer(viewParams, 0, a);
}

// ---------------------------------------------------------------- render

let rafPending = false;
function requestRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    frame();
  });
}

function frame() {
  if (!img.w || !canvas.width) return;
  const enc = device.createCommandEncoder();

  if (dirty.lut) {
    writeLUT();
    dirty.lut = false;
  }
  if (dirty.linearize) {
    device.queue.writeBuffer(linParams, 0, new Uint32Array([state.inputTransfer === 'srgb' ? 1 : 0, 0, 0, 0]));
    const p = enc.beginComputePass();
    p.setPipeline(linPipeline);
    p.setBindGroup(0, linBG);
    p.dispatchWorkgroups(Math.ceil(img.w / 8), Math.ceil(img.h / 8));
    p.end();
    dirty.linearize = false;
  }

  let timed = false;
  if (dirty.ca) {
    writeCAParams();
    timed = ts && !ts.busy;
    const p = enc.beginComputePass(timed
      ? { timestampWrites: { querySet: ts.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }
      : {});
    p.setPipeline(caPipeline);
    p.setBindGroup(0, caBG);
    p.dispatchWorkgroups(Math.ceil(img.w / 8), Math.ceil(img.h / 8));
    p.end();
    dirty.ca = false;
    updateStats();
  }

  writeViewParams();
  const rp = enc.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1],
    }],
  });
  rp.setPipeline(dispPipeline);
  rp.setBindGroup(0, dispBG);
  rp.draw(3);
  rp.end();
  dirty.view = false;

  if (timed) {
    enc.resolveQuerySet(ts.set, 0, 2, ts.resolve, 0);
    enc.copyBufferToBuffer(ts.resolve, 0, ts.read, 0, 16);
  }
  device.queue.submit([enc.finish()]);

  if (timed) {
    ts.busy = true;
    ts.read.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigInt64Array(ts.read.getMappedRange());
      gpuMs = Number(t[1] - t[0]) / 1e6;
      ts.read.unmap();
      ts.busy = false;
      updateStats();
    }).catch(() => { ts.busy = false; });
  }
  updateHud();
}

function updateStats() {
  const s = maxSamplesUsed();
  const lines = [
    `${img.name || 'image'} · ${img.w}×${img.h}`,
    state.palette === 'classic' ? 'samples: 3 (classic)' : `max spread ${s.spread.toFixed(1)} px · ${s.n} samples at corners`,
    gpuMs == null ? (ts ? 'GPU time: measuring…' : 'GPU time: n/a (no timestamp-query)') : `CA pass: ${gpuMs.toFixed(2)} ms`,
  ];
  statsEl.textContent = lines.join('\n');
}

function updateHud() {
  const pct = Math.round(viewState.zoom * window.devicePixelRatio * 100);
  const mode = holdingSpace ? 'ORIGINAL (space)' : state.view.toUpperCase();
  hud.textContent = `${pct}% · ${mode}`;
}

// ---------------------------------------------------------------- view interaction

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  if (viewState.fit) fitView();
  requestRender();
}

function fitView() {
  if (!img.w) return;
  viewState.fit = true;
  viewState.zoom = Math.min(canvas.width / img.w, canvas.height / img.h) * 0.98;
  viewState.pan = [img.w / 2, img.h / 2];
  requestRender();
}

function actualPixels() {
  viewState.fit = false;
  viewState.zoom = window.devicePixelRatio || 1; // 1 image px per CSS px
  requestRender();
}

let holdingSpace = false;
let drag = null;

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const m = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
  const before = [
    (m[0] - canvas.width / 2) / viewState.zoom + viewState.pan[0],
    (m[1] - canvas.height / 2) / viewState.zoom + viewState.pan[1],
  ];
  viewState.zoom = Math.min(64, Math.max(0.02, viewState.zoom * Math.exp(-e.deltaY * 0.0015)));
  viewState.pan = [
    before[0] - (m[0] - canvas.width / 2) / viewState.zoom,
    before[1] - (m[1] - canvas.height / 2) / viewState.zoom,
  ];
  viewState.fit = false;
  requestRender();
}, { passive: false });

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dpr = window.devicePixelRatio || 1;
  viewState.pan[0] -= ((e.clientX - drag.x) * dpr) / viewState.zoom;
  viewState.pan[1] -= ((e.clientY - drag.y) * dpr) / viewState.zoom;
  drag = { x: e.clientX, y: e.clientY };
  viewState.fit = false;
  requestRender();
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('dblclick', () => (viewState.fit ? actualPixels() : fitView()));

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!holdingSpace) {
      holdingSpace = true;
      requestRender();
    }
  } else if (e.key === 'f') fitView();
  else if (e.key === '1') actualPixels();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    holdingSpace = false;
    requestRender();
  }
});

// ---------------------------------------------------------------- loading

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    setImage(bmp, file.name);
    bmp.close();
  } catch (err) {
    fail(`Could not load ${file.name}: ${err.message}`);
  }
}

async function loadTestChart() {
  const bmp = await createImageBitmap(makeTestChart());
  setImage(bmp, 'test chart');
  bmp.close();
}

$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('#btn-chart').addEventListener('click', loadTestChart);
$('#btn-fit').addEventListener('click', fitView);
$('#btn-100').addEventListener('click', actualPixels);
$('#btn-reset').addEventListener('click', () => {
  Object.assign(state, DEFAULTS);
  saveSettings();
  rows.length = 0;
  buildControls();
  dirty.lut = dirty.linearize = dirty.ca = true;
  requestRender();
});

const vp = $('#viewport');
vp.addEventListener('dragover', (e) => {
  e.preventDefault();
  vp.classList.add('dragging');
});
vp.addEventListener('dragleave', () => vp.classList.remove('dragging'));
vp.addEventListener('drop', (e) => {
  e.preventDefault();
  vp.classList.remove('dragging');
  loadFile(e.dataTransfer.files[0]);
});
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

// ---------------------------------------------------------------- boot

(async () => {
  buildControls();
  try {
    const adapter = await initGPU();
    const info = adapter.info || {};
    $('#gpu').textContent = [info.vendor, info.architecture, info.description].filter(Boolean).join(' · ') || 'WebGPU';
  } catch (err) {
    console.error(err);
    fail(err.message);
    return;
  }
  new ResizeObserver(resizeCanvas).observe(canvas);
  resizeCanvas();
  await loadTestChart();
  window.__ca = { state, set, frame, get gpuMs() { return gpuMs; }, loadTestChart };
})();
