import { useRef, useState } from "react";
import { FRAME, clamp, formatClock, type Trim } from "@/lib/time";

export function Scrubber({
  duration,
  current,
  trim,
  snap,
  locked,
  onScrub,
  onPlayFrom,
}: {
  duration: number;
  current: number;
  trim: Trim;
  snap: boolean;
  locked: boolean;
  onScrub: (time: number) => void;
  onPlayFrom: (time: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const timeRef = useRef(current);
  const [live, setLive] = useState<number | null>(null);
  const disabled = locked || duration <= 0;
  const shown = live ?? current;

  function timeAt(clientX: number): number {
    const bar = barRef.current;
    if (!bar || duration <= 0) return 0;
    const rect = bar.getBoundingClientRect();
    const width = rect.width || 1;
    let time = clamp((clientX - rect.left) / width, 0, 1) * duration;
    if (!snap) return time;
    const threshold = 8 / (width / duration);
    let best = time;
    let bestD = threshold;
    for (const mark of [trim.in, trim.out, 0, duration]) {
      const dist = Math.abs(time - mark);
      if (dist <= bestD) {
        best = mark;
        bestD = dist;
      }
    }
    time = best;
    return time;
  }

  function move(clientX: number) {
    const time = timeAt(clientX);
    timeRef.current = time;
    setLive(time);
    onScrub(time);
  }

  function finish(play: boolean) {
    if (!dragRef.current) return;
    dragRef.current = false;
    const time = timeRef.current;
    setLive(null);
    if (play) onPlayFrom(time);
  }

  function nudge(next: number, play: boolean) {
    const time = clamp(next, 0, duration);
    timeRef.current = time;
    if (play) onPlayFrom(time);
    else onScrub(time);
  }

  const playPct = duration > 0 ? (shown / duration) * 100 : 0;
  const inPct = duration > 0 ? (trim.in / duration) * 100 : 0;
  const spanPct = duration > 0 ? ((trim.out - trim.in) / duration) * 100 : 0;

  return (
    <div className="flex h-11 items-center gap-3 px-3">
      <span className="shrink-0 text-xs tracking-wide whitespace-nowrap text-faint uppercase">Play from</span>
      <div
        ref={barRef}
        role="slider"
        aria-label="Jump and play from"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 100) / 100}
        aria-valuenow={Math.round(shown * 100) / 100}
        aria-valuetext={formatClock(shown)}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        data-scrubber=""
        className={
          disabled
            ? "relative flex h-11 min-w-0 flex-1 touch-none items-center opacity-40 select-none"
            : "relative flex h-11 min-w-0 flex-1 cursor-pointer touch-none items-center select-none"
        }
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          dragRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event.clientX);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          move(event.clientX);
        }}
        onPointerUp={() => finish(true)}
        onPointerCancel={() => finish(false)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            onPlayFrom(shown);
            return;
          }
          let delta = 0;
          if (event.key === "ArrowLeft") delta = event.shiftKey ? -1 : -FRAME;
          else if (event.key === "ArrowRight") delta = event.shiftKey ? 1 : FRAME;
          else if (event.key === "Home") delta = -duration;
          else if (event.key === "End") delta = duration;
          else return;
          event.preventDefault();
          event.stopPropagation();
          nudge(shown + delta, false);
        }}
      >
        <div className="relative h-1.5 w-full rounded-full bg-bg">
          {duration > 0 && (
            <div className="absolute inset-y-0 rounded-full bg-line" style={{ left: `${inPct}%`, width: `${spanPct}%` }} />
          )}
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${playPct}%` }} />
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg bg-fg"
            style={{ left: `${playPct}%` }}
          />
          {duration > 0 && (
            <>
              <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-accent" style={{ left: `${inPct}%` }} />
              <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-accent" style={{ left: `${inPct + spanPct}%` }} />
            </>
          )}
        </div>
      </div>
      <span className={live !== null ? "w-20 shrink-0 text-right font-mono text-xs text-accent tabular-nums" : "w-20 shrink-0 text-right font-mono text-xs text-muted tabular-nums"}>
        {formatClock(shown)}
      </span>
    </div>
  );
}
