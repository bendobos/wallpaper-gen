/**
 * Built-in matcap environments — painted, not photographed.
 *
 * A matcap is the image a mirrored sphere would show, indexed by the view-space
 * normal, so painting directly in that space is how they are authored in the
 * first place. Generating them here rather than shipping JPEGs keeps the bundle
 * at zero extra bytes and the app free of image assets, which matters more than
 * photographic provenance for something only ever seen smeared across a warped
 * surface.
 *
 * Values are stored in display range and expanded to HDR in the shader
 * (`m * m * m * MATCAP_GAIN`, see liquid.frag), so a pure-white core reads as a
 * blown specular instead of as flat white, and the mid-greys land near the 0.42
 * the procedural environment uses for its sky.
 */

export const MATCAP_SIZE = 256;

/**
 * Mip levels in the matcap chain: 256 down to 4. Roughness indexes into these,
 * so the top of the chain has to be blurry enough to pass for a fully diffuse
 * reflection. `MATCAP_MAX_LOD` in liquid.frag is this minus one.
 */
export const MATCAP_LEVELS = 7;

/** `#rrggbb` plus an alpha, in the form canvas 2D wants. */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Vertical base gradient. Top of the canvas is up, matching the upload flip. */
function sky(ctx: CanvasRenderingContext2D, stops: ReadonlyArray<readonly [number, string]>) {
  const g = ctx.createLinearGradient(0, 0, 0, MATCAP_SIZE);
  for (const [p, c] of stops) g.addColorStop(p, c);
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, MATCAP_SIZE, MATCAP_SIZE);
}

/**
 * An additive elliptical light source. Additive rather than alpha-blended
 * because that is what overlapping lights actually do, and because letting the
 * cores clip to white is how they end up blown out after the shader's gain.
 *
 * All coordinates and radii are fractions of the matcap, so the numbers below
 * read as positions in the environment rather than as pixels.
 */
function light(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  intensity: number,
  core = 0.3,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx * MATCAP_SIZE, cy * MATCAP_SIZE);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, MATCAP_SIZE);
  g.addColorStop(0, rgba(color, intensity));
  g.addColorStop(core, rgba(color, intensity * 0.42));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-2 * MATCAP_SIZE, -2 * MATCAP_SIZE, 4 * MATCAP_SIZE, 4 * MATCAP_SIZE);
  ctx.restore();
}

/** Darkens, for cloud banding and horizon separation. */
function shade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
  blur: number,
) {
  ctx.save();
  ctx.filter = `blur(${blur * MATCAP_SIZE}px)`;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x * MATCAP_SIZE, y * MATCAP_SIZE, w * MATCAP_SIZE, h * MATCAP_SIZE);
  ctx.restore();
}

// ------------------------------------------------------------- environments --

/** A three-light product shot: key, fill, and the white sweep bouncing back. */
function paintStudio(ctx: CanvasRenderingContext2D) {
  sky(ctx, [
    [0, '#1b222c'],
    [0.42, '#0b0e13'],
    [0.7, '#05070a'],
    [0.9, '#161a20'],
    [1, '#262c34'],
  ]);
  light(ctx, 0.33, 0.24, 0.42, 0.3, '#ffffff', 1, 0.28);
  light(ctx, 0.76, 0.44, 0.26, 0.34, '#c6d2e4', 0.7);
  light(ctx, 0.5, 0.02, 0.9, 0.07, '#e6eefb', 0.85, 0.2);
  light(ctx, 0.5, 1.0, 0.7, 0.16, '#8fa0b8', 0.5);
  light(ctx, 0.08, 0.68, 0.14, 0.2, '#7f8ea6', 0.45);
}

/** Warm sky over a dark ground, with the sun's column running down from it. */
function paintSunset(ctx: CanvasRenderingContext2D) {
  sky(ctx, [
    [0, '#100e2c'],
    [0.24, '#331a4a'],
    [0.42, '#8c3651'],
    [0.54, '#e0703c'],
    [0.585, '#ffd08a'],
    [0.6, '#2a170e'],
    [0.78, '#120a07'],
    [1, '#070404'],
  ]);
  // Cloud banding: thin dark strips only ever read as cloud against a gradient.
  shade(ctx, 0.0, 0.3, 1.0, 0.018, '#1a0f22', 0.55, 0.012);
  shade(ctx, 0.1, 0.44, 0.9, 0.014, '#2a1020', 0.5, 0.01);
  shade(ctx, 0.0, 0.5, 0.7, 0.012, '#3a1520', 0.45, 0.008);

  light(ctx, 0.38, 0.5, 0.34, 0.34, '#ff8a3c', 0.55, 0.18);
  light(ctx, 0.38, 0.5, 0.055, 0.055, '#fff6dc', 1, 0.55);
  // The sun's reflection on whatever is below the horizon.
  light(ctx, 0.38, 0.76, 0.055, 0.3, '#ff9448', 0.45);
  light(ctx, 0.5, 0.59, 0.9, 0.012, '#ffcf90', 0.7, 0.2);
}

/** Scattered coloured sources over near-black: the reason to have matcaps. */
function paintNeon(ctx: CanvasRenderingContext2D) {
  sky(ctx, [
    [0, '#05060f'],
    [0.45, '#0c0e1e'],
    [0.62, '#1a1440'],
    [0.66, '#07060f'],
    [1, '#030307'],
  ]);
  // A near-flat surface only ever samples the middle of the disc (see
  // envMatcap), so the interesting sources have to live near the centre. Push
  // them to the corners and this environment reads as black.
  light(ctx, 0.5, 0.52, 0.5, 0.4, '#3a2a6e', 0.42, 0.3);
  light(ctx, 0.31, 0.4, 0.22, 0.22, '#ff2f8e', 0.95, 0.22);
  light(ctx, 0.68, 0.36, 0.2, 0.2, '#2ee6ff', 0.9, 0.22);
  light(ctx, 0.5, 0.58, 0.16, 0.16, '#ffb03a', 0.85, 0.2);
  light(ctx, 0.79, 0.58, 0.17, 0.17, '#8a4dff', 0.8, 0.22);
  light(ctx, 0.19, 0.6, 0.15, 0.15, '#28ffc0', 0.75, 0.2);
  // Small hot cores. Without these the whole thing is soft haze and the
  // surface gets nothing sharp to reflect.
  light(ctx, 0.31, 0.4, 0.022, 0.022, '#ffffff', 1, 0.5);
  light(ctx, 0.68, 0.36, 0.02, 0.02, '#ffffff', 1, 0.5);
  light(ctx, 0.5, 0.58, 0.016, 0.016, '#ffffff', 1, 0.5);
  light(ctx, 0.42, 0.2, 0.014, 0.014, '#ffffff', 0.9, 0.5);
  // Reflections in the wet ground below the horizon line.
  light(ctx, 0.31, 0.8, 0.035, 0.2, '#ff2f8e', 0.45);
  light(ctx, 0.68, 0.76, 0.03, 0.17, '#2ee6ff', 0.42);
  light(ctx, 0.5, 0.84, 0.028, 0.15, '#ffb03a', 0.38);
}

/** A light tent: bright, near-shadowless, very little contrast anywhere. */
function paintTent(ctx: CanvasRenderingContext2D) {
  sky(ctx, [
    [0, '#f4f6f9'],
    [0.32, '#d2d7de'],
    [0.6, '#949ba4'],
    [0.86, '#5f656d'],
    [1, '#7b828b'],
  ]);
  light(ctx, 0.5, 0.14, 0.62, 0.4, '#ffffff', 0.7, 0.35);
  light(ctx, 0.5, 1.02, 0.62, 0.2, '#c9ced5', 0.45);
  light(ctx, 0.18, 0.5, 0.2, 0.5, '#ffffff', 0.18);
  light(ctx, 0.82, 0.5, 0.2, 0.5, '#ffffff', 0.18);
}

export interface MatcapDef {
  readonly name: string;
  readonly paint: (ctx: CanvasRenderingContext2D) => void;
}

/**
 * Order must match the `envMode` options in params/schema.ts, offset by one for
 * the leading Procedural entry.
 */
export const MATCAPS: readonly MatcapDef[] = [
  { name: 'Studio', paint: paintStudio },
  { name: 'Sunset', paint: paintSunset },
  { name: 'Neon City', paint: paintNeon },
  { name: 'Soft Tent', paint: paintTent },
];

/** `envMode` value for the procedural studio, i.e. no matcap at all. */
export const ENV_PROCEDURAL = 0;
/** `envMode` value for a user-supplied image. Always the last option. */
export const ENV_CUSTOM = MATCAPS.length + 1;

function square(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not build the matcap mip chain');
  return [canvas, ctx];
}

/**
 * Builds the mip chain, level 0 first.
 *
 * Each level is band-limited at *full* resolution and only then downscaled.
 * That order matters: `ctx.filter` applies in destination space, so blurring as
 * part of the downscale merely softens aliasing that has already happened, and
 * leaves the small levels visibly blocky — which is the same defect that makes
 * `generateMipmap`'s box averages unusable here. Roughness magnifies these
 * levels back to full frame, so blocks in them become blocks on screen.
 */
function buildLevels(base: HTMLCanvasElement): ImageData[] {
  const read = (c: HTMLCanvasElement) =>
    c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);

  const levels = [read(base)];

  for (let i = 1; i < MATCAP_LEVELS; i++) {
    const size = Math.max(1, MATCAP_SIZE >> i);
    const sigma = Math.pow(2, i - 1);

    const [soft, sctx] = square(MATCAP_SIZE);
    sctx.filter = `blur(${sigma}px)`;
    // Drawn overscanned by roughly three sigma so the blur has colour to pull
    // from beyond the frame. Left alone it would sample transparent black and
    // darken the rim — which is exactly the part of the matcap the steepest
    // slopes reflect. The magnification this costs is under 3% at the levels
    // where positions still matter.
    const over = 1 + (sigma * 6) / MATCAP_SIZE;
    const offset = (-MATCAP_SIZE * (over - 1)) / 2;
    sctx.drawImage(base, offset, offset, MATCAP_SIZE * over, MATCAP_SIZE * over);

    const [next, nctx] = square(size);
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(soft, 0, 0, size, size);
    levels.push(read(next));
  }

  return levels;
}

const cache = new Map<number, ImageData[]>();

/**
 * Rasterises a built-in matcap and its mip chain. Painting costs a couple of
 * milliseconds, so it happens on selection rather than at startup, and is
 * cached afterwards.
 */
export function bakeMatcap(envMode: number): ImageData[] {
  const index = envMode - 1;
  const def = MATCAPS[index];
  if (!def) throw new Error(`No built-in matcap for envMode ${envMode}`);

  const hit = cache.get(index);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = MATCAP_SIZE;
  canvas.height = MATCAP_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not rasterise the matcap');

  def.paint(ctx);
  const levels = buildLevels(canvas);
  cache.set(index, levels);
  return levels;
}

/**
 * Scales an uploaded image into matcap space and builds its mip chain.
 *
 * Drawing through a canvas rather than asking `createImageBitmap` to resize
 * keeps this working in browsers that ignore its resize options, and hands the
 * renderer the same shape the built-ins produce.
 */
export async function imageToMatcap(source: Blob): Promise<ImageData[]> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = MATCAP_SIZE;
    canvas.height = MATCAP_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not read the image');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, MATCAP_SIZE, MATCAP_SIZE);
    return buildLevels(canvas);
  } finally {
    bitmap.close();
  }
}
