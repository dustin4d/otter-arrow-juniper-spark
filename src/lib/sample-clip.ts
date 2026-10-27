import { formatClock } from "@/lib/time";

const WIDTH = 960;
const HEIGHT = 540;
const FPS = 24;
const SECONDS = 6;

const SCENES = [
  { name: "OPEN", wash: "#2a2118" },
  { name: "HOLD", wash: "#1a2822" },
  { name: "CUT", wash: "#261c28" },
  { name: "TAIL", wash: "#2c2416" },
];

let cached: Promise<File> | null = null;

export function createSampleClip(onProgress: (progress: number) => void): Promise<File> {
  if (!cached) {
    cached = buildSample(onProgress).catch((error: unknown) => {
      cached = null;
      throw error;
    });
  }
  return cached.then((file) => {
    onProgress(1);
    return file;
  });
}

async function buildSample(onProgress: (progress: number) => void): Promise<File> {
  onProgress(0.02);
  try {
    return await encodeFast(onProgress);
  } catch {
    return recordRealtime(onProgress);
  }
}

function drawFrame(ctx: CanvasRenderingContext2D, time: number) {
  const scene = SCENES[Math.min(SCENES.length - 1, Math.floor(time / (SECONDS / SCENES.length)))];
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = "#100e0c";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = scene.wash;
  ctx.fillRect(36, 36, w - 72, h - 36 - 108);

  const bar = 36 + (time / SECONDS) * (w - 72);
  ctx.fillStyle = "#e4a04a";
  ctx.fillRect(bar, 36, 5, h - 36 - 108);

  ctx.fillStyle = "#f4efe6";
  ctx.font = "600 26px 'IBM Plex Sans', sans-serif";
  ctx.fillText(scene.name, 64, 104);
  ctx.font = "500 84px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillText(formatClock(time), 64, h / 2 + 10);
  ctx.fillStyle = "#c3b6a6";
  ctx.font = "500 22px 'IBM Plex Sans', sans-serif";
  ctx.fillText("KEEL SAMPLE", 64, h / 2 + 52);

  ctx.fillStyle = "#1c1914";
  ctx.fillRect(0, h - 84, w, 84);
  ctx.fillStyle = "#4a4034";
  for (let i = 0; i <= 12; i++) {
    ctx.fillRect((i / 12) * w, h - 84, 2, i % 2 === 0 ? 22 : 12);
  }
  ctx.fillStyle = "#e4a04a";
  ctx.fillRect((time / SECONDS) * w, h - 84, 3, 84);
}

async function encodeFast(onProgress: (progress: number) => void): Promise<File> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality } = await import("mediabunny");
  if (document.fonts?.ready) {
    await Promise.race([document.fonts.ready, new Promise((resolve) => window.setTimeout(resolve, 1200))]);
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const video = new CanvasSource(canvas, {
    codec: "avc",
    quality: new Quality("medium"),
    keyFrameInterval: 1,
  });
  output.addVideoTrack(video);
  await output.start();

  const frames = FPS * SECONDS;
  const frame = 1 / FPS;
  for (let i = 0; i < frames; i++) {
    drawFrame(ctx, i * frame);
    await video.add(i * frame, frame);
    if (i % 6 === 0) onProgress(0.05 + (i / frames) * 0.9);
  }
  await output.finalize();
  if (!target.buffer) throw new Error("Sample encode produced nothing");
  onProgress(1);
  return new File([target.buffer], "keel-sample.mp4", { type: "video/mp4" });
}

function recordRealtime(onProgress: (progress: number) => void): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Couldn’t build the sample clip"));

  const stream = canvas.captureStream(FPS);
  const audioCtx = new AudioContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = 220;
  gain.gain.value = 0.04;
  osc.connect(gain);
  const dest = audioCtx.createMediaStreamDestination();
  gain.connect(dest);
  osc.start();

  const mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
    ? "video/webm;codecs=vp8,opus"
    : "video/webm";
  const recorder = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 1_800_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  const done = new Promise<File>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Couldn’t build the sample clip"));
    recorder.onstop = () => {
      osc.stop();
      void audioCtx.close();
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      resolve(new File([blob], "keel-sample.webm", { type: blob.type }));
    };
  });

  recorder.start(100);
  const started = performance.now();
  const tick = () => {
    const elapsed = (performance.now() - started) / 1000;
    const time = Math.min(SECONDS, elapsed);
    drawFrame(ctx, time);
    onProgress(Math.min(0.99, time / SECONDS));
    if (elapsed >= SECONDS) {
      recorder.stop();
      onProgress(1);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return done;
}
