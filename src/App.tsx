import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LiquidRenderer } from './gl/renderer';
import { DEFAULTS, type ParamKey, type Params } from './params/schema';
import { BUILTIN_PRESETS } from './params/presets';
import {
  decodeParams,
  encodeParams,
  loadStoredParams,
  loadUserPresets,
  randomizeParams,
  randomSeed,
  storeParams,
  storeUserPresets,
  type StoredPreset,
} from './params/serialize';
import ControlPanel from './ui/ControlPanel';
import PresetBar from './ui/PresetBar';
import ExportDialog from './ui/ExportDialog';

const MAX_UNDO = 60;

/** Preview render scale. Lower this on a laptop that can't keep up. */
const QUALITY_OPTIONS = [
  { label: '½', value: 0.5 },
  { label: '¾', value: 0.75 },
  { label: '1×', value: 1 },
] as const;

function initialParams(): Params {
  const fromHash = location.hash.length > 1 ? decodeParams(location.hash.slice(1)) : null;
  if (fromHash) return fromHash;
  return loadStoredParams() ?? BUILTIN_PRESETS[0].params;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LiquidRenderer | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const [fatal, setFatal] = useState<string | null>(null);
  const [params, setParams] = useState<Params>(initialParams);
  const [output, setOutput] = useState({ width: 3840, height: 2160 });
  const [quality, setQuality] = useState(0.75);
  const [playing, setPlaying] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [userPresets, setUserPresets] = useState<StoredPreset[]>(() => loadUserPresets());
  const [displaySize, setDisplaySize] = useState({ w: 640, h: 360 });
  const [toast, setToast] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [immersive, setImmersive] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);

  // Live values the render loop reads without re-subscribing every frame.
  const paramsRef = useRef(params);
  const playingRef = useRef(playing);
  const immersiveRef = useRef(immersive);
  const timeRef = useRef(params.phase);
  const dirtyRef = useRef(true);
  const undoRef = useRef<Params[]>([]);

  paramsRef.current = params;
  playingRef.current = playing;
  immersiveRef.current = immersive;

  // ------------------------------------------------------------ renderer --

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new LiquidRenderer(canvas);
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
      return;
    }

    const onLost = (e: Event) => {
      e.preventDefault();
      setFatal('The graphics context was lost, usually from an export that was too large. Reload to continue.');
    };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // -------------------------------------------------------------- sizing --

  // The preview is letterboxed to the export aspect ratio, so what you frame is
  // literally what gets rendered. Changing the export size re-letterboxes here.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const fit = () => {
      const style = getComputedStyle(wrap);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const availW = Math.max(80, wrap.clientWidth - padX);
      const availH = Math.max(80, wrap.clientHeight - padY);

      const aspect = output.width / output.height;
      let w = availW;
      let h = w / aspect;
      if (h > availH) {
        h = availH;
        w = h * aspect;
      }
      setDisplaySize({ w: Math.floor(w), h: Math.floor(h) });
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [output]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    r.resize(displaySize.w * dpr * quality, displaySize.h * dpr * quality);
    dirtyRef.current = true;
  }, [displaySize, quality]);

  // --------------------------------------------------------- render loop --

  useEffect(() => {
    dirtyRef.current = true;
    if (!playingRef.current) timeRef.current = params.phase;
  }, [params]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let acc = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (playingRef.current) {
        // The shader's period is exactly 1.0, so wrapping here keeps the clock
        // bounded and means the phase committed on pause is always in range.
        timeRef.current = (timeRef.current + dt * paramsRef.current.speed) % 1;
        dirtyRef.current = true;
      }

      if (dirtyRef.current && rendererRef.current) {
        rendererRef.current.draw(paramsRef.current, timeRef.current);
        dirtyRef.current = false;
        frames++;
      }

      acc += dt;
      if (acc >= 0.5) {
        setFps(Math.round(frames / acc));
        frames = 0;
        acc = 0;
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------------------------------------------------------- persistence --

  useEffect(() => {
    const id = setTimeout(() => {
      storeParams(params);
      history.replaceState(null, '', `#${encodeParams(params)}`);
    }, 250);
    return () => clearTimeout(id);
  }, [params]);

  // ------------------------------------------------------------- actions --

  const pushUndo = useCallback(() => {
    const stack = undoRef.current;
    const last = stack[stack.length - 1];
    const current = paramsRef.current;
    if (last && Object.keys(current).every((k) => last[k as ParamKey] === current[k as ParamKey])) {
      return; // nothing changed since the last snapshot
    }
    stack.push(current);
    if (stack.length > MAX_UNDO) stack.shift();
  }, []);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (prev) {
      setParams(prev);
      setActivePreset(null);
    }
  }, []);

  const setParam = useCallback((key: ParamKey, value: number | string) => {
    setParams((p) => ({ ...p, [key]: value }));
    setActivePreset(null);
  }, []);

  const applyPreset = useCallback(
    (name: string, next: Params) => {
      pushUndo();
      setParams(next);
      setActivePreset(name);
      timeRef.current = next.phase;
    },
    [pushUndo],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800);
  }, []);

  // Pausing commits the live animation time into `phase`, so the Phase slider
  // and any export agree with the frame currently on screen.
  const togglePlay = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (wasPlaying) setParams((p) => ({ ...p, phase: Math.round(timeRef.current * 1000) / 1000 }));
      return !wasPlaying;
    });
  }, []);

  const openExport = useCallback(() => {
    if (playingRef.current) {
      setPlaying(false);
      setParams((p) => ({ ...p, phase: Math.round(timeRef.current * 1000) / 1000 }));
    }
    setShowExport(true);
  }, []);

  const copyLink = useCallback(async () => {
    const url = `${location.origin}${location.pathname}#${encodeParams(paramsRef.current)}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied');
    } catch {
      showToast('Could not access the clipboard');
    }
  }, [showToast]);

  const savePreset = useCallback(
    (name: string) => {
      setUserPresets((list) => {
        const next = [...list.filter((p) => p.name !== name), { name, params: paramsRef.current }];
        storeUserPresets(next);
        return next;
      });
      setActivePreset(name);
      showToast(`Saved “${name}”`);
    },
    [showToast],
  );

  const deletePreset = useCallback((name: string) => {
    setUserPresets((list) => {
      const next = list.filter((p) => p.name !== name);
      storeUserPresets(next);
      return next;
    });
  }, []);

  // ------------------------------------------------------------ immersive --

  /**
   * Native fullscreen where it exists, with the CSS overlay always applied.
   *
   * iPhone Safari has no Element.requestFullscreen, so relying on the API alone
   * would leave the feature dead there. The overlay alone still fills the
   * viewport and hides the panel, which is most of the value.
   */
  const enterImmersive = useCallback(() => {
    setImmersive(true);
    const el = stageRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
        /* overlay carries it */
      });
    }
  }, []);

  const exitImmersive = useCallback(() => {
    setImmersive(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const toggleImmersive = useCallback(() => {
    if (immersiveRef.current) exitImmersive();
    else enterImmersive();
  }, [enterImmersive, exitImmersive]);

  // Escape and the browser's own fullscreen control bypass our buttons, so
  // mirror whatever the browser decided back into component state.
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // Fade the toolbar out while idle. Any pointer activity brings it back, so a
  // touch device is never left without a way out.
  const nudgeControls = useCallback(() => {
    setControlsShown(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsShown(false), 2600);
  }, []);

  useEffect(() => {
    if (!immersive) {
      window.clearTimeout(hideTimer.current);
      setControlsShown(true);
      return;
    }
    nudgeControls();
    return () => window.clearTimeout(hideTimer.current);
  }, [immersive, nudgeControls]);

  // ----------------------------------------------------------- shortcuts --

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        pushUndo();
        setParams((p) => randomizeParams(p));
        setActivePreset(null);
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        pushUndo();
        setParams((p) => ({ ...p, seed: randomSeed() }));
        setActivePreset(null);
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        openExport();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleImmersive();
      } else if (e.key === 'Escape' && immersiveRef.current) {
        // Only reached when there is no native fullscreen to escape from;
        // otherwise the browser handles Escape and fullscreenchange syncs us.
        exitImmersive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, togglePlay, pushUndo, openExport, toggleImmersive, exitImmersive]);

  // ---------------------------------------------------------------- view --

  if (fatal) {
    return (
      <div className="fatal">
        <div>
          <h1>Can't start the generator</h1>
          <p className="note">{fatal}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div
        className={`stage${immersive ? ' immersive' : ''}`}
        ref={stageRef}
        onPointerMove={immersive ? nudgeControls : undefined}
        onPointerDown={immersive ? nudgeControls : undefined}
      >
        <div className="canvas-wrap" ref={wrapRef}>
          <div
            className="canvas-frame"
            style={{ width: displaySize.w, height: displaySize.h }}
          >
            <canvas ref={canvasRef} />
          </div>
        </div>

        <div className={`stage-bar${immersive && !controlsShown ? ' hidden' : ''}`}>
          <button className="btn" onClick={togglePlay} title="Play / pause (Space)">
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button
            className="btn"
            onClick={() => {
              pushUndo();
              setParams((p) => ({ ...p, seed: randomSeed() }));
              setActivePreset(null);
            }}
            title="New seed (S)"
          >
            ⟳ Seed
          </button>
          <button
            className="btn"
            onClick={() => {
              pushUndo();
              setParams((p) => randomizeParams(p));
              setActivePreset(null);
            }}
            title="Randomize everything (R)"
          >
            ✦ Randomize
          </button>
          <button className="btn" onClick={undo} title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button
            className="btn"
            onClick={() => {
              pushUndo();
              setParams(DEFAULTS);
              setActivePreset(null);
            }}
          >
            Reset
          </button>

          <span className="spacer" />

          <div className="seg" title="Preview render scale">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={q.label}
                className={quality === q.value ? 'on' : ''}
                onClick={() => setQuality(q.value)}
                style={{ padding: '5px 8px' }}
              >
                {q.label}
              </button>
            ))}
          </div>

          <span className="readout">
            {output.width}×{output.height} · {fps} fps
          </span>

          <button
            className="btn"
            onClick={toggleImmersive}
            title={immersive ? 'Exit fullscreen (F or Esc)' : 'Fullscreen preview (F)'}
          >
            {immersive ? '⤡ Exit' : '⛶ Fullscreen'}
          </button>
          <button className="btn" onClick={copyLink} title="Copy a link that restores this look">
            ⧉ Link
          </button>
          <button className="btn primary" onClick={openExport} title="Export (E)">
            ↓ Export
          </button>
        </div>
      </div>

      <aside className="panel">
        <div className="panel-head">
          <div className="brand">Liquid · Wallpaper Generator</div>
        </div>

        <div className="panel-scroll">
          <PresetBar
            active={activePreset}
            userPresets={userPresets}
            onApply={applyPreset}
            onSave={savePreset}
            onDelete={deletePreset}
          />
          <ControlPanel params={params} onChange={setParam} onCommitStart={pushUndo} />
        </div>
      </aside>

      {showExport && rendererRef.current && (
        <ExportDialog
          renderer={rendererRef.current}
          params={params}
          time={timeRef.current}
          size={output}
          onSizeChange={setOutput}
          onClose={() => setShowExport(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
