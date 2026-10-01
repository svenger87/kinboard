/**
 * The room of each requested device, for the screens. Not stored on the
 * request (RFC-011 §5 keeps the table to what the assistant asked for); read
 * from the catalogue when a screen asks, and simply left out when the
 * catalogue cannot be read — the request is still decidable without it.
 */

import { catalogueEntities } from "@/lib/home/catalogue";
import { toScreenRequest, type ActionRequestRow, type ScreenRequest } from "@/lib/home/action-requests";

export async function withRooms(familyId: string, rows: ActionRequestRow[]): Promise<ScreenRequest[]> {
  if (rows.length === 0) return [];
  let rooms = new Map<string, string | null>();
  try {
    rooms = new Map((await catalogueEntities(familyId)).map((e) => [e.entityId, e.room]));
  } catch {
    // Rooms are a nicety here.
  }
  return rows.map((row) => toScreenRequest(row, rooms.get(row.entity_id) ?? null));
}
