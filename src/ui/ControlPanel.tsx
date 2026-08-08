import { useState, type ReactNode } from 'react';
import {
  BY_GROUP,
  SIMPLE_BY_SECTION,
  type Group,
  type ParamDef,
  type ParamKey,
  type Params,
  type SimpleSection,
} from '../params/schema';
import type { UiMode } from '../params/serialize';
import ParamRow from './ParamRow';

type Section = Group | SimpleSection;

interface Props {
  params: Params;
  mode: UiMode;
  onChange: (key: ParamKey, value: number | string) => void;
  onCommitStart: () => void;
  /** Switches to the expert panel from the Simple footer. */
  onShowExpert: () => void;
  /**
   * Extra rows appended to a group's body. For the handful of controls that are
   * not a single serialisable value — a file picker, a capability warning —
   * which have no business being invented as a schema kind apiece.
   */
  extras?: Partial<Record<Section, ReactNode>>;
}

/**
 * Expert opens the two groups people reach for first and leaves the rest
 * folded; Simple is short enough to show whole, and hunting through accordions
 * is exactly the friction it exists to remove.
 */
const INITIALLY_OPEN: readonly Group[] = ['Flow', 'Material'];

const countRows = (sections: ReadonlyArray<readonly [Section, readonly ParamDef[]]>) =>
  sections.reduce((n, [, defs]) => n + defs.length, 0);

const SIMPLE_COUNT = countRows(SIMPLE_BY_SECTION);
const EXPERT_COUNT = countRows(BY_GROUP);

export default function ControlPanel({
  params,
  mode,
  onChange,
  onCommitStart,
  onShowExpert,
  extras,
}: Props) {
  const simple = mode === 'simple';
  const sections: ReadonlyArray<readonly [Section, readonly ParamDef[]]> = simple
    ? SIMPLE_BY_SECTION
    : BY_GROUP;

  const [open, setOpen] = useState<Set<Section>>(
    () => new Set<Section>(simple ? SIMPLE_BY_SECTION.map(([s]) => s) : INITIALLY_OPEN),
  );

  const toggle = (g: Section) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <>
      {sections.map(([section, defs]) => {
        const expanded = open.has(section);
        const changed = defs.filter((d) => params[d.key as ParamKey] !== d.default).length;

        return (
          <section className="group" key={section}>
            <button
              className="group-head"
              aria-expanded={expanded}
              onClick={() => toggle(section)}
            >
              <span className="chev">▶</span>
              <span style={{ flex: 1 }}>{section}</span>
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
                    label={simple ? def.simple?.label : undefined}
                    hint={simple ? def.simple?.hint : undefined}
                  />
                ))}
                {extras?.[section]}
              </div>
            )}
          </section>
        );
      })}

      {/*
        Presets, Randomize and shared links all set parameters Simple has no row
        for, so this panel is never the whole story. Stated once, as a fixed
        count rather than a diff against the defaults: the app opens on a preset,
        so a diff would read as a warning on a perfectly normal first load.
      */}
      {simple && (
        <p className="note panel-note">
          Simple shows {SIMPLE_COUNT} of {EXPERT_COUNT} controls. Presets and Randomize use all of
          them.{' '}
          <button className="link" onClick={onShowExpert}>
            Switch to Expert
          </button>
        </p>
      )}
    </>
  );
}
