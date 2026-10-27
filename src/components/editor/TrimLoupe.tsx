import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { clamp, formatClock } from "@/lib/time";

const CARD_W = 288;

export type TrimPreview = {
  edge: "in" | "out";
  time: number;
  x: number;
  y: number;
};

export type TrimLoupeHandle = {
  prime: () => void;
};

function nearestThumb(thumbs: string[], time: number, duration: number): string | null {
  if (thumbs.length === 0 || duration <= 0) return null;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < thumbs.length; i++) {
    const sample = ((i + 0.5) / thumbs.length) * duration;
    const dist = Math.abs(sample - time);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return thumbs[best] ?? null;
}

function seekTime(video: HTMLVideoElement, time: number): number {
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : time;
  const max = dur > 0.08 ? dur - 0.04 : Math.max(0, dur);
  return clamp(time, 0, max);
}

export function TrimLoupe({
  ref,
  src,
  preview,
  thumbs,
  duration,
}: {
  ref?: Ref<TrimLoupeHandle | null>;
  src: string;
  preview: TrimPreview | null;
  thumbs: string[];
  duration: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wantRef = useRef(0);
  const openRef = useRef(false);
  const pumpRef = useRef<() => void>(() => {});
  const sharpRef = useRef(false);
  const primed = useRef(false);
  const [sharp, setSharp] = useState(false);

  const open = preview !== null;
  openRef.current = open;
  if (preview) wantRef.current = preview.time;

  const [seenOpen, setSeenOpen] = useState(false);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (!open) {
      sharpRef.current = false;
      setSharp(false);
    }
  }

  useImperativeHandle(ref, () => ({
    prime() {
      const video = videoRef.current;
      if (!video || primed.current) return;
      primed.current = true;
      void video
        .play()
        .then(() => {
          video.pause();
          pumpRef.current();
        })
        .catch(() => {
          primed.current = false;
        });
    },
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let seeking = false;
    let dead = false;
    video.src = src;
    video.load();

    const draw = () => {
      if (dead || !openRef.current) return;
      const node = canvasRef.current;
      if (!node || video.readyState < 2 || video.videoWidth === 0) return;
      const ctx = node.getContext("2d");
      if (!ctx) return;
      const cssW = node.clientWidth;
      const cssH = node.clientHeight;
      if (cssW < 2 || cssH < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssH * dpr);
      if (node.width !== bw || node.height !== bh) {
        node.width = bw;
        node.height = bh;
      }
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.min(cssW / vw, cssH / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.drawImage(video, (cssW - dw) / 2, (cssH - dh) / 2, dw, dh);
      if (!sharpRef.current) {
        sharpRef.current = true;
        setSharp(true);
      }
    };

    const pump = () => {
      if (dead || !openRef.current || seeking || video.readyState < 2) return;
      const target = seekTime(video, wantRef.current);
      if (Math.abs(video.currentTime - target) < 0.02) {
        draw();
        return;
      }
      seeking = true;
      try {
        video.currentTime = target;
      } catch {
        seeking = false;
      }
    };
    pumpRef.current = pump;

    const onSeeked = () => {
      seeking = false;
      const paint = () => {
        if (dead) return;
        draw();
        if (!openRef.current || video.readyState < 2) return;
        if (Math.abs(video.currentTime - seekTime(video, wantRef.current)) >= 0.02) pump();
      };
      paint();
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => {
          if (!dead && openRef.current) draw();
        });
      }
    };

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", pump);
    pump();

    return () => {
      dead = true;
      seeking = false;
      pumpRef.current = () => {};
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", pump);
      video.pause();
      video.removeAttribute("src");
      video.load();
      primed.current = false;
      sharpRef.current = false;
    };
  }, [src]);

  useEffect(() => {
    if (open) pumpRef.current();
  }, [open, preview?.time, preview?.edge]);

  const fallback = preview ? nearestThumb(thumbs, preview.time, duration) : null;
  const viewW = typeof document === "undefined" ? CARD_W : document.documentElement.clientWidth;
  const left = preview ? clamp(preview.x - CARD_W / 2, 12, Math.max(12, viewW - CARD_W - 12)) : 0;
  const caret = preview ? clamp(preview.x - left, 16, CARD_W - 16) : CARD_W / 2;

  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        className="pointer-events-none fixed top-0 left-0 size-px opacity-0"
        aria-hidden
      />
      {preview && (
        <div
          className="pointer-events-none fixed z-50 w-72"
          style={{ left, top: preview.y - 8, transform: "translateY(-100%)" }}
          data-trim-loupe={preview.edge}
          aria-hidden
        >
          <div className="overflow-hidden rounded-md border border-accent bg-surface">
            <div className="relative aspect-video w-full bg-bg">
              {fallback && !sharp ? (
                <img src={fallback} alt="" className="absolute inset-0 size-full object-contain" />
              ) : null}
              {!sharp && !fallback ? (
                <p className="absolute inset-0 flex items-center justify-center text-xs text-faint">Reading frame</p>
              ) : null}
              <canvas ref={canvasRef} className={sharp ? "absolute inset-0 size-full" : "absolute inset-0 size-full opacity-0"} />
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-xs font-medium tracking-wide text-accent uppercase">
                {preview.edge === "in" ? "In point" : "Out point"}
              </span>
              <span className="font-mono text-xs text-fg tabular-nums">{formatClock(preview.time)}</span>
            </div>
          </div>
          <span className="absolute top-full h-2 w-0.5 -translate-x-1/2 bg-accent" style={{ left: caret }} />
        </div>
      )}
    </>
  );
}
