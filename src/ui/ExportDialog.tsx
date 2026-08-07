import { useMemo, useRef, useState } from 'react';
import type { LiquidRenderer } from '../gl/renderer';
import type { Params } from '../params/schema';
import {
  canvasToBlob,
  downloadBlob,
  FORMATS,
  RESOLUTIONS,
  type ResolutionPreset,
} from '../params/resolutions';
import {
  estimateBitrate,
  evenSize,
  exportVideo,
  isVideoExportSupported,
  QUALITY_LEVELS,
  VIDEO_FORMATS,
  type QualityId,
  type VideoFormat,
} from '../video/encoder';

interface Props {
  renderer: LiquidRenderer;
  params: Params;
  time: number;
  size: { width: number; height: number };
  onSizeChange: (size: { width: number; height: number }) => void;
  onClose: () => void;
}

const CATEGORIES = ['Desktop', 'Ultrawide', 'Mobile', 'Foldable', 'Tablet'] as const;
const FPS_OPTIONS = [24, 30, 60];

export default function ExportDialog({
  renderer,
  params,
  time,
  size,
  onSizeChange,
  onClose,
}: Props) {
  const [tab, setTab] = useState<'image' | 'video'>('image');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  // image
  const [formatIdx, setFormatIdx] = useState(0);
  const [imageQuality, setImageQuality] = useState(0.92);
  const [ssaa, setSsaa] = useState(2);

  // video
  const [duration, setDuration] = useState(6);
  const [fps, setFps] = useState(30);
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('mp4');
  const [videoQuality, setVideoQuality] = useState<QualityId>('high');
  const [videoSsaa, setVideoSsaa] = useState(1);
  const abortRef = useRef<AbortController | null>(null);

  const format = FORMATS[formatIdx];
  const max = renderer.maxTextureSize;
  const videoSupported = isVideoExportSupported();

  const activeSsaa = tab === 'image' ? ssaa : videoSsaa;
  const tooBig = size.width > max || size.height > max;
  const effectiveSsaa = tooBig ? 1 : renderer.clampSsaa(size.width, size.height, activeSsaa);
  const megapixels = (size.width * size.height) / 1e6;

  const even = evenSize(size.width, size.height);
  const dimensionsAdjusted = even.width !== size.width || even.height !== size.height;
  const frameCount = Math.max(2, Math.round(fps * duration));
  const estBytes =
    (estimateBitrate(even.width, even.height, fps, videoQuality) * duration) / 8;

  const matching = useMemo(
    () => RESOLUTIONS.find((r) => r.width === size.width && r.height === size.height),
    [size],
  );

  const setDim = (key: 'width' | 'height', raw: string) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    onSizeChange({ ...size, [key]: Math.min(32768, Math.max(16, n)) });
  };

  const applyPreset = (r: ResolutionPreset) => onSizeChange({ width: r.width, height: r.height });

  const runImage = async () => {
    setBusy(true);
    setError(null);
    setProgress(0);
    setProgressLabel('');
    try {
      const { canvas, ssaaUsed } = await renderer.exportImage(params, time, {
        width: size.width,
        height: size.height,
        ssaa,
        onProgress: setProgress,
      });
      const blob = await canvasToBlob(canvas, format.mime, imageQuality);
      downloadBlob(
        blob,
        `liquid-${params.seed}-${size.width}x${size.height}${ssaaUsed > 1 ? `-ss${ssaaUsed}` : ''}.${format.ext}`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runVideo = async () => {
    setBusy(true);
    setError(null);
    setProgress(0);
    setProgressLabel('Preparing…');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const result = await exportVideo(renderer, params, {
        width: size.width,
        height: size.height,
        fps,
        durationSeconds: duration,
        format: videoFormat,
        quality: videoQuality,
        ssaa: videoSsaa,
        phaseStart: params.phase,
        signal: ctrl.signal,
        onProgress: (f, frame, total) => {
          setProgress(f);
          setProgressLabel(frame >= total ? 'Encoding…' : `Frame ${frame} / ${total}`);
        },
      });
      const ext = VIDEO_FORMATS.find((f) => f.id === videoFormat)!.ext;
      downloadBlob(
        result.blob,
        `liquid-${params.seed}-${result.width}x${result.height}-${duration}s.${ext}`,
      );
      onClose();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setProgressLabel('');
        setProgress(0);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const cancel = () => {
    if (busy && abortRef.current) abortRef.current.abort();
    else if (!busy) onClose();
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Export wallpaper">
        <div className="dialog-head">
          <span style={{ flex: 1 }}>Export</span>
          <button className="btn icon" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'image'}
            className={tab === 'image' ? 'on' : ''}
            onClick={() => setTab('image')}
            disabled={busy}
          >
            Image
          </button>
          <button
            role="tab"
            aria-selected={tab === 'video'}
            className={tab === 'video' ? 'on' : ''}
            onClick={() => setTab('video')}
            disabled={busy}
          >
            Video
          </button>
        </div>

        <div className="dialog-body">
          {/* Resolution is shared by both tabs — the preview letterboxes to it. */}
          <div className="field">
            <label htmlFor="res-preset">Resolution</label>
            <select
              id="res-preset"
              disabled={busy}
              value={matching ? `${matching.width}x${matching.height}` : 'custom'}
              onChange={(e) => {
                const r = RESOLUTIONS.find((x) => `${x.width}x${x.height}` === e.target.value);
                if (r) applyPreset(r);
              }}
            >
              <option value="custom">Custom</option>
              {CATEGORIES.map((cat) => (
                <optgroup key={cat} label={cat}>
                  {RESOLUTIONS.filter((r) => r.category === cat).map((r) => (
                    <option key={r.label} value={`${r.width}x${r.height}`}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="field-grid">
            <div className="field">
              <label htmlFor="ex-w">Width</label>
              <input
                id="ex-w"
                type="number"
                value={size.width}
                min={16}
                disabled={busy}
                onChange={(e) => setDim('width', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ex-h">Height</label>
              <input
                id="ex-h"
                type="number"
                value={size.height}
                min={16}
                disabled={busy}
                onChange={(e) => setDim('height', e.target.value)}
              />
            </div>
          </div>

          <button
            className="btn"
            disabled={busy}
            onClick={() => onSizeChange({ width: size.height, height: size.width })}
          >
            ⇄ Swap orientation
          </button>

          {tab === 'image' ? (
            <>
              <div className="field">
                <label>Supersampling</label>
                <div className="seg">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      className={ssaa === n ? 'on' : ''}
                      onClick={() => setSsaa(n)}
                      disabled={busy}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Format</label>
                <div className="seg">
                  {FORMATS.map((f, i) => (
                    <button
                      key={f.label}
                      className={formatIdx === i ? 'on' : ''}
                      onClick={() => setFormatIdx(i)}
                      disabled={busy}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {format.lossy && (
                <div className="field">
                  <label htmlFor="ex-q">Quality · {Math.round(imageQuality * 100)}</label>
                  <input
                    id="ex-q"
                    type="range"
                    min={0.4}
                    max={1}
                    step={0.01}
                    value={imageQuality}
                    disabled={busy}
                    onChange={(e) => setImageQuality(Number(e.target.value))}
                  />
                </div>
              )}

              <p className="note">
                {megapixels.toFixed(1)} MP · rendering at {size.width * effectiveSsaa}×
                {size.height * effectiveSsaa}
                {megapixels > 20 && ' · large exports can take a while'}
              </p>
            </>
          ) : (
            <>
              <div className="field-grid">
                <div className="field">
                  <label htmlFor="vid-dur">Loop duration · {duration}s</label>
                  <input
                    id="vid-dur"
                    type="range"
                    min={2}
                    max={15}
                    step={0.5}
                    value={duration}
                    disabled={busy}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>Frame rate</label>
                  <div className="seg">
                    {FPS_OPTIONS.map((n) => (
                      <button
                        key={n}
                        className={fps === n ? 'on' : ''}
                        onClick={() => setFps(n)}
                        disabled={busy}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Format</label>
                <div className="seg">
                  {VIDEO_FORMATS.map((f) => (
                    <button
                      key={f.id}
                      className={videoFormat === f.id ? 'on' : ''}
                      onClick={() => setVideoFormat(f.id)}
                      disabled={busy}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Quality</label>
                <div className="seg">
                  {QUALITY_LEVELS.map((q) => (
                    <button
                      key={q.id}
                      className={videoQuality === q.id ? 'on' : ''}
                      onClick={() => setVideoQuality(q.id)}
                      disabled={busy}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Supersampling</label>
                <div className="seg">
                  {[1, 2].map((n) => (
                    <button
                      key={n}
                      className={videoSsaa === n ? 'on' : ''}
                      onClick={() => setVideoSsaa(n)}
                      disabled={busy}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              </div>

              <p className="note">
                The clip contains <strong>exactly one seamless loop</strong> — loop duration sets
                how long it takes. The Speed slider only affects the live preview.
              </p>
              <p className="note">
                {frameCount} frames · {even.width}×{even.height} · ~{(estBytes / 1e6).toFixed(0)} MB
              </p>
              <p className="note">
                Android can't set a video as wallpaper on its own — use a live-wallpaper app and
                point it at this file.
              </p>

              {!videoSupported && (
                <p className="note error">
                  This browser has no WebCodecs video encoder. Chrome, Edge, or Safari 16.4+ can
                  export video.
                </p>
              )}

              {dimensionsAdjusted && (
                <p className="note warn">
                  Video needs even dimensions — exporting at {even.width}×{even.height} instead of{' '}
                  {size.width}×{size.height}.
                </p>
              )}
            </>
          )}

          {tooBig && (
            <p className="note error">
              {size.width}×{size.height} exceeds this GPU's maximum render size of {max} px. Reduce
              the resolution.
            </p>
          )}

          {!tooBig && effectiveSsaa < activeSsaa && (
            <p className="note warn">
              Supersampling reduced to {effectiveSsaa}× — {activeSsaa}× would need a{' '}
              {size.width * activeSsaa}×{size.height * activeSsaa} buffer, past this GPU's {max} px
              limit.
            </p>
          )}

          {busy && (
            <>
              <div className="progress">
                <div style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              {progressLabel && <p className="note">{progressLabel}</p>}
            </>
          )}

          {error && <p className="note error">{error}</p>}
        </div>

        <div className="dialog-foot">
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
          {tab === 'image' ? (
            <button className="btn primary" onClick={runImage} disabled={busy || tooBig}>
              {busy ? `Rendering ${Math.round(progress * 100)}%` : 'Render & download'}
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={runVideo}
              disabled={busy || tooBig || !videoSupported}
            >
              {busy ? `Rendering ${Math.round(progress * 100)}%` : 'Render & download'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
