import { useEffect, useRef, useState } from "react";
import { Scrubber } from "@/components/editor/Scrubber";
import { TrimLoupe, type TrimLoupeHandle } from "@/components/editor/TrimLoupe";
import { clamp, type Trim } from "@/lib/time";

type Mode = "in" | "out" | "slip" | "seek";

type Drag = {
  mode: Mode;
  originIn: number;
  originOut: number;
  originTime: number;
  pointerId: number;
};

const HANDLE = 16;

export function Timeline({
  duration,
  trim,
  current,
  thumbs,
  thumbFraction,
  snap,
  playing,
  src,
  locked,
  onToggleSnap,
  onSeek,
  onPlayFrom,
  onTrim,
  onTrimStart,
  onTrimEnd,
}: {
  duration: number;
  trim: Trim;
  current: number;
  thumbs: string[];
  thumbFraction: number;
  snap: boolean;
  playing: boolean;
  src: string | null;
  locked: boolean;
  onToggleSnap: () => void;
  onSeek: (time: number) => void;
  onPlayFrom: (time: number) => void;
  onTrim: (next: Trim) => void;
  onTrimStart: () => void;
  onTrimEnd: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const zoomRef = useRef(1);
  const [zoom, setZoomState] = useState(1);
  const [viewport, setViewport] = useState(0);
  const [edgeDrag, setEdgeDrag] = useState<"in" | "out" | null>(null);
  const loupeRef = useRef<TrimLoupeHandle>(null);
  const trimRef = useRef(trim);
  const currentRef = useRef(current);
  const durationRef = useRef(duration);
  const snapRef = useRef(snap);
  const metricsRef = useRef({ px: 1 });
  const setZoomRef = useRef<(next: number) => void>(() => {});
  trimRef.current = trim;
  currentRef.current = current;
  durationRef.current = duration;
  snapRef.current = snap;
  zoomRef.current = zoom;

  const innerPx = Math.max(viewport, Math.round(viewport * zoom));
  const px = duration > 0 ? innerPx / duration : 1;
  metricsRef.current.px = px;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || duration <= 0) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (event.shiftKey) {
        el.scrollLeft += dy;
        return;
      }
      const rect = el.getBoundingClientRect();
      const local = event.clientX - rect.left;
      const contentX = el.scrollLeft + local;
      const prevZoom = zoomRef.current;
      const width = el.clientWidth;
      const prevInner = Math.max(width, Math.round(width * prevZoom));
      const time = contentX / (prevInner / duration);
      const next = clamp(prevZoom * Math.exp(-dy * 0.0016), 1, 24);
      const nextInner = Math.max(width, Math.round(width * next));
      zoomRef.current = next;
      setZoomState(next);
      el.scrollLeft = time * (nextInner / duration) - local;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    const el = scrollerRef.current;
    if (!el || zoomRef.current <= 1.01) return;
    const x = current * metricsRef.current.px;
    const pad = 36;
    if (x < el.scrollLeft + pad || x > el.scrollLeft + el.clientWidth - pad) {
      el.scrollLeft = x - el.clientWidth * 0.35;
    }
  }, [current, playing]);

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
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        setZoomRef.current(1);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoomRef.current(zoomRef.current / 1.4);
      } else if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setZoomRef.current(zoomRef.current * 1.4);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function setZoom(next: number) {
    const el = scrollerRef.current;
    const dur = durationRef.current;
    if (!el || dur <= 0) return;
    const prev = zoomRef.current;
    const clampedZoom = clamp(next, 1, 24);
    const width = el.clientWidth;
    const local = width / 2;
    const contentX = el.scrollLeft + local;
    const prevInner = Math.max(width, Math.round(width * prev));
    const time = contentX / (prevInner / dur);
    zoomRef.current = clampedZoom;
    setZoomState(clampedZoom);
    const nextInner = Math.max(width, Math.round(width * clampedZoom));
    el.scrollLeft = time * (nextInner / dur) - local;
  }
  setZoomRef.current = setZoom;

  function timeAt(clientX: number): number {
    const track = trackRef.current;
    if (!track) return 0;
    const x = clientX - track.getBoundingClientRect().left;
    return clamp(x / metricsRef.current.px, 0, durationRef.current);
  }

  function snapped(time: number, targets: number[]): number {
    if (!snapRef.current) return time;
    const threshold = 8 / Math.max(metricsRef.current.px, 0.0001);
    let best = time;
    let bestD = threshold;
    for (const mark of targets) {
      const dist = Math.abs(time - mark);
      if (dist <= bestD) {
        best = mark;
        bestD = dist;
      }
    }
    return best;
  }

  function applyDrag(mode: Mode, time: number, origin: Drag) {
    const dur = durationRef.current;
    const play = currentRef.current;
    if (mode === "seek") {
      onSeek(snapped(time, [trimRef.current.in, trimRef.current.out, 0, dur]));
      return;
    }
    if (mode === "in") {
      onTrim({ in: Math.min(snapped(time, [play, 0]), trimRef.current.out), out: trimRef.current.out });
      return;
    }
    if (mode === "out") {
      onTrim({ in: trimRef.current.in, out: Math.max(snapped(time, [play, dur]), trimRef.current.in) });
      return;
    }
    const span = origin.originOut - origin.originIn;
    let start = origin.originIn + (time - origin.originTime);
    let end = start + span;
    const threshold = 8 / Math.max(metricsRef.current.px, 0.0001);
    if (snapRef.current && Math.abs(start - play) <= threshold) {
      start = play;
      end = play + span;
    } else if (snapRef.current && Math.abs(end - play) <= threshold) {
      end = play;
      start = play - span;
    }
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > dur) {
      start -= end - dur;
      end = dur;
    }
    onTrim({ in: start, out: end });
  }

  function hit(clientX: number): Mode {
    const track = trackRef.current;
    if (!track) return "seek";
    const x = clientX - track.getBoundingClientRect().left;
    const pxPer = metricsRef.current.px;
    const inX = trimRef.current.in * pxPer;
    const outX = trimRef.current.out * pxPer;
    const distIn = Math.abs(x - inX);
    const distOut = Math.abs(x - outX);
    if (distIn <= HANDLE && distIn <= distOut) return "in";
    if (distOut <= HANDLE) return "out";
    if (x > inX && x < outX) return "slip";
    return "seek";
  }

  const ready = duration > 0 && viewport > 0;
  const inX = trim.in * px;
  const outX = trim.out * px;
  const playX = current * px;
  const trackWidth = zoom > 1.01 ? innerPx : viewport;

  return (
    <section className="shrink-0 border-t border-line bg-surface">
      <div className="border-b border-line">
        <Scrubber
          duration={duration}
          current={current}
          trim={trim}
          snap={snap}
          locked={locked}
          onScrub={onSeek}
          onPlayFrom={onPlayFrom}
        />
      </div>
      <div className="flex min-h-12 items-center gap-2 px-3 py-1">
        <span className="text-xs tracking-wide text-faint uppercase">Timeline</span>
        {duration > 0 && thumbFraction < 1 && (
          <span className="text-xs text-muted">{thumbs.length === 0 ? "Reading frames" : "Filmstrip"}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className={
              snap
                ? "inline-flex h-11 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-ink"
                : "inline-flex h-11 items-center rounded-md border border-line bg-bg px-3 text-xs text-fg"
            }
            aria-pressed={snap}
            onClick={onToggleSnap}
          >
            Snap
          </button>
          <button type="button" className={mini} onClick={() => setZoom(zoom / 1.4)} disabled={!ready || zoom <= 1.01} aria-label="Zoom out">
            −
          </button>
          <span className="w-12 text-center font-mono text-xs text-muted tabular-nums">
            {zoom <= 1.01 ? "Fit" : `${Math.round(zoom * 100)}%`}
          </span>
          <button type="button" className={mini} onClick={() => setZoom(zoom * 1.4)} disabled={!ready} aria-label="Zoom in">
            +
          </button>
          <button type="button" className={miniWide} onClick={() => setZoom(1)} disabled={!ready || zoom <= 1.01}>
            Fit
          </button>
        </div>
      </div>
      {duration > 0 && thumbFraction < 1 && (
        <div className="h-0.5 bg-bg">
          <div className="h-full bg-accent" style={{ width: `${Math.max(4, thumbFraction * 100)}%` }} />
        </div>
      )}
      <div ref={scrollerRef} className="timeline-scroll overflow-x-auto">
        <div
          ref={trackRef}
          className="relative h-28 touch-none bg-bg select-none md:h-32"
          style={{ width: ready && zoom > 1.01 ? innerPx : "100%" }}
          onPointerDown={(event) => {
            if (!ready || event.button !== 0) return;
            const mode = hit(event.clientX);
            const originTime = timeAt(event.clientX);
            dragRef.current = {
              mode,
              originIn: trimRef.current.in,
              originOut: trimRef.current.out,
              originTime,
              pointerId: event.pointerId,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            if (mode === "in" || mode === "out") {
              setEdgeDrag(mode);
              loupeRef.current?.prime();
            } else {
              setEdgeDrag(null);
            }
            if (mode !== "seek") onTrimStart();
            else onSeek(snapped(originTime, [trimRef.current.in, trimRef.current.out, 0, duration]));
            event.currentTarget.style.cursor = mode === "slip" ? "grabbing" : mode === "seek" ? "col-resize" : "ew-resize";
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) {
              const mode = hit(event.clientX);
              event.currentTarget.style.cursor =
                mode === "in" || mode === "out" ? "ew-resize" : mode === "slip" ? "grab" : "col-resize";
              return;
            }
            applyDrag(drag.mode, timeAt(event.clientX), drag);
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            dragRef.current = null;
            setEdgeDrag(null);
            if (drag.mode !== "seek") onTrimEnd();
            event.currentTarget.style.cursor = "col-resize";
          }}
          onPointerCancel={() => {
            if (dragRef.current && dragRef.current.mode !== "seek") onTrimEnd();
            dragRef.current = null;
            setEdgeDrag(null);
          }}
        >
          {ready && thumbs.length > 0 ? (
            thumbs.map((src, index) => (
              <img
                key={`${index}-${src.slice(-16)}`}
                src={src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute top-0 h-full object-cover"
                style={{
                  left: `${(index / thumbs.length) * 100}%`,
                  width: `${100 / thumbs.length}%`,
                }}
              />
            ))
          ) : (
            <div className="pointer-events-none absolute inset-0 flex items-end justify-between px-3 pb-3">
              {Array.from({ length: 9 }, (_, index) => (
                <span key={index} className="h-3 w-px bg-line" />
              ))}
            </div>
          )}
          {ready && (
            <>
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-bg/75" style={{ width: inX }} />
              <div
                className="pointer-events-none absolute inset-y-0 bg-bg/75"
                style={{ left: outX, width: Math.max(0, trackWidth - outX) }}
              />
              <div
                className="pointer-events-none absolute top-0 bottom-0 border-y-2 border-accent"
                style={{ left: inX, width: Math.max(1, outX - inX) }}
              />
              <div className="pointer-events-none absolute top-0 z-20 h-full w-3 -translate-x-1/2" style={{ left: inX }}>
                <span className={edgeDrag === "in" ? "mx-auto block h-full w-1 bg-accent" : "mx-auto block h-full w-1 bg-fg"} />
              </div>
              <div className="pointer-events-none absolute top-0 z-20 h-full w-3 -translate-x-1/2" style={{ left: outX }}>
                <span className={edgeDrag === "out" ? "mx-auto block h-full w-1 bg-accent" : "mx-auto block h-full w-1 bg-fg"} />
              </div>
              <div
                className="pointer-events-none absolute top-0 z-30 h-full w-0.5 bg-accent"
                style={{ transform: `translateX(${playX}px)` }}
              >
                <span
                  className="absolute top-0 left-1/2 h-2 w-2.5 -translate-x-1/2 bg-accent"
                  style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
                />
              </div>
            </>
          )}
          {!ready && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-faint">
              The cut sits on this ruler
            </p>
          )}
        </div>
      </div>
      {src && (
        <TrimLoupe
          ref={loupeRef}
          src={src}
          preview={edgePreview(edgeDrag, trim, px, trackRef.current)}
          thumbs={thumbs}
          duration={duration}
        />
      )}
    </section>
  );
}

const mini =
  "inline-flex size-11 items-center justify-center rounded-md border border-line bg-bg text-sm text-fg hover:bg-raised disabled:opacity-40";
const miniWide =
  "inline-flex h-11 items-center rounded-md border border-line bg-bg px-3 text-xs text-fg hover:bg-raised disabled:opacity-40";

function edgePreview(
  edge: "in" | "out" | null,
  trim: Trim,
  px: number,
  track: HTMLDivElement | null,
): { edge: "in" | "out"; time: number; x: number; y: number } | null {
  if (!edge || !track) return null;
  const time = edge === "in" ? trim.in : trim.out;
  const rect = track.getBoundingClientRect();
  return { edge, time, x: rect.left + time * px, y: rect.top };
}
