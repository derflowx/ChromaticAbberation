# Spectral Chromatic Aberration: WebGL2 prototype

> This folder is a **separate prototype** that sits next to the WebGPU version in `web/` at the repo root. They were developed independently. See `docs/HANDOFF.md` for how they differ and what to merge.

A physically based, art-directable chromatic aberration effect. It runs in the browser as a single-file WebGL2 test bench and is meant to become an **After Effects plugin**.

The point: real CA is **not** "scale the R and B channels a bit". It's a continuous spectrum, it has two different mechanisms (lateral and axial), it follows the glass's dispersion curve, it depends on depth, and it's driven by highlights. This project models all of that, then puts an artist-friendly control layer on top.

## Run it

Open `index.html` in any current browser (Chrome, Safari, Firefox). No server or install needed. It needs WebGL2 with `EXT_color_buffer_float`.

- **Shift-click** the image: set the lens center
- **Alt/Option-click**: focus at that depth (needs depth)
- **Split** mode: drag on the image to move the before/after line
- Drop an image anywhere to load it; load a matching depth map under *Depth & bokeh*
- Type a value into any number field to go past the slider's range ("overcrank"); the control turns orange
- Double-click a label to reset it

## Repository layout

| Path | What |
|---|---|
| `index.html` | The test bench: UI, GLSL shaders, procedural HDR 3D scene with depth |
| `docs/RESEARCH.md` | Physics of CA, why the cheap version looks cheap, literature review, depth-map analysis, verification results |
| `docs/PLUGIN_NOTES.md` | The full model as formulas, how it maps to the AE SDK, the parameter/UI spec |
| `docs/HANDOFF.md` | Project state, decisions made, known issues, next steps: start here when continuing work |

## Features (current)

**Artist layer (top of the panel)**
- **Looks:** Subtle modern, Vintage glass, Cheap zoom, Dreamy bloom, Prism streak, Cyber split, Warm/teal, Overcranked
- **Main controls:** Amount, Fringe blur, Preserve detail, Blur shape (round → streak), Clean center, Highlight glow, Mix
- **Fringe colors:** Natural (CIE spectrum), Shifted (hue rotation), Two-color (custom gradient), plus Color intensity

**Physics (folded away)**
- Lateral CA: wavelength-dependent magnification, radial from the optical center
- Axial CA: a signed defocus for each wavelength. With depth, fringes flip color in front of vs. behind focus.
- Dispersion curves calculated from published glass data for real lens types: single lenses, achromats, an apochromat. Or a custom curve.
- Depth of field with depth comparison (background can't bleed over foreground), aperture blades, cat-eye, bokeh rim / spherical aberration, spherochromatism
- Works in linear light. Takes HDR input, or 8-bit with highlight expansion. Progressive refinement for noise-free stills.

## Status

Test bench works and has been checked. The AE plugin hasn't been started. See `docs/HANDOFF.md`.
