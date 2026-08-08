// The final grade, shared by liquid.frag (which runs it inline whenever nothing
// needs an offscreen pass) and post.frag (which runs it after bloom and depth of
// field). Unlike common.glsl this chunk reads uniforms directly, so it must be
// included *after* the including shader's uniform block — and only by shaders
// that declare all of them.
//
// Having exactly one copy is what keeps the two render paths in agreement: a
// look renders byte-identically whether or not the post chain is engaged, which
// is the only way "bloom at zero changes nothing" can be a guarantee rather than
// a hope.
//
// Input is linear-ish HDR with exposure already applied. `screen` is the same
// height-normalised frame coordinate the shading uses, so the vignette stays
// anchored to the frame rather than to world space.
vec3 gradeToDisplay(vec3 col, vec2 screen) {
  // Gamma-style contrast rather than a pivot at 0.5: it keeps black at black,
  // which is what these compositions are built on.
  col = pow(max(col, 0.0), vec3(uContrast));
  col = max(col - uBlackLevel, 0.0) / max(1.0 - uBlackLevel, 1e-3);

  if (abs(uSaturation - 1.0) > 0.001) {
    col = mix(vec3(luma(col)), col, uSaturation);
  }
  // Only meaningful in Direct mode; in Ramp mode the gradient already decides
  // the hue and rotating it afterwards would fight the editor.
  if (abs(uHueShift) > 0.001 && uColorMode > 0.5) {
    col = hueRotation(radians(uHueShift)) * col;
  }

  // Background tints the dark areas only, leaving highlights untouched.
  col += uBackground * (1.0 - clamp(col, 0.0, 1.0));

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

  return clamp(col, 0.0, 1.0);
}
