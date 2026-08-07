import { useState } from 'react';
import { BY_GROUP, type Group, type ParamKey, type Params } from '../params/schema';
import ParamRow from './ParamRow';

interface Props {
  params: Params;
  onChange: (key: ParamKey, value: number | string) => void;
  onCommitStart: () => void;
}

const INITIALLY_OPEN: readonly Group[] = ['Flow', 'Material'];

export default function ControlPanel({ params, onChange, onCommitStart }: Props) {
  const [open, setOpen] = useState<Set<Group>>(() => new Set(INITIALLY_OPEN));

  const toggle = (g: Group) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <>
      {BY_GROUP.map(([group, defs]) => {
        const expanded = open.has(group);
        const changed = defs.filter((d) => params[d.key as ParamKey] !== d.default).length;

        return (
          <section className="group" key={group}>
            <button
              className="group-head"
              aria-expanded={expanded}
              onClick={() => toggle(group)}
            >
              <span className="chev">▶</span>
              <span style={{ flex: 1 }}>{group}</span>
              {changed > 0 && !expanded && (
                <span style={{ color: 'var(--accent)', fontSize: 10 }}>{changed}</span>
              )}
            </button>

            {expanded && (
              <div className="group-body">
                {defs.map((def) => (
                  <ParamRow
                    key={def.key}
                    def={def}
                    value={params[def.key as ParamKey]}
                    onChange={(v) => onChange(def.key as ParamKey, v)}
                    onCommitStart={onCommitStart}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
