#version 300 es
precision highp float;

#include "common.glsl"

uniform sampler2D uSrc;
uniform vec2 uDstTexel;
/** Blur direction and spacing, already in uv units per tap. */
uniform vec2 uStep;
/** Above zero, isolates highlights before blurring. Only the first pass does. */
uniform float uThreshold;
uniform float uThresholdOn;

out vec4 fragColor;

/**
 * One directional Gaussian pass, used to build anamorphic streaks.
 *
 * Run twice with a widely different `uStep` — one texel, then several — which
 * gives a kernel far wider than nine taps for the cost of nine. A streak has to
 * reach across a good fraction of the frame to read as a lens flare rather than
 * as smudged bloom, and doing that with a single pass would need dozens of taps.
 *
 * Highlights are isolated on the first pass, per tap, rather than afterwards:
 * thresholding a blurred streak would smear the whole image instead of the
 * bright parts of it.
 */
vec3 tap(vec2 uv) {
  vec3 c = texture(uSrc, uv).rgb;
  return uThresholdOn > 0.5 ? softThreshold(c, uThreshold) : c;
}

void main() {
  vec2 uv = gl_FragCoord.xy * uDstTexel;

  const float w0 = 0.2270270270;
  const float w1 = 0.1945945946;
  const float w2 = 0.1216216216;
  const float w3 = 0.0540540541;
  const float w4 = 0.0162162162;

  vec3 c = tap(uv) * w0;
  c += (tap(uv + uStep) + tap(uv - uStep)) * w1;
  c += (tap(uv + uStep * 2.0) + tap(uv - uStep * 2.0)) * w2;
  c += (tap(uv + uStep * 3.0) + tap(uv - uStep * 3.0)) * w3;
  c += (tap(uv + uStep * 4.0) + tap(uv - uStep * 4.0)) * w4;

  fragColor = vec4(c, 1.0);
}
