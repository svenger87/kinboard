/**
 * What the layout routes share: reading a JSON body, checking a name and a
 * size, and the family's per-orientation defaults (a row of `settings`).
 */
import { NextResponse } from "next/server";
import type { LayoutDefaults } from "./types";

export const DEFAULTS_KEY = "layout_defaults";

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
export const notFound = () => fail("not found", 404);

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
    (height as number) >= 300 && (height as number) <= 20000
  );
}

export function readDefaults(value: unknown): LayoutDefaults {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const id = (x: unknown) => (typeof x === "string" ? x : null);
  return { portrait: id(v.portrait), landscape: id(v.landscape) };
}
