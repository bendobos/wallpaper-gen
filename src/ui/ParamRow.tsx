import { useEffect, useRef, useState } from 'react';
import type { ParamDef } from '../params/schema';

/** Horizontal travel a finger must cover before a slider starts responding. */
const TOUCH_DRAG_THRESHOLD = 6;

interface Props {
  def: ParamDef;
  value: number | string;
  onChange: (value: number | string) => void;
  /** Called once when a drag starts, so the caller can snapshot for undo. */
  onCommitStart?: () => void;
}

function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  return Math.min(4, String(step).split('.')[1]?.length ?? 2);
}

/**
 * One control. The numeric readout is an editable text field rather than a
 * label — typing an exact value matters when you are trying to reproduce a look
 * or nudge past the slider's resolution.
 */
export default function ParamRow({ def, value, onChange, onCommitStart }: Props) {
  const modified = value !== def.default;

  if (def.kind === 'color') {
    return (
      <div className="row">
        <div className="row-head">
          <span className={`row-label${modified ? ' modified' : ''}`} title={def.hint}>
            {def.label}
          </span>
        </div>
        <div className="color-row">
          <input
            type="color"
            value={String(value)}
            onChange={(e) => {
              onCommitStart?.();
              onChange(e.target.value);
            }}
            aria-label={def.label}
          />
          <input
            className="color-hex"
            type="text"
            value={String(value)}
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                onCommitStart?.();
                onChange(v.toLowerCase());
              }
            }}
            aria-label={`${def.label} hex value`}
          />
        </div>
      </div>
    );
  }

  if (def.kind === 'select') {
    return (
      <div className="row">
        <div className="row-head">
          <span className={`row-label${modified ? ' modified' : ''}`} title={def.hint}>
            {def.label}
          </span>
        </div>
        <select
          value={String(value)}
          onChange={(e) => {
            onCommitStart?.();
            onChange(Number(e.target.value));
          }}
          aria-label={def.label}
        >
          {def.options.map((opt, i) => (
            <option key={opt} value={i}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return <SliderRow def={def} value={Number(value)} onChange={onChange} onCommitStart={onCommitStart} />;
}

function SliderRow({
  def,
  value,
  onChange,
  onCommitStart,
}: {
  def: Extract<ParamDef, { kind: 'slider' }>;
  value: number;
  onChange: (v: number) => void;
  onCommitStart?: () => void;
}) {
  const dp = decimalsFor(def.step);
  const [text, setText] = useState(() => value.toFixed(dp));
  const [editing, setEditing] = useState(false);
  const modified = value !== def.default;

  /**
   * Gates value changes coming from a pointer.
   *
   * A finger tap on the track would otherwise jump the value to wherever it
   * landed, which happens constantly when tapping to stop a flick-scroll. So a
   * touch pointer has to move horizontally before its changes are accepted.
   *
   * Gating on `pointerType` rather than a device media query means a laptop
   * with a touchscreen keeps precise click-to-position with the mouse and only
   * requires the drag when using a finger.
   */
  // null means "not a pointer gesture" (keyboard), which is always allowed.
  const drag = useRef<{ active: boolean; startX: number } | null>(null);

  const beginPointer = (e: React.PointerEvent) => {
    const isTouch = e.pointerType === 'touch';
    drag.current = { active: !isTouch, startX: e.clientX };
    if (!isTouch) onCommitStart?.();
  };

  const movePointer = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.active) return;
    if (Math.abs(e.clientX - d.startX) >= TOUCH_DRAG_THRESHOLD) {
      d.active = true;
      onCommitStart?.();
    }
  };

  // Fires on release, and also when the browser claims the gesture for
  // scrolling. Stays as a blocking record rather than resetting to null: the
  // slider can still emit one more input event after the gesture ends, and
  // null would wave it through as if it were a keystroke.
  const endPointer = () => {
    drag.current = { active: false, startX: 0 };
  };

  const handleKeyDown = () => {
    drag.current = null;
    onCommitStart?.();
  };

  const handleRangeChange = (v: number) => {
    if (drag.current && !drag.current.active) return;
    onChange(v);
  };

  // Keep the readout in sync with external changes (presets, undo, randomize)
  // but never fight the user while they are typing in it.
  useEffect(() => {
    if (!editing) setText(value.toFixed(dp));
  }, [value, dp, editing]);

  const commitText = () => {
    setEditing(false);
    const n = Number(text);
    if (Number.isFinite(n)) {
      onCommitStart?.();
      onChange(Math.min(def.max, Math.max(def.min, n)));
    } else {
      setText(value.toFixed(dp));
    }
  };

  return (
    <div className="row">
      <div className="row-head">
        <span className={`row-label${modified ? ' modified' : ''}`} title={def.hint}>
          {def.label}
        </span>
        <input
          className="row-value"
          type="text"
          value={text}
          spellCheck={false}
          onFocus={() => setEditing(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setEditing(false);
              setText(value.toFixed(dp));
              e.currentTarget.blur();
            }
          }}
          aria-label={`${def.label} value`}
        />
      </div>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onPointerDown={beginPointer}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onKeyDown={handleKeyDown}
        onChange={(e) => handleRangeChange(Number(e.target.value))}
        aria-label={def.label}
      />
    </div>
  );
}
