import { trimFilename } from "@/lib/time";

export type ExportQuality = "lean" | "fine" | "rich";

const VIDEO_QUALITY = {
  lean: "low",
  fine: "medium",
  rich: "high",
} as const;

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
  video: HTMLVideoElement | null;
  signal: AbortSignal;
  onProgress: (progress: number, label: string) => void;
}): Promise<{ blob: Blob; filename: string }> {
  const { file, start, end, quality, video, signal, onProgress } = options;
  if (signal.aborted) throw abortError();
  try {
    onProgress(0, "Encoding cut");
    const blob = await encodeWithMediabunny(file, start, end, quality, signal, onProgress);
    return { blob, filename: trimFilename(options.filename) };
  } catch (error) {
    if (signal.aborted || isAbort(error)) throw abortError();
    if (!video || !captureOf(video)) throw error instanceof Error ? error : new Error("Export failed");
    onProgress(0, "Recording cut");
    const blob = await recordSelection(video, start, end, signal, (progress) => onProgress(progress, "Recording cut"));
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
    const level = VIDEO_QUALITY[quality];
    const conversion = await Conversion.init({
      input,
      output,
      trim: { start, end },
      tracks: "primary",
      showWarnings: false,
      copy: false,
      video: {
        quality: new Quality(level),
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
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<Blob> {
  const capture = captureOf(video);
  if (!capture) return Promise.reject(new Error("This browser can’t encode that cut."));
  const stream = capture.call(video);
  const mime = pickMime();
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 } : undefined,
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
