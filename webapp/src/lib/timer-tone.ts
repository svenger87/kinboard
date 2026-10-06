/**
 * The timer's alarm tone — best-effort, by design.
 *
 * Browsers refuse to play audio until a page has had a user gesture. A kiosk
 * somebody has tapped is fine; a panel that booted overnight and sat untouched
 * is not, and nothing can force it. So the visual alarm is the guarantee and
 * this is an enhancement: `playTone` reports whether it managed, and the caller
 * must not depend on `true`. RFC-004 §4.2.
 *
 * Synthesised rather than shipped as a file: two short beeps need no asset, no
 * decode, and no network request that could be in flight when the timer ends.
 */

let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Whether a tone would sound now: the browser has let the page start its audio. */
export function toneReady(): boolean {
  return ctx?.state === "running";
}

/** Told whenever toneReady() may have changed. Returns the unsubscribe. */
export function subscribeTone(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Called on every touch or key press on a wall display (TimerAlarm), the only
 * moments a browser lets a page start its audio. Cheap and idempotent.
 */
export function unlockTone(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      ctx.addEventListener("statechange", notify);
      notify();
    }
    // `resume()` rejects outright on a device with no audio hardware. Left
    // unhandled that becomes an unhandled rejection in the logs for something
    // nobody can act on — the tone just stays off, which is already allowed for.
    if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
  } catch {
    // An AudioContext we cannot create is one we cannot use. The visual alarm
    // still fires; there is nothing to report to the user about this.
  }
}

/**
 * Two short beeps. Returns false when the browser would not let us.
 * TimerAlarm repeats it while a timer rings, so it has to carry across a
 * kitchen from a tablet's small speaker: 0.8 of full scale, the beeps never
 * overlapping, so it cannot clip.
 */
export function playTone(): boolean {
  try {
    if (!ctx || ctx.state !== "running") return false;
    const now = ctx.currentTime;
    for (const offset of [0, 0.35]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      // Ramped rather than switched: an abrupt gain change clicks.
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.8, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.3);
    }
    return true;
  } catch {
    return false;
  }
}
