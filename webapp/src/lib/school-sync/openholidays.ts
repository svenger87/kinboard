import * as z from "zod";
import { addDays } from "@/lib/family-time";

/**
 * The OpenHolidays API, as the school-holiday sync uses it (RFC-014 §5.2).
 * One module, so it is the one thing to replace if the API goes away (§9).
 * The fetch is injected: the live one is safeFetch (lib/school-sync/live.ts),
 * the specs pass a counting fake.
 */

export const OPENHOLIDAYS_ORIGIN = "https://openholidaysapi.org";
/** The API answers 400 for more than 1,095 days between validFrom and validTo (plan ruling 25). */
export const MAX_RANGE_DAYS = 1095;
export const DAYS_BACK = 30;
export const MAX_BODY_BYTES = 1_000_000;
export const TIMEOUT_MS = 10_000;

export type SyncFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export interface OpenHolidaysDeps {
  fetch: SyncFetch;
  userAgent: string;
}

/** Where a family's school holidays come from: an OpenHolidays subdivision and group. */
export interface SchoolRegion {
  country: string;
  region: string | null;
  group: string | null;
}

export interface FetchedBreak {
  externalId: string;
  name: string;
  startsOn: string;
  endsOn: string;
}

export type SyncErrorKind = "network" | "timeout" | "http" | "content-type" | "too-large" | "json" | "schema" | "empty";

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

const Ref = z.object({ code: z.string().min(1).max(40) });

export const SchoolHolidayRowSchema = z
  .object({
    id: z.string().min(1).max(100),
    // A real calendar date, not just its shape: 2026-02-30 would otherwise
    // reach Postgres' DATE cast and fail there as a database error.
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    type: z.string(),
    name: z.array(z.object({ language: z.string(), text: z.string().min(1).max(200) })).min(1),
    nationwide: z.boolean(),
    subdivisions: z.array(Ref).optional(),
    groups: z.array(Ref).optional(),
  })
  .refine((r) => r.endDate >= r.startDate, { message: "endDate before startDate" });

export type SchoolHolidayRow = z.infer<typeof SchoolHolidayRowSchema>;

/**
 * Ids are unique within one answer: the store upserts on (family, external
 * id), and Postgres refuses to touch the same row twice in one statement.
 * Which of two rows to keep is not ours to guess, so the answer is refused.
 */
const ResponseSchema = z
  .array(SchoolHolidayRowSchema)
  .max(2000)
  .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, { message: "duplicate id" });

/** 30 days back, and as far ahead as the API allows. */
export function syncWindow(today: string): { from: string; to: string } {
  const from = addDays(today, -DAYS_BACK);
  return { from, to: addDays(from, MAX_RANGE_DAYS) };
}

export function schoolHolidaysUrl(choice: SchoolRegion, window: { from: string; to: string }, language: string): string {
  const url = new URL("/SchoolHolidays", OPENHOLIDAYS_ORIGIN);
  url.searchParams.set("countryIsoCode", choice.country);
  if (choice.region) url.searchParams.set("subdivisionCode", choice.region);
  url.searchParams.set("validFrom", window.from);
  url.searchParams.set("validTo", window.to);
  url.searchParams.set("languageIsoCode", language.toUpperCase());
  return url.href;
}

/** Is `code` the region itself or one of its ancestors? `CH-GR` covers `CH-GR-ML`. */
export function coversRegion(code: string, region: string): boolean {
  return region === code || region.startsWith(`${code}-`);
}

/**
 * Does this row belong to the family (plan ruling 26)? A school holiday
 * (`BackToSchool` and `EndOfLessons` mark a first or last day of school),
 * scoped to the family's region or an ancestor of it -- the API also
 * returns rows for other regions of the same province -- and, when the
 * family has a group, for that group or for every group.
 */
export function rowApplies(row: SchoolHolidayRow, choice: SchoolRegion): boolean {
  if (row.type !== "School") return false;
  const subdivisions = row.subdivisions ?? [];
  if (choice.region && !row.nationwide && subdivisions.length > 0 && !subdivisions.some((s) => coversRegion(s.code, choice.region!))) {
    return false;
  }
  const groups = row.groups ?? [];
  if (choice.group && groups.length > 0 && !groups.some((g) => g.code === choice.group)) return false;
  return true;
}

function nameIn(row: SchoolHolidayRow, language: string): string {
  const wanted = language.toUpperCase();
  return (row.name.find((n) => n.language.toUpperCase() === wanted) ?? row.name[0]).text;
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new SyncError("too-large", `OpenHolidays sent ${declared} bytes`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new SyncError("too-large", `OpenHolidays sent more than ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** GET one OpenHolidays URL as JSON, with every check the sync relies on. Throws SyncError. */
export async function getOpenHolidaysJson(url: string, deps: OpenHolidaysDeps): Promise<unknown> {
  let response: Response;
  try {
    response = await deps.fetch(url, {
      headers: { Accept: "application/json", "User-Agent": deps.userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof SyncError) throw err;
    if (isTimeout(err)) throw new SyncError("timeout", "OpenHolidays did not answer within 10 seconds");
    throw new SyncError("network", `could not reach OpenHolidays (${(err as Error)?.message ?? String(err)})`);
  }
  if (!response.ok) throw new SyncError("http", `OpenHolidays answered ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    throw new SyncError("content-type", `OpenHolidays answered ${type || "without a content type"}`);
  }
  let text: string;
  try {
    text = await readCapped(response);
  } catch (err) {
    if (err instanceof SyncError) throw err;
    if (isTimeout(err)) throw new SyncError("timeout", "OpenHolidays did not answer within 10 seconds");
    throw new SyncError("network", `the answer from OpenHolidays broke off (${(err as Error)?.message ?? String(err)})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SyncError("json", "OpenHolidays answered with something that is not JSON");
  }
}

/** The validated rows for a region and window, unfiltered. */
export async function fetchSchoolHolidayRows(
  choice: SchoolRegion,
  window: { from: string; to: string },
  language: string,
  deps: OpenHolidaysDeps,
): Promise<SchoolHolidayRow[]> {
  const json = await getOpenHolidaysJson(schoolHolidaysUrl(choice, window, language), deps);
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new SyncError("schema", `OpenHolidays answered in an unexpected shape (${parsed.error.issues[0]?.message ?? "schema mismatch"})`);
  }
  return parsed.data;
}

/** The family's school holidays for the window, named in its language. */
export async function fetchSchoolHolidays(
  choice: SchoolRegion,
  window: { from: string; to: string },
  language: string,
  deps: OpenHolidaysDeps,
): Promise<FetchedBreak[]> {
  const rows = await fetchSchoolHolidayRows(choice, window, language, deps);
  return rows
    .filter((row) => rowApplies(row, choice))
    .map((row) => ({ externalId: row.id, name: nameIn(row, language), startsOn: row.startDate, endsOn: row.endDate }));
}
