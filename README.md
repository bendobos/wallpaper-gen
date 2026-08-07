# Liquid — Wallpaper Generator

Browser app that procedurally generates abstract *liquid metal* and *liquid glass*
imagery and exports it as a wallpaper at any resolution.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` produces a static `dist/` that
can be hosted anywhere — there is no backend.

## How it works

Every image is a **warped height field lit as a reflective surface**, drawn by a
single WebGL2 fragment shader over one fullscreen triangle. There is no 3D
engine, no scene, and no texture assets: the environment the surface reflects is
generated analytically.

The pipeline, in [`src/gl/shaders/liquid.frag`](src/gl/shaders/liquid.frag):

1. **Height field** — fractal gradient noise, seeded from `Seed`.
2. **Domain warp** — the field is folded into itself 1–4 times. This is the
   control that turns noise into poured-liquid topology.
3. **Ridge & crease** — folds and sharpens the field into hard creases.
4. **Normals** — finite differences, at a fixed *world-space* epsilon.
5. **Environment** — a procedural studio: horizon gradient plus horizontal
   softbox strips, antialiased analytically.
6. **Material** — *Metal* reflects the environment; *Glass* refracts it with a
   per-channel IOR for chromatic dispersion, plus a slope-driven reflective rim.
7. **Grade** — exposure, contrast, black crush, vignette, grain, a highlight
   shoulder, and ordered dithering before the 8-bit write.

The five built-in presets are nothing but parameter sets — no special-case code
sits behind any of them.

### Resolution independence

World space is normalised by frame *height* only, and the normal epsilon is
fixed in world units rather than pixels. The same parameters therefore produce
the same image at 1080p and at 8K, just sampled more finely — verified at a mean
absolute difference of ~1% (resampling noise) between a 480×270 render and a
1920×1080 render downscaled to match.

The preview is letterboxed to the selected export aspect ratio, so the framing
you see is the framing you get.

## Controls worth knowing

| Control | Why it matters |
| --- | --- |
| **Warp Strength** | The single most important shape control. |
| **Detail Gain** | At `gain = 1/lacunarity` every octave contributes equally to the *gradient* and the surface reads as crumpled foil. Below that it reads as poured liquid. |
| **Relief** | Surface slope. Fresnel and rim terms key off slope, so very low Relief leaves a flat surface reflecting one patch of sky. |
| **Thickness** (Glass) | Darkens the interior. Dispersion fringes only read against a dark interior. |
| **Softbox Count** / **Roughness** | Dispersion needs a finely structured environment; a smooth gradient produces no colour separation. |
| **Black Level** | How the high-contrast filament look gets its large black field. |

Every parameter is defined once in [`src/params/schema.ts`](src/params/schema.ts),
which drives both the control panel and the uniform upload — adding a slider is
a one-line change.

## Export

Renders into an offscreen framebuffer at `size × supersampling`, box-filters it
down in a resolve pass, then reads it back to a PNG/JPEG/WebP download.

- Supersampling is reduced automatically if `size × factor` would exceed the
  GPU's maximum texture size, and the dialog says so rather than degrading
  silently.
- Large renders are drawn in scissored horizontal bands across several frames.
  A single multi-second draw call risks a GPU watchdog reset and a lost context,
  which 8K at 2× would otherwise invite.
- Output is deterministic: the same seed, parameters, and phase give
  byte-identical pixels. Grain is seeded by position, never by time.

Reference timings (RTX 4090): 4K at 2× ≈ 0.26 s, 8K at 2× ≈ 0.93 s.

## Looping video export (Android live wallpaper)

The **Video** tab renders the animation as a **seamlessly looping** MP4 (H.264)
or WebM (VP9), encoded frame-by-frame with WebCodecs — not a real-time screen
capture, so no frames are dropped and the result is deterministic.

**Android cannot set a video as wallpaper by itself.** Export the file, copy it
to the phone, and point a live-wallpaper app at it (Samsung devices have this
built in for the lock screen). Match the export resolution to the phone's screen,
and expect a looping video wallpaper to cost battery.

### How the loop is seamless

Each noise octave travels a **closed orbit** rather than drifting in a straight
line, making the animation periodic with a period of exactly 1.0 in `Phase`. A
field that keeps translating never returns to its start and can never loop.

Three details make this work:

- The orbit is **anchored at phase 0** (`cos(w) - 1.0`), so still images are
  completely unaffected by the motion model — all five presets render
  pixel-identically to before this feature existed.
- Octaves orbit at **harmonic rates** (1×, 2×, 3×), which keeps the period at
  1.0 while avoiding the back-and-forth sway that gives looped procedural noise
  away.
- `fract()` wraps the angle before scaling to radians, so `cos`/`sin` never lose
  mantissa bits on a large argument and the loop closes *exactly* — phase 0 and
  phase 1 are byte-identical.

The clip contains exactly one loop; **Loop duration** sets how long that loop
takes. The Speed slider affects only the live preview. **Motion** controls how
far the field travels over a loop.

Trade-off: motion reads as churning rather than directional flow. That is
inherent to any seamless loop.

### Notes

- Dimensions are rounded down to even numbers (H.264 yuv420 requires it), and
  the dialog says so. The iPhone 15/16 Pro preset becomes 1178×2556.
- Codec strings are probed with `VideoEncoder.isConfigSupported` rather than
  hardcoded, so unusual resolutions fall back to a supported level.
- Prefer MP4: its duration metadata is exact, while the WebM muxer reports
  duration one frame short.
- Reference timing (RTX 4090): 1440×3120, 6 s, 30 fps, 1× → ~2 s, ~23 MB.
  Integrated graphics will be much slower; the render can be cancelled.

## State

- The full parameter set is encoded into the URL hash, so any look is shareable
  and restorable. **⧉ Link** copies it.
- The last state and any saved presets persist to `localStorage`.
- **Randomize** samples only parameters that declare a narrower random band in
  the schema, so results stay usable. Colours are left alone deliberately.

## Shortcuts

`Space` play/pause · `R` randomize · `S` new seed · `E` export · `Ctrl+Z` undo

## Layout

```
src/
  gl/          renderer, GL helpers, GLSL (with a small #include resolver)
  params/      schema (single source of truth), presets, serialisation, resolutions
  ui/          control panel, param rows, preset bar, export dialog
  App.tsx      layout, render loop, undo, shortcuts
```
