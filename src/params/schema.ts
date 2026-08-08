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
  // Everything that happens to the light after it leaves the surface but before
  // the grade. Split out of Post once it outgrew a single readable list.
  'Lens',
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

/** Multi-stop colour ramp, serialised as `pos:hex,…`. See params/gradient.ts. */
export interface GradientDef extends Base {
  readonly kind: 'gradient';
  readonly default: string;
}

export type ParamDef = SliderDef | SelectDef | ColorDef | GradientDef;

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
  // No random band: the three bases are different enough that shuffling
  // between them is a change of subject, not a variation. Cellular also costs
  // roughly twice a gradient evaluation, so Randomize would silently make the
  // preview slower.
  { kind: 'select', key: 'noiseBasis', label: 'Noise Basis', group: 'Flow', uniform: 'uNoiseBasis',
    options: ['Gradient', 'Cellular', 'Cellular Ridges'], default: 0,
    hint: 'Gradient is smooth and flowing. Cellular gives rounded cells with hard boundaries; Ridges gives the thin walls between them — cracks and veins, which gradient noise has no way to produce.' },
  { kind: 'slider', key: 'curl', label: 'Curl Flow', group: 'Flow', uniform: 'uCurl',
    min: 0, max: 1.5, step: 0.01, default: 0, random: [0, 0.8],
    hint: 'Advects the field along a divergence-free flow, so it transports rather than kneading in place. This is what turns the animation from churning into flowing.' },
  { kind: 'slider', key: 'curlScale', label: 'Curl Scale', group: 'Flow', uniform: 'uCurlScale',
    min: 0.2, max: 4, step: 0.01, default: 1,
    hint: 'Size of the vortices the flow wraps around.' },
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
  // Costs three extra height-field evaluations, roughly doubling the shading
  // cost — but only above zero, which is why it is gated in the shader.
  { kind: 'slider', key: 'cavity', label: 'Cavity', group: 'Surface', uniform: 'uCavity',
    min: 0, max: 1, step: 0.01, default: 0, random: [0, 0.6],
    hint: 'Darkens concave regions. Nothing here was ever shadowed before — this is what stops a crumpled surface from reading as flat.' },
  { kind: 'slider', key: 'cavityRange', label: 'Cavity Range', group: 'Surface', uniform: 'uCavityRange',
    min: 0.001, max: 0.06, step: 0.001, default: 0.01,
    hint: 'How deep a crease has to be to darken fully. Lower means more of the surface counts as a crease.' },
  { kind: 'slider', key: 'brush', label: 'Brushed', group: 'Surface', uniform: 'uBrush',
    min: 0, max: 1, step: 0.01, default: 0, random: [0, 0.8],
    hint: 'Squashes the Micro Detail noise into parallel striations, stretching the highlight across them. Needs Micro Detail above zero — it shapes that noise rather than adding its own.' },
  { kind: 'slider', key: 'brushAngle', label: 'Brush Angle', group: 'Surface', uniform: 'uBrushAngle',
    min: -90, max: 90, step: 1, default: 0, random: [-90, 90] },

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
  // Options 1..n must stay in step with MATCAPS in params/matcaps.ts, which the
  // leading Procedural entry offsets by one, and Custom must stay last.
  { kind: 'select', key: 'envMode', label: 'Environment', group: 'Lighting', uniform: 'uEnvMode',
    options: ['Procedural', 'Studio', 'Sunset', 'Neon City', 'Soft Tent', 'Custom…'], default: 0,
    hint: 'Procedural builds the environment from softbox strips, which vary only with height. A matcap is a painted lit sphere and can have structure the strips cannot.' },
  { kind: 'slider', key: 'lightAngle', label: 'Light Angle', group: 'Lighting', uniform: 'uLightAngle',
    min: -180, max: 180, step: 1, default: 35, random: [-180, 180] },
  { kind: 'slider', key: 'lightElev', label: 'Light Elevation', group: 'Lighting', uniform: 'uLightElev',
    min: 0, max: 90, step: 1, default: 45, random: [15, 75] },
  { kind: 'slider', key: 'keyIntensity', label: 'Key Intensity', group: 'Lighting', uniform: 'uKey',
    min: 0, max: 6, step: 0.01, default: 1.2, random: [0.4, 2.5] },
  { kind: 'slider', key: 'envBands', label: 'Softbox Count', group: 'Lighting', uniform: 'uEnvBands',
    min: 0, max: 8, step: 1, default: 3, random: [1, 5],
    hint: 'Horizontal strip lights in the procedural studio environment. Procedural only — a matcap has no strips to count.' },
  { kind: 'slider', key: 'envContrast', label: 'Env Contrast', group: 'Lighting', uniform: 'uEnvContrast',
    min: 0, max: 4, step: 0.01, default: 1.3, random: [0.5, 2.5],
    hint: 'Strength of the softbox strips. Over a matcap it becomes a gamma on the image instead, neutral at this default.' },
  { kind: 'slider', key: 'ambient', label: 'Ambient', group: 'Lighting', uniform: 'uAmbient',
    min: 0, max: 1, step: 0.005, default: 0.03, random: [0, 0.15] },

  // ------------------------------------------------------------------ color
  { kind: 'select', key: 'colorMode', label: 'Color Mode', group: 'Color', uniform: 'uColorMode',
    options: ['Ramp', 'Direct'], default: 0,
    hint: 'Ramp maps brightness through the gradient below. Direct keeps the shaded colour, which is what iridescence needs.' },
  { kind: 'gradient', key: 'gradient', label: 'Gradient', group: 'Color', default: '0:000000,1:ffffff',
    hint: 'Maps image brightness to colour. Click the bar to add a stop, drag to move, double-click to remove.' },
  { kind: 'slider', key: 'iriAmount', label: 'Iridescence', group: 'Color', uniform: 'uIriAmount',
    min: 0, max: 1, step: 0.01, default: 0, random: [0, 0.9] },
  { kind: 'slider', key: 'iriFreq', label: 'Iridescence Freq', group: 'Color', uniform: 'uIriFreq',
    min: 0.1, max: 8, step: 0.01, default: 2.2, random: [0.5, 4] },
  { kind: 'slider', key: 'hueShift', label: 'Hue Shift', group: 'Color', uniform: 'uHueShift',
    min: -180, max: 180, step: 1, default: 0, random: [-180, 180] },
  { kind: 'slider', key: 'saturation', label: 'Saturation', group: 'Color', uniform: 'uSaturation',
    min: 0, max: 2.5, step: 0.01, default: 1, random: [0.6, 1.6] },

  // ------------------------------------------------------------------- lens
  // Any of these above zero routes the render through an offscreen HDR chain
  // instead of the single direct pass. All neutral by default, which is what
  // keeps every existing look byte-identical — the chain is not merely
  // bypassed, it is never built.
  { kind: 'slider', key: 'bloom', label: 'Bloom', group: 'Lens', uniform: 'uBloom',
    min: 0, max: 2, step: 0.01, default: 0, random: [0, 0.6],
    hint: 'Glow bled out of the highlights, taken from the scene before the tonemap shoulder — which is why it reads as a lens rather than as a blurred copy.' },
  { kind: 'slider', key: 'bloomThreshold', label: 'Bloom Threshold', group: 'Lens', uniform: 'uBloomThreshold',
    min: 0, max: 3, step: 0.01, default: 0.8,
    hint: 'How bright a pixel must be to glow. Reflective surfaces run well past 1, so values above 1 still leave plenty glowing.' },
  { kind: 'slider', key: 'bloomRadius', label: 'Bloom Radius', group: 'Lens', uniform: 'uBloomRadius',
    min: 0.5, max: 4, step: 0.05, default: 1.5 },
  { kind: 'color', key: 'bloomTint', label: 'Glow Tint', group: 'Lens', uniform: 'uBloomTint',
    default: '#ffffff',
    hint: 'Colours both the bloom and the streak. Warm gives halation, cool gives the blue of an anamorphic lens.' },
  { kind: 'slider', key: 'streak', label: 'Anamorphic Streak', group: 'Lens', uniform: 'uStreak',
    min: 0, max: 2, step: 0.01, default: 0, random: [0, 0.5],
    hint: 'Smears highlights along one axis, the way a cinema anamorphic lens flares. Uses the Bloom Threshold to decide what counts as a highlight.' },
  // Consumed CPU-side: it sets the direction of the two blur passes, so there
  // is no uniform for the shader to read.
  { kind: 'slider', key: 'streakAngle', label: 'Streak Angle', group: 'Lens',
    min: -90, max: 90, step: 1, default: 0 },
  { kind: 'slider', key: 'chromatic', label: 'Chromatic Aberration', group: 'Lens', uniform: 'uChromatic',
    min: 0, max: 2, step: 0.01, default: 0, random: [0, 0.6],
    hint: 'Reads the three channels at slightly different radii, so the frame edges fringe while the centre stays clean.' },
  { kind: 'slider', key: 'distortion', label: 'Lens Distortion', group: 'Lens', uniform: 'uDistortion',
    min: -0.4, max: 0.4, step: 0.005, default: 0,
    hint: 'Barrel above zero, pincushion below. Barrel pulls the corners in from outside the frame, where they smear — which is where the range stops.' },
  // No random band: a blur with an unrelated focus height is just a blur, so
  // Randomize and Variations leave depth of field alone.
  { kind: 'slider', key: 'dof', label: 'Depth of Field', group: 'Lens', uniform: 'uDof',
    min: 0, max: 1, step: 0.01, default: 0,
    hint: 'There is no depth buffer here, so surface height is the depth: pick a height to keep sharp and everything away from it softens.' },
  { kind: 'slider', key: 'dofFocus', label: 'Focus Height', group: 'Lens', uniform: 'uDofFocus',
    min: 0, max: 1, step: 0.01, default: 0.5,
    hint: 'The height field sits near 0.5, so values near either end put nothing in focus. 0 favours the troughs, 1 the crests.' },
  { kind: 'slider', key: 'dofRange', label: 'Focus Range', group: 'Lens', uniform: 'uDofRange',
    min: 0.02, max: 1, step: 0.01, default: 0.3,
    hint: 'How much of the height range stays sharp.' },

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

/** Colour and gradient params are strings; everything else is a number. */
export type Params = {
  [D in Schema as D['key']]: D extends { kind: 'color' | 'gradient' } ? string : number;
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
