// Single source of truth for every tunable value in the app.
//
// This array drives BOTH the React control panel and the WebGL uniform upload.
// Adding a control is a one-line change here and nothing else, and the UI can
// never drift out of sync with what the shader actually reads.

export const GROUPS = [
  'Composition',
  'Flow',
  'Surface',
  'Material',
  'Lighting',
  'Color',
  'Post',
] as const;

export type Group = (typeof GROUPS)[number];

interface Base {
  readonly key: string;
  readonly label: string;
  readonly group: Group;
  /** Shader uniform to upload to. Omitted for values the app consumes itself. */
  readonly uniform?: string;
  readonly hint?: string;
  /** Kept out of the control panel; surfaced elsewhere in the UI instead. */
  readonly hidden?: boolean;
}

export interface SliderDef extends Base {
  readonly kind: 'slider';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** Narrower band used by Randomize, so random results stay usable. */
  readonly random?: readonly [number, number];
}

export interface SelectDef extends Base {
  readonly kind: 'select';
  readonly options: readonly string[];
  readonly default: number;
  readonly random?: readonly [number, number];
}

export interface ColorDef extends Base {
  readonly kind: 'color';
  readonly default: string;
}

export type ParamDef = SliderDef | SelectDef | ColorDef;

export const PARAM_SCHEMA = [
  // ------------------------------------------------------------ composition
  { kind: 'slider', key: 'seed', label: 'Seed', group: 'Composition', uniform: 'uSeed',
    min: 0, max: 9999, step: 1, default: 1337, random: [0, 9999],
    hint: 'Picks a different region of noise space. Same seed + same settings always gives the same image.' },
  { kind: 'slider', key: 'zoom', label: 'Zoom', group: 'Composition', uniform: 'uZoom',
    min: 0.15, max: 6, step: 0.01, default: 1, random: [0.5, 2] },
  { kind: 'slider', key: 'panX', label: 'Pan X', group: 'Composition', uniform: 'uPanX',
    min: -4, max: 4, step: 0.01, default: 0, random: [-2, 2] },
  { kind: 'slider', key: 'panY', label: 'Pan Y', group: 'Composition', uniform: 'uPanY',
    min: -4, max: 4, step: 0.01, default: 0, random: [-2, 2] },
  { kind: 'slider', key: 'rotation', label: 'Rotation', group: 'Composition', uniform: 'uRotation',
    min: -180, max: 180, step: 1, default: 0, random: [-180, 180] },

  // ------------------------------------------------------------------- flow
  { kind: 'slider', key: 'scale', label: 'Scale', group: 'Flow', uniform: 'uScale',
    min: 0.1, max: 8, step: 0.01, default: 1, random: [0.4, 1.8],
    hint: 'Size of the underlying noise features.' },
  { kind: 'slider', key: 'warp', label: 'Warp Strength', group: 'Flow', uniform: 'uWarp',
    min: 0, max: 3, step: 0.01, default: 0.9, random: [0.3, 1.6],
    hint: 'The most important control. Folds the noise field into itself — this is what makes it look poured rather than generated.' },
  { kind: 'slider', key: 'warpIters', label: 'Warp Iterations', group: 'Flow', uniform: 'uWarpIters',
    min: 1, max: 4, step: 1, default: 2, random: [1, 3],
    hint: 'Compounds the folding. Costs roughly 2 noise evaluations per step.' },
  { kind: 'slider', key: 'octaves', label: 'Octaves', group: 'Flow', uniform: 'uOctaves',
    min: 1, max: 8, step: 1, default: 3, random: [2, 5] },
  // At gain == 1/lacunarity every octave contributes equally to the *gradient*,
  // so the finest one dominates the normals and the surface reads as crumpled
  // foil. Keeping the default below that is what makes it look poured.
  { kind: 'slider', key: 'gain', label: 'Detail Gain', group: 'Flow', uniform: 'uGain',
    min: 0.2, max: 0.8, step: 0.01, default: 0.38, random: [0.28, 0.5] },
  { kind: 'slider', key: 'lacunarity', label: 'Lacunarity', group: 'Flow', uniform: 'uLacunarity',
    min: 1.3, max: 3.2, step: 0.01, default: 2, random: [1.7, 2.4] },
  { kind: 'slider', key: 'anisotropy', label: 'Stretch', group: 'Flow', uniform: 'uAnisotropy',
    min: 0.1, max: 8, step: 0.01, default: 1, random: [0.5, 4],
    hint: 'Squashes noise along one axis, producing directional flowing waves.' },
  { kind: 'slider', key: 'flowAngle', label: 'Flow Angle', group: 'Flow', uniform: 'uFlowAngle',
    min: -180, max: 180, step: 1, default: 0, random: [-180, 180] },
  { kind: 'slider', key: 'ridge', label: 'Ridge', group: 'Flow', uniform: 'uRidge',
    min: 0, max: 1, step: 0.01, default: 0, random: [0, 0.8],
    hint: 'Folds the height field at its midpoint to create hard creases.' },
  // The animation is periodic with a period of exactly 1.0, so Phase spans one
  // complete loop and nothing beyond 1 would show anything new.
  { kind: 'slider', key: 'phase', label: 'Phase', group: 'Flow',
    min: 0, max: 1, step: 0.001, default: 0,
    hint: 'Scrubs one full loop of the animation. Exports use exactly the frame you see.' },
  { kind: 'slider', key: 'motion', label: 'Motion', group: 'Flow', uniform: 'uMotion',
    min: 0, max: 0.4, step: 0.001, default: 0.06, random: [0.02, 0.15],
    hint: 'How far each noise layer travels over one loop. Affects the animation only — at Phase 0 the still image is identical at any value.' },
  // Lives next to the Play button rather than in the panel, so it is hidden
  // here. Still part of the schema so it serialises into the URL like anything
  // else. Expressed in seconds to match the export dialog's loop duration.
  { kind: 'slider', key: 'loopSeconds', label: 'Loop Duration', group: 'Flow', hidden: true,
    min: 2, max: 15, step: 0.5, default: 15,
    hint: 'How long one full loop of the preview takes. Video export sets its own duration.' },

  // ---------------------------------------------------------------- surface
  { kind: 'slider', key: 'relief', label: 'Relief', group: 'Surface', uniform: 'uRelief',
    min: 0.02, max: 4, step: 0.01, default: 0.8, random: [0.3, 1.4] },
  { kind: 'slider', key: 'microDetail', label: 'Micro Detail', group: 'Surface', uniform: 'uMicroDetail',
    min: 0, max: 1, step: 0.01, default: 0.15, random: [0, 0.4],
    hint: 'Perturbs the normal without changing the shape. Keeps polished surfaces from reading as plastic.' },
  { kind: 'slider', key: 'crease', label: 'Crease', group: 'Surface', uniform: 'uCrease',
    min: 0, max: 1, step: 0.01, default: 0.25, random: [0, 0.7] },

  // --------------------------------------------------------------- material
  { kind: 'select', key: 'material', label: 'Mode', group: 'Material', uniform: 'uMaterial',
    options: ['Metal', 'Glass'], default: 0, random: [0, 1] },
  { kind: 'slider', key: 'reflectivity', label: 'Reflectivity', group: 'Material', uniform: 'uReflect',
    min: 0, max: 2, step: 0.01, default: 1, random: [0.7, 1.4] },
  { kind: 'slider', key: 'roughness', label: 'Roughness', group: 'Material', uniform: 'uRoughness',
    min: 0, max: 1, step: 0.01, default: 0.12, random: [0, 0.4] },
  { kind: 'slider', key: 'ior', label: 'IOR', group: 'Material', uniform: 'uIOR',
    min: 1.01, max: 2.6, step: 0.01, default: 1.45, random: [1.2, 1.8],
    hint: 'Glass only. How strongly light bends passing through the surface.' },
  { kind: 'slider', key: 'dispersion', label: 'Dispersion', group: 'Material', uniform: 'uDispersion',
    min: 0, max: 0.4, step: 0.001, default: 0.03, random: [0, 0.15],
    hint: 'Glass only. Splits the refraction per colour channel for chromatic fringing.' },
  { kind: 'slider', key: 'thickness', label: 'Thickness', group: 'Material', uniform: 'uThickness',
    min: 0, max: 3, step: 0.01, default: 0.6, random: [0.2, 1.4] },
  { kind: 'slider', key: 'rimWidth', label: 'Rim Falloff', group: 'Material', uniform: 'uRimWidth',
    min: 0.5, max: 10, step: 0.1, default: 4, random: [2, 7] },
  { kind: 'slider', key: 'rimIntensity', label: 'Rim Intensity', group: 'Material', uniform: 'uRimIntensity',
    min: 0, max: 4, step: 0.01, default: 0.8, random: [0, 2] },

  // --------------------------------------------------------------- lighting
  { kind: 'slider', key: 'lightAngle', label: 'Light Angle', group: 'Lighting', uniform: 'uLightAngle',
    min: -180, max: 180, step: 1, default: 35, random: [-180, 180] },
  { kind: 'slider', key: 'lightElev', label: 'Light Elevation', group: 'Lighting', uniform: 'uLightElev',
    min: 0, max: 90, step: 1, default: 45, random: [15, 75] },
  { kind: 'slider', key: 'keyIntensity', label: 'Key Intensity', group: 'Lighting', uniform: 'uKey',
    min: 0, max: 6, step: 0.01, default: 1.2, random: [0.4, 2.5] },
  { kind: 'slider', key: 'envBands', label: 'Softbox Count', group: 'Lighting', uniform: 'uEnvBands',
    min: 0, max: 8, step: 1, default: 3, random: [1, 5],
    hint: 'Horizontal strip lights in the procedural studio environment.' },
  { kind: 'slider', key: 'envContrast', label: 'Env Contrast', group: 'Lighting', uniform: 'uEnvContrast',
    min: 0, max: 4, step: 0.01, default: 1.3, random: [0.5, 2.5] },
  { kind: 'slider', key: 'ambient', label: 'Ambient', group: 'Lighting', uniform: 'uAmbient',
    min: 0, max: 1, step: 0.005, default: 0.03, random: [0, 0.15] },

  // ------------------------------------------------------------------ color
  { kind: 'select', key: 'palette', label: 'Palette', group: 'Color', uniform: 'uPalette',
    options: ['Mono', 'Duotone', 'Full Color'], default: 0, random: [0, 2] },
  { kind: 'color', key: 'colorA', label: 'Color A', group: 'Color', uniform: 'uColorA',
    default: '#ffffff' },
  { kind: 'color', key: 'colorB', label: 'Color B', group: 'Color', uniform: 'uColorB',
    default: '#0a0a12' },
  { kind: 'slider', key: 'iriAmount', label: 'Iridescence', group: 'Color', uniform: 'uIriAmount',
    min: 0, max: 1, step: 0.01, default: 0, random: [0, 0.9] },
  { kind: 'slider', key: 'iriFreq', label: 'Iridescence Freq', group: 'Color', uniform: 'uIriFreq',
    min: 0.1, max: 8, step: 0.01, default: 2.2, random: [0.5, 4] },
  { kind: 'slider', key: 'hueShift', label: 'Hue Shift', group: 'Color', uniform: 'uHueShift',
    min: -180, max: 180, step: 1, default: 0, random: [-180, 180] },
  { kind: 'slider', key: 'saturation', label: 'Saturation', group: 'Color', uniform: 'uSaturation',
    min: 0, max: 2.5, step: 0.01, default: 1, random: [0.6, 1.6] },

  // ------------------------------------------------------------------- post
  { kind: 'slider', key: 'exposure', label: 'Exposure', group: 'Post', uniform: 'uExposure',
    min: -4, max: 4, step: 0.01, default: 0, random: [-1, 1] },
  { kind: 'slider', key: 'contrast', label: 'Contrast', group: 'Post', uniform: 'uContrast',
    min: 0.2, max: 3.5, step: 0.01, default: 1, random: [0.7, 2] },
  { kind: 'slider', key: 'blackLevel', label: 'Black Level', group: 'Post', uniform: 'uBlackLevel',
    min: 0, max: 0.9, step: 0.005, default: 0, random: [0, 0.4],
    hint: 'Crushes the shadows. How the high-contrast filament look gets its huge black field.' },
  { kind: 'slider', key: 'vignette', label: 'Vignette', group: 'Post', uniform: 'uVignette',
    min: 0, max: 1, step: 0.01, default: 0, random: [0, 0.7] },
  { kind: 'slider', key: 'falloff', label: 'Vignette Falloff', group: 'Post', uniform: 'uFalloff',
    min: 0.2, max: 3, step: 0.01, default: 1, random: [0.5, 1.6] },
  { kind: 'slider', key: 'grain', label: 'Grain', group: 'Post', uniform: 'uGrain',
    min: 0, max: 0.25, step: 0.001, default: 0.008, random: [0, 0.03] },
  { kind: 'color', key: 'background', label: 'Background', group: 'Post', uniform: 'uBackground',
    default: '#000000' },
] as const satisfies readonly ParamDef[];

type Schema = (typeof PARAM_SCHEMA)[number];

export type ParamKey = Schema['key'];

/**
 * Widened view for iteration. `PARAM_SCHEMA` keeps literal types so `Params` can
 * be derived from it, but that makes it a union whose members don't all declare
 * the optional fields — iterate this instead.
 */
export const PARAM_LIST: readonly ParamDef[] = PARAM_SCHEMA;

/** Colour params are hex strings; everything else is a number. */
export type Params = {
  [D in Schema as D['key']]: D extends { kind: 'color' } ? string : number;
};

export const DEFAULTS: Params = Object.fromEntries(
  PARAM_SCHEMA.map((d) => [d.key, d.default]),
) as Params;

/** Drives the control panel, so `hidden` params are filtered out here. */
export const BY_GROUP: ReadonlyArray<readonly [Group, readonly ParamDef[]]> = GROUPS.map(
  (g) => [g, PARAM_LIST.filter((d) => d.group === g && !d.hidden)] as const,
);

export const SCHEMA_BY_KEY = new Map<string, ParamDef>(
  PARAM_SCHEMA.map((d) => [d.key as string, d as ParamDef]),
);
