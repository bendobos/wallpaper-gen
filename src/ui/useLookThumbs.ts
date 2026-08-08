import { useEffect, useRef, useState } from 'react';
import type { LiquidRenderer } from '../gl/renderer';
import { bakeMatcap, ENV_CUSTOM, ENV_PROCEDURAL } from '../params/matcaps';
import type { Params } from '../params/schema';

export interface ThumbEntry {
  /** Stable identity for the cache — a preset name or a kept look's id. */
  key: string;
  params: Params;
}

/** Thumbnail width. Three to a 320px panel column, at device pixel ratio 2. */
const THUMB_W = 160;

/**
 * Renders preview images for a list of looks, off the same path exports use.
 *
 * Sequential and cancellable rather than parallel: each image is published as
 * it lands so the grid fills progressively instead of blocking, and a tab
 * switch abandons whatever is still in flight. Same shape as the loop in
 * VariationsGrid, which this is deliberately modelled on.
 *
 * Results are cached for the session but never persisted. The kept shelf
 * already shares a ~5 MB localStorage budget, and a stored preset image would
 * go stale the moment a preset is retuned.
 */
export function useLookThumbs(
  renderer: LiquidRenderer | null,
  entries: readonly ThumbEntry[],
  aspect: number,
  enabled: boolean,
  /** Suspends the preview while the shared matcap texture is borrowed. */
  setBusy: (busy: boolean) => void,
  /** Puts the current look's own environment back afterwards. */
  restoreMatcap: () => void,
): ReadonlyMap<string, string> {
  const cache = useRef(new Map<string, string>());
  const lastAspect = useRef(aspect);
  const runId = useRef(0);
  // Thumbnails land in the cache ref, so a counter is what tells React that
  // there is something new to paint.
  const [, bump] = useState(0);

  useEffect(() => {
    if (!enabled || !renderer) return;

    // The tiles frame what an export would give, so a change of output aspect
    // invalidates every image at once.
    if (lastAspect.current !== aspect) {
      cache.current.clear();
      lastAspect.current = aspect;
    }

    const missing = entries.filter((e) => !cache.current.has(e.key));
    if (!missing.length) return;

    const run = ++runId.current;
    const height = Math.max(40, Math.round(THUMB_W / aspect));

    void (async () => {
      setBusy(true);
      try {
        for (const entry of missing) {
          if (runId.current !== run) return;
          try {
            // The matcap is one shared texture, so each look's environment has
            // to be bound before it renders — otherwise every preset comes out
            // wearing whatever the current look happens to be using.
            const mode = entry.params.envMode;
            if (mode !== ENV_PROCEDURAL) {
              // A stored look cannot carry a custom image, and neither can a
              // link; both fall back to procedural the same way.
              renderer.setMatcap(mode === ENV_CUSTOM ? null : bakeMatcap(mode));
            }
            // At the look's own phase, so a tile is deterministic and shows what
            // applying it actually puts on screen.
            const { canvas } = await renderer.exportImage(entry.params, entry.params.phase, {
              width: THUMB_W,
              height,
              ssaa: 1,
            });
            if (runId.current !== run) return;
            cache.current.set(entry.key, canvas.toDataURL('image/jpeg', 0.8));
            bump((v) => v + 1);
          } catch {
            // A tile that cannot render stays a placeholder. One bad look is
            // not worth taking the panel down for.
          }
        }
      } finally {
        // A newer run owns the texture and the busy flag now; releasing them
        // from here would leave the preview drawing with its bindings.
        if (runId.current === run) {
          restoreMatcap();
          setBusy(false);
        }
      }
    })();

    return () => {
      runId.current++;
    };
    // setBusy and restoreMatcap must be stable, or the cleanup below would
    // cancel an in-flight run on every render.
  }, [enabled, renderer, entries, aspect, setBusy, restoreMatcap]);

  return cache.current;
}
