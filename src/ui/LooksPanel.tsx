import { useMemo, useState } from 'react';
import type { LiquidRenderer } from '../gl/renderer';
import { DEFAULTS, type Params } from '../params/schema';
import { BUILTIN_PRESETS } from '../params/presets';
import type { KeptLook, StoredPreset } from '../params/serialize';
import { useLookThumbs, type ThumbEntry } from './useLookThumbs';

type Tab = 'builtin' | 'saved' | 'kept';

/** The untouched parameter set, offered as a look like any other. */
const DEFAULT_LOOK = 'Default';

interface Props {
  renderer: LiquidRenderer | null;
  /** Export aspect, so tiles frame the way the preview and exports do. */
  aspect: number;
  activePreset: string | null;
  userPresets: StoredPreset[];
  kept: KeptLook[];
  onApply: (name: string, params: Params) => void;
  onSave: (name: string) => void;
  onDeletePreset: (name: string) => void;
  onKeep: () => void;
  onApplyKept: (params: Params) => void;
  onRemoveKept: (id: string) => void;
  onRandomize: () => void;
  onVariations: () => void;
  onSeed: () => void;
  onUndo: () => void;
  /** Both must be referentially stable — see useLookThumbs. */
  onThumbsBusy: (busy: boolean) => void;
  onRestoreMatcap: () => void;
}

/**
 * One surface for picking a look, replacing the preset chips, the keep shelf
 * and the save button that used to sit above each other doing the same job.
 *
 * Tiles rather than names because these are images, and the four actions that
 * *produce* a look sit directly under them — the panel below is for refining
 * one you already have.
 */
export default function LooksPanel({
  renderer,
  aspect,
  activePreset,
  userPresets,
  kept,
  onApply,
  onSave,
  onDeletePreset,
  onKeep,
  onApplyKept,
  onRemoveKept,
  onRandomize,
  onVariations,
  onSeed,
  onUndo,
  onThumbsBusy,
  onRestoreMatcap,
}: Props) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('builtin');
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');

  // Kept looks carry their own thumbnail from the moment they were pinned;
  // only presets need rendering.
  const entries = useMemo<ThumbEntry[]>(() => {
    if (tab === 'builtin') {
      return [
        { key: DEFAULT_LOOK, params: DEFAULTS },
        ...BUILTIN_PRESETS.map((p) => ({ key: p.name, params: p.params })),
      ];
    }
    if (tab === 'saved') return userPresets.map((p) => ({ key: p.name, params: p.params }));
    return [];
  }, [tab, userPresets]);

  const thumbs = useLookThumbs(renderer, entries, aspect, open, onThumbsBusy, onRestoreMatcap);

  const commitName = () => {
    const name = draft.trim();
    if (name) onSave(name);
    setDraft('');
    setNaming(false);
  };

  const tile = (
    key: string,
    label: string,
    src: string | undefined,
    onClick: () => void,
    onDelete?: () => void,
  ) => (
    <span className={`look-tile${activePreset === key ? ' on' : ''}`} key={key}>
      <button style={{ aspectRatio: `${aspect}` }} onClick={onClick} title={`Use “${label}”`}>
        {src ? <img src={src} alt="" /> : <span className="look-pending" />}
        <span className="look-name">{label}</span>
      </button>
      {onDelete && (
        <button className="x" onClick={onDelete} aria-label={`Delete ${label}`} title="Delete">
          ✕
        </button>
      )}
    </span>
  );

  /** The tile that makes a new entry in the tab it sits in. */
  const addTile = (label: string, onClick: () => void) => (
    <button className="look-tile add" style={{ aspectRatio: `${aspect}` }} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <section className="group">
      <button className="group-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="chev">▶</span>
        <span style={{ flex: 1 }}>Looks</span>
      </button>

      {open && (
        <>
          <div className="tabs looks-tabs" role="tablist">
            {(
              [
                ['builtin', 'Built-in'],
                ['saved', `Saved${userPresets.length ? ` (${userPresets.length})` : ''}`],
                ['kept', `Kept${kept.length ? ` (${kept.length})` : ''}`],
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

          <div className="looks-grid">
            {tab === 'builtin' && (
              <>
                {tile(DEFAULT_LOOK, DEFAULT_LOOK, thumbs.get(DEFAULT_LOOK), () =>
                  onApply(DEFAULT_LOOK, DEFAULTS),
                )}
                {BUILTIN_PRESETS.map((p) =>
                  tile(p.name, p.name, thumbs.get(p.name), () => onApply(p.name, p.params)),
                )}
              </>
            )}

            {tab === 'saved' && (
              <>
                {addTile('＋ Save current', () => setNaming(true))}
                {userPresets.map((p) =>
                  tile(
                    p.name,
                    p.name,
                    thumbs.get(p.name),
                    () => onApply(p.name, p.params),
                    () => onDeletePreset(p.name),
                  ),
                )}
              </>
            )}

            {tab === 'kept' && (
              <>
                {addTile('☆ Keep current', onKeep)}
                {kept.map((look) => (
                  <span className="look-tile" key={look.id}>
                    <button
                      style={{ aspectRatio: `${aspect}` }}
                      onClick={() => onApplyKept(look.params)}
                      title="Restore this look"
                    >
                      <img src={look.thumb} alt="" />
                    </button>
                    <button
                      className="x"
                      onClick={() => onRemoveKept(look.id)}
                      aria-label="Remove kept look"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </>
            )}
          </div>

          {tab === 'saved' && naming && (
            <div className="btn-row">
              <input
                type="text"
                autoFocus
                placeholder="Preset name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') {
                    setDraft('');
                    setNaming(false);
                  }
                }}
              />
              <button className="btn primary" onClick={commitName} disabled={!draft.trim()}>
                Save
              </button>
            </div>
          )}

          <div className="looks-actions">
            <button className="btn" onClick={onRandomize} title="Randomize everything (R)">
              ✦ Randomize
            </button>
            <button className="btn" onClick={onVariations} title="Explore variations (V)">
              ▦ Variations
            </button>
            <button className="btn" onClick={onSeed} title="New seed (S)">
              ⟳ Seed
            </button>
            <button className="btn" onClick={onUndo} title="Undo (Ctrl+Z)">
              ↶ Undo
            </button>
          </div>
        </>
      )}
    </section>
  );
}
