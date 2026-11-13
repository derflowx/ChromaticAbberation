# Research notes: spectral chromatic aberration + depth of field

Goal: a realistic but art-directable chromatic aberration (CA) effect for After Effects, GPU-only, fast.
Prototype on the web (WebGPU, GitHub Pages) first, then port to AE.

## Decisions so far

- **Prototype:** WebGPU + compute shaders, hosted on GitHub Pages.
- **AE platform order:** Windows first (DirectX / CUDA), Mac (Metal) later.
- **Phase 1:** lateral CA only (no depth map, no DoF yet).
- **Shader source:** aim for one source that compiles to WGSL (web) and HLSL/Metal/CUDA (AE). Candidate: Slang (not yet verified hands-on).

## Phases

1. Web app: image load, spectral lateral CA, debug views.
2. Depth map input + gather-based DoF (signed CoC, tile dilation).
3. Longitudinal (axial) CA via pencil map inside the DoF gather; aperture shape LUT.
4. Art-direction controls, presets, tuning → port to After Effects.

## Physics

### Lateral CA (transverse, "CA of magnification")
- Each wavelength is magnified slightly differently: `m(λ) = 1 + k · d(λ)`, with `d(λ)` a dispersion curve (e.g. Cauchy / Abbe-number based).
- Visible in focus, grows toward the frame edges, radial direction.
- Realistic look = continuous rainbow fringe, not 3 discrete R/G/B ghosts.
- Render: N (8–16) jittered wavelength samples along the radial vector, each weighted by a spectrum→RGB curve normalised so all weights sum to white.
- Unity does the same with a spectral LUT; more samples at higher intensity.
- The Kawase decks do **not** cover lateral CA rendering; this part is our own design.

### Longitudinal CA (axial)
- Each wavelength focuses at a different distance → each wavelength has its own circle of confusion (CoC).
- Only visible out of focus. Requires depth + defocus blur, so **axial CA = spectral depth of field**. The plugin becomes a DoF plugin.
- Uncorrected lens: front bokeh red fringe (sharp), back bokeh blue fringe (soft).
- Achromat (typical corrected lens): front bokeh soft **purple** fringe, darker centre; back bokeh sharp **green** fringe, brighter centre ("secondary spectrum").
- APO lenses correct 3 wavelengths; residual is smaller.
- Most visible **slightly out of focus at wide aperture**; less visible at large defocus / small aperture.
- Shrinks when stopping down; depends on focus distance.

### Spherical aberration (SA)
- Not CA, but shapes bokeh: one side sharp-edged, the other soft-edged; dark centre vs. bright peak.
- Interacts with axial CA (spherochromatism) → complex gradients in real bokeh.

## Key reference: Kawase, SIGGRAPH 2015 "Making Your Bokeh Fascinating"

**Pencil map** (core idea)
- A precomputed 2D texture: U = signed defocus (distance from lens), V = radial position inside the bokeh.
- Each texel stores the bokeh's RGB intensity at that radius for that defocus.
- Built offline by tracing a small number of rays from the *longitudinal aberration diagram* (focus shift vs. incident height, per wavelength). Captures SA + axial CA together.
- 3 wavelengths look bad (hard RGB rings). Trace many wavelengths, convert to RGB.
- Optimisation: normalise V by the bokeh radius at each U → fewer empty texels, much better precision near focus.
- Can use real lens data where available; only per-wavelength ray paths are needed.

**Aperture shape LUT**
- A separate 2D LUT maps a position in the kernel → V coordinate of the pencil map.
- Independent of the pencil map. Handles 4–9 blades, opening/closing, curved blades, stars, hearts, etc.
- Interpolate between adjacent LUTs for smooth changes.

**Extras covered**
- Optical vignetting (cat's-eye bokeh toward frame edges).
- Fake diffraction spikes at small apertures.
- STF / apodization lens (soft-edged bokeh via radial ND gradient).
- Lens type presets: spherical, aspherical, achromat (2 types), APO, "perfect", STF.

**Scatter vs gather**
- Scatter = better quality but expensive. Recommended: hybrid.
- Choose scatter per pixel by CoC size + luminance difference to neighbours (bright highlights scatter, rest gathers).
- Scatter at half res (16× faster). Hierarchical resolutions for larger bokeh (1/4 res ≈ 256× faster). Scatter every 2×2 pixels for large bokeh (4× faster).

### Kawase, SIGGRAPH 2015 "Lenses"
- Theory: Seidel aberrations, SA, axial CA, achromat/APO correction, residual aberrations = bokeh character.
- Focus breathing: FOV depends on image distance, not focal length; effective F-number `Fe = (1 + M) · F`.
- Entrance pupil diameter `D = f / F`; variable vs fixed aperture zooms.
- Possible extras for us: focus breathing, effective F-number.

## Implemented in phase 1 (lateral CA)

- Spectral pipeline: RGB → smooth spectrum (uplift) → per-λ radial shift → CIE CMF → linear sRGB. Colour-coherent: a red object only fringes in long wavelengths.
- No per-wavelength clipping (that caused hard colour bands). Out-of-gamut values stay in float; display desaturates to fit.
- Cumulative 3×3 kernel → each tap integrates its interval → exact identity at any sample count. Stepping appears when taps are > ~1 px apart, so the default cap is 256 samples (≈1–2 ms at 2400×1600 on an RTX 40-series).

## How we apply it

- **Axial CA:** one gather pass. Per tap, look up the pencil map with (tap's signed defocus, distance / CoC) → RGB weight. Spectral fringe for the cost of one texture fetch per tap, no per-wavelength loop.
  - Normalise per channel (coloured weights).
- **Art direction:** generate the pencil map on the GPU from sliders (axial CA amount, secondary spectrum, SA, lens preset). Rebuilds in milliseconds. "More than real" = exaggerate the aberration diagram.
- **Aperture shape:** Kawase-style LUT → blades and custom shapes at no extra per-pixel cost.

## Depth of field: state of the art

- Modern approach: gather-based DoF with signed CoC, near/far split, tile min/max CoC dilation. Optional scatter for bright bokeh.
  - Unreal Diaphragm DOF (Abadie 2018): blade count and curvature.
  - AMD FidelityFX DoF: open source; outside-in ring gather approximates occlusion.
  - Blender EEVEE-Next: compute-shader DoF with gather, scatter, hole-fill, stabilise passes.
  - Older but foundational: GPU Gems 3 ch. 28 (gather vs scatter); AMD GDC 2017 "Cinematic Depth of Field".
- **Not suitable:** circular separable convolution (Garcia 2017, Wronski 2017). Very fast, but fixed kernel size, so it can't do per-pixel depth-varying blur.
- Frischluft Lenscare is CPU-era. Modern GPU DoF runs in milliseconds per 1080p frame in games.

### Hard limits (any 2.5D DoF)
- **Partial occlusion:** blurred foreground should reveal background that isn't in the image. Can only be faked (hole fill / inpaint).
- **Depth map edges:** AI depth maps (Depth Anything etc.) are soft at edges → halos. Needs edge-aware depth handling.
- **Linear light:** bokeh and fringes only look right in linear 32-bit float. Need a "linearize input" option.

## After Effects GPU path

- GPU SDK since AE 16.0; sample `SDK_Invert_ProcAmp`.
- Windows: CUDA (AE 27: CUDA 12.8 x64, 13.4 ARM64) and DirectX (HLSL compiled with DXC). Mac: Metal.
- DirectX requires `PF_OutFlag2_SUPPORTS_DIRECTX_RENDERING` in global flags + PiPL, and the `DirectXAssets` folder deployed next to the binary. Without the flag AE falls back to CPU → **a CPU implementation is still required**.
- Adobe recommends the CUDA Driver API (or statically linked runtime) for compatibility with future drivers.
- Open question from the community: Metal synchronisation / GPU world lifetime in SmartFX GPU render.

## Web prototype

- WebGPU + WGSL compute, `rgba16float` / `rgba32float` textures.
- Hosted on GitHub Pages.

## Competitors

- Frischluft Lenscare (DoF, slow, CPU-era).
- Sapphire FreeLens (edge CA).
- Crossphere Bokeh, Fast Camera Lens Blur, Fast Bokeh Pro (DoF).
- Quick Chromatic Aberration 3 (free, RGB shift + distortion), Chromabba.
- No spectral, depth-aware CA plugin found (quick search only).

## Sources

- Kawase, "Lenses", SIGGRAPH 2015 course (original link now 404): [Wayback copy](https://web.archive.org/web/20240803171515/https://www.siliconstudio.co.jp/rd/presentations/files/siggraph2015/04_Lenses_S2015_Kawase_EN.pdf)
- Kawase, "Making Your Bokeh Fascinating", SIGGRAPH 2015 (original link now 404): [Wayback copy](https://web.archive.org/web/20240803164952/https://www.siliconstudio.co.jp/rd/presentations/files/siggraph2015/06_MakingYourBokehFascinating_S2015_Kawase_EN.pdf), [SlideShare](https://www.slideshare.net/slideshow/making-your-bokeh-fascinating-realtime-rendering-of-physically-based-optical-effect-in-theory-and-practice-siggraph-2015-course/51986241)
- SIGGRAPH 2015 course listing: https://history.siggraph.org/?p=60115
- Unity Chromatic Aberration: https://docs.unity3d.com/Packages/com.unity.postprocessing@3.4/manual/Chromatic-Aberration.html
- Spectral sampling along spread vector (forum): https://communityforums.atmeta.com/discussions/dev-general/how-does-the-gear-vr-runtime-handle-lens-distortion--chromatic-aberration/613517/replies/613519
- Axial CA: https://arxiv.org/pdf/2110.04030
- CA vs aperture/focus (patent): https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8786709
- Unreal cinematic DoF: https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-depth-of-field-in-unreal-engine
- AMD FidelityFX DoF: https://gpuopen.com/?p=55260
- AMD GDC 2017 Cinematic DoF: https://gpuopen.com/download/GDC2017-Cinematic-Depth-Of-Field.pdf
- Blender EEVEE-Next DoF compute: https://developer.blender.org/rBf4fe3fb09b2
- GPU Gems 3 ch. 28: https://developer.nvidia.com/gpugems/GPUGems3/gpugems3_ch28.html
- Garcia 2017 Circular Separable Convolution DoF: https://history.siggraph.org/wp-content/uploads/2022/09/2017-Talks-Garcia_Circular-Separable-Convolution-Depth-of-Field.pdf
- Wronski, separable bokeh: https://bartwronski.com/2017/08/06/separable-bokeh/
- AE GPU build instructions: https://ae-plugins.docsforadobe.dev/intro/gpu-build-instructions/
- AE GPU support: https://helpx.adobe.com/after-effects/using/basics-gpu-after-effects.html
- Premiere/AE GPU SDK: https://ppro-plugins.docsforadobe.dev/gpu-effects-transitions/gpu-effects-transitions
- AE SDK Metal sync question: https://community.adobe.com/questions-529/ae-sdk-26-5-metal-synchronization-and-gpu-world-lifetime-in-pf-cmd-smart-render-gpu-1647996
- WebGPU (MDN): https://developer.mozilla.org/docs/Web/API/WebGPU_API
- Lenscare: https://frischluft.com/lenscare/index.php
- Sapphire FreeLens: https://borisfx.com/documentation/sapphire/ae/freelens/
- aescripts blur plugins: https://aescripts.com/after-effects/image/blur/
- Quick Chromatic Aberration: https://www.toolfarm.com/?p=21821
