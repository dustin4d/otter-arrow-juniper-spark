export const FRAME = 1 / 30;
export const MIN_SPAN = 0.1;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const centi = Math.round(seconds * 100);
  const cs = centi % 100;
  const total = Math.floor(centi / 100);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const body = `${pad(m)}:${pad(s)}.${pad(cs)}`;
  return h > 0 ? `${h}:${body}` : body;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export type Trim = { in: number; out: number };

export function clampTrim(inPoint: number, outPoint: number, duration: number): Trim {
  if (!Number.isFinite(duration) || duration <= 0) return { in: 0, out: 0 };
  const min = Math.min(MIN_SPAN, duration);
  let start = clamp(inPoint, 0, duration);
  let end = clamp(outPoint, 0, duration);
  if (end < start) {
    const swap = start;
    start = end;
    end = swap;
  }
  if (end - start < min) {
    if (start + min <= duration) end = start + min;
    else {
      end = duration;
      start = Math.max(0, duration - min);
    }
  }
  return { in: start, out: end };
}

export function trimFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const clean = base.trim() || "clip";
  return `${clean}-trim.mp4`;
}
