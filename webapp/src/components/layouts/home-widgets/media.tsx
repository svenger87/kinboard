"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ListMusic, Music, Pause, Play, Power, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { artworkSrc } from "@/components/media/artwork-src";
import { MediaBrowseSheet } from "@/components/media/browse-sheet";
import { interpolatedPosition } from "@/components/media/progress";
import { useNowPlaying } from "@/components/widgets/media-player-widget";
import { useMediaCommand } from "@/hooks/use-media-player-state";
import type { Capability, MediaCommand, MediaPlayerState } from "@/plugins/media/types";
import type { MediaPlayer } from "@/types/database";
import type { HomeWidgetProps } from "./shared";
import { HomeCard, HomeCardHeader, HomeEmptyLine } from "./frame";
import { TOUCH, useShrinkStep } from "./rest-shared";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface Step {
  /** The devices playing, to switch between, when there are several. */
  switcher: boolean;
  artwork: boolean;
  /** Lines of text: the device, the track, the artist. */
  lines: 1 | 2 | 3;
  progress: boolean;
  /** "all": power, previous, play, next, browse, mute; "main": previous, play, next; "play": play alone. */
  controls: "all" | "main" | "play";
  /** The shared title row: it goes last, in a box too small for it and a row of play. */
  header: boolean;
}

/** Richest first; each step drops the next least needed thing. */
const STEPS: Step[] = [
  { switcher: true, artwork: true, lines: 3, progress: true, controls: "all", header: true },
  { switcher: false, artwork: true, lines: 3, progress: true, controls: "all", header: true },
  { switcher: false, artwork: true, lines: 2, progress: false, controls: "all", header: true },
  { switcher: false, artwork: true, lines: 2, progress: false, controls: "main", header: true },
  { switcher: false, artwork: false, lines: 2, progress: false, controls: "main", header: true },
  { switcher: false, artwork: false, lines: 1, progress: false, controls: "main", header: true },
  { switcher: false, artwork: false, lines: 1, progress: false, controls: "play", header: true },
  { switcher: false, artwork: false, lines: 1, progress: false, controls: "play", header: false },
];

function Player({
  player,
  state,
  familyId,
  box,
  playing,
  players,
  activeId,
  onSelect,
}: {
  player: MediaPlayer;
  state: MediaPlayerState;
  familyId: string;
  box: HomeWidgetProps["box"];
  playing: string[];
  players: MediaPlayer[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("media");
  const { run, isPending } = useMediaCommand();
  const [failed, setFailed] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const can = (c: Capability) => state.capabilities.includes(c);
  const isUnavailable = state.status === "unavailable";

  const ref = useRef<HTMLDivElement>(null);
  const caps = state.capabilities.join();
  const index = useShrinkStep(ref, STEPS.length, [box.width, box.height, player.id, caps, playing.length, Boolean(state.artworkUrl), Boolean(state.artist), failed]);
  const step = STEPS[index];

  // The playhead moves by arithmetic, once a second, and only while a progress bar is on screen.
  const [now, setNow] = useState(() => new Date());
  const ticking = step.progress && state.status === "playing" && state.duration !== undefined;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  const position = interpolatedPosition(state, now);

  const send = async (command: MediaCommand) => {
    setFailed(false);
    try {
      await run(player, command);
    } catch {
      // Quiet, as on the card: a wall display must not raise a modal nobody is standing at.
      setFailed(true);
    }
  };

  const artwork = state.artworkUrl ? artworkSrc(player.id, familyId, state.artworkUrl) : null;
  const subtitle = isUnavailable ? t("unavailable") : state.status === "off" ? t("off") : (state.title ?? t("nothingPlaying"));

  const control = (show: boolean, label: string, icon: ReactNode, command: MediaCommand | null, onClick?: () => void) =>
    show ? (
      <Button
        variant="ghost"
        size="icon"
        className={`${TOUCH} shrink-0`}
        aria-label={label}
        disabled={command ? isPending : false}
        onClick={() => (command ? void send(command) : onClick?.())}
      >
        {icon}
      </Button>
    ) : null;
  const all = step.controls === "all";
  const main = step.controls !== "play";

  return (
    <HomeCard ref={ref} testId="home-media" step={index} className={`gap-[0.4em] ${isUnavailable ? "opacity-50" : ""}`}>
      {step.header && <HomeCardHeader icon={Music} title={t("title")} />}
      {step.switcher && playing.length > 1 && (
        <div className="flex shrink-0 gap-[0.3em]">
          {playing.map((id) => {
            const p = players.find((x) => x.id === id);
            if (!p) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                className={`${TOUCH} shrink-0 rounded-full px-[0.7em] home-meta ${id === activeId ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              >
                {p.nickname}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex min-w-0 shrink-0 items-center gap-[0.5em]">
        {step.artwork &&
          (artwork ? (
            <img src={artwork} alt="" className="size-[3.2em] shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="flex size-[3.2em] shrink-0 items-center justify-center rounded-lg bg-muted">
              <Music className="size-[1.4em] text-muted-foreground" aria-hidden="true" />
            </span>
          ))}
        <div className="min-w-0 flex-1 leading-tight">
          {step.lines >= 2 && <p className="truncate home-meta text-muted-foreground">{player.nickname}</p>}
          <p className="truncate font-medium">{subtitle}</p>
          {step.lines >= 3 && !isUnavailable && state.artist && <p className="truncate home-meta text-muted-foreground">{state.artist}</p>}
        </div>
        {step.controls === "play" &&
          can("transport") &&
          control(true, t("playPause"), state.status === "playing" ? <Pause className="size-5" /> : <Play className="size-5" />, { kind: "playPause" })}
      </div>
      {step.progress && !isUnavailable && position !== undefined && state.duration !== undefined && (
        <div className="flex shrink-0 items-center gap-[0.4em] home-label tabular-nums text-muted-foreground">
          <span>{fmt(position)}</span>
          <div className="h-[0.35em] flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, (position / state.duration) * 100)}%` }} />
          </div>
          <span>{fmt(state.duration)}</span>
        </div>
      )}
      {main && (
        <div className="flex shrink-0 items-center gap-[0.1em]">
          {control(all && can("power"), state.status === "off" ? t("turnOn") : t("turnOff"), <Power className={`size-5 ${state.status === "off" ? "" : "text-primary"}`} />, {
            kind: "power",
            on: state.status === "off",
          })}
          {control(can("previous"), t("previous"), <SkipBack className="size-5" />, { kind: "previous" })}
          {control(can("transport"), t("playPause"), state.status === "playing" ? <Pause className="size-5" /> : <Play className="size-5" />, { kind: "playPause" })}
          {control(can("next"), t("next"), <SkipForward className="size-5" />, { kind: "next" })}
          {control(all && can("browse"), t("browse"), <ListMusic className="size-5" />, null, () => setBrowseOpen(true))}
          {control(all && can("mute"), state.muted ? t("unmute") : t("mute"), state.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />, {
            kind: "setMuted",
            muted: !state.muted,
          })}
        </div>
      )}
      {failed && <p className="shrink-0 home-meta text-destructive">{t("commandFailed")}</p>}
      {can("browse") && (
        // A sheet over the whole screen, not inside the box (RFC-022 §3.3).
        <MediaBrowseSheet
          player={player}
          familyId={familyId}
          open={browseOpen}
          onOpenChange={setBrowseOpen}
          onPlay={(node) => {
            setBrowseOpen(false);
            void send({ kind: "playMedia", contentId: node.id, contentType: node.type });
          }}
        />
      )}
    </HomeCard>
  );
}

/**
 * The media player in a box (RFC-022 §3.1, fixed): whatever is playing, one
 * device at a time, chosen as on the card (useNowPlaying), with its artwork,
 * track, progress and controls. Every control is 48px and gated on the
 * player's capabilities, as on the card; as the box shrinks the device
 * switcher goes, then the progress, the less used controls, the artwork and
 * the lines of text, down to the track with play/pause. Browsing opens its
 * sheet over the screen. Absent when nothing plays, as the card is.
 */
export function MediaHomeWidget({ box, editing }: HomeWidgetProps) {
  const t = useTranslations("media");
  const { family, players, states, playing, activeId, player, setSelected } = useNowPlaying();
  const stateOf = useMemo(() => (player ? states[player.id] : undefined), [player, states]);

  if (!family || !player || !activeId || !stateOf) {
    if (!editing) return null;
    return (
      <HomeCard testId="home-media" icon={Music} title={t("title")}>
        <HomeEmptyLine text={t("nothingPlaying")} />
      </HomeCard>
    );
  }
  return (
    <Player
      player={player}
      state={stateOf}
      familyId={family.id}
      box={box}
      playing={playing}
      players={players}
      activeId={activeId}
      onSelect={setSelected}
    />
  );
}
