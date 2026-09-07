"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { MediaPlayer, MediaPlayerInsert } from "@/types/database";

const KEY = "media-players";

export function useMediaPlayers() {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [KEY, family?.id],
    enabled: Boolean(family?.id),
    queryFn: async (): Promise<MediaPlayer[]> => {
      const r = await fetch(`/api/media-players?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`media-players: ${r.status}`);
      const json = (await r.json()) as { players: MediaPlayer[] };
      return json.players;
    },
  });
}

/** Nav gating: the Media entry appears only once a player exists. */
export function useMediaPlayersCount(): {
  count: number | undefined;
  loading: boolean;
} {
  const { data, isLoading } = useMediaPlayers();
  return { count: data?.length, loading: isLoading };
}

export function useSaveMediaPlayer() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (
      input: { id?: string } & Partial<MediaPlayerInsert>,
    ): Promise<MediaPlayer> => {
      const isUpdate = Boolean(input.id);
      const r = await fetch(
        isUpdate ? `/api/media-players/${input.id}` : "/api/media-players",
        {
          method: isUpdate ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, family_id: family!.id }),
        },
      );
      if (!r.ok) throw new Error(`media-player save: ${r.status}`);
      const json = (await r.json()) as { player: MediaPlayer };
      return json.player;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}

export function useDeleteMediaPlayer() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await fetch(
        `/api/media-players/${id}?family_id=${family!.id}`,
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error(`media-player delete: ${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}
