import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiquidRenderer } from '../gl/renderer';
import type { Params } from '../params/schema';
import { mutateParams } from '../params/serialize';

const COLS = 3;
const ROWS = 3;
const COUNT = COLS * ROWS;
/** Index of the tile that shows the unmodified current look. */
const CENTRE = 4;

const THUMB_W = 240;

interface Tile {
  params: Params;
  src: string | null;
}

interface Props {
  renderer: LiquidRenderer;
  params: Params;
  time: number;
  /** Export aspect, so thumbnails frame the same way the preview does. */
  aspect: number;
  onPick: (params: Params) => void;
  onClose: () => void;
}

/**
 * Nine thumbnails: the current look in the middle, eight mutations around it.
 * Picking one makes it the new centre, so a good result can be refined by
 * choosing rather than by guessing at forty sliders.
 */
export default function VariationsGrid({
  renderer,
  params,
  time,
  aspect,
  onPick,
  onClose,
}: Props) {
  const [spread, setSpread] = useState(0.3);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  const thumbH = Math.max(60, Math.round(THUMB_W / aspect));

  const generate = useCallback(
    async (base: Params, amount: number) => {
      const run = ++runId.current;
      setError(null);
      setRendering(true);

      const next: Tile[] = Array.from({ length: COUNT }, (_, i) => ({
        params: i === CENTRE ? base : mutateParams(base, amount),
        src: null,
      }));
      setTiles(next);

      try {
        for (let i = 0; i < COUNT; i++) {
          if (runId.current !== run) return; // superseded by a newer request
          const { canvas } = await renderer.exportImage(next[i].params, time, {
            width: THUMB_W,
            height: thumbH,
            ssaa: 1,
          });
          const src = canvas.toDataURL('image/jpeg', 0.85);
          if (runId.current !== run) return;
          // Publish each tile as it lands so the grid fills progressively.
          setTiles((prev) => prev.map((t, j) => (j === i ? { ...t, src } : t)));
        }
      } catch (e) {
        if (runId.current === run) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (runId.current === run) setRendering(false);
      }
    },
    [renderer, time, thumbH],
  );

  // Generate once on open. Deliberately not re-running when `params` changes:
  // picking a tile re-seeds the grid explicitly via the click handler.
  useEffect(() => {
    void generate(params, spread);
    return () => {
      runId.current++; // cancel any in-flight run on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = (tile: Tile, index: number) => {
    if (index !== CENTRE) onPick(tile.params);
    void generate(tile.params, spread);
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="variations" role="dialog" aria-modal="true" aria-label="Variations">
        <div className="dialog-head">
          <span style={{ flex: 1 }}>Variations</span>
          <button className="btn icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="variations-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {tiles.map((tile, i) => (
            <button
              key={i}
              className={`variation${i === CENTRE ? ' current' : ''}`}
              style={{ aspectRatio: `${aspect}` }}
              onClick={() => pick(tile, i)}
              title={i === CENTRE ? 'Current look — click to re-roll around it' : 'Use this variation'}
            >
              {tile.src ? <img src={tile.src} alt="" /> : <span className="variation-pending" />}
              {i === CENTRE && <span className="variation-tag">current</span>}
            </button>
          ))}
        </div>

        <div className="variations-foot">
          <label className="loop-speed" title="How far each variation strays from the centre">
            <span className="readout" style={{ minWidth: 44 }}>
              Spread
            </span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={spread}
              onChange={(e) => setSpread(Number(e.target.value))}
              aria-label="Variation spread"
            />
            <span className="readout">{Math.round(spread * 100)}%</span>
          </label>

          <span className="spacer" />

          {error && <span className="note error">{error}</span>}

          <button className="btn" onClick={() => void generate(params, spread)} disabled={rendering}>
            {rendering ? 'Rendering…' : '↻ Re-roll'}
          </button>
        </div>

        <p className="note" style={{ padding: '0 16px 14px' }}>
          The seed is held fixed, so these vary the treatment rather than the composition.
          Use the Seed button for a different shape.
        </p>
      </div>
    </div>
  );
}
