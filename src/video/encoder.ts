import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import type { LiquidRenderer } from '../gl/renderer';
import type { Params } from '../params/schema';

export type VideoFormat = 'mp4' | 'webm';

export const VIDEO_FORMATS = [
  { id: 'mp4' as const, label: 'MP4', ext: 'mp4', mime: 'video/mp4' },
  { id: 'webm' as const, label: 'WebM', ext: 'webm', mime: 'video/webm' },
];

/** Bits per pixel per frame. Smooth gradients need generous bitrates. */
export const QUALITY_LEVELS = [
  { id: 'standard', label: 'Standard', bpp: 0.1 },
  { id: 'high', label: 'High', bpp: 0.2 },
  { id: 'max', label: 'Max', bpp: 0.35 },
] as const;

export type QualityId = (typeof QUALITY_LEVELS)[number]['id'];

const MAX_BITRATE = 60_000_000;

export class VideoError extends Error {}

export function isVideoExportSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * H.264 in yuv420 needs both dimensions even, and VP9 is happier that way too.
 * Rounding down rather than up guarantees we never exceed a requested size.
 */
export function evenSize(width: number, height: number) {
  return { width: width - (width % 2), height: height - (height % 2) };
}

export function estimateBitrate(
  width: number,
  height: number,
  fps: number,
  quality: QualityId,
): number {
  const bpp = QUALITY_LEVELS.find((q) => q.id === quality)?.bpp ?? 0.2;
  return Math.min(MAX_BITRATE, Math.round(width * height * fps * bpp));
}

/**
 * Picks the first codec string the browser will actually accept at this size.
 * Hardcoding a level breaks as soon as someone exports a resolution the level
 * doesn't cover, and the failure surfaces deep inside the encoder.
 */
async function pickCodec(
  format: VideoFormat,
  config: Omit<VideoEncoderConfig, 'codec'>,
): Promise<string> {
  const candidates =
    format === 'mp4'
      ? ['avc1.640034', 'avc1.640033', 'avc1.640032', 'avc1.640028', 'avc1.42E01F']
      : ['vp09.00.51.08', 'vp09.00.41.08', 'vp8'];

  for (const codec of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({ ...config, codec });
      if (support.supported) return codec;
    } catch {
      // Malformed string for this browser — try the next.
    }
  }

  throw new VideoError(
    `This browser can't encode ${format.toUpperCase()} at ${config.width}×${config.height}. Try a lower resolution or the other format.`,
  );
}

export interface VideoExportOptions {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  format: VideoFormat;
  quality: QualityId;
  ssaa: number;
  phaseStart?: number;
  onProgress?: (fraction: number, frame: number, totalFrames: number) => void;
  signal?: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  width: number;
  height: number;
  frameCount: number;
  ssaaUsed: number;
}

export async function exportVideo(
  renderer: LiquidRenderer,
  params: Params,
  opts: VideoExportOptions,
): Promise<VideoExportResult> {
  if (!isVideoExportSupported()) {
    throw new VideoError(
      'This browser has no WebCodecs video encoder. Chrome, Edge, or Safari 16.4+ can export video.',
    );
  }

  const { width, height } = evenSize(opts.width, opts.height);
  const { fps, durationSeconds, format, quality, ssaa, phaseStart = 0 } = opts;

  const frameCount = Math.max(2, Math.round(fps * durationSeconds));
  const bitrate = estimateBitrate(width, height, fps, quality);

  const baseConfig = {
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality' as const,
  };
  const codec = await pickCodec(format, baseConfig);

  const target = format === 'mp4' ? new Mp4Target() : new WebmTarget();
  const muxer =
    format === 'mp4'
      ? new Mp4Muxer({
          target: target as Mp4Target,
          video: { codec: 'avc', width, height, frameRate: fps },
          // Puts the index at the front so players can start without seeking
          // to the end — matters for the live-wallpaper apps that consume this.
          fastStart: 'in-memory',
        })
      : new WebmMuxer({
          target: target as WebmTarget,
          video: { codec: 'V_VP9', width, height, frameRate: fps },
        });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure({ ...baseConfig, codec });

  // A keyframe every ~2s. Fewer keyframes buys quality at a given bitrate, and
  // a looping clip is never seeked into.
  const keyframeInterval = Math.max(1, Math.round(fps * 2));
  const frameDurationUs = Math.round(1_000_000 / fps);

  try {
    const { ssaaUsed } = await renderer.exportSequence(params, {
      width,
      height,
      ssaa,
      frameCount,
      phaseStart,
      signal: opts.signal,
      onProgress: (f, frame) => opts.onProgress?.(f * 0.97, frame, frameCount),
      onFrame: async (canvas, i) => {
        if (encoderError) throw encoderError;

        // Backpressure. Without this the whole sequence queues up as VideoFrames,
        // which at 1440x3120 is gigabytes of non-GC'd memory.
        while (encoder.encodeQueueSize > 4) {
          await new Promise<void>((resolve) => {
            encoder.addEventListener('dequeue', () => resolve(), { once: true });
          });
          if (encoderError) throw encoderError;
        }

        const frame = new VideoFrame(canvas, {
          timestamp: i * frameDurationUs,
          duration: frameDurationUs,
        });
        try {
          encoder.encode(frame, { keyFrame: i % keyframeInterval === 0 });
        } finally {
          frame.close();
        }
      },
    });

    await encoder.flush();
    if (encoderError) throw encoderError;

    muxer.finalize();
    opts.onProgress?.(1, frameCount, frameCount);

    const buffer = (target as Mp4Target | WebmTarget).buffer;
    if (!buffer) throw new VideoError('The muxer produced no output.');

    const mime = format === 'mp4' ? 'video/mp4' : 'video/webm';
    return { blob: new Blob([buffer], { type: mime }), width, height, frameCount, ssaaUsed };
  } finally {
    // close() on an already-closed encoder throws; state check keeps cancel clean.
    if (encoder.state !== 'closed') encoder.close();
  }
}
