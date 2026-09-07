"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { interpolatedPosition } from "./progress";
import { useMediaCommand } from "@/hooks/use-media-player-state";
import type { Capability, MediaPlayerState } from "@/plugins/media/types";
import type { MediaPlayer } from "@/types/database";

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * One media player: artwork, track, progress and its controls.
 *
 * Every control below is gated on `state.capabilities` — never on the driver
 * or the device model — so a player that cannot skip does not grow a skip
 * button. `stateFromHaEntity` (plugins/media/drivers/home-assistant.ts)
 * already collapses capabilities to `[]` when the player is unavailable, so
 * that one guard is what makes every control disappear together; this
 * component only needs to dim the card and swap the subtitle for "Not
 * reachable" — it must not render as an error.
 */
export function PlayerCard({
  player,
  state,
  familyId,
}: {
  player: MediaPlayer;
  state: MediaPlayerState;
  familyId: string;
}) {
  const t = useTranslations("media");
  const { run, isPending } = useMediaCommand();
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // Radix Slider's own drag position, shown in place of `state.volume` while
  // the thumb is moving so a slow poll can't fight the finger on it — the
  // same pattern home-assistant/cards/media-player-card.tsx and light-card.tsx
  // use, committed on release rather than on every step.
  const [localVolume, setLocalVolume] = useState<number | null>(null);

  // Only the clock ticks; the position comes from arithmetic, not a request.
  useEffect(() => {
    if (state.status !== "playing") return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const can = (c: Capability) => state.capabilities.includes(c);
  const isUnavailable = state.status === "unavailable";
  const position = interpolatedPosition(state, now);

  const send = async (fn: () => Promise<void>) => {
    setFailed(false);
    try {
      await fn();
    } catch {
      // Quiet: a wall display must not raise a modal nobody is standing at.
      setFailed(true);
    }
  };

  const artwork = state.artworkUrl
    ? `/api/media-players/${player.id}/artwork?family_id=${familyId}&src=${encodeURIComponent(state.artworkUrl)}`
    : null;

  const volumePercent = Math.round((state.volume ?? 0) * 100);
  const displayVolume = state.muted ? 0 : (localVolume ?? volumePercent);

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-opacity ${
        isUnavailable ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        {artwork ? (
          <img src={artwork} alt="" className="size-16 rounded-lg object-cover" />
        ) : (
          <div className="size-16 rounded-lg bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{player.nickname}</p>
          <p className="truncate text-sm text-muted-foreground">
            {isUnavailable ? t("unavailable") : (state.title ?? t("nothingPlaying"))}
          </p>
          {!isUnavailable && state.artist && (
            <p className="truncate text-xs text-muted-foreground">{state.artist}</p>
          )}
        </div>
      </div>

      {!isUnavailable && position !== undefined && state.duration !== undefined && (
        <div className="flex items-center gap-2 text-2xs tabular-nums text-muted-foreground">
          <span>{fmt(position)}</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(100, (position / state.duration) * 100)}%` }}
            />
          </div>
          <span>{fmt(state.duration)}</span>
        </div>
      )}

      {(can("transport") || can("next") || can("mute")) && (
        <div className="flex items-center gap-2">
          {can("transport") && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-[44px] min-w-[44px]"
                aria-label={t("previous")}
                disabled={isPending}
                onClick={() => send(() => run(player, { kind: "previous" }))}
              >
                <SkipBack className="size-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-[44px] min-w-[44px]"
                aria-label={t("playPause")}
                disabled={isPending}
                onClick={() => send(() => run(player, { kind: "playPause" }))}
              >
                {state.status === "playing" ? (
                  <Pause className="size-5" />
                ) : (
                  <Play className="size-5" />
                )}
              </Button>
            </>
          )}
          {can("next") && (
            <Button
              variant="ghost"
              size="icon"
              className="min-h-[44px] min-w-[44px]"
              aria-label={t("next")}
              disabled={isPending}
              onClick={() => send(() => run(player, { kind: "next" }))}
            >
              <SkipForward className="size-5" />
            </Button>
          )}
          {can("mute") && (
            <Button
              variant="ghost"
              size="icon"
              className="min-h-[44px] min-w-[44px]"
              aria-label={state.muted ? t("unmute") : t("mute")}
              disabled={isPending}
              onClick={() => send(() => run(player, { kind: "setMuted", muted: !state.muted }))}
            >
              {state.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
            </Button>
          )}
        </div>
      )}

      {can("volume") && (
        // A bare Slider carries no accessible name of its own — light-card.tsx
        // solves this the same way, with a labelled group around it rather
        // than a prop the styled Slider wrapper doesn't forward to its thumb.
        <div className="flex items-center gap-2 px-1" role="group" aria-label={t("volume")}>
          <Slider
            value={[displayVolume]}
            min={0}
            max={100}
            step={5}
            disabled={isPending || state.muted}
            onValueChange={(v) => setLocalVolume(v[0])}
            onValueCommit={(v) => {
              setLocalVolume(null);
              send(() => run(player, { kind: "setVolume", volume: v[0] / 100 }));
            }}
            className="min-h-[44px] flex-1 cursor-pointer"
          />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {Math.round(displayVolume)}%
          </span>
        </div>
      )}

      {can("sources") && state.sourceList && state.sourceList.length > 0 && (
        <select
          className="min-h-[44px] rounded-lg border border-border bg-background px-2 py-2 text-sm"
          aria-label={t("source")}
          value={state.source ?? ""}
          disabled={isPending}
          onChange={(e) =>
            send(() => run(player, { kind: "selectSource", source: e.target.value }))
          }
        >
          {state.sourceList.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      {failed && <p className="text-xs text-destructive">{t("commandFailed")}</p>}
    </div>
  );
}
