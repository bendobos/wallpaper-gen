#version 300 es
precision highp float;

#include "common.glsl"

out vec4 fragColor;

uniform vec2 uResolution;

// HDR scene, exposure applied, circle of confusion in alpha.
uniform sampler2D uScene;
// The blur chain built from it: half, quarter and eighth resolution.
uniform sampler2D uLevel0;
uniform sampler2D uLevel1;
uniform sampler2D uLevel2;
uniform vec2 uLevel0Texel;
uniform vec2 uLevel1Texel;
uniform vec2 uLevel2Texel;

uniform float uBloom;
uniform float uBloomThreshold;
uniform float uBloomRadius;
uniform vec3  uBloomTint;
uniform float uDof;

// lens
uniform float uChromatic;
uniform float uDistortion;
uniform float uStreak;
uniform sampler2D uStreakTex;

// ---- the grade, identical to the one liquid.frag runs inline ----
uniform float uSeed;
uniform float uDither;
uniform float uContrast;
uniform float uBlackLevel;
uniform float uSaturation;
uniform float uHueShift;
uniform float uColorMode;
uniform vec3  uBackground;
uniform float uVignette;
uniform float uFalloff;
uniform float uGrain;

#include "grade.glsl"

/** Four bilinear taps in a tent, which softens the magnified chain levels. */
vec3 tent(sampler2D src, vec2 uv, vec2 texel, float radius) {
  vec2 o = texel * radius;
  return 0.25 * (
    texture(src, uv + vec2(-o.x, -o.y)).rgb +
    texture(src, uv + vec2( o.x, -o.y)).rgb +
    texture(src, uv + vec2(-o.x,  o.y)).rgb +
    texture(src, uv + vec2( o.x,  o.y)).rgb
  );
}

/**
 * Barrel (positive) and pincushion (negative) distortion.
 *
 * Corrected for aspect before the radial term, so the distortion is circular
 * rather than elliptical on a phone-shaped frame. Applied only to the scene
 * fetch: the grade stays anchored to the frame, which is what you want — a
 * vignette that bulged with the image would read as a mistake.
 *
 * Barrel pulls the corners from outside the scene target, where CLAMP_TO_EDGE
 * smears the border pixel. That is visible at strong settings and is the reason
 * the slider stops where it does.
 */
vec2 lensDistort(vec2 uv) {
  if (abs(uDistortion) < 0.0001) return uv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 c = uv - 0.5;
  c.x *= aspect;
  c *= 1.0 + uDistortion * dot(c, c);
  c.x /= aspect;
  return c + 0.5;
}

/**
 * Scene fetch with chromatic aberration: the three channels are read at
 * slightly different radii, which is what a real lens does and what makes the
 * frame edges fringe while the centre stays clean. The offset is a fraction of
 * the frame, so it survives a change of resolution unchanged.
 */
vec3 sampleScene(vec2 uv, out float coc) {
  if (uChromatic < 0.0001) {
    vec4 s = texture(uScene, uv);
    coc = s.a;
    return s.rgb;
  }
  vec2 d = uv - 0.5;
  // A real lens fringes by a fraction of a percent. 0.005 puts a visible but
  // photographic amount at the middle of the slider and leaves the top of the
  // range for the deliberately broken look, rather than reaching it by 0.3.
  float k = uChromatic * 0.005;
  vec4 g = texture(uScene, uv);
  coc = g.a;
  return vec3(
    texture(uScene, 0.5 + d * (1.0 - k)).r,
    g.g,
    texture(uScene, 0.5 + d * (1.0 + k)).b
  );
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 screen = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  float coc;
  vec3 col = sampleScene(lensDistort(uv), coc);
  vec4 scene = vec4(col, coc);

  vec3 b0 = tent(uLevel0, uv, uLevel0Texel, uBloomRadius);
  vec3 b1 = tent(uLevel1, uv, uLevel1Texel, uBloomRadius);
  vec3 b2 = tent(uLevel2, uv, uLevel2Texel, uBloomRadius);

  // Depth of field walks up the chain as the circle of confusion grows, so the
  // blur radius keeps increasing instead of saturating at one kernel width.
  // Sharp foreground bleeds into soft background at the boundary, which is the
  // standard price of gather-based DoF and invisible on a field with no edges.
  if (uDof > 0.0001) {
    float t = clamp(scene.a, 0.0, 1.0) * 3.0;
    col = mix(col, b0, clamp(t, 0.0, 1.0));
    col = mix(col, b1, clamp(t - 1.0, 0.0, 1.0));
    col = mix(col, b2, clamp(t - 2.0, 0.0, 1.0));
  }

  // Summing the three levels rather than one blur gives the wide, soft-shouldered
  // falloff a lens actually has: a tight core from the half-resolution level and
  // a broad haze from the eighth.
  if (uBloom > 0.0001) {
    vec3 glow = softThreshold(b0, uBloomThreshold)
              + softThreshold(b1, uBloomThreshold)
              + softThreshold(b2, uBloomThreshold);
    col += glow * uBloomTint * (uBloom / 3.0);
  }

  // Anamorphic streak. Already thresholded and blurred along one axis by the
  // two blur passes, so all that is left is to add it. Shares the bloom tint,
  // which covers both the cool streak of an anamorphic lens and the warm bleed
  // of halation without a second colour control.
  if (uStreak > 0.0001) {
    col += texture(uStreakTex, uv).rgb * uBloomTint * uStreak;
  }

  fragColor = vec4(gradeToDisplay(col, screen), 1.0);
}
