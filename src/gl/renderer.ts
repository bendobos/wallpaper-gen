import { createProgram, hexToRgb, resolveIncludes, UniformCache } from './glutil';
import { PARAM_LIST, type Params } from '../params/schema';
import { bakeGradient, RAMP_WIDTH } from '../params/gradient';

import quadVert from './shaders/quad.vert?raw';
import commonGlsl from './shaders/common.glsl?raw';
import liquidFrag from './shaders/liquid.frag?raw';
import resolveFrag from './shaders/resolve.frag?raw';

const CHUNKS = { 'common.glsl': commonGlsl };

/** Rough pixel budget per draw call, see renderChunked(). */
const PIXELS_PER_CHUNK = 1_500_000;

export interface ExportOptions {
  width: number;
  height: number;
  /** Supersampling factor, 1–4. Reduced automatically if it exceeds GPU limits. */
  ssaa: number;
  onProgress?: (fraction: number) => void;
}

export interface ExportResult {
  canvas: HTMLCanvasElement;
  /** Factor actually used, which may be lower than requested. */
  ssaaUsed: number;
}

export class RendererError extends Error {}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class LiquidRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureSize: number;

  private liquidProgram: WebGLProgram;
  private resolveProgram: WebGLProgram;
  private liquidUniforms: UniformCache;
  private resolveUniforms: UniformCache;
  private vao: WebGLVertexArrayObject;
  private rampTex: WebGLTexture;
  private rampSpec: string | null = null;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false, // we supersample instead; MSAA does nothing for a shader-only image
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new RendererError('WebGL2 is not available in this browser.');
    this.gl = gl;

    const maxTex = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number | null) ?? 0;
    if (!maxTex) {
      throw new RendererError('The WebGL2 context is not usable. Try reloading the page.');
    }
    // MAX_VIEWPORT_DIMS is normally the larger of the two limits, but treat it
    // as optional so a driver that omits it doesn't take the whole app down.
    const viewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
    this.maxTextureSize = viewportDims
      ? Math.min(maxTex, viewportDims[0], viewportDims[1])
      : maxTex;

    const liquidSrc = resolveIncludes(liquidFrag, CHUNKS);
    const resolveSrc = resolveIncludes(resolveFrag, CHUNKS);

    this.liquidProgram = createProgram(gl, quadVert, liquidSrc, 'liquid');
    this.resolveProgram = createProgram(gl, quadVert, resolveSrc, 'resolve');
    this.liquidUniforms = new UniformCache(gl, this.liquidProgram);
    this.resolveUniforms = new UniformCache(gl, this.resolveProgram);

    // WebGL2 requires a bound VAO even for attribute-less drawing on some drivers.
    const vao = gl.createVertexArray();
    if (!vao) throw new RendererError('Failed to create vertex array');
    this.vao = vao;
    gl.bindVertexArray(vao);

    // Colour ramp lookup. LINEAR so the 256 stops read as a smooth gradient.
    const ramp = gl.createTexture();
    if (!ramp) throw new RendererError('Failed to create the gradient texture');
    this.rampTex = ramp;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ramp);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, RAMP_WIDTH, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ------------------------------------------------------------- uniforms --

  private uploadParams(u: UniformCache, params: Params, time: number, dither: boolean) {
    for (const def of PARAM_LIST) {
      if (!def.uniform) continue; // app-side only (phase, loopSeconds, gradient)
      const value = params[def.key as keyof Params];
      if (def.kind === 'color') {
        const [r, g, b] = hexToRgb(value as string);
        u.v3(def.uniform, r, g, b);
      } else {
        u.f(def.uniform, value as number);
      }
    }
    u.f('uTime', time);
    u.f('uDither', dither ? 1 : 0);
  }

  /**
   * Uploads the colour ramp on unit 1 and binds it. Cached on the spec string:
   * rasterising through canvas 2D on every frame would be wasteful, and the
   * ramp only changes when the user edits it.
   */
  private bindRamp(spec: string) {
    const gl = this.gl;
    if (spec !== this.rampSpec) {
      const data = bakeGradient(spec);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RAMP_WIDTH, 1, gl.RGBA, gl.UNSIGNED_BYTE, data.data);
      this.rampSpec = spec;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
    this.liquidUniforms.i('uRamp', 1);
  }

  /**
   * Draws the liquid shader into the currently bound framebuffer, splitting the
   * work across several scissored draw calls.
   *
   * A single multi-second draw call is how you get a GPU watchdog reset and a
   * lost context, which at 8K with supersampling is a real risk. Bands keep
   * each call short and give the progress callback something to report.
   */
  private async renderChunked(
    width: number,
    height: number,
    params: Params,
    time: number,
    dither: boolean,
    onProgress?: (f: number) => void,
  ) {
    const gl = this.gl;
    gl.useProgram(this.liquidProgram);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, width, height);
    this.uploadParams(this.liquidUniforms, params, time, dither);
    this.bindRamp(params.gradient);
    this.liquidUniforms.v2('uResolution', width, height);

    const rows = Math.max(1, Math.floor(PIXELS_PER_CHUNK / Math.max(width, 1)));

    if (rows >= height) {
      gl.disable(gl.SCISSOR_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      onProgress?.(1);
      return;
    }

    gl.enable(gl.SCISSOR_TEST);
    try {
      for (let y = 0; y < height; y += rows) {
        const h = Math.min(rows, height - y);
        gl.scissor(0, y, width, h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // Flush so the driver starts this band instead of batching all of them
        // into one giant submission, which would defeat the point.
        gl.flush();
        onProgress?.(Math.min(1, (y + h) / height));
        await nextFrame();
        if (this.disposed) return;
      }
    } finally {
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  // -------------------------------------------------------------- preview --

  /** Sizes the drawing buffer. Returns true if it changed. */
  resize(width: number, height: number): boolean {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  /** Synchronous single-pass draw to the canvas. */
  draw(params: Params, time: number) {
    const gl = this.gl;
    const { width, height } = this.canvas;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.liquidProgram);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, width, height);
    this.uploadParams(this.liquidUniforms, params, time, true);
    this.bindRamp(params.gradient);
    this.liquidUniforms.v2('uResolution', width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // --------------------------------------------------------------- export --

  private makeTarget(width: number, height: number) {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new RendererError('Failed to allocate render target');

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      throw new RendererError(
        `Could not allocate a ${width}×${height} render target (status 0x${status.toString(16)}). Try a smaller resolution.`,
      );
    }
    return { tex, fbo };
  }

  /** Largest supersampling factor that fits within GPU limits for a given size. */
  clampSsaa(width: number, height: number, requested: number): number {
    let s = Math.max(1, Math.min(4, Math.round(requested)));
    while (s > 1 && (width * s > this.maxTextureSize || height * s > this.maxTextureSize)) {
      s--;
    }
    return s;
  }

  /**
   * Allocates everything a render at this size needs. Held across a whole frame
   * sequence so a 180-frame video doesn't allocate 180 framebuffers.
   */
  private openSession(width: number, height: number, ssaa: number) {
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new RendererError(
        `${width}×${height} exceeds this GPU's maximum render size of ${this.maxTextureSize} px.`,
      );
    }

    const gl = this.gl;
    const factor = this.clampSsaa(width, height, ssaa);
    const hi = this.makeTarget(width * factor, height * factor);
    const lo = factor > 1 ? this.makeTarget(width, height) : null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
      gl.deleteTexture(hi.tex);
      gl.deleteFramebuffer(hi.fbo);
      if (lo) {
        gl.deleteTexture(lo.tex);
        gl.deleteFramebuffer(lo.fbo);
      }
      throw new RendererError('Could not create a 2D context for the export.');
    }

    return {
      factor,
      hi,
      lo,
      canvas,
      ctx,
      pixels: new Uint8Array(width * height * 4),
      flipped: new Uint8ClampedArray(width * height * 4),
      close: () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteTexture(hi.tex);
        gl.deleteFramebuffer(hi.fbo);
        if (lo) {
          gl.deleteTexture(lo.tex);
          gl.deleteFramebuffer(lo.fbo);
        }
      },
    };
  }

  private async renderIntoSession(
    session: ReturnType<LiquidRenderer['openSession']>,
    params: Params,
    time: number,
    width: number,
    height: number,
    chunked: boolean,
    onProgress?: (f: number) => void,
  ) {
    const gl = this.gl;
    const { factor, hi, lo, ctx, pixels, flipped } = session;

    gl.bindFramebuffer(gl.FRAMEBUFFER, hi.fbo);

    if (chunked) {
      await this.renderChunked(width * factor, height * factor, params, time, factor === 1, onProgress);
    } else {
      gl.useProgram(this.liquidProgram);
      gl.bindVertexArray(this.vao);
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, width * factor, height * factor);
      this.uploadParams(this.liquidUniforms, params, time, factor === 1);
      this.bindRamp(params.gradient);
      this.liquidUniforms.v2('uResolution', width * factor, height * factor);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    let readFbo = hi.fbo;

    if (lo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, lo.fbo);
      gl.useProgram(this.resolveProgram);
      gl.bindVertexArray(this.vao);
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hi.tex);
      this.resolveUniforms.i('uSrc', 0);
      this.resolveUniforms.i('uFactor', factor);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      readFbo = lo.fbo;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, readFbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      throw new RendererError(`GL error 0x${err.toString(16)} while reading back the image.`);
    }

    // GL reads bottom-up; ImageData is top-down.
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * rowBytes;
      flipped.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
    }
    ctx.putImageData(new ImageData(flipped, width, height), 0, 0);
  }

  async exportImage(
    params: Params,
    time: number,
    { width, height, ssaa, onProgress }: ExportOptions,
  ): Promise<ExportResult> {
    const session = this.openSession(width, height, ssaa);
    try {
      // Reserve the last 5% of the progress bar for resolve + readback.
      await this.renderIntoSession(session, params, time, width, height, true, (f) =>
        onProgress?.(f * 0.95),
      );
      onProgress?.(1);

      // Hand back a canvas the session won't reuse.
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      out.getContext('2d')!.drawImage(session.canvas, 0, 0);
      return { canvas: out, ssaaUsed: session.factor };
    } finally {
      session.close();
    }
  }

  /**
   * Renders `frameCount` frames of one animation loop.
   *
   * Frame `i` is rendered at `phaseStart + i / frameCount`. The endpoint is
   * deliberately excluded: the shader's period is 1.0, so a frame at
   * `phaseStart + 1` would be identical to frame 0 and would show up as a
   * stutter on every repeat of the loop.
   *
   * The canvas passed to `onFrame` is reused between frames — consume it before
   * returning (e.g. wrap it in a `VideoFrame`), don't retain it.
   */
  async exportSequence(
    params: Params,
    {
      width,
      height,
      ssaa,
      frameCount,
      phaseStart = 0,
      onFrame,
      onProgress,
      signal,
    }: {
      width: number;
      height: number;
      ssaa: number;
      frameCount: number;
      phaseStart?: number;
      onFrame: (canvas: HTMLCanvasElement, index: number) => void | Promise<void>;
      onProgress?: (fraction: number, frame: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<{ ssaaUsed: number }> {
    const session = this.openSession(width, height, ssaa);
    try {
      for (let i = 0; i < frameCount; i++) {
        if (signal?.aborted || this.disposed) throw new DOMException('Aborted', 'AbortError');

        const time = phaseStart + i / frameCount;
        await this.renderIntoSession(session, params, time, width, height, false);
        await onFrame(session.canvas, i);

        onProgress?.((i + 1) / frameCount, i + 1);
        // Yield so the progress bar paints and the Cancel button stays live.
        await nextFrame();
      }
      return { ssaaUsed: session.factor };
    } finally {
      session.close();
    }
  }

  dispose() {
    this.disposed = true;
    const gl = this.gl;
    gl.deleteProgram(this.liquidProgram);
    gl.deleteProgram(this.resolveProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.rampTex);
    // Deliberately no WEBGL_lose_context here. A canvas hands out the same
    // context object forever, so killing it would leave a StrictMode remount
    // (or any future re-init on this canvas) holding a dead context.
  }
}
