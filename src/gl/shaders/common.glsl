// Shared helpers for the liquid shaders. Included via the #include resolver in
// glutil.ts, so this file has no #version directive of its own.

const float TAU = 6.28318530718;

// ---------------------------------------------------------------- hashing --
// Dave Hoskins style hashes: cheap, and free of the axis-aligned artefacts the
// naive sin(dot(...)) hash produces at large coordinates.

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

// ------------------------------------------------------------------ noise --

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// Gradient (Perlin-style) noise. Gradient rather than value noise because the
// smooth zero-crossings are what read as flowing liquid rather than blobs.
// Roughly normalised to [-1, 1].
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  float a = dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0));
  float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));

  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ------------------------------------------------------------------ color --

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Inigo Quilez cosine palette, used for the thin-film iridescence tint.
vec3 cosPalette(float t, vec3 phase) {
  return 0.5 + 0.5 * cos(TAU * (t + phase));
}

mat3 hueRotation(float a) {
  float c = cos(a), s = sin(a);
  float o = 1.0 / 3.0;
  float sq = sqrt(1.0 / 3.0);
  float k = (1.0 - c) * o;
  return mat3(
    c + k,        k - sq * s,   k + sq * s,
    k + sq * s,   c + k,        k - sq * s,
    k - sq * s,   k + sq * s,   c + k
  );
}

// ----------------------------------------------------------------- output --

// Standard 8x8 ordered dither built by interleaving the bits of x and y.
// Returns [0, 1). Applied before the 8-bit write: the near-black gradients this
// generator produces band very visibly without it.
float bayer8(vec2 c) {
  ivec2 p = ivec2(mod(c, 8.0));
  int v = 0;
  v = v * 2 + ((p.y >> 2) & 1);
  v = v * 2 + ((p.x >> 2) & 1);
  v = v * 2 + ((p.y >> 1) & 1);
  v = v * 2 + ((p.x >> 1) & 1);
  v = v * 2 + (p.y & 1);
  v = v * 2 + (p.x & 1);
  return float(v) / 64.0;
}
