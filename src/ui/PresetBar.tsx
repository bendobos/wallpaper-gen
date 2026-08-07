import { useState } from 'react';
import type { Params } from '../params/schema';
import { BUILTIN_PRESETS } from '../params/presets';
import type { StoredPreset } from '../params/serialize';

interface Props {
  active: string | null;
  userPresets: StoredPreset[];
  onApply: (name: string, params: Params) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}

export default function PresetBar({ active, userPresets, onApply, onSave, onDelete }: Props) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const name = draft.trim();
    if (name) onSave(name);
    setDraft('');
    setNaming(false);
  };

  return (
    <>
      <div className="presets">
        {BUILTIN_PRESETS.map((p) => (
          <button
            key={p.name}
            className={`chip${active === p.name ? ' active' : ''}`}
            onClick={() => onApply(p.name, p.params)}
          >
            {p.name}
          </button>
        ))}

        {userPresets.map((p) => (
          <span key={p.name} className={`chip${active === p.name ? ' active' : ''}`}>
            <button onClick={() => onApply(p.name, p.params)} style={{ color: 'inherit' }}>
              {p.name}
            </button>
            <button
              className="x"
              onClick={() => onDelete(p.name)}
              aria-label={`Delete preset ${p.name}`}
              title="Delete preset"
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      {naming ? (
        <div className="btn-row">
          <input
            type="text"
            autoFocus
            placeholder="Preset name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft('');
                setNaming(false);
              }
            }}
          />
          <button className="btn primary" onClick={commit} disabled={!draft.trim()}>
            Save
          </button>
        </div>
      ) : (
        <div className="btn-row">
          <button className="btn" onClick={() => setNaming(true)}>
            ＋ Save current as preset
          </button>
        </div>
      )}
    </>
  );
}
