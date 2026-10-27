import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  FolderOpen,
  Keyboard,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  SkipBack,
  SkipForward,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { downloadBlob, exportCut, type ExportQuality } from "@/lib/export-clip";
import { createSampleClip } from "@/lib/sample-clip";
import { extractThumbs } from "@/lib/thumbs";
import { FRAME, clamp, clampTrim, formatClock, nearly, type Trim } from "@/lib/time";
import { Timeline } from "@/components/editor/Timeline";

type Clip = {
  id: number;
  file: File;
  url: string;
  name: string;
  duration: number;
  width: number;
  height: number;
};

type Banner = { tone: "info" | "error"; text: string };

type Prefs = {
  loop: boolean;
  rate: number;
  muted: boolean;
  volume: number;
  quality: ExportQuality;
  snap: boolean;
};

const PREFS_KEY = "keel.prefs.v1";
const RATES = [0.5, 1, 1.5, 2];

const DEFAULT_PREFS: Prefs = {
  loop: true,
  rate: 1,
  muted: false,
  volume: 1,
  quality: "fine",
  snap: true,
};

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Play or pause"],
  ["J  K  L", "Back 1s, pause, play"],
  ["←  →", "Step one frame"],
  ["Shift ← →", "Step one second"],
  ["I  /  O", "Mark in and out"],
  ["Home  /  End", "Go to in or out"],
  ["M", "Mute"],
  ["R", "Reset the cut"],
  ["⌘Z  /  ⌘⇧Z", "Undo and redo"],
  ["−  /  +", "Zoom the timeline"],
  ["F", "Fit the timeline"],
  ["⌘E", "Export"],
  ["?", "Shortcuts"],
];

export function Editor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  const openId = useRef(0);
  const initedFor = useRef(0);
  const trimRef = useRef<Trim>({ in: 0, out: 0 });
  const durationRef = useRef(0);
  const currentRef = useRef(0);
  const loopRef = useRef(true);
  const rateRef = useRef(1);
  const busyRef = useRef(false);
  const gestureRef = useRef<Trim | null>(null);
  const historyRef = useRef<{ past: Trim[]; future: Trim[] }>({ past: [], future: [] });
  const abortRef = useRef<AbortController | null>(null);
  const sampleLock = useRef(false);
  const playScopeRef = useRef<"cut" | "free">("cut");

  const [clip, setClip] = useState<Clip | null>(null);
  const [trim, setTrim] = useState<Trim>({ in: 0, out: 0 });
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [thumbFraction, setThumbFraction] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [help, setHelp] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sampleProgress, setSampleProgress] = useState<number | null>(null);
  const [job, setJob] = useState<{ progress: number; label: string } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  trimRef.current = trim;
  durationRef.current = clip?.duration ?? 0;
  currentRef.current = current;
  loopRef.current = prefs.loop;
  rateRef.current = prefs.rate;
  busyRef.current = job !== null;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      setPrefs((prev) => ({
        ...prev,
        loop: typeof parsed.loop === "boolean" ? parsed.loop : prev.loop,
        rate: RATES.includes(parsed.rate ?? -1) ? (parsed.rate as number) : prev.rate,
        muted: typeof parsed.muted === "boolean" ? parsed.muted : prev.muted,
        volume: typeof parsed.volume === "number" ? clamp(parsed.volume, 0, 1) : prev.volume,
        quality: parsed.quality === "lean" || parsed.quality === "fine" || parsed.quality === "rich" ? parsed.quality : prev.quality,
        snap: typeof parsed.snap === "boolean" ? parsed.snap : prev.snap,
      }));
    } catch {
      /* ignore broken prefs */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || job) return;
    video.playbackRate = prefs.rate;
    video.muted = prefs.muted;
    video.volume = prefs.volume;
  }, [prefs.rate, prefs.muted, prefs.volume, job, clip?.id]);

  useEffect(() => {
    if (!playing || job) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (!video) return;
      if (!busyRef.current && loopRef.current && playScopeRef.current === "cut" && !video.paused) {
        const fudge = Math.max(0.05, 0.08 * rateRef.current);
        if (video.currentTime >= trimRef.current.out - fudge) {
          video.currentTime = trimRef.current.in;
          if (video.paused) void video.play();
        }
      }
      setCurrent(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, job]);

  useEffect(() => {
    if (!clip || clip.duration <= 0) return;
    if (initedFor.current === clip.id) return;
    initedFor.current = clip.id;
    const next = { in: 0, out: clip.duration };
    trimRef.current = next;
    setTrim(next);
    historyRef.current = { past: [], future: [] };
    setCanUndo(false);
    setCanRedo(false);
    setCurrent(0);
  }, [clip]);

  useEffect(() => {
    if (!clip || clip.duration <= 0) {
      setThumbs([]);
      setThumbFraction(0);
      return;
    }
    const ac = new AbortController();
    const count = Math.min(14, Math.max(8, Math.round(clip.duration)));
    setThumbs([]);
    setThumbFraction(0);
    void extractThumbs(clip.url, clip.duration, count, ac.signal, (urls) => {
      if (ac.signal.aborted) return;
      setThumbs(urls);
      setThumbFraction(urls.length / count);
    }).catch(() => {});
    return () => ac.abort();
  }, [clip]);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  useEffect(() => {
    const title = clip ? `${clip.name} — Keel` : "Keel";
    document.title = title;
  }, [clip]);

  const openFileRef = useRef<(file: File) => void>(() => {});
  const exportRef = useRef<() => void>(() => {});
  const apiRef = useRef({
    togglePlay: () => {},
    step: (_delta: number) => {},
    jump: (_time: number) => {},
    markIn: () => {},
    markOut: () => {},
    resetTrim: () => {},
    undo: () => {},
    redo: () => {},
    toggleMute: () => {},
    toggleHelp: () => {},
    cancelJob: () => {},
  });

  function syncHistory() {
    setCanUndo(historyRef.current.past.length > 0);
    setCanRedo(historyRef.current.future.length > 0);
  }

  function applyTrim(next: Trim) {
    const clamped = clampTrim(next.in, next.out, durationRef.current);
    trimRef.current = clamped;
    setTrim(clamped);
  }

  function recordAndApply(next: Trim) {
    const clamped = clampTrim(next.in, next.out, durationRef.current);
    if (nearly(clamped.in, trimRef.current.in) && nearly(clamped.out, trimRef.current.out)) return;
    historyRef.current.past.push(trimRef.current);
    if (historyRef.current.past.length > 80) historyRef.current.past.shift();
    historyRef.current.future = [];
    applyTrim(clamped);
    syncHistory();
  }

  function openFile(file: File) {
    if (!isLikelyVideo(file)) {
      setBanner({ tone: "error", text: "Keel opens video files — MP4, WebM, or MOV." });
      return;
    }
    abortRef.current?.abort();
    const id = ++openId.current;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    setBanner(null);
    setPlaying(false);
    setThumbs([]);
    setThumbFraction(0);
    setClip({ id, file, url, name: file.name, duration: 0, width: 0, height: 0 });
  }
  openFileRef.current = openFile;

  function adopt(video: HTMLVideoElement) {
    const id = openId.current;
    const apply = (duration: number) => {
      if (!Number.isFinite(duration) || duration <= 0 || duration === Infinity) return;
      setClip((prev) => {
        if (!prev || prev.id !== id) return prev;
        if (prev.duration > 0) {
          if (prev.width === video.videoWidth && prev.height === video.videoHeight) return prev;
          return { ...prev, width: video.videoWidth, height: video.videoHeight };
        }
        return { ...prev, duration, width: video.videoWidth, height: video.videoHeight };
      });
    };
    const duration = video.duration;
    if (Number.isFinite(duration) && duration > 0) {
      apply(duration);
      return;
    }
    void probeDuration(video).then(apply);
  }

  function failOpen() {
    if (openId.current === 0) return;
    openId.current += 1;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setClip(null);
    setBanner({ tone: "error", text: "This browser can’t play that file. Try MP4, WebM, or MOV." });
  }

  function seek(time: number) {
    const video = videoRef.current;
    const next = clamp(time, 0, durationRef.current || 0);
    currentRef.current = next;
    setCurrent(next);
    if (video) {
      video.pause();
      video.currentTime = next;
    }
  }

  function playFrom(time: number) {
    const video = videoRef.current;
    if (!video || !clip || clip.duration <= 0 || job) return;
    const dur = durationRef.current || 0;
    const next = clamp(time, 0, dur);
    currentRef.current = next;
    setCurrent(next);
    video.currentTime = next;
    if (dur - next < 0.05) {
      video.pause();
      return;
    }
    playScopeRef.current = next >= trimRef.current.out - 0.05 ? "free" : "cut";
    void video.play().catch(() => setPlaying(false));
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video || !clip || clip.duration <= 0 || job) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    playScopeRef.current = "cut";
    if (prefs.loop && (video.currentTime < trimRef.current.in || video.currentTime >= trimRef.current.out - 0.05)) {
      video.currentTime = trimRef.current.in;
    }
    void video.play().catch(() => setPlaying(false));
  }

  function step(delta: number) {
    const video = videoRef.current;
    if (!video || !clip) return;
    video.pause();
    seek((video.currentTime || currentRef.current) + delta);
  }

  function markIn() {
    const time = videoRef.current?.currentTime ?? currentRef.current;
    recordAndApply({ in: time, out: trimRef.current.out });
  }

  function markOut() {
    const time = videoRef.current?.currentTime ?? currentRef.current;
    recordAndApply({ in: trimRef.current.in, out: time });
  }

  function resetTrim() {
    if (!clip || clip.duration <= 0) return;
    recordAndApply({ in: 0, out: clip.duration });
  }

  function undo() {
    const prev = historyRef.current.past.pop();
    if (!prev) return;
    historyRef.current.future.push(trimRef.current);
    applyTrim(prev);
    syncHistory();
  }

  function redo() {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(trimRef.current);
    applyTrim(next);
    syncHistory();
  }

  function toggleMute() {
    setPrefs((prev) => ({ ...prev, muted: !prev.muted }));
  }

  function cancelJob() {
    abortRef.current?.abort();
  }

  apiRef.current = {
    togglePlay,
    step,
    jump: seek,
    markIn,
    markOut,
    resetTrim,
    undo,
    redo,
    toggleMute,
    toggleHelp: () => setHelp((open) => !open),
    cancelJob,
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      const key = event.key;
      const meta = event.metaKey || event.ctrlKey;
      if (key === "Escape") {
        if (help) {
          setHelp(false);
          return;
        }
        if (busyRef.current) {
          event.preventDefault();
          apiRef.current.cancelJob();
        }
        return;
      }
      if (key === "?" || (key === "/" && event.shiftKey)) {
        event.preventDefault();
        apiRef.current.toggleHelp();
        return;
      }
      if (meta && key.toLowerCase() === "e") {
        event.preventDefault();
        exportRef.current();
        return;
      }
      if (meta && key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) apiRef.current.redo();
        else apiRef.current.undo();
        return;
      }
      if (meta || event.altKey) return;
      if (key === " ") {
        event.preventDefault();
        apiRef.current.togglePlay();
      } else if (key === "k" || key === "K") {
        event.preventDefault();
        videoRef.current?.pause();
      } else if (key === "l" || key === "L") {
        event.preventDefault();
        const video = videoRef.current;
        if (video?.paused) apiRef.current.togglePlay();
      } else if (key === "j" || key === "J") {
        event.preventDefault();
        apiRef.current.step(-1);
      } else if (key === "ArrowLeft") {
        event.preventDefault();
        apiRef.current.step(event.shiftKey ? -1 : -FRAME);
      } else if (key === "ArrowRight") {
        event.preventDefault();
        apiRef.current.step(event.shiftKey ? 1 : FRAME);
      } else if (key === "i" || key === "I" || key === "[") {
        event.preventDefault();
        apiRef.current.markIn();
      } else if (key === "o" || key === "O" || key === "]") {
        event.preventDefault();
        apiRef.current.markOut();
      } else if (key === "Home") {
        event.preventDefault();
        apiRef.current.jump(trimRef.current.in);
      } else if (key === "End") {
        event.preventDefault();
        apiRef.current.jump(trimRef.current.out);
      } else if (key === "m" || key === "M") {
        event.preventDefault();
        apiRef.current.toggleMute();
      } else if (key === "r" || key === "R") {
        event.preventDefault();
        apiRef.current.resetTrim();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types?.includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = pickVideo(event.dataTransfer.files);
      if (file) openFileRef.current(file);
      else if (event.dataTransfer.files.length) {
        setBanner({ tone: "error", text: "Keel opens video files — MP4, WebM, or MOV." });
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("demo")) return;
    void loadSample();
    // Only the first visit with ?demo=1 should auto-open the sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSample() {
    if (sampleLock.current) return;
    sampleLock.current = true;
    setSampleProgress(0);
    setBanner(null);
    try {
      const file = await createSampleClip((progress) => setSampleProgress(progress));
      openFileRef.current(file);
    } catch (error) {
      setBanner({ tone: "error", text: error instanceof Error ? error.message : "Couldn’t build the sample." });
    } finally {
      sampleLock.current = false;
      setSampleProgress(null);
    }
  }

  async function onExport() {
    if (!clip || clip.duration <= 0 || job) return;
    const span = trimRef.current.out - trimRef.current.in;
    if (span < 0.05) {
      setBanner({ tone: "error", text: "The cut is too short to export." });
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    videoRef.current?.pause();
    setJob({ progress: 0, label: "Encoding cut" });
    setBanner(null);
    try {
      const result = await exportCut({
        file: clip.file,
        filename: clip.name,
        start: trimRef.current.in,
        end: trimRef.current.out,
        quality: prefs.quality,
        video: videoRef.current,
        signal: ctrl.signal,
        onProgress: (progress, label) => setJob({ progress, label }),
      });
      downloadBlob(result.blob, result.filename);
      setBanner({ tone: "info", text: `Downloaded ${result.filename}` });
    } catch (error) {
      if (isAbort(error)) setBanner({ tone: "info", text: "Export canceled" });
      else setBanner({ tone: "error", text: error instanceof Error ? error.message : "Export failed" });
    } finally {
      setJob(null);
      abortRef.current = null;
    }
  }
  exportRef.current = onExport;

  const ready = Boolean(clip && clip.duration > 0);
  const span = Math.max(0, trim.out - trim.in);
  const meta = ready && clip ? `${clip.width}×${clip.height} · ${formatClock(clip.duration)}` : "On this device";

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="flex shrink-0 items-center gap-2">
          <Mark />
          <span className="text-sm font-medium tracking-tight">Keel</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            <span>{clip?.name ?? "No clip"}</span>
            <span className="text-faint"> · {meta}</span>
          </p>
        </div>
        <button type="button" className={iconBtn} aria-label="Keyboard shortcuts" onClick={() => setHelp(true)}>
          <Keyboard className="size-4" />
        </button>
        <button type="button" className={ghost} onClick={() => inputRef.current?.click()}>
          <FolderOpen className="size-4" />
          <span className="hidden sm:inline">Open</span>
        </button>
        {job ? (
          <button type="button" className={iconBtn} onClick={cancelJob} aria-label="Cancel export">
            <X className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          className={primary}
          disabled={!ready || Boolean(job)}
          onClick={() => void onExport()}
          aria-label={job ? job.label : "Export trim"}
        >
          {job ? `${Math.round(job.progress * 100)}%` : "Export"}
        </button>
      </header>
      {job && (
        <div className="h-0.5 shrink-0 bg-bg">
          <div className="h-full bg-accent" style={{ width: `${Math.max(3, job.progress * 100)}%` }} />
        </div>
      )}
      {banner && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-raised px-3 py-2 text-sm">
          <p className="min-w-0 flex-1">{banner.text}</p>
          <button type="button" className={iconBtn} aria-label="Dismiss" onClick={() => setBanner(null)}>
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-bg p-3 md:p-6">
        {clip ? (
          <>
            <video
              key={clip.id}
              ref={videoRef}
              src={clip.url}
              playsInline
              preload="auto"
              disablePictureInPicture
              className="max-h-full max-w-full bg-surface"
              onLoadedMetadata={(event) => adopt(event.currentTarget)}
              onDurationChange={(event) => adopt(event.currentTarget)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => {
                if (clip.id === openId.current && clip.duration <= 0) failOpen();
              }}
              onClick={togglePlay}
            />
            {clip.duration <= 0 && <p className="absolute text-sm text-muted">Reading clip…</p>}
          </>
        ) : (
          <div className="flex w-full max-w-md flex-col items-center px-4 text-center">
            <span className="mb-4 flex size-12 items-center justify-center rounded-md border border-line bg-surface text-accent">
              <Clapperboard className="size-6" />
            </span>
            <h1 className="text-2xl font-medium tracking-tight text-balance">Drop a short video</h1>
            <p className="mt-2 max-w-sm text-sm text-pretty text-muted">
              Drag the edges of the timeline to keep the middle. The file stays in this browser.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <button type="button" className={primary} onClick={() => inputRef.current?.click()}>
                <FolderOpen className="size-4" />
                Browse
              </button>
              <button type="button" className={ghost} onClick={() => void loadSample()} disabled={sampleProgress !== null}>
                {sampleProgress === null ? "Try a sample" : `Making sample ${Math.round(sampleProgress * 100)}%`}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-3 py-2 md:flex-row md:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={playBtn} onClick={togglePlay} disabled={!ready || Boolean(job)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
          <button type="button" className={iconBtn} onClick={() => step(-FRAME)} disabled={!ready} aria-label="Step back one frame">
            <SkipBack className="size-4" />
          </button>
          <button type="button" className={iconBtn} onClick={() => step(FRAME)} disabled={!ready} aria-label="Step forward one frame">
            <SkipForward className="size-4" />
          </button>
          <p className="font-mono text-sm tabular-nums">
            <span>{formatClock(current)}</span>
            <span className="text-faint"> / {formatClock(clip?.duration ?? 0)}</span>
          </p>
          <button
            type="button"
            className={prefs.loop ? toggleOn : ghost}
            aria-pressed={prefs.loop}
            onClick={() => setPrefs((prev) => ({ ...prev, loop: !prev.loop }))}
          >
            Loop cut
          </button>
          <button type="button" className={iconBtn} onClick={toggleMute} aria-label={prefs.muted ? "Unmute" : "Mute"} aria-pressed={prefs.muted}>
            {prefs.muted || prefs.volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <input
            className="keel-slider hidden sm:block"
            type="range"
            min={0}
            max={1}
            step={0.01}
            aria-label="Volume"
            value={prefs.muted ? 0 : prefs.volume}
            onChange={(event) => {
              const volume = Number(event.target.value);
              setPrefs((prev) => ({ ...prev, volume, muted: volume === 0 }));
            }}
          />
          <button
            type="button"
            className={ghost}
            onClick={() =>
              setPrefs((prev) => {
                const index = RATES.indexOf(prev.rate);
                return { ...prev, rate: RATES[(index + 1) % RATES.length] ?? 1 };
              })
            }
          >
            {prefs.rate}×
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          <Readout label="In" value={formatClock(trim.in)} />
          <Readout label="Length" value={formatClock(span)} accent />
          <Readout label="Out" value={formatClock(trim.out)} />
          <button type="button" className={ghost} onClick={markIn} disabled={!ready}>
            Mark in
          </button>
          <button type="button" className={ghost} onClick={markOut} disabled={!ready}>
            Mark out
          </button>
          <button type="button" className={iconBtn} onClick={resetTrim} disabled={!ready} aria-label="Reset trim">
            <RotateCcw className="size-4" />
          </button>
          <button type="button" className={iconBtn} onClick={undo} disabled={!canUndo} aria-label="Undo trim">
            <Undo2 className="size-4" />
          </button>
          <button type="button" className={iconBtn} onClick={redo} disabled={!canRedo} aria-label="Redo trim">
            <Redo2 className="size-4" />
          </button>
          <div className="flex h-11 items-center rounded-md border border-line p-0.5">
            {(["lean", "fine", "rich"] as const).map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={prefs.quality === level}
                className={
                  prefs.quality === level
                    ? "h-10 rounded-sm bg-raised px-3 text-xs font-medium text-fg capitalize"
                    : "h-10 rounded-sm px-3 text-xs text-faint capitalize"
                }
                onClick={() => setPrefs((prev) => ({ ...prev, quality: level }))}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Timeline
        key={clip?.id ?? 0}
        duration={clip?.duration ?? 0}
        trim={trim}
        current={current}
        thumbs={thumbs}
        thumbFraction={thumbFraction}
        snap={prefs.snap}
        playing={playing}
        src={clip?.url ?? null}
        locked={Boolean(job)}
        onToggleSnap={() => setPrefs((prev) => ({ ...prev, snap: !prev.snap }))}
        onSeek={seek}
        onPlayFrom={playFrom}
        onTrim={(next) => applyTrim(next)}
        onTrimStart={() => {
          gestureRef.current = trimRef.current;
          videoRef.current?.pause();
        }}
        onTrimEnd={() => {
          const start = gestureRef.current;
          gestureRef.current = null;
          if (!start) return;
          if (nearly(start.in, trimRef.current.in) && nearly(start.out, trimRef.current.out)) return;
          historyRef.current.past.push(start);
          if (historyRef.current.past.length > 80) historyRef.current.past.shift();
          historyRef.current.future = [];
          syncHistory();
        }}
      />

      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.ogv,.ogg"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) openFile(file);
        }}
      />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-bg/85">
          <div className="rounded-md border border-accent px-8 py-6 text-center">
            <p className="text-lg font-medium">Drop to open</p>
            <p className="text-sm text-muted">Replaces the current clip</p>
          </div>
        </div>
      )}

      {help && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-bg/80 p-3 sm:items-center" onClick={() => setHelp(false)}>
          <div
            className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-md border border-line bg-surface"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-labelledby="shortcut-title"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="shortcut-title" className="text-sm font-medium">
                Shortcuts
              </h2>
              <button type="button" className={iconBtn} aria-label="Close shortcuts" onClick={() => setHelp(false)}>
                <X className="size-4" />
              </button>
            </div>
            <dl className="overflow-auto px-4 py-2">
              {SHORTCUTS.map(([key, action]) => (
                <div key={key} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
                  <dt className="font-mono text-sm text-accent tabular-nums">{key}</dt>
                  <dd className="text-sm text-muted">{action}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-line px-4 py-3 text-xs text-faint">
              Drag either edge to trim. The frame at that cut pops up above the handle. The bar above the filmstrip jumps there and plays. Drag the kept region to slide the cut. Scroll to zoom.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function Readout({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="flex min-w-16 flex-col">
      <span className="text-xs tracking-wide text-faint uppercase">{label}</span>
      <span className={accent ? "font-mono text-sm text-accent tabular-nums" : "font-mono text-sm tabular-nums"}>{value}</span>
    </span>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <rect x="2" y="4" width="3" height="16" rx="0.5" className="fill-accent" />
      <rect x="19" y="4" width="3" height="16" rx="0.5" className="fill-accent" />
      <rect x="6" y="11" width="12" height="2" className="fill-fg" />
    </svg>
  );
}

function probeDuration(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      window.clearTimeout(timer);
      const fromMeta = video.duration;
      const found = Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : video.currentTime;
      if (video.currentTime !== 0) video.currentTime = 0;
      resolve(found);
    };
    const onSeeked = () => finish();
    const timer = window.setTimeout(finish, 1200);
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = 1e101;
    } catch {
      finish();
    }
  });
}

function isLikelyVideo(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  if (file.type.startsWith("image/") || file.type.startsWith("audio/")) return false;
  if (/\.(mp4|mov|m4v|webm|mkv|ogv|ogg|avi|mpeg|mpg|qt)$/i.test(file.name)) return true;
  return file.type === "" || file.type === "application/octet-stream";
}

function pickVideo(list: FileList): File | null {
  return Array.from(list).find(isLikelyVideo) ?? null;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const ghost =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-line bg-bg px-3 text-sm text-fg hover:bg-raised disabled:opacity-40";
const iconBtn =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-bg text-fg hover:bg-raised disabled:opacity-40";
const primary =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-40";
const playBtn =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-40";
const toggleOn =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink";
