# Research: what chromatic aberration actually is

## 1. The physics

Glass refracts short wavelengths (blue) more strongly than long ones (red); this is dispersion. Two separate effects come from it.

### Lateral (transverse) CA: magnification depends on wavelength
- Each wavelength forms an image at a slightly different scale, so colors separate **radially** from the optical center.
- It's zero at the center and grows toward the edges, usually faster than linearly. Real lenses have distortion-like higher-order terms (r³, r⁵), so it's not a plain scale.
- Light is a **continuous spectrum**: a white edge smears into a continuous fringe, not three discrete copies.

### Axial (longitudinal) CA: focus distance depends on wavelength
- Only one wavelength is in perfect focus. Every other wavelength is defocused by an amount that grows with its distance in wavelength from the focused one.
- It happens everywhere, including the frame center.
- It produces purple/green fringing on high-contrast edges and color-edged bokeh.
- **With depth:** objects in front of the focus plane fringe one color, objects behind fringe the opposite color (the classic magenta-foreground / green-background "bokeh fringing").

### Secondary spectrum
Most real lenses are **achromats**: two glasses chosen so red and blue meet at a common focus. Green is left over, so real fringes are often **green/magenta**, not red/cyan. Apochromats bring three wavelengths together and leave a tiny, wavy residual.

### Spherochromatism
Spherical aberration itself varies with wavelength. A bokeh disc's rim (hard ring vs. soft edge) and the rim's color depend on which side of focus it's on *and* on the wavelength.

### It's a light effect
Fringes are strongest around very bright highlights (sky through branches, specular glints), because those are far brighter than display white. CA has to be computed in **linear light with highlights above 1.0**. In gamma-encoded 8-bit, a bright window fringes as weakly as a grey edge.

## 2. Why the naive version looks cheap

It's mostly *not* the scaling geometry. It's these things together:
1. Three hard copies (R, G, B) instead of a continuous spectrum
2. No axial blur: fringes are razor-sharp
3. Computed in gamma space, with no highlight energy
4. Red/cyan instead of the green/magenta of real (achromatic) lenses
5. Same everywhere, regardless of depth

## 3. Literature

Found via searches on 2026-11-11. Mostly checked from abstracts and summaries only; read the full papers before quoting exact formulas.

| Paper | Relevance |
|---|---|
| **Jeong, Lee, Kwon, Lee: "Expressive chromatic accumulation buffering for defocus blur"**, *The Visual Computer* 32(6-8), 2016. DOI 10.1007/s00371-016-1244-x | **Closest fit.** Adds axial and lateral chromatic terms to the simple-lens depth-of-field model, with explicit artist control past physical limits. The depth-aware model here is based on it. |
| Lee, Eisemann, Seidel: "Real-time lens blur effects and focus control", SIGGRAPH 2010 (TOG 29) | Predecessor: real-time lens blur that includes aberrations |
| Hullin, Hanika, Heidrich: **"Polynomial Optics"**, EGSR 2012; sparse/wide-angle extension, KIT 2016 (with code) | A per-wavelength polynomial maps where light enters the lens to where it lands on the sensor. Fit it to real lens designs (from patents) → "real lens" presets. **Best candidate for a distinctive feature.** |
| Hullin, Eisemann, Seidel, Lee: "Physically-Based Real-Time Lens Flare Rendering", SIGGRAPH 2011 | Chromatic aberration in flares and ghost reflections; possible future companion feature |
| Lin, Farrell, Wandell, OSA 2014; MathWorks "spatially variant PSF" example | PSFs computed per wavelength on a coarse field grid and interpolated. Gives comet-shaped, asymmetric off-axis fringes that a disk blur can't. |
| "Lens blur fields", arXiv 2310.11535 (2023); DeepLens toolkit | A small neural network learns a lens's PSF, including CA, from position, focus and depth. "Match this camera" from calibration photos. Heavy. |
| Steinert et al., spectral camera-lens simulation (CGF 2011); Hanika & Dachsbacher, Eurographics 2014 *(from memory, not checked)* | Ground truth from tracing every ray through every wavelength; useful as reference images |
| Wyman, Sloan, Shirley, JCGT 2013 | Analytic fit of the CIE 1931 color-matching curves; used for the spectral weights |
| Jimenez, "Next Generation Post Processing in Call of Duty: AW", SIGGRAPH 2014 course | Depth of field done as scatter-as-gather with tile-max CoC; used for the depth-aware gather |

Adjacent (capture-side, not rendering): Cossairt "Spectral Focal Sweep" (ICCP 2010), "Depth from Spectral Defocus Blur" (ICIP 2019), "Spectrum from Defocus" (arXiv 2503.20184).

Sources:
- https://dblp.org/rec/journals/vc/JeongLK016
- https://graphics.tudelft.nl/Publications-new/2010/LES10a
- https://www.cs.ubc.ca/labs/imager/tr/2012/PolynomialOptics/
- https://cg.ivd.kit.edu/publications/2016/lens_sparse_poly/2016_optics.pdf
- https://resources.mpi-inf.mpg.de/lensflareRendering
- https://web.stanford.edu/~jefarrel/Publications//2010s/LinFarrelWandell_OSA2014.pdf
- https://www.mathworks.com/help/images/simulate-image-using-spatially-variant-psf.html
- https://ben-steinert.net/content/01-blog/05-eurographics/lens_sim_paper.pdf
- https://arxiv.org/pdf/2310.11535v2.pdf
- https://github.com/AI4Optics/DeepLens
- https://cave.cs.columbia.edu/old/publications/pdfs/Cossairt_ICCP10.pdf

## 4. Depth maps / 3D renders

Yes, it works, and it makes the effect much more realistic:
- **Lateral CA** is a property of the image plane, so it's independent of depth.
- **Axial CA** becomes depth-dependent. Signed CoC per wavelength: `c_λ(z) = A·(1 − S/z) + axial·(D(λ) − D(λ_focus))`. Front vs. behind focus get opposite fringe colors, which no flat filter can do.
- **HDR renders (32-bit EXR)** carry real highlight energy, so no highlight-expansion workaround is needed.

Catches (the usual problems with depth of field done in post):
- **One depth layer:** nothing is known behind foreground objects, so blurred foreground edges either smear or leave halos. Mitigated by depth-compared gathering; truly fixed only by a background plate or deep EXR.
- **Antialiased depth edges:** render Z without antialiasing and dilate it.
- **Camera match:** needs focus distance and aperture in real units (or read them from the AE 3D camera).

## 5. Verification results

- No errors in the browser console; no NaN or black pixels in the accumulation buffer (1920×1080 HDR scene).
- **Front/behind color flip** (white dot, flat depth, focus at 5 m, achromat curve, axial 6 px). RGB ratios at the bokeh edge:
  - Behind focus (z = 20 m): edge ≈ (0.34, 0.00, 2.66) → blue/violet fringe
  - In front (z = 2.6 m): edge ≈ (1.23, 1.58, 0.18) → yellow-green fringe
- Neutral grey ramp stays neutral (per-channel normalization of the spectral weights).
- Overcranked fringe blur (120 px) with *Preserve detail* 85%: the image stays sharp and only the color blooms.
