"use client";

import { useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Tv,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useMediaPlayerControl } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

type MediaPlayerStateKey = "playing" | "paused" | "idle" | "off" | "standby" | "buffering";
const MEDIA_PLAYER_STATE_KEYS: readonly string[] = ["playing", "paused", "idle", "off", "standby", "buffering"];

interface MediaPlayerCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function MediaPlayerCard({ card, entity }: MediaPlayerCardProps) {
  const t = useTranslations("homeAutomation.cards.mediaPlayer");
  const tState = useTranslations("homeAutomation.entityState");
  const tMpState = useTranslations("homeAutomation.mediaPlayerState");
  const {
    play,
    pause,
    stop,
    next,
    previous,
    setVolume,
    mute,
    isPending,
  } = useMediaPlayerControl();
  const [localVolume, setLocalVolume] = useState<number | null>(null);

  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";
  const isOff = entity.state === "off" || entity.state === "standby";
  const isPlaying = entity.state === "playing";
  const isPaused = entity.state === "paused";
  const isIdle = entity.state === "idle";

  // Media attributes
  const mediaTitle = entity.attributes.media_title as string | undefined;
  const mediaArtist = entity.attributes.media_artist as string | undefined;
  const volumeLevel = entity.attributes.volume_level as number | undefined;
  const isMuted = entity.attributes.is_volume_muted as boolean | undefined;
  const entityPicture = entity.attributes.entity_picture as string | undefined;

  const displayVolume = localVolume !== null ? localVolume : ((volumeLevel ?? 0) * 100);
  const supportsVolume = volumeLevel !== undefined;

  const getStateColor = () => {
    if (isPlaying) return "text-green-500";
    if (isPaused) return "text-yellow-500";
    return "text-muted-foreground";
  };

  const handlePlayPause = async () => {
    if (isUnavailable) return;
    if (isPlaying) {
      await pause(entity.entity_id);
    } else {
      await play(entity.entity_id);
    }
  };

  const handlePrevious = async () => {
    await previous(entity.entity_id);
  };

  const handleNext = async () => {
    await next(entity.entity_id);
  };

  const handleVolumeChange = (value: number[]) => {
    setLocalVolume(value[0]);
  };

  const handleVolumeCommit = async (value: number[]) => {
    await setVolume(entity.entity_id, value[0] / 100);
    setLocalVolume(null);
  };

  const handleMuteToggle = async () => {
    await mute(entity.entity_id, !isMuted);
  };

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isPlaying
          ? "bg-green-500/10 border-green-500/30"
          : isPaused
          ? "bg-yellow-500/10 border-yellow-500/30"
          : "bg-card hover:border-month-primary/30"
      } ${isUnavailable ? "opacity-50" : ""}`}
    >
      {/* Header with optional album art */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`p-2 rounded-lg shrink-0 ${
            isPlaying
              ? "bg-green-500/20 text-green-500"
              : isPaused
              ? "bg-yellow-500/20 text-yellow-500"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {entityPicture ? (
            <img
              src={entityPicture}
              alt="Album art"
              className="size-5 rounded object-cover"
            />
          ) : (
            <Tv className="size-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{label}</p>
          <p className={`text-xs ${getStateColor()}`}>
            {isUnavailable
              ? tState("unavailable")
              : MEDIA_PLAYER_STATE_KEYS.includes(entity.state)
                ? tMpState(entity.state as MediaPlayerStateKey)
                : entity.state}
          </p>
        </div>
      </div>

      {/* Now Playing Info */}
      {(isPlaying || isPaused) && (mediaTitle || mediaArtist) && (
        <div className="mb-3 p-2 rounded-lg bg-muted/50">
          {mediaTitle && (
            <p className="text-sm font-medium truncate">{mediaTitle}</p>
          )}
          {mediaArtist && (
            <p className="text-xs text-muted-foreground truncate">{mediaArtist}</p>
          )}
        </div>
      )}

      {/* Playback Controls */}
      {!isUnavailable && !isOff && (
        <div className="flex items-center justify-center gap-2 mb-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={handlePrevious}
            disabled={isPending}
            aria-label={t("previousAria")}
          >
            <SkipBack className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-10"
            onClick={handlePlayPause}
            disabled={isPending}
            aria-label={isPlaying ? t("pauseAria") : t("playAria")}
          >
            {isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="size-5" />
            ) : (
              <Play className="size-5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={handleNext}
            disabled={isPending}            aria-label={t("nextAria")}
          >
            <SkipForward className="size-4" />
          </Button>
        </div>
      )}

      {/* Volume Control */}
      {supportsVolume && !isUnavailable && !isOff && (
        <div className="flex items-center gap-2 pt-3 border-t">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={handleMuteToggle}
            disabled={isPending}
            aria-label={isMuted ? t("unmuteAria") : t("muteAria")}
          >
            {isMuted ? (
              <VolumeX className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </Button>
          <Slider
            value={[isMuted ? 0 : displayVolume]}
            min={0}
            max={100}
            step={5}
            onValueChange={handleVolumeChange}
            onValueCommit={handleVolumeCommit}
            disabled={isPending || isMuted}
            className="cursor-pointer flex-1"
          />
          <span className="text-xs text-muted-foreground w-8 text-right">
            {Math.round(displayVolume)}%
          </span>
        </div>
      )}
    </div>
  );
}
