import { useEffect, useState } from 'react';
import type { ParamDef } from '../params/schema';
import { useSliderGate } from './useSliderGate';

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

  const { handlers, accept } = useSliderGate(onCommitStart);

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
        {...handlers}
        onChange={(e) => accept(Number(e.target.value), onChange)}
        aria-label={def.label}
      />
    </div>
  );
}
