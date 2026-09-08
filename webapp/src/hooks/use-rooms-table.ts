"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { Room } from "@/types/database";

const KEY = "rooms";

/**
 * A stable empty array.
 *
 * `useQuery`'s `data` is undefined until it resolves, and a `= []` default in
 * a destructure is a fresh array every render — which turns any effect or
 * memo keyed on it into one that fires every render. That pegged a tab here
 * once.
 */
const EMPTY: Room[] = [];

/**
 * Drop the row from the cache rather than trusting a refetch to return a list
 * without it. `invalidateQueries` is deduped against whatever fetch is already
 * in flight, and on a family board something usually is.
 */
function forget(qc: QueryClient, familyId: string | undefined, id: string) {
  qc.setQueryData<Room[]>([KEY, familyId], (old) => old?.filter((x) => x.id !== id));
  void qc.invalidateQueries({ queryKey: [KEY, familyId] });
}

/**
 * Thrown by `useCreateRoomRow` when the server rejected the add because this
 * family already has a room with that name. Kept as its own class, rather
 * than a generic `Error`, so the screen can tell "you already have a room
 * called that" apart from any other failure.
 */
export class RoomDuplicateError extends Error {
  constructor() {
    super("rooms add: duplicate name");
    this.name = "RoomDuplicateError";
  }
}

export function useRooms() {
  const { family } = useFamilyStore();
  const query = useQuery({
    queryKey: [KEY, family?.id],
    enabled: Boolean(family?.id),
    queryFn: async (): Promise<Room[]> => {
      const r = await fetch(`/api/rooms?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`rooms: ${r.status}`);
      return ((await r.json()) as { rooms: Room[] }).rooms;
    },
  });
  return { ...query, data: query.data ?? EMPTY };
}

export function useCreateRoomRow() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      icon?: string | null;
      color?: string | null;
    }): Promise<Room> => {
      const r = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family!.id, ...body }),
      });
      if (!r.ok) {
        if (r.status === 409) throw new RoomDuplicateError();
        throw new Error(`rooms add: ${r.status}`);
      }
      return ((await r.json()) as { room: Room }).room;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}

export function useUpdateRoomRow() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      icon?: string | null;
      color?: string | null;
      position?: number;
    }): Promise<Room> => {
      const r = await fetch(`/api/rooms/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family!.id, ...patch }),
      });
      if (!r.ok) {
        // A rename can collide with an existing room exactly the way an add
        // can — `PATCH /api/rooms/[id]` returns the same 409 as POST does —
        // so it gets the same mapping. A 400/500/network failure must NOT
        // become this: telling somebody their name is taken when the real
        // problem is the backend being down is a worse lie than a vague one.
        if (r.status === 409) throw new RoomDuplicateError();
        throw new Error(`rooms update: ${r.status}`);
      }
      return ((await r.json()) as { room: Room }).room;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}

export function useDeleteRoomRow() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await fetch(`/api/rooms/${id}?family_id=${family!.id}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(`rooms delete: ${r.status}`);
    },
    onSuccess: (_data, id) => forget(qc, family?.id, id),
  });
}
