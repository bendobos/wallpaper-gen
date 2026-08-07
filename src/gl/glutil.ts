/** Minimal WebGL2 helpers. No engine — the whole app is one fullscreen quad. */

/**
 * Resolves `#include "name.glsl"` against a map of chunk sources. Runs once at
 * startup; deliberately not recursive, since one level of sharing is all the
 * two shaders here need.
 */
export function resolveIncludes(src: string, chunks: Record<string, string>): string {
  return src.replace(/^[ \t]*#include\s+"([^"]+)"[ \t]*$/gm, (_, name: string) => {
    const chunk = chunks[name];
    if (chunk === undefined) throw new Error(`Unknown shader include: ${name}`);
    return chunk;
  });
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    gl.deleteShader(shader);
    // Line numbers in the log refer to the resolved source, so print it.
    const numbered = src
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(4)} | ${l}`)
      .join('\n');
    console.error(`[${label}] shader source:\n${numbered}`);
    throw new Error(`${label} failed to compile:\n${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
  label: string,
): WebGLProgram {
  const vert = compile(gl, gl.VERTEX_SHADER, vertSrc, `${label}.vert`);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc, `${label}.frag`);

  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  // Safe to delete once linked; the program keeps its own reference.
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)';
    gl.deleteProgram(program);
    throw new Error(`${label} failed to link:\n${log}`);
  }
  return program;
}

/**
 * Caches uniform locations. Missing uniforms resolve to null and are silently
 * skipped on upload — the GLSL compiler drops unused uniforms, so a parameter
 * that a given shader ignores must not be an error.
 */
export class UniformCache {
  private locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private gl: WebGL2RenderingContext,
    private program: WebGLProgram,
  ) {}

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locations.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.locations.set(name, l);
    }
    return l;
  }

  f(name: string, v: number) {
    const l = this.loc(name);
    if (l) this.gl.uniform1f(l, v);
  }

  i(name: string, v: number) {
    const l = this.loc(name);
    if (l) this.gl.uniform1i(l, v);
  }

  v2(name: string, x: number, y: number) {
    const l = this.loc(name);
    if (l) this.gl.uniform2f(l, x, y);
  }

  v3(name: string, x: number, y: number, z: number) {
    const l = this.loc(name);
    if (l) this.gl.uniform3f(l, x, y, z);
  }
}

/** `#rrggbb` (or `#rgb`) to linear-ish 0..1 triplet. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
