import {
  DEFAULTS,
  PARAM_LIST,
  PARAM_SCHEMA,
  type ParamDef,
  type ParamKey,
  type Params,
} from './schema';
import { isValidGradient, MONO_RAMP } from './gradient';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Clamps arbitrary input to something the shader can safely consume. */
export function sanitize(raw: unknown): Params {
  const out = { ...DEFAULTS } as Record<string, number | string>;
  if (!raw || typeof raw !== 'object') return out as Params;
  const src = raw as Record<string, unknown>;

  for (const def of PARAM_SCHEMA) {
    const v = src[def.key];
    if (v === undefined || v === null) continue;

    if (def.kind === 'color') {
      if (typeof v === 'string' && HEX.test(v.trim())) out[def.key] = v.trim().toLowerCase();
    } else if (def.kind === 'gradient') {
      if (typeof v === 'string' && isValidGradient(v.trim())) out[def.key] = v.trim().toLowerCase();
    } else if (def.kind === 'select') {
      const n = Number(v);
      if (Number.isFinite(n)) out[def.key] = Math.min(def.options.length - 1, Math.max(0, Math.round(n)));
    } else {
      const n = Number(v);
      if (Number.isFinite(n)) out[def.key] = Math.min(def.max, Math.max(def.min, n));
    }
  }

  migrateLegacyPalette(src, out);
  return out as Params;
}

/**
 * Converts the pre-gradient `palette` + `colorA` + `colorB` triple into the
 * equivalent ramp, so links and saved presets from before the gradient editor
 * still load looking the way they did.
 *
 * Only applies when the input has no gradient of its own — a current payload
 * always wins.
 */
function migrateLegacyPalette(src: Record<string, unknown>, out: Record<string, number | string>) {
  if (src.palette === undefined) return;
  if (typeof src.gradient === 'string' && isValidGradient(src.gradient)) return;

  const hex = (v: unknown, fallback: string) =>
    typeof v === 'string' && HEX.test(v.trim()) ? v.trim().slice(1).toLowerCase() : fallback;

  const palette = Number(src.palette);
  if (palette === 2) {
    // "Full Color" kept the shaded colour untouched — that is Direct mode now.
    out.colorMode = 1;
  } else if (palette === 1) {
    out.colorMode = 0;
    out.gradient = `0:${hex(src.colorB, '0a0a12')},1:${hex(src.colorA, 'ffffff')}`;
  } else {
    out.colorMode = 0;
    out.gradient = MONO_RAMP;
  }
}

/** Only the values that differ from the defaults, so URLs stay short. */
function diffFromDefaults(p: Params): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const def of PARAM_SCHEMA) {
    const v = p[def.key as ParamKey];
    if (v !== def.default) {
      out[def.key] = typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v;
    }
  }
  return out;
}

const VERSION = '1';

export function encodeParams(p: Params): string {
  const json = JSON.stringify(diffFromDefaults(p));
  // All content is ASCII (numbers, hex colours, latin keys), so btoa is safe.
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${VERSION}.${b64}`;
}

export function decodeParams(s: string): Params | null {
  try {
    const body = s.startsWith(`${VERSION}.`) ? s.slice(VERSION.length + 1) : s;
    let b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return sanitize(JSON.parse(atob(b64)));
  } catch {
    return null;
  }
}

function snap(value: number, step: number, min: number): number {
  if (step <= 0) return value;
  const snapped = min + Math.round((value - min) / step) * step;
  // Strip float representation noise: without this, snapping 0.36 can yield
  // 0.35000000000000003, which displays identically but fails an equality
  // check — enough to dirty the URL and push a no-op undo entry.
  return Math.round(snapped * 1e6) / 1e6;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 10000);
}

type Explorable = Extract<ParamDef, { kind: 'slider' | 'select' }> & {
  random: readonly [number, number];
};

/**
 * Parameters that take part in random exploration: everything declaring a
 * `random` band. Those without one (colours, phase, loopSeconds) are left alone
 * deliberately — randomising them makes results worse, not more interesting.
 */
function explorable(): Explorable[] {
  return PARAM_LIST.filter(
    (d): d is Explorable => (d.kind === 'slider' || d.kind === 'select') && !!d.random,
  );
}

/** Clamps a raw value onto a parameter's own grid. */
function fit(def: Explorable, v: number): number {
  return def.kind === 'select'
    ? Math.min(def.options.length - 1, Math.max(0, Math.round(v)))
    : Math.min(def.max, Math.max(def.min, snap(v, def.step, def.min)));
}

/**
 * Chaotic parameters, where a small change is not a small change.
 *
 * `seed` indexes into noise space through a hash, so nudging it by 1 gives a
 * completely unrelated composition. Including it in a *mutation* would defeat
 * the point of exploring the neighbourhood of a look — the Seed button is there
 * when a new composition is what you want.
 */
const CHAOTIC = new Set<string>(['seed']);

/** Box-Muller normal deviate. */
function gauss(): number {
  const u = Math.random() || 1e-9;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

/** Samples every explorable parameter uniformly across its band. */
export function randomizeParams(current: Params): Params {
  const out = { ...current } as Record<string, number | string>;
  for (const def of explorable()) {
    const [lo, hi] = def.random;
    out[def.key] = fit(def, lo + Math.random() * (hi - lo));
  }
  return out as Params;
}

/**
 * Nudges every explorable parameter around its *current* value, rather than
 * resampling it. `spread` of 0 reproduces the input; 1 wanders about a third of
 * each band per step.
 *
 * Clamping is to the parameter's full range, not to its band: a preset may
 * legitimately sit outside the band, and yanking it back in would change the
 * look rather than vary it.
 */
export function mutateParams(current: Params, spread: number): Params {
  const out = { ...current } as Record<string, number | string>;
  for (const def of explorable()) {
    if (CHAOTIC.has(def.key)) continue;
    const [lo, hi] = def.random;
    const sigma = (hi - lo) * spread * 0.35;
    out[def.key] = fit(def, Number(current[def.key as ParamKey]) + gauss() * sigma);
  }
  return out as Params;
}

// ------------------------------------------------------------- persistence --

const STORAGE_STATE = 'wallpaper-gen:state';
const STORAGE_PRESETS = 'wallpaper-gen:presets';

export function loadStoredParams(): Params | null {
  try {
    const raw = localStorage.getItem(STORAGE_STATE);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function storeParams(p: Params) {
  try {
    localStorage.setItem(STORAGE_STATE, JSON.stringify(diffFromDefaults(p)));
  } catch {
    /* private mode / quota — not worth surfacing */
  }
}

export interface StoredPreset {
  name: string;
  params: Params;
}

export function loadUserPresets(): StoredPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_PRESETS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.name === 'string')
      .map((e) => ({ name: String(e.name).slice(0, 60), params: sanitize(e.params) }));
  } catch {
    return [];
  }
}

export function storeUserPresets(list: StoredPreset[]) {
  try {
    localStorage.setItem(
      STORAGE_PRESETS,
      JSON.stringify(list.map((p) => ({ name: p.name, params: diffFromDefaults(p.params) }))),
    );
  } catch {
    /* ignore */
  }
}
