import { trimFilename } from "@/lib/time";

export type ExportQuality = "lean" | "fine" | "rich";
export type Compression = "off" | "light" | "tight";

const QUALITY_VIDEO_BPS: Record<ExportQuality, number> = {
  lean: 2_000_000,
  fine: 4_500_000,
  rich: 9_000_000,
};

const COMPRESSION_FACTOR: Record<Compression, number> = {
  off: 1,
  light: 0.45,
  tight: 0.18,
};

const ENCODER_LADDER = ["very-low", "low", "medium", "high", "very-high"] as const;

export function encoderQuality(quality: ExportQuality, compression: Compression): (typeof ENCODER_LADDER)[number] {
  const base = quality === "lean" ? 1 : quality === "rich" ? 3 : 2;
  const shift = compression === "tight" ? -2 : compression === "light" ? -1 : 0;
  return ENCODER_LADDER[Math.max(0, Math.min(ENCODER_LADDER.length - 1, base + shift))];
}

export function exportRates(
  quality: ExportQuality,
  compression: Compression,
  width: number,
  height: number,
): { video: number; audio: number } {
  const w = width >= 16 ? width : 1280;
  const h = height >= 16 ? height : 720;
  const scale = Math.min(3, Math.max(0.35, (w * h) / (1280 * 720)));
  const video = Math.max(120_000, Math.round(QUALITY_VIDEO_BPS[quality] * COMPRESSION_FACTOR[compression] * scale));
  return { video, audio: 128_000 };
}

export function estimateExportBytes(
  quality: ExportQuality,
  compression: Compression,
  seconds: number,
  width: number,
  height: number,
): number {
  if (!(seconds > 0)) return 0;
  const rates = exportRates(quality, compression, width, height);
  return Math.round(((rates.video + rates.audio) * seconds) / 8);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return gb < 10 ? `${gb.toFixed(1)} GB` : `${Math.round(gb)} GB`;
}

type CaptureVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

export async function exportCut(options: {
  file: File;
  filename: string;
  start: number;
  end: number;
  quality: ExportQuality;
  compression: Compression;
  width: number;
  height: number;
  video: HTMLVideoElement | null;
  signal: AbortSignal;
  onProgress: (progress: number, label: string) => void;
}): Promise<{ blob: Blob; filename: string }> {
  const { file, start, end, quality, compression, width, height, video, signal, onProgress } = options;
  const rates = exportRates(quality, compression, width, height);
  if (signal.aborted) throw abortError();
  try {
    onProgress(0, "Encoding cut");
    const blob = await encodeWithMediabunny(file, start, end, quality, compression, signal, onProgress);
    return { blob, filename: trimFilename(options.filename) };
  } catch (error) {
    if (signal.aborted || isAbort(error)) throw abortError();
    if (!video || !captureOf(video)) throw error instanceof Error ? error : new Error("Export failed");
    onProgress(0, "Recording cut");
    const blob = await recordSelection(video, start, end, rates, signal, (progress) => onProgress(progress, "Recording cut"));
    const type = blob.type || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const base = trimFilename(options.filename).replace(/\.mp4$/, "");
    return { blob, filename: `${base}.${ext}` };
  }
}

async function encodeWithMediabunny(
  file: File,
  start: number,
  end: number,
  quality: ExportQuality,
  compression: Compression,
  signal: AbortSignal,
  onProgress: (progress: number, label: string) => void,
): Promise<Blob> {
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality } = await import(
    "mediabunny"
  );
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      trim: { start, end },
      tracks: "primary",
      showWarnings: false,
      copy: false,
      video: {
        quality: new Quality(encoderQuality(quality, compression)),
        hardwareAcceleration: "prefer-hardware",
        keyFrameInterval: 2,
      },
      audio: {
        codec: "aac",
        quality: new Quality("medium"),
      },
    });

    if (!conversion.isValid) {
      const reason = conversion.discardedTracks.find((track) => track.reason !== "discarded_by_user")?.reason;
      throw new Error(reasonText(reason));
    }

    conversion.onProgress = (progress) => onProgress(progress, "Encoding cut");
    const cancel = () => {
      void conversion.cancel();
    };
    signal.addEventListener("abort", cancel);
    try {
      if (signal.aborted) {
        await conversion.cancel();
        throw abortError();
      }
      await conversion.execute();
    } finally {
      signal.removeEventListener("abort", cancel);
    }
    if (!target.buffer) throw new Error("Export produced an empty file.");
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    dispose(input);
  }
}

function recordSelection(
  video: HTMLVideoElement,
  start: number,
  end: number,
  rates: { video: number; audio: number },
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<Blob> {
  const capture = captureOf(video);
  if (!capture) return Promise.reject(new Error("This browser can’t encode that cut."));
  const stream = capture.call(video);
  const mime = pickMime();
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime, videoBitsPerSecond: rates.video, audioBitsPerSecond: rates.audio } : undefined,
  );
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  return new Promise((resolve, reject) => {
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      video.pause();
      if (recorder.state !== "inactive") recorder.stop();
    };
    recorder.onerror = () => reject(new Error("Recording the cut failed."));
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    const span = Math.max(0.05, end - start);
    const arm = () => {
      video.playbackRate = 1;
      void video.play().then(() => {
        if (signal.aborted) {
          onAbort();
          return;
        }
        recorder.start(200);
        const tick = () => {
          if (stopped) return;
          const progress = (video.currentTime - start) / span;
          onProgress(Math.max(0, Math.min(1, progress)));
          if (video.currentTime >= end - 0.04 || video.ended) {
            signal.removeEventListener("abort", onAbort);
            finish();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }).catch(() => {
        signal.removeEventListener("abort", onAbort);
        reject(new Error("Playback has to run to record this cut."));
      });
    };

    if (Math.abs(video.currentTime - start) < 0.05) arm();
    else {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        arm();
      };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = start;
    }
  });
}

function captureOf(video: HTMLVideoElement): (() => MediaStream) | null {
  const el = video as CaptureVideo;
  if (typeof el.captureStream === "function") return el.captureStream;
  if (typeof el.mozCaptureStream === "function") return el.mozCaptureStream;
  return null;
}

function pickMime(): string | undefined {
  const types = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((type) => MediaRecorder.isTypeSupported(type));
}

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case "undecodable_source_codec":
    case "unknown_source_codec":
      return "This browser can’t decode that codec.";
    case "no_encodable_target_codec":
      return "This browser can’t encode an MP4 from that clip.";
    default:
      return "Couldn’t encode that cut.";
  }
}

function abortError(): DOMException {
  return new DOMException("Export canceled", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function dispose(input: object): void {
  const maybe = input as { [Symbol.dispose]?: () => void };
  try {
    maybe[Symbol.dispose]?.();
  } catch {
    /* already closed */
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
