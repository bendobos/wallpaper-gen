#version 300 es
precision highp float;

#include "common.glsl"

out vec4 fragColor;

// --------------------------------------------------------------- uniforms --
uniform vec2  uResolution;
uniform float uTime;
uniform float uDither;      // 1 when writing straight to an 8-bit target

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

// surface
uniform float uRelief;
uniform float uMicroDetail;
uniform float uCrease;

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

// color
uniform float uPalette;     // 0 = mono, 1 = duotone, 2 = iridescent
uniform vec3  uColorA;
uniform vec3  uColorB;
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

  float h = fbm(w) * 0.5 + 0.5;

  // Ridging folds the field back on itself at the midpoint, producing the hard
  // creases of polished chrome instead of soft dunes.
  h = mix(h, 1.0 - abs(2.0 * h - 1.0), uRidge);

  // Saturating contrast around 0.5. Softer than a clamp, which would flatten
  // regions to a constant and kill their normals.
  float s = (h - 0.5) * mix(1.0, 5.0, uCrease);
  h = 0.5 + 0.5 * s / (1.0 + abs(s));

  return h;
}

// Finite-difference normal. The epsilon is fixed in *world* space (scaled by
// uScale so it tracks feature size), never in pixels — a pixel-sized epsilon
// would make an 8K export sharper than its own preview.
vec3 surfaceNormal(vec2 p, float h0) {
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
    float m0 = gnoise(p * mf);
    float mx = gnoise((p + vec2(me, 0.0)) * mf);
    float my = gnoise((p + vec2(0.0, me)) * mf);
    g += vec2(mx - m0, my - m0) / me * uMicroDetail * 0.004 / max(uScale, 0.05);
  }

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
vec3 envSample(vec3 dir) {
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

  // Key highlight. The tight exponent at low roughness produces the blown-out
  // specular streaks that read as a polished surface.
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

vec3 shadeMetal(vec3 N, vec3 V, float h) {
  vec3 R = reflect(-V, N);
  vec3 refl = envSample(R);

  float edge = pow(slopeTerm(N), uRimWidth);

  if (uIriAmount > 0.001) {
    vec3 tint = iridescence(slopeTerm(N) + h * 0.5);
    refl *= mix(vec3(1.0), tint * 1.45, uIriAmount);
  }

  return refl * uReflect + edge * uRimIntensity * 0.25 + uAmbient;
}

vec3 shadeGlass(vec3 N, vec3 V, float h) {
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
  vec3 col = mix(refr, refl * uReflect, F);
  col += pow(slope, uRimWidth) * uRimIntensity * 0.6;
  return col + uAmbient;
}

// ------------------------------------------------------------------- main --

void main() {
  // Height-normalised, aspect-correct world space. Normalising by .y only is
  // what makes the composition resolution-independent: the same parameters give
  // the same image at 1080p and at 8K, just sampled more finely.
  vec2 screen = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  vec2 p = rot(radians(uRotation)) * (screen / max(uZoom, 0.01)) + vec2(uPanX, uPanY);

  float h = heightAt(p);
  vec3 N = surfaceNormal(p, h);

  // Slight perspective on the view vector so the reflection varies across the
  // frame instead of being purely gradient-driven.
  vec3 V = normalize(vec3(screen * 0.15, 1.0));

  vec3 col = uMaterial < 0.5 ? shadeMetal(N, V, h) : shadeGlass(N, V, h);

  // ---- palette ----
  if (uPalette < 0.5) {
    col = vec3(luma(col));
  } else if (uPalette < 1.5) {
    float l = luma(col);
    // Ramp between the two colours, then add the over-1.0 headroom back so
    // blown-out speculars stay blown out instead of clamping to colour A.
    col = mix(uColorB, uColorA, clamp(l, 0.0, 1.0)) + max(l - 1.0, 0.0);
  }

  // ---- grade ----
  col *= exp2(uExposure);
  // Gamma-style contrast rather than a pivot at 0.5: it keeps black at black,
  // which is what these compositions are built on.
  col = pow(max(col, 0.0), vec3(uContrast));
  col = max(col - uBlackLevel, 0.0) / max(1.0 - uBlackLevel, 1e-3);

  if (abs(uSaturation - 1.0) > 0.001) {
    col = mix(vec3(luma(col)), col, uSaturation);
  }
  if (abs(uHueShift) > 0.001 && uPalette > 1.5) {
    col = hueRotation(radians(uHueShift)) * col;
  }

  // Background tints the dark areas only, leaving highlights untouched.
  col += uBackground * (1.0 - clamp(col, 0.0, 1.0));

  // Vignette is anchored to the frame, not to world space, so panning does not
  // drag it around.
  if (uVignette > 0.001) {
    float r = length(screen) / max(uFalloff, 0.05);
    col *= 1.0 - uVignette * smoothstep(0.25, 1.1, r);
  }

  // Highlight shoulder. Reflective surfaces routinely push well past 1.0; a
  // hard clamp turns those into flat white slabs, while this keeps everything
  // below the knee untouched and rolls the rest off asymptotically.
  const float KNEE = 0.75;
  vec3 over = max(col - KNEE, 0.0);
  col = min(col, vec3(KNEE)) + (1.0 - KNEE) * (1.0 - exp(-over / (1.0 - KNEE)));

  if (uGrain > 0.0001) {
    // Seeded by position only, never by time, so an export is reproducible.
    col += (hash12(gl_FragCoord.xy + uSeed) - 0.5) * uGrain;
  }

  col += (bayer8(gl_FragCoord.xy) - 0.5) / 255.0 * uDither;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
