"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useFamilyStore } from "@/stores/family-store";
import { useMediaPlayers } from "@/hooks/use-media-players";
import { useMediaPlayerStates } from "@/hooks/use-media-player-state";
import { PlayerCard } from "@/components/media/player-card";

/**
 * Whatever is playing, one device at a time.
 *
 * Absent when nothing plays — the rule the attention panel already follows, and
 * what earns a widget its space on a wall. Two things playing at once and the
 * most recently started wins, measured as the first render in which we saw the
 * device playing, because not every driver reports a start time. RFC-003 §7.
 *
 * The "first seen playing" bookkeeping is state, not derived render output, so
 * it is written from a `useEffect`, never mutated inline during render. An
 * earlier draft kept a `Map` in a `useState` initializer and mutated it inside
 * the `useMemo` that computed the play order — a side effect during the render
 * phase, the same class of bug PR #241 fixed elsewhere in this codebase
 * ("Cannot update a component while rendering a different component"). Under
 * StrictMode's double-render that mutation would double-apply. Here the effect
 * updates `seenPlayingAt` via a functional `setState`, which only produces a
 * new Map (and thus a re-render) when the set of playing devices actually
 * changed, so a duplicate StrictMode invocation is a no-op rather than a
 * second mutation.
 */
export function MediaPlayerWidget() {
  const t = useTranslations("media");
  const { family } = useFamilyStore();
  const { data: players = [] } = useMediaPlayers();
  const [selected, setSelected] = useState<string | undefined>();
  const [seenPlayingAt, setSeenPlayingAt] = useState<Map<string, number>>(
    () => new Map(),
  );

  const states = useMediaPlayerStates(players, selected);

  const playingIds = useMemo(
    () => players.map((p) => p.id).filter((id) => states[id]?.status === "playing"),
    [players, states],
  );

  // Record first-seen and prune stopped devices — a commit-phase effect, not
  // a render-phase mutation. Bails out (returns `prev` unchanged) when the
  // playing set hasn't actually changed, so it is safe to run twice.
  useEffect(() => {
    setSeenPlayingAt((prev) => {
      const now = Date.now();
      let changed = false;
      const next = new Map(prev);
      for (const id of playingIds) {
        if (!next.has(id)) {
          next.set(id, now);
          changed = true;
        }
      }
      for (const id of [...next.keys()]) {
        if (!playingIds.includes(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [playingIds]);

  const playing = useMemo(
    () =>
      [...playingIds].sort(
        (a, b) => (seenPlayingAt.get(b) ?? 0) - (seenPlayingAt.get(a) ?? 0),
      ),
    [playingIds, seenPlayingAt],
  );

  if (playing.length === 0 || !family) return null;

  const activeId = selected && playing.includes(selected) ? selected : playing[0];
  const player = players.find((p) => p.id === activeId);
  if (!player) return null;

  return (
    <section className="col-span-1 sm:col-span-2" aria-label={t("title")}>
      {playing.length > 1 && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto">
          {playing.map((id) => {
            const p = players.find((x) => x.id === id);
            if (!p) return null;
            return (
              <button
                key={id}
                onClick={() => setSelected(id)}
                className={`min-h-[44px] shrink-0 rounded-full px-3 text-xs ${
                  id === activeId ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {p.nickname}
              </button>
            );
          })}
        </div>
      )}
      <PlayerCard player={player} state={states[player.id]} familyId={family.id} />
    </section>
  );
}
