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

Spectral, not per-RGB-channel:

1. **Uplift:** each source pixel's RGB becomes a smooth spectrum (3 smooth basis functions that sum to 1, so white = flat spectrum).
2. **Disperse:** each wavelength is displaced radially by its own amount (dispersion curve: linear ↔ Cauchy glass).
3. **Project:** the displaced spectra are converted back with the CIE 1931 colour-matching functions into linear sRGB.

- Out-of-gamut spectral colours are kept as float values and only compressed (desaturated to fit) for display.
- Steps 1–3 plus softness collapse into a cumulative 3×3 kernel, baked on the CPU (`web/src/spectrum.js`). Each shader tap (`web/src/shaders/lateral_ca.wgsl`) integrates its own slice of that kernel, so flat colours are reproduced exactly at any sample count.
- Tap count adapts to the local spread, so the image centre is nearly free.
- If a pixel's spread exceeds Max samples, taps read a pre-blurred mip level instead of stepping. More samples looks better.
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
