import { hitLimit } from "@/lib/rate-limit";

/** One OpenHolidays fetch a minute per family, from any session route (RFC-014 §5.2). */
export function syncLimited(familyId: string): { limited: boolean; retryAfterMs: number } {
  return hitLimit(`school-sync:${familyId}`, 1, 60_000);
}
