# Spectral CA — model & After Effects porting notes

Reference implementation: `chromatic-aberration.html` (WebGL2). Everything below maps 1:1 to its shaders.

## The model

Work in **linear light, 32-bit float**. For each pixel, integrate over wavelength λ ∈ [400, 700] nm:

```
out_c(p) = Σ_λ  w_c(λ) · PSF_λ ⊛ img (p + lateral(λ, p))   /   Σ_λ w_c(λ)
```

| Piece | Formula | Source |
|---|---|---|
| Spectral weights `w(λ)` | CIE 1931 2° CMFs (Wyman 2013 fit) → linear sRGB, clamped ≥ 0, normalised per channel so neutrals stay neutral | Wyman, Sloan, Shirley, JCGT 2013 |
| Dispersion `D(λ)` | Relative focal-length change `Δf/f = φ(550)/φ(λ) − 1`, from Sellmeier glass data; thin elements in contact solved for singlet / achromat (φ_F = φ_C) / apochromat (φ_F = φ_d = φ_C). Normalised to max\|D\| = 1, D(550) = 0. Stored as a 64-entry LUT | Glass: Schott/Ohara catalogues |
| Lateral CA | `p + dir · lateral · (r / r_halfdiag)^falloff · D(λ)` (radial, from the optical centre) | — |
| Axial CA | per-wavelength signed CoC offset: `c_λ = c(z) + axial · (D(λ) − D(λ_focus))` | Jeong et al. 2016 (thin lens + chromatic terms) |
| Depth CoC | `c(z) = aperture · (1 − S / z)`, signed (− front, + behind), clamped to ±maxCoC | thin lens |
| Gather | scatter-as-gather: radius R = tile-max\|CoC\| (32 px tiles, ±2 tile dilation) + axial span; each sample weight `cov · profile · R² / c²`, background samples use `min(c_s, c_center)` so they can't bleed over foreground; analytic centre term for ρ < 1 | Jimenez 2014 (CoD post-FX), McGuire |
| Aperture shape | n-gon boundary `cos(π/n) / cos(θ mod 2π/n − π/n)` | — |
| Cat-eye | sample offset's radial component scaled by `1 − k·r²` | optical vignetting |
| Spherochromatism | disk profile `1 + s·(2q² − 1)` (zero-mean), `s = sphero·sign(c) + spheroChroma·D(λ)` → rim vs soft core flips with side of focus *and* varies with wavelength | — |
| 8-bit sources | inverse-Reinhard highlight expansion before, forward after | — |

## AE plugin mapping

- **SmartFX**, 32 bpc + `PF_OutFlag2_FLOAT_COLOR_AWARE`; linearise with the project working space (or require linearised workspace).
- **GPU**: `PF_OutFlag2_SUPPORTS_GPU_RENDER_F32` → the main pass ports to Metal/CUDA/OpenCL nearly verbatim. CPU fallback with the same code via a shared header (ISPC or plain C++ + threads).
- **Passes**: (1) tile-max CoC into a small buffer, (2) main gather. No progressive accumulation in AE: use `samples = 128–256`, jitter off → deterministic frames (important for render farms and frame-to-frame stability). Optionally a temporal-stable blue-noise seed per frame.
- **Depth**: layer parameter (`PF_Param_LAYER`) like Camera Lens Blur. Options: "Z metric (EXR)", "normalised map + near/far", invert. Read focus distance / aperture from the active 3D camera optionally (`AEGP_GetCameraFocusDistance`, `AEGP_GetCameraApertureSize`).
- **Resolution independence**: express all px amounts as fraction of the comp diagonal internally; scale by `in_data->downsample_x/y` for draft previews.
- **Output bounds**: lateral + blur push pixels out of the layer; expand the output rect by `|lateral| + maxCoC` in `PF_Cmd_SMART_PRE_RENDER`.
- **Edge cases**: edge clamp vs transparent; premultiplied alpha → unpremultiply before, re-premultiply after (and blur alpha with the same kernel).

## Parameters (UI) — artist layer on top of the physics

Top level (always visible), each maps to one or two physical terms:

| Artist control | Drives | Notes |
|---|---|---|
| **Look** | sets everything below + glass model | one-click starting points; any edit flips it to "Custom" |
| **Amount** (px) | lateral CA | negative = inverted fringe order; unbounded when typed |
| **Fringe blur** (px) | axial CA spread (scaled by field position, so it respects Clean center) | unbounded when typed ("overcrank") |
| **Preserve detail** | re-inject original luma: `col += (Y_orig − Y_col)·k` | lets huge blur values bloom color without turning the image to mush |
| **Blur shape: round → streak** | tangential PSF squash | radial prism streaks |
| **Clean center** | radial falloff exponent `0.6 + 3.4·k` | |
| **Highlight glow** | inverse-Reinhard expansion | 8-bit sources only; HDR sources already have real highlights |
| **Mix** | linear blend with source (allowed up to 200%) | |
| **Fringe colors** | spectral weights: Natural (CIE) / Shifted (hue-rotated CMFs) / Two-color (artist gradient) | per-channel normalisation keeps neutrals neutral in all modes |
| **Color intensity** | saturation of the spectral weights (0 = colorless spectral blur, >100% = overcrank) | |

"Depth & bokeh" group (collapsed unless a depth source exists): depth layer, focus distance, bokeh size, blades, rotation, cat-eye, rim. "Lens physics" group (collapsed): glass model + curve, sharpest wavelength, falloff offset, spherochromatism, max depth blur, cheap-RGB comparison.

AE conventions to keep: slider range ≠ valid range (`PF_ADD_FLOAT_SLIDERX` with large valid max, small slider max) — that *is* the overcrank mechanism; Looks as a popup that writes params (with `PF_ParamFlag_SUPERVISE`), reset via AE's built-in param reset. Quality popup Draft/Good/Final = 16/48/128 samples (no progressive accumulation in AE).

## Next ideas (from the literature)

1. **Polynomial optics presets** (Hullin, Hanika, Heidrich, EGSR 2012; Schrade et al. 2016, code available): trace real lens prescriptions per λ, fit polynomials → per-lens lateral curve + field-dependent PSF instead of `r^falloff`.
2. **Spatially-varying PSF grid** (Lin/Farrell/Wandell 2014): precompute PSF per (field position, λ, defocus) on a coarse grid, interpolate → coma/astigmatism-shaped fringes.
3. **Layered DOF** for the single-depth-layer occlusion problem (hidden background behind blurred foreground): accept a background plate / deep EXR.
4. **Lens blur fields** (arXiv 2310.11535): learn a real lens' PSF from calibration shots → "match this camera".
