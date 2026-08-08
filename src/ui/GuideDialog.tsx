import { useEffect, useState, type ReactNode } from 'react';
import { SCHEMA_BY_KEY, type ParamDef, type ParamKey, type Params } from '../params/schema';
import type { UiMode } from '../params/serialize';

interface Props {
  onClose: () => void;
  /** Names the settings the way the panel currently in use names them. */
  mode: UiMode;
  /** Applies a recipe on top of the current look. The caller snapshots for undo. */
  onApply: (patch: Partial<Params>, name: string) => void;
}

type Tab = 'quality' | 'recipes' | 'workflow' | 'keys';

interface Recipe {
  name: string;
  /** Why it works. The *what* is rendered from the patch, so it cannot drift. */
  body: ReactNode;
  patch: Partial<Params>;
}

/**
 * Renders a patch entry the way the panel would show it, so the settings listed
 * under a recipe are generated from the values Apply actually writes rather
 * than typed out beside them.
 *
 * A recipe reaches past the Simple selection freely, so a setting with no Simple
 * name falls back to its expert one — which is also where you would go to find
 * it by hand.
 */
/** What the panel currently in use calls a control. */
function labelOf(key: ParamKey, simple: boolean): string {
  const def = SCHEMA_BY_KEY.get(key) as ParamDef | undefined;
  if (!def) return key;
  return (simple && def.simple?.label) || def.label;
}

function describe(key: string, value: number | string, simple: boolean): string {
  const def = SCHEMA_BY_KEY.get(key) as ParamDef | undefined;
  if (!def) return `${key} ${value}`;
  const label = labelOf(key as ParamKey, simple);
  if (def.kind === 'select') return `${label}: ${def.options[Number(value)]}`;
  if (def.kind === 'color') return `${label} ${value}`;
  if (def.kind === 'gradient') return label;
  const dp = def.step >= 1 ? 0 : Math.min(4, String(def.step).split('.')[1]?.length ?? 2);
  return `${label} ${Number(value).toFixed(dp)}`;
}

const RECIPES: readonly Recipe[] = [
  {
    name: 'Cracks and veins',
    body: (
      <>
        Gradient noise has no notion of a boundary, so it can never produce a crack. The cellular
        basis can: <em>Cellular Ridges</em> is the thin wall between cells. Cavity then inks the
        cracks in by darkening what is concave — the only control here that darkens rather than
        lights. Keep Swirl low, or the walls fold into mush.
      </>
    ),
    patch: {
      noiseBasis: 2, warp: 0.35, warpIters: 1, gain: 0.42, lacunarity: 2.1, ridge: 0,
      cavity: 0.8, cavityRange: 0.008, roughness: 0.25,
    },
  },
  {
    name: 'Flow instead of churn',
    body: (
      <>
        Domain warp folds the field into itself but never transports it, which is why plain motion
        reads as kneading in place. Curl Flow advects along a divergence-free flow and gives the
        streakline structure of a fluid. Curl Scale sets how big the vortices are.
      </>
    ),
    patch: { curl: 0.6, curlScale: 0.8, motion: 0.09 },
  },
  {
    name: 'Brushed metal',
    body: (
      <>
        Brushed squashes the Micro Detail noise into parallel striations — it shapes that noise
        rather than adding its own, so <strong>Micro Detail has to be well above zero</strong> or
        nothing happens. It also needs something structured to sweep: under the procedural
        environment, which varies only with height, a vertical grain nearly vanishes. A light tent
        or a matcap shows it.
      </>
    ),
    patch: {
      microDetail: 0.45, brush: 0.75, brushAngle: 8, roughness: 0.14,
      envMode: 4, colorMode: 1, cavity: 0.45, cavityRange: 0.012,
    },
  },
  {
    name: 'Glass with colour fringes',
    body: (
      <>
        Dispersion splits the refraction per colour channel, so the fringes only appear where the
        three rays hit <em>different</em> parts of the environment. That needs a finely structured
        environment — several narrow softboxes and low Roughness — and a dark interior from high
        Thickness, or there is nothing for the colour to show against.
      </>
    ),
    patch: {
      material: 1, ior: 1.4, dispersion: 0.3, thickness: 1.3, roughness: 0.03,
      envBands: 4, envContrast: 1.3, rimWidth: 2, rimIntensity: 1,
    },
  },
  {
    name: 'Neon glow and anamorphic streak',
    body: (
      <>
        Bloom is taken from the scene before the tonemap, which is why it reads as a lens rather
        than a blurred copy. The streak smears the same highlights along one axis. Glow Tint colours
        both: cool for anamorphic blue, warm for halation. Threshold decides what counts as a
        highlight — reflective surfaces run well past 1, so 0.7 leaves plenty glowing.
      </>
    ),
    patch: {
      bloom: 1, bloomThreshold: 0.7, streak: 0.8, streakAngle: 0, bloomTint: '#8fd0ff',
      exposure: 0.6, vignette: 0.4,
    },
  },
  {
    name: 'Molten heat with halation',
    body: (
      <>
        The same chain, warm instead of cool, over cellular ridges carrying the heat. Crushed blacks
        keep the glow from washing the frame out — Black Level is what gives this look its large
        dark field.
      </>
    ),
    patch: {
      noiseBasis: 2, curl: 0.45, cavity: 0.4, bloom: 1.1, bloomThreshold: 0.85,
      bloomTint: '#ff9c4a', contrast: 1.45, blackLevel: 0.14,
    },
  },
  {
    name: 'Thin filaments on black',
    body: (
      <>
        Ridge folds the height field at its midpoint, turning smooth swells into hard creases. Crush
        the shadows and only the crease highlights survive, which is the whole trick behind the
        high-contrast ink look. Drop Ambient to zero so nothing fills the black back in.
      </>
    ),
    patch: {
      ridge: 0.7, relief: 1.2, crease: 0.45, roughness: 0.03, ambient: 0,
      keyIntensity: 1.6, contrast: 1.8, blackLevel: 0.2, exposure: -0.3,
    },
  },
  {
    name: 'A subject, not a texture',
    body: (
      <>
        Shape confines the liquid and flattens the rest to background — the difference between a
        swatch and an image. The mask is applied to the height field, so the edge rounds off like a
        poured rim instead of reading as a cut-out. The shape lives in world space: Zoom, Pan and
        Rotation position it. A narrow Shape Edge gives a sharp lip, a wide one melts it into the
        background.
      </>
    ),
    patch: { shape: 1, shapeSize: 0.34, shapeEdge: 0.05, zoom: 0.95 },
  },
  {
    name: 'Shallow focus',
    body: (
      <>
        There is no depth buffer here, so surface height is the depth: pick a height to keep sharp
        and everything away from it softens. The height field sits near 0.5, so a Focus Height near
        either end puts nothing in focus and simply blurs the frame.
      </>
    ),
    patch: { dof: 0.6, dofFocus: 0.5, dofRange: 0.22, chromatic: 0.35 },
  },
  {
    name: 'Iridescence that is not rainbow noise',
    body: (
      <>
        Iridescence tints the shaded colour, so it needs <strong>Color Mode: Direct</strong> — the
        ramp would throw it away. Then keep the frequency low: 0.8 gives broad purple-to-gold
        sweeps, while high values break into rainbow speckle.
      </>
    ),
    patch: { colorMode: 1, iriAmount: 0.6, iriFreq: 0.8, hueShift: -25, saturation: 1.1 },
  },
];

export default function GuideDialog({ onClose, mode, onApply }: Props) {
  const [tab, setTab] = useState<Tab>('quality');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Guide">
        <div className="dialog-head">
          <span style={{ flex: 1 }}>Tips &amp; recipes</span>
          <button className="btn icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="tabs" role="tablist">
          {(
            [
              ['quality', 'Quality'],
              ['recipes', 'Recipes'],
              ['workflow', 'Workflow'],
              ['keys', 'Shortcuts'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'on' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="dialog-body guide">
          {tab === 'quality' && <Quality simple={mode === 'simple'} />}
          {tab === 'recipes' && <Recipes onApply={onApply} simple={mode === 'simple'} />}
          {tab === 'workflow' && <Workflow />}
          {tab === 'keys' && <Shortcuts />}
        </div>
      </div>
    </div>
  );
}

function Quality({ simple }: { simple: boolean }) {
  // Named through the schema so the guide calls each control whatever the panel
  // in front of you calls it.
  const n = (key: ParamKey) => labelOf(key, simple);

  return (
    <>
      <p className="note">
        Everything below is about the image itself. None of it costs export quality — the preview
        scale next to the frame counter only affects the preview.
      </p>

      <section className="guide-item">
        <h4>{n('warp')} is the shape control</h4>
        <p>
          It folds the noise field into itself, and it is what makes the surface look poured rather
          than generated. If a look feels flat or synthetic, this is the first slider to move — well
          before {n('octaves')} or {n('relief')}.
        </p>
      </section>

      <section className="guide-item">
        <h4>Keep Detail Gain below 1 ÷ Lacunarity</h4>
        <p>
          At that point every octave contributes equally to the gradient, the finest one dominates
          the normals, and the surface reads as crumpled foil. At the defaults that boundary is 0.5,
          which is why Detail Gain sits at 0.38. Above it you get noise, not detail. Both controls
          live in Expert.
        </p>
      </section>

      <section className="guide-item">
        <h4>Depth needs slope, not height</h4>
        <p>
          The Fresnel and rim terms key off surface slope, so a very low {n('relief')} leaves a
          nearly flat surface reflecting a single patch of sky, however dramatic the rest of the
          settings are. Cavity is the counterpart: it is the only control that darkens rather than
          lights, and without it a heavily crumpled surface still reads as flat. It lives in Expert.
        </p>
      </section>

      <section className="guide-item">
        <h4>{n('envMode')} decides more than the material</h4>
        <p>
          The procedural studio varies only with height, so every metal look built on it is a
          relative of every other one — there is simply not much to reflect. Switching to a matcap
          (Studio, Sunset, Neon City, Soft Tent, or your own image) changes <em>what</em> is being
          reflected rather than the shape reflecting it, and it is the single biggest change
          available.
        </p>
      </section>

      <section className="guide-item">
        <h4>A little Micro Detail, a little {n('grain')}</h4>
        <p>
          Micro Detail — an Expert control — perturbs the normal without changing the shape, which
          is what keeps a polished surface from reading as plastic. {n('grain')} around 0.006–0.01
          is below the threshold of notice on a phone and hides the banding that large smooth
          gradients otherwise show on 8-bit displays.
        </p>
      </section>

      <section className="guide-item">
        <h4>Export at 2× supersampling</h4>
        <p>
          The export dialog renders larger and box-filters down, which is where the clean edges come
          from. It reduces the factor by itself if the GPU's maximum texture size or the lens
          chain's memory budget would be exceeded, and says which limit it hit rather than degrading
          quietly. 4K at 2× is unaffected; 8K falls back to 1×.
        </p>
      </section>

      <section className="guide-item">
        <h4>Results are reproducible</h4>
        <p>
          The same seed, settings and phase always give byte-identical pixels — grain is seeded by
          position, never by time. A copied link therefore restores exactly what you saw, with one
          exception: an uploaded custom matcap has nowhere to live in a URL, so a link made with one
          falls back to the procedural environment.
        </p>
      </section>
    </>
  );
}

function Recipes({ onApply, simple }: { onApply: Props['onApply']; simple: boolean }) {
  return (
    <>
      <p className="note">
        Each recipe changes only the settings it lists, on top of the look you already have — so the
        result depends on where you start. Undo takes it back.
      </p>

      {RECIPES.map((r) => (
        <section className="guide-item" key={r.name}>
          <div className="guide-item-head">
            <h4>{r.name}</h4>
            <button className="btn" onClick={() => onApply(r.patch, r.name)}>
              Apply
            </button>
          </div>
          <p>{r.body}</p>
          <div className="guide-patch">
            {Object.entries(r.patch).map(([key, value]) => (
              <span className="tag" key={key}>
                {describe(key as ParamKey, value as number | string, simple)}
              </span>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function Workflow() {
  return (
    <>
      <section className="guide-item">
        <h4>Find a look, then refine it</h4>
        <p>
          <strong>Randomize</strong> resamples every setting that declares a sensible band, so
          results stay usable rather than merely random; colours are left alone deliberately.
          <strong> Variations</strong> is the gentler version — it nudges around the look you have
          now, with Spread controlling how far. Seed is excluded from that nudging on purpose: it
          indexes into noise space through a hash, so moving it by one gives an unrelated image
          rather than a neighbouring one. Use <strong>⟳ Seed</strong> when a new composition is what
          you actually want.
        </p>
      </section>

      <section className="guide-item">
        <h4>Keep the good ones as you go</h4>
        <p>
          Undo is a single linear stack, so a promising result found two experiments ago is
          otherwise gone. <strong>☆ Keep</strong> pins the current look to the shelf at the top of
          the panel with a thumbnail to recognise it by. Save a preset when you want it by name;
          copy a <strong>⧉ Link</strong> when you want it on another device.
        </p>
      </section>

      <section className="guide-item">
        <h4>Colours from a photograph</h4>
        <p>
          The <strong>⤒ Image</strong> button under the gradient builds a ramp from a picture's
          colours, anchored to its actual darkest and brightest tones. The result is an ordinary
          gradient, so it travels in a share link like anything else. A photo also works as a custom
          environment, loosely — that one does not travel.
        </p>
      </section>

      <section className="guide-item">
        <h4>Exporting a set</h4>
        <p>
          The <strong>Batch</strong> tab renders the current look at every resolution you tick and
          delivers one ZIP, with supersampling planned per size. The <strong>Video</strong> tab
          writes a seamlessly looping MP4 or WebM. Android cannot set a video as wallpaper on its
          own — copy the file over and point a live-wallpaper app at it, and expect it to cost
          battery.
        </p>
      </section>

      <section className="guide-item">
        <h4>Simple and Expert</h4>
        <p>
          The switch at the top of the panel trades reach for calm. Simple shows a short,
          plain-language set; Expert shows all of it. It only ever hides rows — no setting is reset
          or recalculated when you switch, and presets, Randomize and the recipes here keep using
          the full set in either mode.
        </p>
      </section>
    </>
  );
}

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Space', 'Play / pause'],
  ['R', 'Randomize'],
  ['S', 'New seed'],
  ['V', 'Variations'],
  ['K', 'Keep this look'],
  ['E', 'Export'],
  ['F', 'Fullscreen preview'],
  ['H', 'This guide'],
  ['Esc', 'Close / leave fullscreen'],
  ['Ctrl+Z', 'Undo'],
];

function Shortcuts() {
  return (
    <>
      <div className="guide-keys">
        {KEYS.map(([key, what]) => (
          <div className="guide-key" key={key}>
            <kbd>{key}</kbd>
            <span>{what}</span>
          </div>
        ))}
      </div>
      <p className="note">
        Fullscreen gives the preview the whole screen, still letterboxed to the export aspect — so a
        portrait phone wallpaper previews edge to edge on a phone. The toolbar fades while idle and
        returns on any pointer movement.
      </p>
    </>
  );
}
