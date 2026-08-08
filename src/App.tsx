import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LiquidRenderer } from './gl/renderer';
import {
  type Group,
  type ParamKey,
  type Params,
  type SimpleSection,
} from './params/schema';
import { BUILTIN_PRESETS } from './params/presets';
import { bakeMatcap, ENV_CUSTOM, ENV_PROCEDURAL } from './params/matcaps';
import {
  decodeParams,
  encodeParams,
  loadKeptLooks,
  loadStoredParams,
  loadUiMode,
  loadUserPresets,
  MAX_KEPT,
  randomizeParams,
  randomSeed,
  storeKeptLooks,
  storeParams,
  storeUiMode,
  storeUserPresets,
  type KeptLook,
  type StoredPreset,
  type UiMode,
} from './params/serialize';
import ControlPanel from './ui/ControlPanel';
import LooksPanel from './ui/LooksPanel';
import ExportDialog from './ui/ExportDialog';
import GuideDialog from './ui/GuideDialog';
import LoopSpeed from './ui/LoopSpeed';
import VariationsGrid from './ui/VariationsGrid';
import MatcapUpload from './ui/MatcapUpload';

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
  const [uiMode, setUiMode] = useState<UiMode>(loadUiMode);
  const [output, setOutput] = useState({ width: 3840, height: 2160 });
  const [quality, setQuality] = useState(0.75);
  const [playing, setPlaying] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showVariations, setShowVariations] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [userPresets, setUserPresets] = useState<StoredPreset[]>(() => loadUserPresets());
  const [kept, setKept] = useState<KeptLook[]>(() => loadKeptLooks());
  const [displaySize, setDisplaySize] = useState({ w: 640, h: 360 });
  const [toast, setToast] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [immersive, setImmersive] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [postSupported, setPostSupported] = useState(true);
  // Deliberately not persisted and not serialised: an uploaded image has no
  // representation in the URL hash, and pretending otherwise in localStorage
  // would make the limitation surface as a bug on the next visit instead.
  const [customMatcap, setCustomMatcap] = useState<{ name: string; levels: ImageData[] } | null>(
    null,
  );

  // Live values the render loop reads without re-subscribing every frame.
  const paramsRef = useRef(params);
  const playingRef = useRef(playing);
  const immersiveRef = useRef(immersive);
  const timeRef = useRef(params.phase);
  const dirtyRef = useRef(true);
  const undoRef = useRef<Params[]>([]);
  /** Set while the Looks panel is rendering thumbnails; see the render loop. */
  const thumbsBusyRef = useRef(false);

  paramsRef.current = params;
  playingRef.current = playing;
  immersiveRef.current = immersive;

  // ------------------------------------------------------------ renderer --

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const r = new LiquidRenderer(canvas);
      rendererRef.current = r;
      setPostSupported(r.postSupported);
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

  // ------------------------------------------------------------- matcap --

  // Baking is a couple of milliseconds of canvas 2D, so it happens on selection
  // rather than at startup and there is no loading state to manage. Clearing
  // the texture is what makes the renderer fall back to the procedural
  // environment, which is how a link carrying a custom matcap degrades.
  //
  // Exposed as a callback because the matcap is a single shared texture: the
  // Looks panel swaps it per thumbnail and calls this to put the current look's
  // own environment back.
  const applyMatcap = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    const mode = paramsRef.current.envMode;
    if (mode === ENV_PROCEDURAL) return; // texture unused; leave whatever is there
    r.setMatcap(mode === ENV_CUSTOM ? (customMatcap?.levels ?? null) : bakeMatcap(mode));
    dirtyRef.current = true;
  }, [customMatcap]);

  useEffect(() => {
    applyMatcap();
  }, [params.envMode, applyMatcap]);

  const setThumbsBusy = useCallback((busy: boolean) => {
    thumbsBusyRef.current = busy;
    if (!busy) dirtyRef.current = true; // repaint whatever the pause held back
  }, []);

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
        // One phase unit is one full loop, so advancing by dt/loopSeconds makes
        // a loop take exactly that many seconds. The shader's period is 1.0, so
        // wrapping keeps the clock bounded and the phase committed on pause is
        // always in range.
        const seconds = Math.max(0.1, paramsRef.current.loopSeconds);
        timeRef.current = (timeRef.current + dt / seconds) % 1;
        dirtyRef.current = true;
      }

      // Thumbnail rendering borrows the shared matcap texture and yields a
      // frame per band, so drawing the preview meanwhile would flicker through
      // other looks' environments. Holding the last frame for a second is the
      // cheaper answer than giving every look its own texture.
      if (dirtyRef.current && rendererRef.current && !thumbsBusyRef.current) {
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

  // Kept out of the params payload above on purpose: the mode is a preference
  // of the person, not part of the look, so it must not ride along in a link.
  useEffect(() => {
    storeUiMode(uiMode);
  }, [uiMode]);

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

  // Shared by the Looks panel and the keyboard handler, so a shortcut and its
  // button cannot drift apart.
  const newSeed = useCallback(() => {
    pushUndo();
    setParams((p) => ({ ...p, seed: randomSeed() }));
    setActivePreset(null);
  }, [pushUndo]);

  const randomizeAll = useCallback(() => {
    pushUndo();
    setParams((p) => randomizeParams(p));
    setActivePreset(null);
  }, [pushUndo]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800);
  }, []);

  /**
   * Applies a recipe from the guide over the current look. A patch rather than a
   * whole parameter set on purpose: a recipe is an effect you add to what you
   * have, not a preset that replaces it.
   */
  const applyRecipe = useCallback(
    (patch: Partial<Params>, name: string) => {
      pushUndo();
      setParams((p) => ({ ...p, ...patch }));
      setActivePreset(null);
      showToast(`Applied “${name}” — Ctrl+Z to undo`);
    },
    [pushUndo, showToast],
  );

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

  /**
   * Pins the current look with a thumbnail. Rendered off the same path exports
   * use, at the export aspect so the tile frames what you would actually get.
   */
  const keepCurrent = useCallback(async () => {
    const r = rendererRef.current;
    if (!r) return;
    try {
      const height = Math.max(36, Math.round((240 * output.height) / output.width));
      const { canvas } = await r.exportImage(paramsRef.current, timeRef.current, {
        width: 240,
        height,
        ssaa: 1,
      });
      const look: KeptLook = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        params: paramsRef.current,
        thumb: canvas.toDataURL('image/jpeg', 0.82),
      };
      setKept((list) => {
        const next = [look, ...list].slice(0, MAX_KEPT);
        storeKeptLooks(next);
        return next;
      });
      showToast('Kept');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not keep this look');
    }
  }, [output, showToast]);

  const removeKept = useCallback((id: string) => {
    setKept((list) => {
      const next = list.filter((l) => l.id !== id);
      storeKeptLooks(next);
      return next;
    });
  }, []);

  const deletePreset = useCallback((name: string) => {
    setUserPresets((list) => {
      const next = list.filter((p) => p.name !== name);
      storeUserPresets(next);
      return next;
    });
  }, []);

  // Rows that belong inside a control group but are not a single serialisable
  // value, so they are not in the schema. Each is registered under both its
  // expert group and its simple section — the controls they belong to (custom
  // environment, bloom) exist in both panels.
  const panelExtras = useMemo<Partial<Record<Group | SimpleSection, React.ReactNode>>>(() => {
    const matcap =
      params.envMode === ENV_CUSTOM ? (
        <MatcapUpload
          loaded={customMatcap?.name ?? null}
          onLoad={(name, levels) => setCustomMatcap({ name, levels })}
          onClear={() => setCustomMatcap(null)}
        />
      ) : null;

    const postWarning = postSupported ? null : (
      <p className="note warn">
        Bloom and depth of field need a float render target, which this browser's WebGL2 does not
        offer (no <code>EXT_color_buffer_float</code>). Both are ignored here.
      </p>
    );

    return {
      Lighting: matcap,
      'Light & Material': matcap,
      Lens: postWarning,
      Finish: postWarning,
    };
  }, [params.envMode, customMatcap, postSupported]);

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
        randomizeAll();
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        newSeed();
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        openExport();
      } else if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setShowVariations((v) => !v);
      } else if (e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void keepCurrent();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleImmersive();
      } else if (e.key.toLowerCase() === 'h' || e.key === '?') {
        e.preventDefault();
        setShowGuide((v) => !v);
      } else if (e.key === 'Escape' && immersiveRef.current) {
        // Only reached when there is no native fullscreen to escape from;
        // otherwise the browser handles Escape and fullscreenchange syncs us.
        exitImmersive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    undo,
    togglePlay,
    randomizeAll,
    newSeed,
    openExport,
    toggleImmersive,
    exitImmersive,
    keepCurrent,
  ]);

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

          {/* What the preview *is*, rather than what you can do to it — so it
              sits on the image instead of taking a slot in the toolbar. The
              quality switch fades in on hover; see .stage-overlay. */}
          <div className={`stage-overlay${immersive && !controlsShown ? ' hidden' : ''}`}>
            <div className="seg" title="Preview render scale">
              {QUALITY_OPTIONS.map((q) => (
                <button
                  key={q.label}
                  className={quality === q.value ? 'on' : ''}
                  onClick={() => setQuality(q.value)}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <span className="readout">
              {output.width}×{output.height} · {fps} fps
            </span>
          </div>
        </div>

        {/* Playback on the left, output on the right. Everything that changes
            the look itself lives in the Looks panel now. */}
        <div className={`stage-bar${immersive && !controlsShown ? ' hidden' : ''}`}>
          <button className="btn" onClick={togglePlay} title="Play / pause (Space)">
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>

          <LoopSpeed
            value={params.loopSeconds}
            onChange={(v) => setParams((p) => ({ ...p, loopSeconds: v }))}
            onCommitStart={pushUndo}
          />

          <span className="spacer" />

          <button
            className="btn icon"
            onClick={toggleImmersive}
            aria-label={immersive ? 'Exit fullscreen' : 'Fullscreen preview'}
            title={immersive ? 'Exit fullscreen (F or Esc)' : 'Fullscreen preview (F)'}
          >
            {immersive ? '⤡' : '⛶'}
          </button>
          <button
            className="btn icon"
            onClick={() => setShowGuide(true)}
            aria-label="Tips and recipes"
            title="Tips and recipes (H)"
          >
            ?
          </button>
          <button
            className="btn icon"
            onClick={copyLink}
            aria-label="Copy a link to this look"
            title="Copy a link that restores this look"
          >
            ⧉
          </button>
          <button className="btn primary" onClick={openExport} title="Export (E)">
            ↓ Export
          </button>
        </div>
      </div>

      <aside className="panel">
        <div className="panel-head">
          <div className="brand">Liquid</div>
          <div className="seg" title="Simple shows a short, plain-language set of controls">
            <button
              className={uiMode === 'simple' ? 'on' : ''}
              aria-pressed={uiMode === 'simple'}
              onClick={() => setUiMode('simple')}
            >
              Simple
            </button>
            <button
              className={uiMode === 'expert' ? 'on' : ''}
              aria-pressed={uiMode === 'expert'}
              onClick={() => setUiMode('expert')}
            >
              Expert
            </button>
          </div>
        </div>

        <div className="panel-scroll">
          <LooksPanel
            renderer={rendererRef.current}
            aspect={output.width / output.height}
            activePreset={activePreset}
            userPresets={userPresets}
            kept={kept}
            onApply={applyPreset}
            onSave={savePreset}
            onDeletePreset={deletePreset}
            onKeep={() => void keepCurrent()}
            onApplyKept={(next) => {
              pushUndo();
              setParams(next);
              setActivePreset(null);
            }}
            onRemoveKept={removeKept}
            onRandomize={randomizeAll}
            onVariations={() => setShowVariations(true)}
            onSeed={newSeed}
            onUndo={undo}
            onThumbsBusy={setThumbsBusy}
            onRestoreMatcap={applyMatcap}
          />
          <ControlPanel
            // Remounting on a mode change re-runs the initially-open logic,
            // which differs per mode, and costs nothing at this size.
            key={uiMode}
            params={params}
            mode={uiMode}
            onChange={setParam}
            onCommitStart={pushUndo}
            onShowExpert={() => setUiMode('expert')}
            extras={panelExtras}
          />
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

      {showVariations && rendererRef.current && (
        <VariationsGrid
          renderer={rendererRef.current}
          params={params}
          time={timeRef.current}
          aspect={output.width / output.height}
          onPick={(next) => {
            pushUndo();
            setParams(next);
            setActivePreset(null);
          }}
          onClose={() => setShowVariations(false)}
        />
      )}

      {showGuide && (
        <GuideDialog mode={uiMode} onClose={() => setShowGuide(false)} onApply={applyRecipe} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
