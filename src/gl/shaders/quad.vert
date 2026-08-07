#version 300 es

// Attribute-less fullscreen triangle. Vertex 0/1/2 map to (0,0) (2,0) (0,2)
// in clip-UV space, which covers the whole viewport with one primitive.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
