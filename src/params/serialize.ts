import { DEFAULTS, PARAM_LIST, PARAM_SCHEMA, type ParamKey, type Params } from './schema';

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
    } else if (def.kind === 'select') {
      const n = Number(v);
      if (Number.isFinite(n)) out[def.key] = Math.min(def.options.length - 1, Math.max(0, Math.round(n)));
    } else {
      const n = Number(v);
      if (Number.isFinite(n)) out[def.key] = Math.min(def.max, Math.max(def.min, n));
    }
  }
  return out as Params;
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
  return min + Math.round((value - min) / step) * step;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 10000);
}

/**
 * Samples every parameter that declares a `random` band. Parameters without one
 * (colours, phase, speed) are left alone deliberately — randomising those makes
 * results worse, not more interesting.
 */
export function randomizeParams(current: Params): Params {
  const out = { ...current } as Record<string, number | string>;
  for (const def of PARAM_LIST) {
    if (def.kind === 'color' || !def.random) continue;
    const [lo, hi] = def.random;
    const v = lo + Math.random() * (hi - lo);
    out[def.key] =
      def.kind === 'select'
        ? Math.min(def.options.length - 1, Math.max(0, Math.round(v)))
        : Math.min(def.max, Math.max(def.min, snap(v, def.step, def.min)));
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
