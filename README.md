# Spectral Chromatic Aberration

Realistic, art-directable chromatic aberration, GPU-only. Prototyped in WebGPU, later ported to After Effects.
Background and design decisions: [docs/RESEARCH.md](docs/RESEARCH.md).

**Status:** phase 1, spectral lateral CA.

## Run locally

WebGPU needs a secure context, so serve over localhost:

```bash
cd web && python3 -m http.server 8000
```

Open http://localhost:8000 in Chrome or Edge.

## Controls

- Drop, paste or load an image. A test chart loads by default.
- Scroll to zoom, drag to pan, double-click to toggle fit/100%.
- Hold <kbd>Space</kbd> to see the original. Double-click a slider to reset it.

## How it works

- `web/src/spectrum.js` bakes a 1D **fringe kernel**: CIE 1931 spectrum → linear sRGB, placed along the radius by a dispersion curve (linear ↔ Cauchy glass), optionally box-blurred (softness).
- `web/src/shaders/lateral_ca.wgsl` takes evenly spaced radial taps per pixel, weighted by that kernel and normalised per channel. Tap count adapts to the local spread, so the image centre is nearly free.
- `amount` = shift between the F (486 nm) and C (656 nm) lines, in pixels, at the image corners.

## Headless render (testing)

Runs the same shaders through Dawn, without a browser:

```bash
cd tools && npm install
```

```bash
node render.mjs in.png out.png amount=30 softness=0.5 --bench 10
```

On Linux without a GPU, install `mesa-vulkan-drivers` and prefix the command with `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json`.

## Deploy

`.github/workflows/pages.yml` publishes `web/` on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
