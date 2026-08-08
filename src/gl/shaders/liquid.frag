#version 300 es
precision highp float;

#include "common.glsl"

out vec4 fragColor;

// --------------------------------------------------------------- uniforms --
uniform vec2  uResolution;
uniform float uTime;
uniform float uDither;      // 1 when writing straight to an 8-bit target
uniform float uPostChain;   // 1 when the grade is deferred to post.frag

// composition
uniform float uSeed;
uniform float uZoom;
uniform float uPanX;
uniform float uPanY;
uniform float uRotation;    // degrees

// flow
uniform float uScale;
uniform float uWarp;
uniform float uWarpIters;
uniform float uOctaves;
uniform float uGain;
uniform float uLacunarity;
uniform float uAnisotropy;
uniform float uFlowAngle;   // degrees
uniform float uRidge;
uniform float uMotion;      // orbit radius of the per-octave animation
#ifdef FEAT_CELLULAR
uniform float uNoiseBasis;  // 1 = cellular F1, 2 = cellular F2-F1
#endif
#ifdef FEAT_CURL
uniform float uCurl;
uniform float uCurlScale;
#endif
#ifdef FEAT_SHAPE
uniform float uShape;       // 1 circle, 2 rounded square, 3 arch, 4 band, 5 blob
uniform float uShapeSize;
uniform float uShapeEdge;
uniform float uShapeInvert;
#endif

// surface
uniform float uRelief;
uniform float uMicroDetail;
uniform float uCrease;
uniform float uCavity;      // occlusion in concave regions
uniform float uCavityRange; // height difference that counts as a full crease
uniform float uBrush;       // anisotropy of the micro detail
uniform float uBrushAngle;  // degrees

// material
uniform float uMaterial;    // 0 = metal, 1 = glass
uniform float uReflect;
uniform float uRoughness;
uniform float uIOR;
uniform float uDispersion;
uniform float uThickness;
uniform float uRimWidth;
uniform float uRimIntensity;

// lighting
uniform float uLightAngle;  // degrees
uniform float uLightElev;   // degrees
uniform float uKey;
uniform float uEnvBands;
uniform float uEnvContrast;
uniform float uAmbient;
uniform float uEnvMode;     // 0 = procedural studio, >0 = matcap
uniform sampler2D uMatcap;  // 256x256 lit-sphere image, indexed by the normal

// Highest mip of the matcap chain, i.e. MATCAP_LEVELS - 1 in params/matcaps.ts.
const float MATCAP_MAX_LOD = 6.0;
// The value of Env Contrast at which the matcap is passed through untouched.
const float ENV_CONTRAST_NEUTRAL = 1.3;

// color
uniform float uColorMode;   // 0 = ramp, 1 = direct
uniform sampler2D uRamp;    // 256x1 luminance -> colour lookup
uniform float uIriAmount;
uniform float uIriFreq;
uniform float uHueShift;    // degrees
uniform float uSaturation;

// post
uniform float uExposure;    // stops
uniform float uContrast;
uniform float uBlackLevel;
uniform float uVignette;
uniform float uFalloff;
uniform float uGrain;
uniform vec3  uBackground;

// depth of field — the circle of confusion is written into alpha for post.frag
uniform float uDof;
uniform float uDofFocus;
uniform float uDofRange;

// Reads the uniforms above, so it has to come after them.
#include "grade.glsl"

// ------------------------------------------------------------ height field --

// Per-seed offset into noise space. Derived in the shader so `seed` stays a
// plain scalar parameter with no CPU-side special case.
vec2 seedOffset() {
  return vec2(hash11(uSeed * 0.7371), hash11(uSeed * 0.3119 + 7.7)) * 512.0;
}

float fbm(vec2 p) {
  vec2 so = seedOffset();
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  mat2 m = rot(0.7);   // decorrelates octaves so features don't stack on-axis

  for (int i = 0; i < 8; i++) {
    if (float(i) >= uOctaves) break;

    // Each octave travels a closed orbit rather than drifting in a straight
    // line, which makes uTime periodic with a period of exactly 1.0 — the
    // animation can therefore be exported as a seamless loop. A field that
    // keeps translating never returns to its start and can never loop.
    //
    // The `- 1.0` anchors every orbit at the origin when uTime == 0, so still
    // frames at phase 0 are unaffected by the motion model.
    //
    // Harmonic rates (1x, 2x, 3x) keep the period at 1.0 while stopping the
    // result from reading as a simple back-and-forth sway, which is the usual
    // giveaway of looped procedural noise. The per-octave rotation keeps the
    // shear between layers that makes the surface churn.
    float a = float(i) * 2.3999632;
    float harm = float(1 + (i - (i / 3) * 3));
    // fract() before scaling to radians keeps the angle inside one turn. Without
    // it, cos/sin of a large argument lose mantissa bits and the loop stops
    // closing exactly once the phase has run on for a while.
    float w = TAU * fract(uTime * harm);
    vec2 drift = rot(a) * (uMotion * vec2(cos(w) - 1.0, sin(w)));

    sum += amp * gnoise(p + drift + so);
    norm += amp;

    p = m * p * uLacunarity;
    amp *= uGain;
  }

  return sum / max(norm, 1e-4);
}

#ifdef FEAT_CELLULAR
/**
 * Worley noise over a 3x3 neighbourhood, rescaled to gnoise's rough [-1, 1].
 *
 * F1 gives cells with rounded interiors and hard boundaries; F2 - F1 gives the
 * thin walls between them, which is the cracked-glass and vein topology that
 * gradient noise fundamentally cannot produce — it has no notion of a boundary.
 */
float worley(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      // hash22 spans [-1, 1]; halved and offset it places one feature point
      // anywhere inside the neighbouring cell.
      vec2 point = g + hash22(cell + g) * 0.5 + 0.5;
      float d = length(point - f);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  }

  if (uNoiseBasis > 1.5) return (f2 - f1) * 2.0 - 1.0;
  return 1.0 - f1 * 2.0;
}

/**
 * The octave loop again, over cellular noise.
 *
 * Duplicated rather than parameterised on purpose. Giving `fbm` a basis
 * argument would add a second call site of `gnoise` to the *default* build,
 * and an extra call site alone is enough to make the driver re-associate and
 * shift output — the whole reason these features are compiled in rather than
 * branched around. See fbm() above for why the drift is a closed orbit.
 */
float fbmCellular(vec2 p) {
  vec2 so = seedOffset();
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  mat2 m = rot(0.7);

  for (int i = 0; i < 8; i++) {
    if (float(i) >= uOctaves) break;

    float a = float(i) * 2.3999632;
    float harm = float(1 + (i - (i / 3) * 3));
    float w = TAU * fract(uTime * harm);
    vec2 drift = rot(a) * (uMotion * vec2(cos(w) - 1.0, sin(w)));

    sum += amp * worley(p + drift + so);
    norm += amp;

    p = m * p * uLacunarity;
    amp *= uGain;
  }

  return sum / max(norm, 1e-4);
}
#endif

#ifdef FEAT_CURL
/**
 * Divergence-free displacement: the curl of a scalar potential, `(dF/dy,
 * -dF/dx)`.
 *
 * Domain warp folds the field into itself but never transports it, which is
 * why the animation reads as churning rather than flowing. Advecting along a
 * curl field gives the streakline structure of a fluid — filaments that wrap
 * around vortices instead of kneading in place.
 *
 * Forward differences, so this costs two extra fbm evaluations rather than the
 * four a central difference would. The potential is the same `fbm`, so it
 * inherits the closed-orbit motion model and the loop still closes exactly.
 */
vec2 curlFlow(vec2 p) {
  float e = 0.05;
  float f0 = fbm(p);
  float fx = fbm(p + vec2(e, 0.0));
  float fy = fbm(p + vec2(0.0, e));
  return vec2(fy - f0, -(fx - f0)) / e;
}
#endif

#ifdef FEAT_SHAPE
float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

/**
 * Signed distance to the composition shape, in world space.
 *
 * World space, not screen space, so Pan, Zoom and Rotation move and size it —
 * reusing three controls that already exist instead of growing a second
 * positioning system beside them.
 *
 * Evaluated on the raw `p` rather than on the flow-transformed `q`, so Stretch
 * and Flow Angle skew the liquid inside the shape without skewing the shape
 * itself.
 */
float shapeDistance(vec2 p) {
  float r = max(uShapeSize, 0.01);

  if (uShape < 1.5) return length(p) - r;
  if (uShape < 2.5) return sdRoundedBox(p, vec2(r), r * 0.28);
  if (uShape < 3.5) {
    // A column with a semicircular top: the poster arch.
    float column = sdRoundedBox(p + vec2(0.0, r), vec2(r, r), 0.0);
    return min(column, length(p) - r);
  }
  if (uShape < 4.5) return abs(p.y) - r;

  // Blob: a circle whose radius wobbles with angle. Two harmonics read as
  // organic; more starts to look like a gear.
  float a = atan(p.y, p.x);
  float wob = 0.14 * sin(a * 3.0 + uSeed) + 0.09 * sin(a * 5.0 - uSeed * 0.7);
  return length(p) - r * (1.0 + wob);
}
#endif

// The surface height at a point in world space. Everything about the shape
// lives here: anisotropic stretch, domain warp, ridging, crease contrast.
float heightAt(vec2 p) {
  vec2 q = rot(radians(uFlowAngle)) * p;
  q.y *= uAnisotropy;
  q *= uScale;

  // Domain warp. This is the parameter that turns bland noise into the folded,
  // poured-liquid topology; iterating it compounds the folding.
  vec2 w = q;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uWarpIters) break;
    float fi = float(i);
    vec2 o = vec2(
      fbm(w + vec2(0.0, 0.0) + fi * 17.3),
      fbm(w + vec2(5.2, 1.3) + fi * 11.7)
    );
    w += uWarp * o;
  }

#ifdef FEAT_CURL
  // Advection comes after the warp: the warp decides the topology, this
  // transports it.
  w += uCurl * curlFlow(w * uCurlScale) * 0.1;
#endif

#ifdef FEAT_CELLULAR
  // Only the final evaluation switches basis. The warp above stays on gradient
  // noise deliberately — it wants a smooth field, and running four more
  // cellular evaluations through the warp loop would multiply the cost of the
  // most expensive part of the shader by the warp iteration count.
  float h = fbmCellular(w) * 0.5 + 0.5;
#else
  float h = fbm(w) * 0.5 + 0.5;
#endif

  // Ridging folds the field back on itself at the midpoint, producing the hard
  // creases of polished chrome instead of soft dunes.
  h = mix(h, 1.0 - abs(2.0 * h - 1.0), uRidge);

  // Saturating contrast around 0.5. Softer than a clamp, which would flatten
  // regions to a constant and kill their normals.
  float s = (h - 0.5) * mix(1.0, 5.0, uCrease);
  h = 0.5 + 0.5 * s / (1.0 + abs(s));

#ifdef FEAT_SHAPE
  float m = 1.0 - smoothstep(-max(uShapeEdge, 0.001), 0.0, shapeDistance(p));
  if (uShapeInvert > 0.5) m = 1.0 - m;
  // Flattening the height outside the shape is the whole trick. A constant
  // height has zero gradient, so the normal points straight back at the viewer
  // and reflects one patch of environment — which reads as background rather
  // than as a hole. And because this happens inside heightAt, surfaceNormal's
  // offset samples see it too, so the transition band gets real normals and
  // the edge rounds off like a poured rim. Masking the output colour instead
  // would give a flat cut-out with a hard edge.
  h = mix(0.5, h, m);
#endif

  return h;
}

// Finite-difference normal. The epsilon is fixed in *world* space (scaled by
// uScale so it tracks feature size), never in pixels — a pixel-sized epsilon
// would make an 8K export sharper than its own preview.
vec3 surfaceNormal(vec2 p, float h0, out float cavity) {
  float e = 0.0015 / max(uScale, 0.05);
  float hx = heightAt(p + vec2(e, 0.0));
  float hy = heightAt(p + vec2(0.0, e));
  // The raw gradient is proportional to uScale (the field is sampled at p*scale),
  // so divide it out: Relief then means the same slope at every feature size.
  vec2 g = (vec2(hx - h0, hy - h0) / e) / max(uScale, 0.05);

  // Micro detail perturbs the normal only, never the silhouette. Without it a
  // polished surface reads as plastic.
  if (uMicroDetail > 0.001) {
    float mf = uScale * 22.0;
    float me = 0.0006;

    // Brushed metal: stretching the micro-detail noise along one axis turns it
    // into parallel striations, and a highlight crossing them smears out
    // instead of pooling. Skipped entirely at brush 0 — the maths there is an
    // identity, but a non-zero angle would still rotate the sampling.
    //
    // The two axes are scaled by s and 1/s rather than one of them alone, so
    // the *geometric mean* frequency is unchanged. Compressing one axis on its
    // own raises the peak frequency with it, and the striations alias into
    // speckle long before they get fine enough to read as a grain.
    mat2 brush = mat2(1.0);
    float s = 1.0;
    vec2 mp = p;
    if (uBrush > 0.001) {
      brush = rot(radians(uBrushAngle));
      s = sqrt(1.0 + uBrush * 40.0);
      mp = brush * p;
      mp = vec2(mp.x / s, mp.y * s);
    }

    float m0 = gnoise(mp * mf);
    float mx = gnoise((mp + vec2(me, 0.0)) * mf);
    float my = gnoise((mp + vec2(0.0, me)) * mf);
    vec2 gm = vec2(mx - m0, my - m0) / me;

    if (uBrush > 0.001) {
      // Chain rule back to world axes. Without it the striations would be drawn
      // in one direction but perturb the normal in another, and the highlight
      // would not stretch at all.
      gm = vec2(gm.x / s, gm.y * s);
      gm = transpose(brush) * gm;
    }

    g += gm * uMicroDetail * 0.004 / max(uScale, 0.05);
  }

  cavity = 0.0;
#ifdef FEAT_CAVITY
  {
    // Occlusion from concavity: sample a ring and compare its mean height to
    // this point. Higher neighbours mean we are sitting in a crease.
    //
    // Three samples at 120°, not four on the axes, because that is the
    // cheapest arrangement whose first-order terms cancel exactly (three unit
    // vectors at 120° sum to zero) while the second-order term stays
    // isotropic. A two-sample version would miss every crease running parallel
    // to its axis.
    //
    // The radius is deliberately far wider than the normal's epsilon — a
    // quarter of a feature. Two reasons: a second difference taken over the
    // normal's 0.0015 world units is mostly floating-point cancellation noise,
    // and the height difference it reports scales with the square of the
    // radius, so a narrow ring measures a few parts in 100000 and no usable
    // threshold exists. A crease is a wide feature anyway.
    float rc = 0.25 / max(uScale, 0.05);
    const float C120 = -0.5, S120 = 0.8660254;
    float r1 = heightAt(p + rc * vec2(1.0, 0.0));
    float r2 = heightAt(p + rc * vec2(C120, S120));
    float r3 = heightAt(p + rc * vec2(C120, -S120));

    // A plain height difference, so no epsilon or scale factor has to be
    // divided back out: the radius already tracks feature size and h is always
    // in 0..1.
    float dh = (r1 + r2 + r3) / 3.0 - h0;
    cavity = uCavity * smoothstep(0.0, max(uCavityRange, 0.001), dh);
  }
#endif

  // The 0.5 puts a mid Relief around a 20° tilt, which swings the reflection
  // far enough to sweep the environment's bands. Much less than this and a
  // smooth surface just samples one flat patch of sky.
  return normalize(vec3(-g * uRelief * 0.5, 1.0));
}

// ------------------------------------------------------------ environment --

vec3 lightDir() {
  float az = radians(uLightAngle);
  float el = radians(uLightElev);
  return normalize(vec3(cos(az) * cos(el), sin(az) * cos(el), sin(el)));
}

// Procedural studio environment sampled by a direction. A horizon gradient plus
// horizontal softbox strips — the same setup a product photographer would use,
// and the reason the result reads as metal rather than as coloured noise.
// Roughness widens the strips instead of blurring a map, which keeps it cheap.
vec3 envProcedural(vec3 dir) {
  float y = clamp(dir.y, -1.0, 1.0);

  // Floor / horizon / sky gradient.
  float g = smoothstep(-0.8, 0.8, y);
  vec3 col = mix(vec3(0.02), vec3(0.42), g);

  if (uEnvBands > 0.5) {
    // Distance from the nearest strip centre, 0 at the centre and 1 midway
    // between strips.
    float t = (y * 0.5 + 0.5) * uEnvBands;
    float f = abs(fract(t) - 0.5) * 2.0;

    // Analytic antialiasing. A hard pow(sin, k) edge here stair-steps badly
    // wherever the surface gradient is steep, which is most of the image.
    float aa = max(fwidth(f), 1e-4);
    float w = mix(0.14, 0.9, clamp(uRoughness, 0.0, 1.0));
    float inner = w * 0.35;
    float outer = max(w, inner + aa);
    float strip = 1.0 - smoothstep(inner, outer, f);

    col += vec3(strip) * uEnvContrast;
  }

  return col;
}

/**
 * Matcap environment: a painted lit sphere, indexed by the direction's xy.
 *
 * The whole point is structure the three softbox strips cannot have — the
 * procedural environment varies only with dir.y, so every metal look built on
 * it is a relative of every other one.
 *
 * Scaling by 1.1 before mapping to the disc is not arbitrary. The reflection
 * vector's xy runs to roughly twice the normal's, and slopeTerm() treats
 * length(N.xy) * 2.2 as the steepest slope the height field produces, so 1.1
 * puts the rim of the matcap exactly at that slope. Without it a low-relief
 * surface would only ever sample a coin-sized patch in the middle of the image.
 * Anything past the rim clamps to it, which is what a sphere does anyway.
 */
vec3 envMatcap(vec3 dir) {
  vec2 d = dir.xy * 1.1;
  float l = length(d);
  if (l > 1.0) d /= l;

  // Roughness picks a mip level. The chain is pre-blurred on the CPU rather
  // than left to generateMipmap, because a box-filtered mip of a matcap makes
  // a rough reflection look blocky rather than soft — see params/matcaps.ts.
  //
  // Linear, so a mip level maps straight onto lobe width and the low
  // roughnesses the presets actually use keep their detail.
  //
  // Worth knowing: on a high-frequency surface this looks weaker than it is.
  // Roughness blurs what is *reflected*, but most of the apparent sharpness in
  // these images comes from the normals sweeping the environment, and no
  // amount of blurring the environment can blur the geometry. It reads clearly
  // on a smooth surface, and at the top of the range where the matcap
  // collapses toward a single colour.
  vec3 m = textureLod(uMatcap, d * 0.5 + 0.5, clamp(uRoughness, 0.0, 1.0) * MATCAP_MAX_LOD).rgb;

  // Env Contrast has no softbox strips to widen in this mode, so it becomes a
  // gamma on the image instead. Normalised to its own default, and skipped
  // there outright: pow(x, 1.0) is exp2(log2(x)) and does not always round-trip
  // exactly, which would leave the shipped matcaps merely close to unchanged.
  if (abs(uEnvContrast - ENV_CONTRAST_NEUTRAL) > 0.001) {
    m = pow(m, vec3(max(uEnvContrast, 0.1) / ENV_CONTRAST_NEUTRAL));
  }

  // The image is stored in display range; 8 bits cannot hold a specular. Cubing
  // it restores a range comparable to the procedural environment's (deep
  // falloff, cores well past 1.0) — see params/matcaps.ts, which paints to
  // match.
  return m * m * m * 3.0;
}

vec3 envSample(vec3 dir) {
  vec3 col = uEnvMode < 0.5 ? envProcedural(dir) : envMatcap(dir);

  // Key highlight. The tight exponent at low roughness produces the blown-out
  // specular streaks that read as a polished surface. Kept in both modes so the
  // light controls stay live over a matcap, which brings its own soft sources
  // but no directional key.
  float spec = pow(max(dot(dir, lightDir()), 0.0), mix(220.0, 3.0, uRoughness));
  col += vec3(spec) * uKey;

  return col;
}

// ---------------------------------------------------------------- shading --

vec3 iridescence(float t) {
  // A narrow phase spread keeps the channels close together, giving the
  // violet-to-gold sweep of a thin film. The evenly spaced (0, 1/3, 2/3) used
  // for generic cosine palettes walks the full hue circle and reads as rainbow
  // noise, not as a coated surface.
  vec3 phase = vec3(0.0, 0.13, 0.30);
  return cosPalette(t * uIriFreq + uHueShift / 360.0, phase);
}

/**
 * How steeply the surface is tilted, remapped to reach 1.0 at the steepest
 * slopes the height field actually produces.
 *
 * A textbook Fresnel on dot(N, V) is useless here: a height field viewed
 * head-on never gets near a grazing angle, so 1 - dot(N, V) tops out around
 * 0.1 and any exponent above ~2 collapses the term to zero. Keying off slope
 * instead gives edge terms that reach full strength on the creases, which is
 * where the reference images put their bright rims.
 */
float slopeTerm(vec3 N) {
  return clamp(length(N.xy) * 2.2, 0.0, 1.0);
}

// Occlusion attenuates what the surface *gathers* from the environment, so it
// scales the reflection and the ambient fill but never the rim, which is a
// slope term the creases are supposed to light up. At cavity 0 this is a
// multiply by exactly 1.0 and changes nothing.
vec3 shadeMetal(vec3 N, vec3 V, float h, float cavity) {
  float occ = 1.0 - cavity;
  vec3 R = reflect(-V, N);
  vec3 refl = envSample(R);

  float edge = pow(slopeTerm(N), uRimWidth);

  if (uIriAmount > 0.001) {
    vec3 tint = iridescence(slopeTerm(N) + h * 0.5);
    refl *= mix(vec3(1.0), tint * 1.45, uIriAmount);
  }

  return refl * uReflect * occ + edge * uRimIntensity * 0.25 + uAmbient * occ;
}

vec3 shadeGlass(vec3 N, vec3 V, float h, float cavity) {
  float eta = 1.0 / max(uIOR, 1.001);
  float d = uDispersion * 0.5;

  // Per-channel IOR: the whole point of the glass mode is the chromatic
  // fringing this produces along steep gradients.
  vec3 Tr = refract(-V, N, eta * (1.0 + d));
  vec3 Tg = refract(-V, N, eta);
  vec3 Tb = refract(-V, N, eta * (1.0 - d));

  vec3 refr = vec3(
    envSample(Tr).r,
    envSample(Tg).g,
    envSample(Tb).b
  );

  // Beer-Lambert absorption. Untinted on purpose — coupling it to a palette
  // colour meant a dark Colour B silently drove the whole image to black.
  refr *= exp(-uThickness * 1.2);

  vec3 R = reflect(-V, N);
  vec3 refl = envSample(R);

  float slope = slopeTerm(N);

  if (uIriAmount > 0.001) {
    vec3 tint = iridescence(slope + h * 0.5);
    refl *= mix(vec3(1.0), tint * 1.45, uIriAmount);
  }

  // Flat areas stay transmissive, steep areas turn mirror-like: dark bodies
  // with bright reflective edges, which is the liquid-glass read.
  float F = 0.04 + 0.96 * pow(slope, 3.0);
  float occ = 1.0 - cavity;
  vec3 col = mix(refr, refl * uReflect, F) * occ;
  col += pow(slope, uRimWidth) * uRimIntensity * 0.6;
  return col + uAmbient * occ;
}

// ------------------------------------------------------------------- main --

void main() {
  // Height-normalised, aspect-correct world space. Normalising by .y only is
  // what makes the composition resolution-independent: the same parameters give
  // the same image at 1080p and at 8K, just sampled more finely.
  vec2 screen = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  vec2 p = rot(radians(uRotation)) * (screen / max(uZoom, 0.01)) + vec2(uPanX, uPanY);

  float h = heightAt(p);
  float cavity;
  vec3 N = surfaceNormal(p, h, cavity);

  // Slight perspective on the view vector so the reflection varies across the
  // frame instead of being purely gradient-driven.
  vec3 V = normalize(vec3(screen * 0.15, 1.0));

  vec3 col = uMaterial < 0.5 ? shadeMetal(N, V, h, cavity) : shadeGlass(N, V, h, cavity);

  // ---- palette ----
  if (uColorMode < 0.5) {
    float l = luma(col);
    // Map brightness through the ramp, then add the over-1.0 headroom back so
    // blown-out speculars stay blown out instead of clamping to the ramp's end.
    col = texture(uRamp, vec2(clamp(l, 0.0, 1.0), 0.5)).rgb + max(l - 1.0, 0.0);
  }

  // ---- exposure ----
  // The last thing that happens before the split. Bloom has to see linear HDR,
  // so everything from contrast onwards lives in gradeToDisplay() and runs
  // either here or at the end of post.frag.
  col *= exp2(uExposure);

  if (uPostChain > 0.5) {
    // Hand the scene to the post chain, with the circle of confusion in alpha.
    //
    // A height field has no depth buffer, so height *is* the depth — and that
    // turns out to be the control you want anyway: focus the crests and the
    // troughs go soft, or the reverse, rather than focusing a plane that
    // nothing in the image lies on.
    float d = clamp(abs(h - uDofFocus) / max(uDofRange, 0.02), 0.0, 1.0);
    fragColor = vec4(col, smoothstep(0.0, 1.0, d) * uDof);
    return;
  }

  // ---- grade ----
  fragColor = vec4(gradeToDisplay(col, screen), 1.0);
}
