import { isSleepyTime, type Bedtime } from "@/lib/creature-mood";

/**
 * The idle screen's night (RFC-021 §3.4): while the family's bedtime runs
 * (Settings -> Creatures, 20:00 to 06:30 unless changed), if the family
 * switched night on under Settings -> Screensaver, the screensaver shows a
 * dim clock and nothing else. One clock for the household: the screen's
 * night is the children's (§8.4).
 */
export function isScreensaverNight(on: boolean | undefined, now: Date, timeZone: string | null | undefined, bedtime: Bedtime): boolean {
  return on === true && isSleepyTime(now, timeZone, bedtime);
}
