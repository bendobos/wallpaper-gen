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
4. **Normals** — finite differences, at a fixed *world-space* epsilon, plus an
   optional cavity term from the field's concavity.
5. **Environment** — a procedural studio (horizon gradient plus horizontal
   softbox strips, antialiased analytically), or a matcap.
6. **Material** — *Metal* reflects the environment; *Glass* refracts it with a
   per-channel IOR for chromatic dispersion, plus a slope-driven reflective rim.
7. **Grade** — exposure, contrast, black crush, vignette, grain, a highlight
   shoulder, and ordered dithering before the 8-bit write.

The five built-in presets are nothing but parameter sets — no special-case code
sits behind any of them.

Bloom and depth of field are the one exception to "one shader, one pass": above
zero they insert an offscreen HDR chain between steps 6 and 7. See
[Bloom and depth of field](#bloom-and-depth-of-field).

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
| **Environment** | The single biggest change to *what* is being reflected, rather than to the shape reflecting it. |
| **Cavity** | The only thing here that darkens rather than lights. Creases stop reading as painted-on. |
| **Noise Basis** | Changes the topology itself, not the treatment of it — the one control that makes a genuinely unrelated image. |
| **Curl Flow** | The fix for motion that churns instead of flowing. |
| **Bloom Threshold** | Reflective surfaces run well past 1.0, so values above 1 still leave plenty glowing. |
| **Focus Height** | The height field sits near 0.5; setting this near either end puts nothing in focus. |

Every parameter is defined once in [`src/params/schema.ts`](src/params/schema.ts),
which drives both the control panel and the uniform upload — adding a slider is
a one-line change.

**? Guide** (`H`) opens the same material as an in-app overlay:
[`src/ui/GuideDialog.tsx`](src/ui/GuideDialog.tsx) carries quality notes, ten
effect recipes, workflow and the shortcut list. A recipe is a `Partial<Params>`
patch applied *on top of* the current look rather than a preset replacing it,
and the settings listed under each one are rendered from that patch through
`SCHEMA_BY_KEY` — so the text cannot drift from what Apply writes, and it names
each setting the way whichever panel you are in names it.

## Simple and Expert

The panel header switches between two views of the same schema.

**Expert** is the full set: 69 controls under the eight groups above, which
follow the render pipeline. **Simple** is 21 of them under four plain-language
sections — Pattern, Color, Light & Material, Finish — with the jargon renamed
(*Warp Strength* → **Swirl**, *Scale* → **Pattern Size**, *Roughness* →
**Polish**) and every section open, since there is little enough to show whole.

Simple filters, it never remaps: each row writes exactly the parameter it writes
in Expert, so switching modes cannot change the image and nothing is reset. The
controls left out are the ones that are inert on their own — `ior` and
`dispersion` do nothing outside Glass, `bloomThreshold` does nothing at zero
Bloom — plus the fine-tuning axes (`gain`, `lacunarity`, `anisotropy`, …).

Presets, Randomize and shared links keep setting the full parameter set in
either mode, so a Simple panel is never the whole story. It says so in a footer
rather than pretending otherwise.

A control joins Simple by declaring a `simple` block in the schema — section,
label, and a hint written for someone who has not read this file:

```ts
{ kind: 'slider', key: 'warp', label: 'Warp Strength', group: 'Flow', …
  simple: { section: 'Pattern', label: 'Swirl',
    hint: 'How much the pattern folds into itself.' } },
```

The chosen mode persists to `localStorage` and is deliberately **not** part of
`Params`: it belongs to the person, not to the look, so it neither travels in a
share link nor gets overwritten by opening one.

## Composition shapes

**Shape** confines the liquid to a circle, rounded square, arch, band or blob
and flattens the rest to background — the difference between a texture swatch
and an image.

The mask is applied **inside `heightAt`**, not as a multiply on the output
colour. That is the whole trick, and it is worth being precise about why:

- Outside the shape the height goes constant. A constant height has zero
  gradient, so the normal points straight back at the viewer and the surface
  reflects a single patch of environment. That reads as a backdrop rather than
  as a hole punched in the image.
- `surfaceNormal` samples `heightAt` at offsets, so it sees the mask too. The
  transition band therefore gets a real height gradient and the edge rounds off
  like a poured rim. Masking the colour instead would give a flat cut-out with
  a hard edge and no lighting on it at all.

The shape lives in **world space**, so Pan, Zoom and Rotation position and size
it — three controls that already exist, rather than a second placement system
beside them. It is evaluated on the raw world point rather than the
flow-transformed one, so Stretch and Flow Angle skew the liquid *inside* the
shape without skewing the shape itself.

Note that the background is a flat mirror, so it reflects whatever the
environment is: with the procedural studio you will see its softbox strips as
soft horizontal bands. Softbox Count, Key Intensity and Background all shape
it, and a matcap replaces it wholesale.

## Shape vocabulary

Every image used to be fbm plus domain warp. Two controls widen that.

**Noise Basis** switches the final height evaluation between gradient noise,
Worley F1 (rounded cells with hard boundaries) and Worley F2−F1 (the thin walls
between them — cracks and veins, a topology gradient noise cannot produce
because it has no notion of a boundary).

Only the *final* evaluation switches. The domain warp stays on gradient noise
deliberately: it wants a smooth field, and routing four more cellular
evaluations through the warp loop would multiply the most expensive part of the
shader by the warp iteration count.

**Curl Flow** advects the field along a divergence-free displacement — the curl
of a scalar potential, `(dF/dy, −dF/dx)`. Domain warp folds the field into
itself but never transports it, which is why the README used to concede the
animation reads as churning; advection gives the streakline structure of a
fluid instead. The potential is the same `fbm`, so it inherits the closed-orbit
motion model and the loop still closes exactly — verified byte-identical at
phase 0 and phase 1.

Both cost almost nothing: at 4K with 8 octaves and 3 warp iterations, gradient
is 72 ms, cellular 73 ms, curl 65 ms. Worley is roughly twice a gradient
evaluation, but it runs once against the warp's many, so it disappears into the
noise.

## Shader variants

Optional shader features are `#ifdef`-ed out and the liquid shader is compiled
once per feature set, lazily, keyed on the defines.

This is not premature optimisation — it is the only way the guarantee below
holds. A runtime `if` is not enough: adding an *unreachable* call to `heightAt`
was measured to shift output by one 8-bit level on 0.28% of subpixels, because
the driver schedules the reachable calls differently once the function has more
callers. `#ifdef` removes the code entirely, so the no-feature variant is
textually the shader that has always run.

The cost is one compile the first time a feature is switched on: ~6 ms warm,
up to ~1 s the very first time on a machine, after which the driver's own shader
cache takes over. Nobody pays for a feature they never enable.

Three features use it — Cavity, the cellular basis and curl advection — and it
is the same mechanism that keeps bloom's chain unbuilt at zero. Each one adds
call sites to `heightAt` or `fbm`, which is exactly the trigger.

## Cavity

Nothing in this generator was ever shadowed — every surface only got brighter or
dimmer *by reflection* — which is the main reason a heavily crumpled surface
still read as flat. **Cavity** darkens concave regions.

It compares a point's height against the mean of a ring around it: higher
neighbours mean a crease. Three samples at 120°, not four on the axes, because
that is the cheapest arrangement whose first-order terms cancel exactly (three
unit vectors at 120° sum to zero) while the second-order term stays isotropic —
a two-sample version would miss every crease running parallel to its axis.

The ring radius is a quarter of a feature, far wider than the normal's epsilon.
That is not a stylistic choice: the height difference this measures scales with
the *square* of the radius, so a ring at the normal's 0.0015 world units reports
a few parts in 100000, which is mostly floating-point cancellation noise with no
usable threshold above it. The first attempt used a narrow ring and produced a
control that did nothing at any setting.

Occlusion scales the environment reflection and the ambient fill, never the rim
— the rim is a slope term whose whole job is to light creases up.

Cost depends entirely on how expensive `heightAt` already is, because Cavity
triples the number of times it runs. On the default preset (4 octaves, 2 warp
iterations) that is 56 → 59 ms at 4K, about +5%, because the pass is nowhere
near shader-bound. On a heavy one (8 octaves, 3 warp iterations) it is 72 →
145 ms — the full 2× the arithmetic predicts. Quote the second number, not the
first.

## Brushed metal

**Brushed** squashes the Micro Detail noise into parallel striations, so a
highlight crossing them smears out instead of pooling. It shapes that noise
rather than adding its own, so Micro Detail has to be above zero.

Both axes are scaled, by `s` and `1/s`, rather than one of them alone. Scaling a
single axis raises the peak frequency with it, and the striations alias into
speckle long before they are fine enough to read as a grain — which is exactly
what the first version did. Keeping the geometric-mean frequency fixed makes
Brushed change the character of the perturbation without changing how much of it
lands above Nyquist.

The gradient is transformed back to world axes afterwards (scale, then the
transposed rotation). Skip that and the striations are *drawn* in one direction
but *perturb* in another, and the highlight never stretches at all.

One thing that looks like a bug and is not: at 90° over the procedural
environment the grain nearly vanishes. Measured across the frame, the striations
are there and correctly oriented — contrast across x of 28.2 against 1.2 across
y — but the procedural environment varies only with height, so a vertical grain
has no structure to sweep. It shows against a matcap with horizontal structure.

## Environments

The procedural studio varies only with the reflected direction's *height*, which
is why every metal look built on it is a relative of every other one — there is
simply not much to reflect. **Environment** switches that for a **matcap**: a
painted lit sphere, indexed by the view-space normal, which can have structure
and colour in two dimensions.

Four are built in — Studio, Sunset, Neon City, Soft Tent — and they are
*generated*, not shipped: [`src/params/matcaps.ts`](src/params/matcaps.ts) paints
each one with canvas 2D on selection and caches it. That costs a couple of
milliseconds and zero bundle bytes, against ~40 KB an asset for images that only
ever appear smeared across a warped surface.

Two details make them work:

- The image is stored in display range, and 8 bits cannot hold a specular. The
  shader cubes it and scales by 3, restoring a range comparable to the
  procedural environment's — deep falloff, cores well past 1.0. The matcaps are
  painted to suit that curve, with additive light sources whose cores clip.
- A near-flat surface only reflects directions close to straight ahead, so it
  only ever samples the middle of the disc. The shader scales the direction by
  1.1 before mapping it, which puts the rim of the matcap at exactly the slope
  `slopeTerm()` already treats as the steepest the height field produces.
  Without it, low Relief would sample a coin-sized patch and every matcap would
  read as one flat colour. It is also why the built-ins keep their interesting
  content near the centre.

The key light stays live over a matcap — the image brings soft sources but no
directional key. **Env Contrast** has no strips to widen in this mode, so it
becomes a gamma on the image instead, normalised to be neutral at its own
default. **Softbox Count** stays procedural-only and its hint says so.

**Roughness** picks a mip level. The chain is pre-blurred on the CPU rather than
left to `generateMipmap`, and band-limited at full resolution *before*
downscaling — `ctx.filter` applies in destination space, so blurring as part of
the downscale only softens aliasing that has already happened and leaves the
small levels blocky, which Roughness then magnifies back to full frame. Each
level is drawn overscanned by ~3σ so the blur has colour to pull from beyond the
frame instead of transparent black, which would darken the rim the steepest
slopes reflect.

Expect this to look weaker than it is on a high-frequency surface. Roughness
blurs what is *reflected*, but most of the apparent sharpness in these images
comes from the normals sweeping the environment, and blurring an environment
cannot blur geometry. On a smooth surface the response is clean and monotonic
(local detail 2.46 → 0.51 across the range); on a crumpled one it mostly shows
at the top of the slider, where the matcap collapses toward a single colour.

**Custom** takes any image (a real matcap, or a photo, loosely) and scales it to
256×256. Its limitation is real and stated in the panel: **a custom matcap
cannot travel in a share link.** Built-ins serialise by id; an uploaded image
has nowhere to go in a URL hash, so a link made with one falls back to the
procedural environment. The renderer enforces that in one place, so the preview,
thumbnails, stills and video all degrade identically.

## Bloom and depth of field

Both default to zero, and at zero **the renderer does not change at all** — the
single direct pass still runs, and every image this app has ever produced still
comes out byte-identical. Above zero, either one routes the frame through:

```
liquid.frag     → RGBA16F scene, HDR, circle of confusion in alpha
downsample.frag ×3 → ½, ¼, ⅛ blur chain (13-tap)
blur.frag       ×2 → directional smear of the ⅛ level, for streaks
post.frag       → scene + bloom + streak + DoF + lens, then the grade, to 8-bit
```

The grade itself lives in [`grade.glsl`](src/gl/shaders/grade.glsl) and is
included by *both* shaders, so there is exactly one copy of it and the two paths
cannot drift apart.

### Why one chain serves both

Thresholding *after* a blur normally loses thin bright features, because their
blurred average falls back under the threshold — which is why bloom usually gets
a chain of its own. It works here because the chain is built from genuine HDR: a
one-pixel specular filament at 8.0 still averages well past a threshold of 0.8
after halving, and thin bright filaments are most of what these images contain.
So bloom sums a soft-knee threshold of the three levels, and depth of field
walks up the same three as the circle of confusion grows.

### Depth from height

There is no depth buffer, so **surface height is the depth**. That is not a
compromise so much as the more useful control: Focus Height picks a height to
keep sharp — 0 the troughs, 1 the crests — and everything away from it softens.
Focusing a plane would mean focusing something nothing in the image lies on.

Note that the height field is centred near 0.5 by the crease sigmoid, so a Focus
Height near either end puts nothing in focus and simply blurs the frame.

## Lens

Four optical effects sharing the chain bloom already builds. Any of them above
zero engages it; all at rest and the direct pass runs untouched.

- **Chromatic aberration** reads the three channels at slightly different radii.
  Measured: red-minus-blue at the frame edge goes 0 → 49 while the centre stays
  at 2, which is the behaviour a real lens has and a uniform tint does not.
- **Lens distortion** remaps the scene fetch radially, aspect-corrected so it
  stays circular on a phone frame. The grade is deliberately left anchored to
  the frame — a vignette that bulged with the image would read as a mistake.
  Barrel pulls the corners in from outside the scene target, where
  `CLAMP_TO_EDGE` smears the border pixel; that is why the slider stops at 0.4.
- **Anamorphic streak** smears highlights along one axis, from the smallest
  chain level through two passes of `blur.frag` into a ping-pong pair.
- **Glow Tint** colours bloom and streak together. Warm gives halation, cool
  gives the anamorphic blue — one control instead of two systems.

### Two things the streak got wrong first

The two blur passes use tap spacings differing by exactly 9×, so the second
steps past the first's whole nine-tap span and the first fills the gaps the
second would otherwise leave as discrete blobs.

The reach was originally expressed in *texels of the ⅛ chain level*. That is a
resolution-dependence bug of exactly the kind the world-space epsilon in
`liquid.frag` exists to avoid: the level scales with the render, so an 8K export
would have come out with a streak an eighth as long as its own preview. It is a
fraction of frame height now, and holds to within 17% across a 4× change of
render size.

The first working version then reached 56% of the frame per side, which is not a
streak but a full-frame average — it measured as a flat haze with no direction
at all. 22% is the setting that reads as a lens.

### Memory

An RGBA16F scene is 8 bytes per pixel against 4 for the RGBA8 the direct path
uses. At 8K with 2× supersampling that is 15360×8640×8 ≈ 1.06 GB before the
chain, so `planSsaa()` reduces the factor until the whole thing fits under
~600 MB and the export dialog says which limit it hit — the GPU's texture size,
or this. 8K falls to 1×; 4K at 2× is unaffected.

`RG11B10F` would be 4 bytes and avoid the cap, but it has no alpha channel to
carry the circle of confusion.

### Cost

At preview resolution the chain is free (both paths sit on the 120 fps vsync cap
on an RTX 4090). A 4K still at 2× with both effects on takes ~0.23 s, against
~0.26 s without — the chain is a dozen texture fetches per pixel against the
liquid shader's hundreds of noise evaluations, which is also why it is the one
part of a large export that is *not* split into scissored bands.

## Workflow

**Batch export** renders the current look at every selected resolution and
delivers one ZIP. One archive rather than N downloads because browsers throttle
or silently block repeated automatic downloads, and a folder of wallpapers is
what you wanted anyway. Supersampling is planned per size, so an 8K entry can
quietly use a lower factor than a phone one in the same archive.

[`zip.ts`](src/params/zip.ts) writes the container by hand, store method only —
about seventy lines with no dependency. Compression would be pointless: every
file going in is already a PNG, JPEG or WebP.

**Palette from an image** builds a ramp from a photo's colours by median cut.
Deterministic, unlike k-means, so the same picture always gives the same ramp,
and the result is a plain gradient string that travels in a share link like any
other parameter.

The ends are anchored to the image's actual extremes *before* quantising, which
is not an embellishment — median cut splits a box at its median pixel, so an
image that is 94% mid-tone splits into two mid-tone halves and a small highlight
stays buried however many colours you ask for. Measured on exactly that image
the palette came back as three copies of the same brown with both ends lost.
Choosing which box to split differently does not help; the median is the
problem, not the selection. Anchors are averaged over the darkest and brightest
2% so a single stuck pixel cannot set the end of a ramp.

**Keep shelf** pins looks worth returning to. Undo is a single linear stack, so
a good result found two experiments ago is otherwise gone. Capped at 40 entries
— localStorage is a ~5 MB budget shared with saved presets, and each thumbnail
is about 8 KB.

## Export

Renders into an offscreen framebuffer at `size × supersampling`, box-filters it
down in a resolve pass, then reads it back to a PNG/JPEG/WebP download.

- Supersampling is reduced automatically if `size × factor` would exceed the
  GPU's maximum texture size — or the post chain's memory budget, when bloom or
  depth of field is on — and the dialog says which, rather than degrading
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
takes. The preview has its own loop duration next to the Play button, in the
same unit, which does not affect the file. **Motion** controls how
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
- The last state, any saved presets and the Simple/Expert choice persist to
  `localStorage`. Only the parameters go into the hash.
- **Randomize** samples only parameters that declare a narrower random band in
  the schema, so results stay usable. Colours are left alone deliberately.

## Shortcuts

`Space` play/pause · `R` randomize · `S` new seed · `V` variations · `K` keep ·
`E` export · `H` guide · `F` fullscreen · `Esc` close / leave fullscreen ·
`Ctrl+Z` undo

Fullscreen hides the panel and gives the preview the whole screen, still
letterboxed to the export aspect — so a portrait phone wallpaper previews
edge-to-edge on a phone. It requests native fullscreen where that exists and
falls back to a full-viewport overlay where it doesn't (iPhone Safari has no
`requestFullscreen` on elements). The toolbar fades while idle and returns on
any pointer activity.

## Layout

```
src/
  gl/          renderer, GL helpers, GLSL (with a small #include resolver)
                 liquid.frag    shading, palette, exposure
                 grade.glsl     the grade, shared by the two output paths
                 downsample.frag / blur.frag / post.frag   the lens chain
                 resolve.frag   supersampling box filter
  params/      schema (single source of truth), presets, gradients, matcaps,
               palette extraction, zip writer, serialisation, resolutions
  ui/          control panel, param rows, preset bar, export dialog, variations,
               keep shelf, guide overlay
  App.tsx      layout, render loop, undo, shortcuts
```

`ControlPanel` takes an `extras` map so a group can hold a row that is not a
single serialisable value — the custom-matcap picker, the "no float targets"
warning — without inventing a schema kind for each of them. The map is keyed by
group *or* Simple section, so those rows appear in whichever panel holds the
control they belong to.
