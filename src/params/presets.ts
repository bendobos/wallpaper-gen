import { DEFAULTS, type Params } from './schema';

export interface Preset {
  name: string;
  params: Params;
}

const make = (over: Partial<Params>): Params => ({ ...DEFAULTS, ...over });

/**
 * Built-in looks, each tuned toward one of the reference styles. They are just
 * parameter sets — there is no special-case code behind any of them, which is
 * the payoff of driving everything from one shader.
 */
export const BUILTIN_PRESETS: readonly Preset[] = [
  {
    // High-frequency turbulent chrome: heavy warping, hard ridges, tight specular.
    name: 'Chrome Mercury',
    params: make({
      seed: 1337, scale: 0.85, warp: 1.1, warpIters: 2, octaves: 4, gain: 0.36,
      ridge: 0.4, anisotropy: 1.2, relief: 0.7, crease: 0.3, microDetail: 0.08,
      material: 0, reflectivity: 1.05, roughness: 0.07,
      lightAngle: 40, lightElev: 38, keyIntensity: 0.8, envBands: 3, envContrast: 1.0,
      ambient: 0.02, colorMode: 0, contrast: 1.2, grain: 0.006,
      rimWidth: 4, rimIntensity: 0.4,
    }),
  },
  {
    // Stretched directional waves with a strong thin-film tint.
    name: 'Iridescent Flow',
    params: make({
      seed: 284, scale: 0.5, warp: 0.5, warpIters: 2, octaves: 2, gain: 0.35,
      anisotropy: 2.6, flowAngle: 18, ridge: 0.15, relief: 1.0, crease: 0.2,
      microDetail: 0.05, material: 0, reflectivity: 1.0, roughness: 0.12,
      lightAngle: 25, lightElev: 55, keyIntensity: 1.0, envBands: 2, envContrast: 1.2,
      // Low iridescence frequency is the difference between broad purple-to-gold
      // sweeps and a rainbow-noise mess.
      ambient: 0.02, colorMode: 1, iriAmount: 0.6, iriFreq: 0.8, hueShift: -25,
      saturation: 1.1, contrast: 1.25, blackLevel: 0.05, vignette: 0.35, falloff: 1.3,
      grain: 0.006, rimWidth: 3.5, rimIntensity: 0.6,
    }),
  },
  {
    // Thin bright filaments over a huge black field: crushed blacks do the work.
    name: 'Ink Filament',
    params: make({
      seed: 7021, scale: 0.7, warp: 1.2, warpIters: 2, octaves: 2, gain: 0.35,
      ridge: 0.7, anisotropy: 1.6, flowAngle: -35, relief: 1.2, crease: 0.45,
      microDetail: 0.0, material: 0, reflectivity: 1.2, roughness: 0.03,
      lightAngle: 60, lightElev: 30, keyIntensity: 1.6, envBands: 2, envContrast: 1.6,
      ambient: 0.0, colorMode: 0, exposure: -0.3, contrast: 1.8, blackLevel: 0.2,
      vignette: 0.45, falloff: 1.2, grain: 0.004, rimWidth: 3, rimIntensity: 0.8,
    }),
  },
  {
    // Large smooth glass lobes; the read comes almost entirely from the rim.
    name: 'Dark Glass',
    params: make({
      seed: 512, scale: 0.6, warp: 0.5, warpIters: 2, octaves: 2, gain: 0.4,
      anisotropy: 1.3, ridge: 0.35, relief: 1.3, crease: 0.3, microDetail: 0.0,
      material: 1, reflectivity: 1.2, roughness: 0.05, ior: 1.5, dispersion: 0.06,
      thickness: 1.1, rimWidth: 2.5, rimIntensity: 1.3,
      lightAngle: 120, lightElev: 50, keyIntensity: 1.4, envBands: 2, envContrast: 1.0,
      ambient: 0.0, colorMode: 0, gradient: '0:05060b,1:dfe8ff',
      exposure: -0.1, contrast: 1.4, blackLevel: 0.05, vignette: 0.25, falloff: 1.4,
      grain: 0.005, background: '#000000',
    }),
  },
  {
    // Heavy chromatic dispersion. Needs a dark interior (high Thickness) and a
    // finely structured environment (many narrow softboxes) — the colour
    // fringes only appear where the three refracted rays hit different parts
    // of the environment, so a smooth gradient shows nothing.
    name: 'Prism Glass',
    params: make({
      seed: 3390, scale: 1.1, warp: 0.55, warpIters: 2, octaves: 2, gain: 0.4,
      anisotropy: 1.5, flowAngle: 45, ridge: 0.5, relief: 1.8, crease: 0.25,
      microDetail: 0.0, material: 1, reflectivity: 1.0, roughness: 0.03,
      ior: 1.4, dispersion: 0.3, thickness: 1.3, rimWidth: 2, rimIntensity: 1.0,
      lightAngle: -50, lightElev: 60, keyIntensity: 0.8, envBands: 4, envContrast: 1.3,
      ambient: 0.0, colorMode: 1, iriAmount: 0.5, iriFreq: 1.2, saturation: 1.2,
      exposure: -0.2, contrast: 1.3, blackLevel: 0.08, vignette: 0.25, falloff: 1.4,
      grain: 0.008, background: '#0b0806',
    }),
  },
];
