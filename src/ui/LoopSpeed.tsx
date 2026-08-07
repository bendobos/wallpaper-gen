import { SCHEMA_BY_KEY } from '../params/schema';
import { useSliderGate } from './useSliderGate';

const def = SCHEMA_BY_KEY.get('loopSeconds');
if (!def || def.kind !== 'slider') throw new Error('loopSeconds must be a slider param');
const { min, max, step } = def;

interface Props {
  value: number;
  onChange: (v: number) => void;
  onCommitStart?: () => void;
}

/**
 * Preview loop duration, sitting next to the Play button.
 *
 * Expressed in seconds rather than as an abstract rate so it reads the same way
 * as the export dialog's loop duration: both answer "how long does one loop
 * take". Bounds come from the schema so the two stay in step.
 */
export default function LoopSpeed({ value, onChange, onCommitStart }: Props) {
  const { handlers, accept } = useSliderGate(onCommitStart);

  return (
    <label className="loop-speed" title="How long one full loop of the preview takes">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        {...handlers}
        onChange={(e) => accept(Number(e.target.value), onChange)}
        aria-label="Preview loop duration in seconds"
      />
      <span className="readout">{value.toFixed(1)}s</span>
    </label>
  );
}
