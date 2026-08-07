#version 300 es
precision highp float;

#include "common.glsl"

uniform sampler2D uSrc;
uniform int uFactor;

out vec4 fragColor;

// Box-averages the supersampled render down to the output size. Doing the
// downsample here rather than letting the canvas scale it keeps control of the
// filter and lets the dither land at output resolution, where it belongs.
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * uFactor;
  vec3 sum = vec3(0.0);

  for (int y = 0; y < 4; y++) {
    if (y >= uFactor) break;
    for (int x = 0; x < 4; x++) {
      if (x >= uFactor) break;
      sum += texelFetch(uSrc, base + ivec2(x, y), 0).rgb;
    }
  }

  vec3 col = sum / float(uFactor * uFactor);
  col += (bayer8(gl_FragCoord.xy) - 0.5) / 255.0;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
