#version 300 es
precision highp float;

uniform sampler2D uSrc;
uniform vec2 uSrcTexel;   // 1 / source size
uniform vec2 uDstTexel;   // 1 / destination size

out vec4 fragColor;

/**
 * One step of the blur chain: half resolution, 13 taps.
 *
 *   A   B   C
 *     J   K
 *   D   E   F
 *     L   M
 *   G   H   I
 *
 * A plain 2x2 box average would be cheaper, but three chained boxes leave a
 * blocky signal that shows bilinear diamonds the moment post.frag magnifies the
 * eighth-resolution level back to full size. This kernel (the one Call of Duty's
 * bloom uses) is wide enough that three levels magnify cleanly, which is what
 * makes the same chain usable for depth of field as well as for glow.
 *
 * Alpha carries the circle of confusion in the scene target and is meaningless
 * once blurred, so it is dropped here rather than smeared.
 */
void main() {
  vec2 uv = gl_FragCoord.xy * uDstTexel;
  vec2 t = uSrcTexel;

  vec3 a = texture(uSrc, uv + t * vec2(-2.0,  2.0)).rgb;
  vec3 b = texture(uSrc, uv + t * vec2( 0.0,  2.0)).rgb;
  vec3 c = texture(uSrc, uv + t * vec2( 2.0,  2.0)).rgb;
  vec3 d = texture(uSrc, uv + t * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture(uSrc, uv).rgb;
  vec3 f = texture(uSrc, uv + t * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture(uSrc, uv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture(uSrc, uv + t * vec2( 0.0, -2.0)).rgb;
  vec3 i = texture(uSrc, uv + t * vec2( 2.0, -2.0)).rgb;
  vec3 j = texture(uSrc, uv + t * vec2(-1.0,  1.0)).rgb;
  vec3 k = texture(uSrc, uv + t * vec2( 1.0,  1.0)).rgb;
  vec3 l = texture(uSrc, uv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture(uSrc, uv + t * vec2( 1.0, -1.0)).rgb;

  vec3 col = e * 0.125;
  col += (a + c + g + i) * 0.03125;
  col += (b + d + f + h) * 0.0625;
  col += (j + k + l + m) * 0.125;

  fragColor = vec4(col, 1.0);
}
