/**
 * One clock for every creature on the page (hooks/use-creature-mood.ts): a
 * single interval, started by the first subscriber and stopped with the
 * last. Its snapshot is the minute, so React re-renders a subscriber only
 * when the minute changes, and the evening is noticed within a minute of
 * 20:00. A wall display with three creatures on it runs one timer, not three.
 */

export const MINUTE_MS = 60_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export function subscribeMinuteClock(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) timer = setInterval(() => listeners.forEach((l) => l()), MINUTE_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The current minute: ms since the epoch / 60 000, rounded down. */
export const currentMinute = (): number => Math.floor(Date.now() / MINUTE_MS);
