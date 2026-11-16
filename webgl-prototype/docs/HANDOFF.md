# Handoff: where this project stands

Start here when continuing in a new chat. Read `README.md`, then this, then `RESEARCH.md` and `PLUGIN_NOTES.md` as needed.

## Two versions in this repo
This prototype lives in `webgl-prototype/`. The repo root holds a separate **WebGPU** version (`web/`, `tools/`, root `README.md` and `docs/RESEARCH.md`), built in a different chat.

| | WebGPU version (`web/`) | WebGL2 prototype (`webgl-prototype/`) |
|---|---|---|
| Spectrum | RGB converted to a smooth spectrum (3 basis functions) → shifted per wavelength → converted back with CIE curves; out-of-gamut colors kept as floats | Each RGB channel weighted by the CIE curves per wavelength sample, normalized per channel |
| Lateral CA | ✔ Better sampling: weights precomputed on the CPU so flat colors come out exact at any sample count, tap count adapts to the local spread, pre-blurred input copies hide gaps between taps | ✔ Stochastic samples + progressive refinement |
| Axial CA / depth / bokeh | — (phase 1) | ✔ Signed per-wavelength defocus, depth-aware gather, blades, cat-eye, spherical aberration, spherochromatism |
| Glass models | linear ↔ Cauchy | Sellmeier: single lenses, achromats, apochromat |
| Artist layer | basic sliders | Looks, palettes, Preserve detail, streak, overcrank |
| Tooling | headless Dawn renderer, Pages deploy | single HTML file |

**Suggested merge direction:** keep the WebGPU version's lateral-CA sampling and spectrum conversion as the base. Port this prototype's depth/axial/bokeh model and artist layer onto it.

## Goal
A chromatic aberration effect that looks *real* rather than the cheap RGB channel shift, while staying **art-directable** (including overcranking far past realism). It's prototyped in the browser (`index.html`, WebGL2) and will become an **After Effects plugin** (SmartFX, 32 bpc, GPU).

## How we got here
1. **v1:** spectral lateral CA in a fragment shader: N wavelength samples, CIE weights, axial blur as a disk per wavelength, linear light, highlight expansion. Had a "Cheap RGB" comparison mode.
2. **Research pass:** papers on CA rendering (see RESEARCH.md). Conclusion: build on Jeong et al. 2016 (simple-lens model + chromatic terms, depth-aware); polynomial optics is the future "real lens presets" feature.
3. **v2 ("make it the sickest"):** depth-aware chromatic defocus (signed CoC per wavelength, scatter-as-gather with tile-max), dispersion curves calculated from real glass data (single lenses, achromats, apochromat), procedural HDR 3D scene with float depth, aperture blades, cat-eye, spherical aberration, spherochromatism, progressive refinement, CoC/depth views.
4. **User feedback:** "not artist-friendly, too complex, not art-directable enough, want to overcrank the blur."
5. **v3 (current):** artist layer on top: Looks, six main controls, fringe palettes (Natural / Shifted / Two-color), Color intensity, Mix, typed values past the slider range (overcrank), double-click to reset. Physics and depth folded away. Added **Preserve detail** (puts the original luminance back) because huge blur values otherwise turn the image to mush.

## Key decisions
- **Linear light, per-channel normalized spectral weights:** greys stay grey in every palette mode.
- **One dispersion curve `D(λ)`** (64-entry lookup table, normalized so max|D| = 1 and D(550 nm) = 0) drives both lateral and axial CA. Amount sliders set the magnitude; the glass model only sets the curve's shape.
- **Fringe blur is weighted by field position** (`rn^(falloff/2)`), so *Clean center* also keeps the center sharp.
- **Overcrank = slider range ≠ valid range**, exactly like AE's `PF_ADD_FLOAT_SLIDERX`.
- **No progressive accumulation in AE:** use a fixed, deterministic sample count instead (Draft/Good/Final = 16/48/128).

## Known issues / limitations
- Very large blur values on Draft/Good are grainy; Final (64 frames) cleans that up. AE needs a smarter low-noise approach for big radii, e.g. a separable/pyramid pre-blur per wavelength band, or blue-noise sampling plus more samples.
- One depth layer: halos/smearing behind blurred foreground edges.
- No EXR loading in the browser; 8-bit images rely on Highlight glow.
- Depth blur radius is covered up to about 256 px (tile dilation ±8 tiles of 32 px).
- In browsers, `requestAnimationFrame` pauses when the tab is hidden, so refinement appears to stall. That's harmless.
- The literature was only partly checked against full texts (see RESEARCH.md).

## Next steps (suggested order)
1. **Decide the AE architecture:** C++ SmartFX skeleton, shared GLSL→Metal/CUDA kernel, CPU fallback, parameter list from PLUGIN_NOTES.md.
2. **Low-noise big blur** for deterministic AE renders.
3. **Polynomial-optics lens presets** (trace real lens designs per wavelength, fit polynomials) as the distinctive feature.
4. Spatially varying PSF grid (coma/astigmatism-shaped fringes).
5. Optional: lens flare / ghosts with CA (Hullin 2011).
