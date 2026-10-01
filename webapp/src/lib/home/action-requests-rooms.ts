/**
 * Requests as a screen sees them: with the room of each requested device and
 * the action in words, in the screen's language.
 *
 * The room is not stored on the request (RFC-011 §5 keeps the table to what
 * the assistant asked for); it is read from the catalogue when a screen asks,
 * and simply left out when the catalogue cannot be read — the request is
 * still decidable without it. Only home requests have one.
 */

import type { NextRequest } from "next/server";
import { catalogueEntities } from "@/lib/home/catalogue";
import { getTranslator } from "@/lib/notifications/messages";
import { LOCALE_COOKIE, negotiateLocale } from "@/i18n/locales";
import {
  toScreenRequest, type ActionRequestRow, type ActionTranslator, type ScreenRequest,
} from "@/lib/home/action-requests";

/** The `assistantActions` translator in the language the asking screen shows. */
export function screenTranslator(request: NextRequest): ActionTranslator {
  const locale = negotiateLocale(request.cookies.get(LOCALE_COOKIE)?.value, request.headers.get("accept-language"));
  return getTranslator(locale, "assistantActions") as unknown as ActionTranslator;
}

export async function withRooms(familyId: string, rows: ActionRequestRow[], t: ActionTranslator): Promise<ScreenRequest[]> {
  if (rows.length === 0) return [];
  let rooms = new Map<string, string | null>();
  if (rows.some((row) => row.kind === "home")) {
    try {
      rooms = new Map((await catalogueEntities(familyId)).map((e) => [e.entityId, e.room]));
    } catch {
      // Rooms are a nicety here.
    }
  }
  return rows.map((row) =>
    toScreenRequest(row, t, row.kind === "home" && row.entity_id ? rooms.get(row.entity_id) ?? null : null));
}
