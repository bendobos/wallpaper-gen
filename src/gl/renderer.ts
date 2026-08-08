import { createProgram, hexToRgb, resolveIncludes, UniformCache } from './glutil';
import { PARAM_LIST, type Params } from '../params/schema';
import { bakeGradient, RAMP_WIDTH } from '../params/gradient';
import { MATCAP_LEVELS, MATCAP_SIZE } from '../params/matcaps';

import quadVert from './shaders/quad.vert?raw';
import commonGlsl from './shaders/common.glsl?raw';
import gradeGlsl from './shaders/grade.glsl?raw';
import liquidFrag from './shaders/liquid.frag?raw';
import resolveFrag from './shaders/resolve.frag?raw';
import downsampleFrag from './shaders/downsample.frag?raw';
import blurFrag from './shaders/blur.frag?raw';
import postFrag from './shaders/post.frag?raw';

const CHUNKS = { 'common.glsl': commonGlsl, 'grade.glsl': gradeGlsl };

/** Rough pixel budget per draw call, see renderChunked(). */
const PIXELS_PER_CHUNK = 1_500_000;

/**
 * Levels in the blur chain: half, quarter, eighth. Three is enough for a bloom
 * halo that reads as optical and for a depth-of-field blur that goes properly
 * soft; a fourth would cost another target for a level whose weight is already
 * low.
 */
const POST_LEVELS = 3;

/**
 * Chain level the anamorphic streak is smeared from: the quarter-resolution
 * one, not the eighth.
 *
 * A streak has to read as a line of light, and the level it starts from decides
 * how thin that line can be. Taken from the eighth-resolution level the source
 * is already an isotropic blob three downsamples wide, and smearing a blob
 * sideways gives a glow that shifts with the angle rather than a streak. One
 * level up costs four times the area on two small targets — about 1 byte per
 * output pixel — and is the difference between the effect working and merely
 * measuring.
 */
const STREAK_LEVEL = 1;

/**
 * Bytes of GPU memory an export costs per output pixel once the post chain is
 * involved: the RGBA16F scene (8), the chain at ~⅓ its area (≈2.6), and the
 * 8-bit target it resolves into (4), rounded up.
 */
const POST_BYTES_PER_PX = 17;

/**
 * Ceiling for that. 8K at 2x supersampling would want a 15360x8640 float scene
 * — over a gigabyte before the chain — so the factor gets reduced instead, the
 * same way it already is for the hard texture-size limit.
 */
const POST_BUDGET_BYTES = 600e6;

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

/** Why a supersampling factor came back lower than asked for. */
export type SsaaLimit = 'size' | 'memory' | null;

export interface SsaaPlan {
  factor: number;
  limit: SsaaLimit;
}

export class RendererError extends Error {}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

/**
 * The scene target plus its blur chain, sized to one particular render.
 *
 * `streak` is a ping-pong pair at the smallest chain level, used to smear
 * highlights along one axis. Two targets at 1/64 of the frame area cost almost
 * nothing, so they are allocated with the chain rather than conditionally; only
 * the passes are skipped when the effect is off.
 */
interface PostTargets {
  scene: Target;
  levels: Target[];
  streak: [Target, Target];
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class LiquidRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureSize: number;
  /**
   * Whether bloom and depth of field can run at all. They need a float render
   * target; without one the controls are inert and the UI says so rather than
   * silently doing nothing.
   */
  readonly postSupported: boolean;

  /**
   * Liquid shader variants, keyed by the feature defines they were built with.
   *
   * Optional features are `#ifdef`-ed out rather than branched around at
   * runtime, because a branch is not enough: an unreachable call to `heightAt`
   * still changes how the driver schedules the reachable ones, which shifts
   * output by a level. Compiling per feature set is what makes "this control at
   * zero changes nothing" a guarantee instead of a hope — and it means nobody
   * pays for a feature they never switch on.
   *
   * Populated lazily; enabling a feature for the first time costs one compile.
   */
  private liquidVariants = new Map<string, { program: WebGLProgram; uniforms: UniformCache }>();
  private liquidSrc: string;

  private resolveProgram: WebGLProgram;
  private downsampleProgram: WebGLProgram;
  private blurProgram: WebGLProgram;
  private postProgram: WebGLProgram;
  private resolveUniforms: UniformCache;
  private downsampleUniforms: UniformCache;
  private blurUniforms: UniformCache;
  private postUniforms: UniformCache;
  private vao: WebGLVertexArrayObject;
  private rampTex: WebGLTexture;
  private rampSpec: string | null = null;
  private matcapTex: WebGLTexture;
  private matcapReady = false;
  /** Post targets for the preview, kept across frames and resized with it. */
  private previewPost: PostTargets | null = null;
  private previewPostFailed = false;
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

    // Half-float textures are filterable in core WebGL2; only *rendering* into
    // one needs an extension.
    this.postSupported = !!gl.getExtension('EXT_color_buffer_float');

    this.liquidSrc = resolveIncludes(liquidFrag, CHUNKS);
    const resolveSrc = resolveIncludes(resolveFrag, CHUNKS);
    const postSrc = resolveIncludes(postFrag, CHUNKS);

    // Build the base variant eagerly, so a broken shader fails here rather than
    // on the first frame.
    this.liquidVariant([]);
    this.resolveProgram = createProgram(gl, quadVert, resolveSrc, 'resolve');
    this.downsampleProgram = createProgram(gl, quadVert, downsampleFrag, 'downsample');
    this.blurProgram = createProgram(gl, quadVert, resolveIncludes(blurFrag, CHUNKS), 'blur');
    this.postProgram = createProgram(gl, quadVert, postSrc, 'post');
    this.resolveUniforms = new UniformCache(gl, this.resolveProgram);
    this.downsampleUniforms = new UniformCache(gl, this.downsampleProgram);
    this.blurUniforms = new UniformCache(gl, this.blurProgram);
    this.postUniforms = new UniformCache(gl, this.postProgram);

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

    // Matcap. Allocated even when unused: sampling an incomplete texture is an
    // error, and the shader still names the sampler in procedural mode.
    // texStorage2D allocates every level up front, so the texture stays
    // mip-complete whether or not one has been uploaded.
    const matcap = gl.createTexture();
    if (!matcap) throw new RendererError('Failed to create the matcap texture');
    this.matcapTex = matcap;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, matcap);
    gl.texStorage2D(gl.TEXTURE_2D, MATCAP_LEVELS, gl.RGBA8, MATCAP_SIZE, MATCAP_SIZE);
    // LINEAR_MIPMAP_LINEAR so Roughness can land between levels; the chain is
    // pre-blurred in params/matcaps.ts rather than generated here.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // -------------------------------------------------------- shader variants --

  private liquidVariant(defines: readonly string[]) {
    const key = defines.join('|');
    let variant = this.liquidVariants.get(key);
    if (!variant) {
      const program = createProgram(
        this.gl, quadVert, this.liquidSrc, `liquid[${key || 'base'}]`, defines,
      );
      variant = { program, uniforms: new UniformCache(this.gl, program) };
      this.liquidVariants.set(key, variant);
    }
    return variant;
  }

  /**
   * Optional shader features this look needs. Order must be stable so the same
   * feature set always maps to the same cache key.
   */
  private liquidDefines(params: Params): string[] {
    const defines: string[] = [];
    if (params.cavity > 0.001) defines.push('FEAT_CAVITY');
    return defines;
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
    // A share link can carry "custom matcap" but not the image, and a browser
    // without float targets cannot bloom. Correcting both here means every
    // caller — preview, thumbnails, stills, video — degrades the same way
    // instead of each having to remember.
    if (!this.matcapReady) u.f('uEnvMode', 0);
    if (!this.postSupported) {
      u.f('uBloom', 0);
      u.f('uDof', 0);
      u.f('uStreak', 0);
      u.f('uChromatic', 0);
      u.f('uDistortion', 0);
    }
    u.f('uTime', time);
    u.f('uDither', dither ? 1 : 0);
  }

  /**
   * Uploads the colour ramp on unit 1 and binds it. Cached on the spec string:
   * rasterising through canvas 2D on every frame would be wasteful, and the
   * ramp only changes when the user edits it.
   */
  private bindRamp(u: UniformCache, spec: string) {
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
    u.i('uRamp', 1);
  }

  /**
   * Sets the matcap image, or clears it with `null` so the shader falls back to
   * the procedural environment. Uploading is the caller's cue that the image is
   * ready — there is no async path in here.
   */
  setMatcap(levels: ImageData[] | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.matcapTex);
    if (levels) {
      // Matcaps are authored with the sky at the top of the image, and GL's v
      // axis runs the other way.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      for (let i = 0; i < Math.min(levels.length, MATCAP_LEVELS); i++) {
        const level = levels[i];
        gl.texSubImage2D(
          gl.TEXTURE_2D, i, 0, 0,
          level.width, level.height,
          gl.RGBA, gl.UNSIGNED_BYTE, level.data,
        );
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    this.matcapReady = !!levels;
  }

  private bindMatcap(u: UniformCache) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.matcapTex);
    u.i('uMatcap', 2);
  }

  // ---------------------------------------------------------- liquid pass --

  /**
   * True when a look actually needs the offscreen chain.
   *
   * Everything else keeps the original single-pass path, which is faster and —
   * more importantly — is literally the code that rendered every image this app
   * has ever produced. Bloom and DoF at zero cannot drift because they are not
   * in the picture at all.
   */
  usesPostChain(params: Params): boolean {
    return (
      this.postSupported &&
      (params.bloom > 0.0005 ||
        params.dof > 0.0005 ||
        params.streak > 0.0005 ||
        params.chromatic > 0.0005 ||
        Math.abs(params.distortion) > 0.0005)
    );
  }

  /** Binds the liquid program and uploads everything a draw at this size needs. */
  private beginLiquid(
    width: number,
    height: number,
    params: Params,
    time: number,
    dither: boolean,
    post: boolean,
  ) {
    const gl = this.gl;
    const { program, uniforms } = this.liquidVariant(this.liquidDefines(params));
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, width, height);
    this.uploadParams(uniforms, params, time, dither);
    this.bindRamp(uniforms, params.gradient);
    this.bindMatcap(uniforms);
    uniforms.f('uPostChain', post ? 1 : 0);
    uniforms.v2('uResolution', width, height);
  }

  /**
   * Draws the liquid shader into the currently bound framebuffer, splitting the
   * work across several scissored draw calls. `beginLiquid` must have run.
   *
   * A single multi-second draw call is how you get a GPU watchdog reset and a
   * lost context, which at 8K with supersampling is a real risk. Bands keep
   * each call short and give the progress callback something to report.
   */
  private async renderChunked(width: number, height: number, onProgress?: (f: number) => void) {
    const gl = this.gl;
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

  // ----------------------------------------------------------- post chain --

  private makeTarget(width: number, height: number, format: number, filter: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new RendererError('Failed to allocate render target');

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
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
    return { tex, fbo, w: width, h: height };
  }

  private allocPost(width: number, height: number): PostTargets {
    const gl = this.gl;
    const made: Target[] = [];
    try {
      // LINEAR throughout: every one of these is read back magnified.
      const scene = this.makeTarget(width, height, gl.RGBA16F, gl.LINEAR);
      made.push(scene);
      const levels: Target[] = [];
      let w = width;
      let h = height;
      for (let i = 0; i < POST_LEVELS; i++) {
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
        const level = this.makeTarget(w, h, gl.RGBA16F, gl.LINEAR);
        made.push(level);
        levels.push(level);
      }
      // Sized to the streak's source level, not the smallest one. See runStreak.
      const from = levels[STREAK_LEVEL];
      const streakA = this.makeTarget(from.w, from.h, gl.RGBA16F, gl.LINEAR);
      made.push(streakA);
      const streakB = this.makeTarget(from.w, from.h, gl.RGBA16F, gl.LINEAR);
      made.push(streakB);
      return { scene, levels, streak: [streakA, streakB] };
    } catch (e) {
      for (const t of made) this.freeTarget(t);
      throw e;
    }
  }

  private freeTarget(t: Target) {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  private freePost(p: PostTargets) {
    this.freeTarget(p.scene);
    for (const l of p.levels) this.freeTarget(l);
    for (const s of p.streak) this.freeTarget(s);
  }

  /**
   * Builds the blur chain from the scene and composites scene + bloom + DoF +
   * grade into `dst`.
   *
   * Deliberately not banded the way the liquid pass is: this is a dozen texture
   * fetches per pixel against the liquid shader's hundreds of noise evaluations,
   * so it is nowhere near the draw length that trips a GPU watchdog even at 8K.
   */
  private runPost(
    post: PostTargets,
    dst: WebGLFramebuffer | null,
    width: number,
    height: number,
    params: Params,
    dither: boolean,
  ) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.SCISSOR_TEST);

    gl.useProgram(this.downsampleProgram);
    let src: Target = post.scene;
    for (const level of post.levels) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, level.fbo);
      gl.viewport(0, 0, level.w, level.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      this.downsampleUniforms.i('uSrc', 0);
      this.downsampleUniforms.v2('uSrcTexel', 1 / src.w, 1 / src.h);
      this.downsampleUniforms.v2('uDstTexel', 1 / level.w, 1 / level.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = level;
    }

    if (params.streak > 0.0005) this.runStreak(post, params);

    gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.postProgram);
    const u = this.postUniforms;
    // Time is irrelevant here; the grade uniforms are the point.
    this.uploadParams(u, params, 0, dither);
    u.v2('uResolution', width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, post.scene.tex);
    u.i('uScene', 0);

    for (let i = 0; i < post.levels.length; i++) {
      const level = post.levels[i];
      const unit = 3 + i;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, level.tex);
      u.i(`uLevel${i}`, unit);
      u.v2(`uLevel${i}Texel`, 1 / level.w, 1 / level.h);
    }

    // Always bound, so the sampler is complete even when the passes were
    // skipped; post.frag only reads it when the effect is on.
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, post.streak[1].tex);
    u.i('uStreakTex', 6);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Smears highlights along one axis into `streak[1]`.
   *
   * Two passes whose tap spacing differs by 9x — the second pass steps exactly
   * past the first's whole nine-tap span, so the first fills the gaps the
   * second would otherwise leave as discrete blobs. That reaches far wider than
   * nine taps could alone, and a streak has to cross a real fraction of the
   * frame to read as a lens artefact rather than as smudged bloom.
   *
   * Spacing is a fraction of frame *height*, never of the chain level's texels.
   * Texels would tie the streak's length to the render resolution — an 8K
   * export would come out with a streak an eighth the length of its own
   * preview, which is the same resolution-dependence trap the world-space
   * epsilon in liquid.frag exists to avoid.
   */
  private runStreak(post: PostTargets, params: Params) {
    const gl = this.gl;
    const src = post.levels[STREAK_LEVEL];
    const [a, b] = post.streak;
    const angle = (params.streakAngle * Math.PI) / 180;
    // Four taps per side, so per-tap spacing of REACH/4 lands the outermost tap
    // at REACH. The two passes together reach 10x the first alone.
    const REACH = 0.22;
    // uv is normalised per axis, so travelling at a true pixel-space angle needs
    // x scaled by the aspect. Without it the streak shears on a phone frame.
    const aspect = b.h / Math.max(b.w, 1);
    const dir: [number, number] = [Math.cos(angle) * aspect, Math.sin(angle)];

    gl.useProgram(this.blurProgram);
    const u = this.blurUniforms;

    const pass = (from: Target, to: Target, spacing: number, threshold: boolean) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
      gl.viewport(0, 0, to.w, to.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      u.i('uSrc', 0);
      u.v2('uDstTexel', 1 / to.w, 1 / to.h);
      u.v2('uStep', dir[0] * spacing, dir[1] * spacing);
      u.f('uThreshold', params.bloomThreshold);
      u.f('uThresholdOn', threshold ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    pass(src, a, REACH / 36, true);
    pass(a, b, REACH / 4, false);
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

  /**
   * Post targets matching the preview. Held between frames — reallocating a
   * float buffer every frame would cost more than the passes it feeds — and
   * kept once allocated, so dragging the Bloom slider through zero does not
   * thrash them.
   */
  private ensurePreviewPost(width: number, height: number): PostTargets | null {
    const cur = this.previewPost;
    if (cur && cur.scene.w === width && cur.scene.h === height) return cur;
    if (cur) this.freePost(cur);
    this.previewPost = null;
    if (this.previewPostFailed) return null;

    try {
      this.previewPost = this.allocPost(width, height);
    } catch {
      // draw() runs inside requestAnimationFrame, where an exception would take
      // the whole loop down and freeze the preview for good. Dropping back to
      // the direct path costs the effects and nothing else.
      this.previewPostFailed = true;
    }
    return this.previewPost;
  }

  /** Synchronous draw to the canvas, through the post chain when one is needed. */
  draw(params: Params, time: number) {
    const gl = this.gl;
    const { width, height } = this.canvas;
    const post = this.usesPostChain(params) ? this.ensurePreviewPost(width, height) : null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, post ? post.scene.fbo : null);
    this.beginLiquid(width, height, params, time, true, !!post);
    gl.disable(gl.SCISSOR_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (post) this.runPost(post, null, width, height, params, true);
  }

  // --------------------------------------------------------------- export --

  /**
   * Largest supersampling factor that fits, and what stopped it if it had to
   * come down: the GPU's texture-size limit, or the memory the post chain's
   * float targets would need.
   */
  planSsaa(width: number, height: number, requested: number, post: boolean): SsaaPlan {
    let factor = Math.max(1, Math.min(4, Math.round(requested)));
    let limit: SsaaLimit = null;

    while (factor > 1 && (width * factor > this.maxTextureSize || height * factor > this.maxTextureSize)) {
      factor--;
      limit = 'size';
    }
    if (post) {
      while (factor > 1 && width * factor * height * factor * POST_BYTES_PER_PX > POST_BUDGET_BYTES) {
        factor--;
        limit = 'memory';
      }
    }
    return { factor, limit };
  }

  /**
   * Allocates everything a render at this size needs. Held across a whole frame
   * sequence so a 180-frame video doesn't allocate 180 framebuffers.
   */
  private openSession(width: number, height: number, ssaa: number, post: boolean) {
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new RendererError(
        `${width}×${height} exceeds this GPU's maximum render size of ${this.maxTextureSize} px.`,
      );
    }

    const gl = this.gl;
    const factor = this.planSsaa(width, height, ssaa, post).factor;
    const owned: Target[] = [];
    let postTargets: PostTargets | null = null;

    const abandon = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const t of owned) this.freeTarget(t);
      if (postTargets) this.freePost(postTargets);
    };

    try {
      const hi = this.makeTarget(width * factor, height * factor, gl.RGBA8, gl.NEAREST);
      owned.push(hi);
      const lo = factor > 1 ? this.makeTarget(width, height, gl.RGBA8, gl.NEAREST) : null;
      if (lo) owned.push(lo);
      if (post) postTargets = this.allocPost(width * factor, height * factor);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      if (!ctx) throw new RendererError('Could not create a 2D context for the export.');

      return {
        factor,
        hi,
        lo,
        post: postTargets,
        canvas,
        ctx,
        pixels: new Uint8Array(width * height * 4),
        flipped: new Uint8ClampedArray(width * height * 4),
        close: abandon,
      };
    } catch (e) {
      abandon();
      throw e;
    }
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
    const { factor, hi, lo, post, ctx, pixels, flipped } = session;
    const renderW = width * factor;
    const renderH = height * factor;
    // Dither belongs at output resolution, so it happens either here or in the
    // resolve pass, never both.
    const dither = factor === 1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, post ? post.scene.fbo : hi.fbo);
    this.beginLiquid(renderW, renderH, params, time, dither, !!post);

    if (chunked) {
      await this.renderChunked(renderW, renderH, onProgress);
      if (this.disposed) return;
    } else {
      gl.disable(gl.SCISSOR_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    if (post) this.runPost(post, hi.fbo, renderW, renderH, params, dither);

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
    const session = this.openSession(width, height, ssaa, this.usesPostChain(params));
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
    const session = this.openSession(width, height, ssaa, this.usesPostChain(params));
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
    for (const { program } of this.liquidVariants.values()) gl.deleteProgram(program);
    this.liquidVariants.clear();
    gl.deleteProgram(this.resolveProgram);
    gl.deleteProgram(this.downsampleProgram);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.postProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.rampTex);
    gl.deleteTexture(this.matcapTex);
    if (this.previewPost) {
      this.freePost(this.previewPost);
      this.previewPost = null;
    }
    // Deliberately no WEBGL_lose_context here. A canvas hands out the same
    // context object forever, so killing it would leave a StrictMode remount
    // (or any future re-init on this canvas) holding a dead context.
  }
}
