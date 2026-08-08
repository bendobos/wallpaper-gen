import { useRef, useState } from 'react';
import {
  formatGradient,
  parseGradient,
  RAMP_PRESETS,
  toCss,
  type Stop,
} from '../params/gradient';
import { imageToPalette } from '../params/palette';

interface Props {
  value: string;
  onChange: (spec: string) => void;
  onCommitStart?: () => void;
}

/**
 * Multi-stop ramp editor. Click the bar to add a stop, drag a handle to move
 * it, double-click a handle to remove it.
 *
 * Handles use pointer capture rather than a document-level listener so a drag
 * that leaves the bar keeps tracking, and `touch-action: none` on the handle
 * stops the panel scrolling out from under a drag. The bar itself keeps
 * `pan-y`, so scrolling past the editor still works.
 */
export default function GradientEditor({ value, onChange, onCommitStart }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef<number | null>(null);

  /**
   * Builds a ramp from an image's colours. Unlike a custom matcap the result is
   * a plain gradient string, so it travels in a share link like anything else.
   */
  const fromImage = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const spec = await imageToPalette(file);
      onCommitStart?.();
      onChange(spec);
      setSelected(0);
    } catch {
      setError(`Could not read “${file.name}” as an image.`);
    }
  };

  const stops = parseGradient(value);
  const active = Math.min(selected, stops.length - 1);

  const commit = (next: Stop[]) => onChange(formatGradient(next));

  const posFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
  };

  const addStop = (e: React.MouseEvent) => {
    if (dragging.current !== null) return;
    const pos = posFromEvent(e.clientX);
    // Inherit the colour already showing at that position so adding a stop
    // never changes the gradient — it only creates a new handle to move.
    const before = [...stops].reverse().find((s) => s.pos <= pos) ?? stops[0];
    onCommitStart?.();
    const next = [...stops, { pos, hex: before.hex }].sort((a, b) => a.pos - b.pos);
    setSelected(next.findIndex((s) => s.pos === pos));
    commit(next);
  };

  const startDrag = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    setSelected(index);
    dragging.current = index;
    onCommitStart?.();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const moveDrag = (index: number) => (e: React.PointerEvent) => {
    if (dragging.current !== index) return;
    const next = stops.map((s, i) => (i === index ? { ...s, pos: posFromEvent(e.clientX) } : s));
    commit(next);
  };

  const endDrag = (e: React.PointerEvent) => {
    dragging.current = null;
    const el = e.target as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const removeStop = (index: number) => {
    if (stops.length <= 2) return; // a ramp needs two ends
    onCommitStart?.();
    commit(stops.filter((_, i) => i !== index));
    setSelected(0);
  };

  return (
    <div className="row">
      <div className="row-head">
        <span className="row-label" title="Maps image brightness to colour">
          Gradient
        </span>
        <select
          className="ramp-preset"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            onCommitStart?.();
            onChange(e.target.value);
            setSelected(0);
          }}
          aria-label="Load a ramp preset"
        >
          <option value="">Presets…</option>
          {RAMP_PRESETS.map((p) => (
            <option key={p.name} value={p.spec}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="gradient-bar" ref={barRef} style={{ background: toCss(value) }} onClick={addStop}>
        {stops.map((s, i) => (
          <span
            key={i}
            className={`gradient-stop${i === active ? ' on' : ''}`}
            style={{ left: `${s.pos * 100}%`, background: `#${s.hex}` }}
            onPointerDown={startDrag(i)}
            onPointerMove={moveDrag(i)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={(e) => {
              e.stopPropagation();
              removeStop(i);
            }}
            title={`Stop at ${Math.round(s.pos * 100)}% — drag to move, double-click to remove`}
          />
        ))}
      </div>

      <div className="gradient-controls">
        <input
          type="color"
          value={`#${stops[active].hex}`}
          onChange={(e) => {
            onCommitStart?.();
            commit(stops.map((s, i) => (i === active ? { ...s, hex: e.target.value.slice(1) } : s)));
          }}
          aria-label="Selected stop colour"
        />
        <span className="readout">
          {Math.round(stops[active].pos * 100)}% · {stops.length} stops
        </span>
        <span className="spacer" />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            void fromImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          className="btn"
          onClick={() => fileRef.current?.click()}
          title="Build a ramp from the colours in an image"
        >
          ⤒ Image
        </button>
        <button
          className="btn"
          onClick={() => removeStop(active)}
          disabled={stops.length <= 2}
          title="Remove the selected stop"
        >
          −
        </button>
      </div>

      {error && <p className="note error">{error}</p>}
    </div>
  );
}
