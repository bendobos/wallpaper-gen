/**
 * Colour ramps, serialised as `pos:hex,pos:hex,…` — e.g.
 * `0:000000,0.55:6b3fa0,1:ffd9a0`.
 *
 * A string keeps the whole gradient inside the existing `Params` value type,
 * so it round-trips through the URL hash with no special handling.
 */

export interface Stop {
  pos: number;
  hex: string; // six lowercase hex digits, no leading #
}

export const RAMP_WIDTH = 256;

const STOP_RE = /^([0-9]*\.?[0-9]+):([0-9a-fA-F]{6})$/;

export function parseGradient(spec: string): Stop[] {
  const stops: Stop[] = [];
  for (const part of spec.split(',')) {
    const m = STOP_RE.exec(part.trim());
    if (!m) continue;
    const pos = Number(m[1]);
    if (!Number.isFinite(pos)) continue;
    stops.push({ pos: Math.min(1, Math.max(0, pos)), hex: m[2].toLowerCase() });
  }
  stops.sort((a, b) => a.pos - b.pos);
  // A ramp needs two ends. Anything unparseable falls back to plain mono.
  if (stops.length < 2) return [{ pos: 0, hex: '000000' }, { pos: 1, hex: 'ffffff' }];
  return stops;
}

export function formatGradient(stops: Stop[]): string {
  return [...stops]
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${Math.round(s.pos * 1000) / 1000}:${s.hex.toLowerCase()}`)
    .join(',');
}

export function isValidGradient(spec: string): boolean {
  const parts = spec.split(',');
  return parts.length >= 2 && parts.every((p) => STOP_RE.test(p.trim()));
}

/** CSS gradient for previewing a ramp in the DOM. */
export function toCss(spec: string, angle = '90deg'): string {
  const stops = parseGradient(spec)
    .map((s) => `#${s.hex} ${(s.pos * 100).toFixed(1)}%`)
    .join(', ');
  return `linear-gradient(${angle}, ${stops})`;
}

/**
 * Rasterises a ramp to a 256×1 RGBA strip for upload as a lookup texture.
 * Uses canvas 2D so the browser's own gradient interpolation does the work.
 */
export function bakeGradient(spec: string): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = RAMP_WIDTH;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not rasterise the gradient');

  const grad = ctx.createLinearGradient(0, 0, RAMP_WIDTH, 0);
  for (const s of parseGradient(spec)) grad.addColorStop(s.pos, `#${s.hex}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, RAMP_WIDTH, 1);

  return ctx.getImageData(0, 0, RAMP_WIDTH, 1);
}

export const MONO_RAMP = '0:000000,1:ffffff';

export const RAMP_PRESETS: ReadonlyArray<{ name: string; spec: string }> = [
  { name: 'Mono', spec: MONO_RAMP },
  { name: 'Chrome', spec: '0:05070c,0.42:5c6a7a,0.62:c9d6e2,1:ffffff' },
  { name: 'Gold', spec: '0:0a0600,0.4:6b4415,0.68:d9a441,1:fff3d0' },
  { name: 'Oil Slick', spec: '0:05060b,0.35:2b1a5e,0.6:1f7a8c,0.8:c4467a,1:ffe9b8' },
  { name: 'Neon', spec: '0:04040a,0.45:12224f,0.7:2ee6d6,1:fff6a0' },
  { name: 'Pearl', spec: '0:0b0a10,0.4:6a5f7a,0.66:d7c9dd,1:fffdf8' },
  { name: 'Ember', spec: '0:080200,0.45:5c1405,0.72:d95f18,1:ffe08a' },
  { name: 'Ice', spec: '0:03060c,0.44:1d4a6b,0.7:79c3e3,1:f2fbff' },
];
