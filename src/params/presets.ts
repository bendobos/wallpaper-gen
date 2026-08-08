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

  // The five above predate matcaps, the lens chain, cavity and the cellular
  // basis. These use them. Anything selecting a matcap also sets Color Mode to
  // Direct — a matcap's whole contribution is its colour, and the ramp would
  // throw it away.
  {
    // Brushed titanium: the grain does the work, cavity gives it depth.
    name: 'Brushed Titanium',
    params: make({
      seed: 4410, scale: 0.75, warp: 0.45, warpIters: 2, octaves: 3, gain: 0.34,
      anisotropy: 1.4, ridge: 0.2, relief: 0.85, crease: 0.2,
      microDetail: 0.45, brush: 0.75, brushAngle: 8,
      cavity: 0.45, cavityRange: 0.012,
      material: 0, reflectivity: 1.0, roughness: 0.14,
      // A light tent, not the studio: an even, bright source is what shows a
      // grain. Under a dark studio matcap the striations vanish into the murk.
      envMode: 4, colorMode: 1, lightAngle: 25, lightElev: 40, keyIntensity: 0.8,
      ambient: 0.02, exposure: -0.2, contrast: 1.25, blackLevel: 0.04,
      bloom: 0.35, bloomThreshold: 1.1, grain: 0.01, vignette: 0.25,
    }),
  },
  {
    // Sunset chrome: the matcap supplies the palette, curl supplies the flow.
    name: 'Sunset Chrome',
    params: make({
      seed: 812, scale: 0.55, warp: 0.9, warpIters: 2, octaves: 3, gain: 0.38,
      anisotropy: 1.8, flowAngle: 12, ridge: 0.35, relief: 1.0, crease: 0.3,
      microDetail: 0.06, curl: 0.6, curlScale: 0.8,
      material: 0, reflectivity: 1.05, roughness: 0.1,
      envMode: 2, colorMode: 1, keyIntensity: 0.5, ambient: 0.01,
      exposure: -0.15, contrast: 1.2, blackLevel: 0.04,
      bloom: 0.8, bloomThreshold: 0.9, bloomTint: '#ffb27a',
      vignette: 0.3, falloff: 1.3, grain: 0.006,
    }),
  },
  {
    // Cracked enamel: cellular ridges are the whole point, cavity inks them in.
    name: 'Cracked Enamel',
    params: make({
      seed: 2255, noiseBasis: 2, scale: 0.85, warp: 0.35, warpIters: 1, octaves: 3,
      gain: 0.42, lacunarity: 2.1, ridge: 0.0, relief: 1.1, crease: 0.35,
      microDetail: 0.1, cavity: 0.8, cavityRange: 0.008,
      material: 0, reflectivity: 0.95, roughness: 0.25,
      lightAngle: 55, lightElev: 50, keyIntensity: 0.9, envBands: 2, envContrast: 1.1,
      colorMode: 0, gradient: '0:05060b,0.45:264a5c,0.72:9fc6c9,1:fdfaf2',
      contrast: 1.3, blackLevel: 0.06, grain: 0.01, vignette: 0.25,
    }),
  },
  {
    // A neon orb: shape mask plus streak, which is what the lens chain is for.
    name: 'Neon Orb',
    params: make({
      seed: 6103, shape: 1, shapeSize: 0.34, shapeEdge: 0.05,
      zoom: 0.95, scale: 1.2, warp: 0.8, warpIters: 2, octaves: 3, gain: 0.36,
      ridge: 0.3, relief: 1.0, crease: 0.3, microDetail: 0.08,
      material: 0, reflectivity: 1.35, roughness: 0.04,
      envMode: 3, colorMode: 1, keyIntensity: 0.9, ambient: 0.0,
      // Neon City is mostly black by design, so this needs the exposure back.
      exposure: 1.1, contrast: 1.2, blackLevel: 0.03,
      bloom: 1.0, bloomThreshold: 0.7, streak: 0.8, bloomTint: '#8fd0ff',
      dof: 0.5, dofFocus: 0.55, dofRange: 0.25,
      vignette: 0.4, falloff: 1.1, grain: 0.006,
    }),
  },
  {
    // Molten veins: cellular ridges carrying heat, with halation on top.
    name: 'Molten Vein',
    params: make({
      seed: 907, noiseBasis: 2, scale: 0.7, warp: 0.6, warpIters: 2, octaves: 4,
      gain: 0.4, anisotropy: 1.6, flowAngle: -20, relief: 1.3, crease: 0.4,
      microDetail: 0.05, curl: 0.45, cavity: 0.4,
      material: 0, reflectivity: 1.2, roughness: 0.15,
      lightAngle: 70, lightElev: 35, keyIntensity: 1.4, envBands: 3, envContrast: 1.5,
      colorMode: 0, gradient: '0:070200,0.42:5e1603,0.68:e0651a,0.88:ffc862,1:fff6df',
      exposure: -0.2, contrast: 1.45, blackLevel: 0.14,
      bloom: 1.1, bloomThreshold: 0.85, bloomTint: '#ff9c4a',
      vignette: 0.35, falloff: 1.2, grain: 0.008,
    }),
  },
  {
    // Soft arch: a light tent, a shape and shallow focus — the quiet one.
    name: 'Pearl Arch',
    params: make({
      seed: 3344, shape: 3, shapeSize: 0.3, shapeEdge: 0.07, panY: -0.12,
      scale: 0.5, warp: 0.5, warpIters: 2, octaves: 2, gain: 0.36,
      anisotropy: 1.2, ridge: 0.15, relief: 0.8, crease: 0.2, microDetail: 0.04,
      material: 0, reflectivity: 1.0, roughness: 0.3,
      envMode: 4, colorMode: 1, keyIntensity: 0.3, ambient: 0.03,
      exposure: -0.35, contrast: 1.1,
      bloom: 0.5, bloomThreshold: 1.2, chromatic: 0.35,
      dof: 0.6, dofFocus: 0.5, dofRange: 0.22,
      vignette: 0.25, grain: 0.007,
    }),
  },
];
