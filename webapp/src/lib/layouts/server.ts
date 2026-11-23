/**
 * What the layout routes share: reading a JSON body, checking a name, a size
 * and the grid marker, and the family's per-orientation defaults (a row of
 * `settings`), and the check on Home's per-child widgets that needs the
 * database: that each named person is one of the family's.
 */
import { NextResponse } from "next/server";
import { LAYOUT_GRID, gridFor } from "./grid";
import { personOf } from "./validate";
import type { HomeLayoutItem, LayoutDefaults } from "./types";

export const DEFAULTS_KEY = "layout_defaults";

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
export const notFound = () => fail("not found", 404);

/**
 * A write must say which grid its positions count (`grid: LAYOUT_GRID`): a
 * page still running a bundle from before the steps sends none, and its cell
 * positions must not land in a layout counted in steps. 409 grid_changed tells
 * it to reload. Also the answer for a layout row not on the grid.
 */
export const gridOk = (body: Record<string, unknown>) => body.grid === LAYOUT_GRID;
export const gridChanged = () => fail("grid_changed", 409);

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A name of 1 to 60 characters once trimmed, or null. */
export function parseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.trim();
  return name.length >= 1 && name.length <= 60 ? name : null;
}

export function sizeOk(width: unknown, height: unknown): width is number {
  return (
    Number.isInteger(width) && Number.isInteger(height) &&
    (width as number) >= 600 && (width as number) <= 20000 &&
    (height as number) >= 300 && (height as number) <= 20000 &&
    // A size the grid has no rows for (under 6) could never hold a screensaver.
    gridFor(width as number, height as number) !== null
  );
}

export function readDefaults(value: unknown): LayoutDefaults {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const id = (x: unknown) => (typeof x === "string" ? x : null);
  return { portrait: id(v.portrait), landscape: id(v.landscape) };
}

export type PeopleCheck =
  | { ok: true }
  | { ok: false; error: "bad_person"; itemId: string }
  | { ok: false; error: "db"; message: string };

/**
 * Whether every Home item that names a person (`options.personId`, already
 * shaped by validateItems) names one of this family's people who is not in
 * the recycle bin. Run after validateItems(…, "home") and before a write:
 * the route reads with the service role, so nothing else stops an id from
 * another family. Answers the first item that fails, as validateItems does.
 */
export async function checkHomePeople(
  /** The admin client, untyped as everywhere in the layout routes. */
  db: any,
  familyId: string,
  items: readonly HomeLayoutItem[],
): Promise<PeopleCheck> {
  const wanted = [...new Set(items.flatMap((i) => personOf(i) ?? []))];
  if (wanted.length === 0) return { ok: true };
  const { data, error } = await db
    .from("people")
    .select("id")
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .in("id", wanted);
  if (error) return { ok: false, error: "db", message: error.message };
  const found = new Set(((data ?? []) as { id: string }[]).map((p) => p.id));
  const bad = items.find((i) => {
    const p = personOf(i);
    return p !== undefined && !found.has(p);
  });
  return bad ? { ok: false, error: "bad_person", itemId: bad.id } : { ok: true };
}
