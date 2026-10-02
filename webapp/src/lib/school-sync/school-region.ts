import * as z from "zod";
import { hasOpenHolidays, resolveRegion } from "@/lib/holidays/region";
import { coversRegion, type SchoolHolidayRow } from "./openholidays";

/**
 * Which OpenHolidays subdivision and group a family's school holidays come
 * from (RFC-014 §5.3, plan rulings 26 and 30).
 */

/** ISO and date-holidays number Austria's Länder; OpenHolidays uses letters. Checked against its isoCode. */
export const AT_OPENHOLIDAYS_CODES: Readonly<Record<string, string>> = Object.freeze({
  "AT-1": "AT-BL",
  "AT-2": "AT-KÄ",
  "AT-3": "AT-NÖ",
  "AT-4": "AT-OÖ",
  "AT-5": "AT-SB",
  "AT-6": "AT-SM",
  "AT-7": "AT-TI",
  "AT-8": "AT-VA",
  "AT-9": "AT-WI",
});

/** Cantons whose rows are scoped below them (2026-10-02): Graubünden's Regions, Appenzell Innerrhoden's districts. */
const NEEDS_FINER_REGION: ReadonlySet<string> = new Set(["CH-GR", "CH-AI"]);

/** Swiss cantons with school-type groups whose general schools are `<canton>-VS` (2026-10-02). */
const SWISS_VOLKSSCHULE: ReadonlySet<string> = new Set(["CH-ZH", "CH-BE", "CH-SO", "CH-AR"]);

export type PendingPick = "region" | "group" | null;

/**
 * The school region a picked public-holiday region implies. Null when
 * OpenHolidays does not cover the country; `pending: "region"` when the
 * family has to pick (every country but DE, AT and CH; a bare country;
 * GR and AI, which need the level below).
 */
export function defaultSchoolRegion(
  holidayRegion: string,
): { country: string; region: string | null; group: string | null; pending: PendingPick } | null {
  const resolved = resolveRegion(holidayRegion);
  if (!resolved || !hasOpenHolidays(resolved.country)) return null;
  const { country, state, code } = resolved;
  const pick = { country, region: null, group: null, pending: "region" as const };
  if (state === null) return pick;
  if (country === "DE") return { country, region: code, group: code === "DE-MV" ? "DE-MV-ABS" : null, pending: null };
  if (country === "AT") {
    const region = AT_OPENHOLIDAYS_CODES[code];
    return region ? { country, region, group: null, pending: null } : pick;
  }
  if (country === "CH") {
    if (NEEDS_FINER_REGION.has(code)) return { country, region: code, group: null, pending: "region" };
    return { country, region: code, group: SWISS_VOLKSSCHULE.has(code) ? `${code}-VS` : null, pending: null };
  }
  return pick;
}

export interface RegionOption {
  code: string;
  name: string;
}

const Localized = z.array(z.object({ language: z.string(), text: z.string() })).min(1);
type Node = { code: string; name: z.infer<typeof Localized>; children?: Node[] };
const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.object({ code: z.string().min(1).max(40), name: Localized, children: z.array(NodeSchema).optional() }),
);
const GroupSchema = z.object({
  code: z.string().min(1).max(40),
  name: Localized,
  subdivisions: z.array(z.object({ code: z.string() })).optional(),
});

const nameIn = (name: z.infer<typeof Localized>, language: string) =>
  (name.find((n) => n.language.toUpperCase() === language.toUpperCase()) ?? name[0]).text;

/** `/Subdivisions`, top level with its direct children, named in `language`. */
export function parseSubdivisions(json: unknown, language: string): (RegionOption & { children: RegionOption[] })[] {
  const nodes = z.array(NodeSchema).parse(json);
  return nodes.map((n) => ({
    code: n.code,
    name: nameIn(n.name, language),
    children: (n.children ?? []).map((c) => ({ code: c.code, name: nameIn(c.name, language) })),
  }));
}

/** `/Groups`, named in `language`, with the subdivisions each applies to. */
export function parseGroups(json: unknown, language: string): (RegionOption & { subdivisions: string[] })[] {
  return z
    .array(GroupSchema)
    .parse(json)
    .map((g) => ({ code: g.code, name: nameIn(g.name, language), subdivisions: (g.subdivisions ?? []).map((s) => s.code) }));
}

/**
 * The children of `subdivision` that rows are scoped to without the
 * subdivision itself -- Graubünden's Regions, Appenzell Innerrhoden's
 * districts. Empty for NL provinces, whose rows always list the province.
 */
export function childrenReferenced(subdivision: string, rows: SchoolHolidayRow[]): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    const codes = (row.subdivisions ?? []).map((s) => s.code);
    if (codes.some((c) => coversRegion(c, subdivision))) continue;
    for (const c of codes) if (c.startsWith(`${subdivision}-`)) found.add(c.split("-").slice(0, 3).join("-"));
  }
  return [...found].sort();
}

/** The groups that apply to `region`: listed for it, an ancestor of it, or a place inside it. */
export function applicableGroups<G extends { subdivisions: string[] }>(region: string, groups: G[]): G[] {
  return groups.filter((g) => g.subdivisions.some((s) => coversRegion(s, region) || coversRegion(region, s)));
}

/** The only group, else general schools (`-VS` Volksschule, `-ABS` allgemeinbildende Schulen), else none. */
export function defaultGroup(groups: readonly { code: string }[]): string | null {
  if (groups.length === 1) return groups[0].code;
  return groups.find((g) => /-(VS|ABS)$/.test(g.code))?.code ?? null;
}

/** `CH-GR-ML` → `CH-GR`. */
export function topLevel(code: string): string {
  return code.split("-").slice(0, 2).join("-");
}
