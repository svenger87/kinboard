"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Home,
  Settings,
  RefreshCw,
  WifiOff,
  ImageIcon,
  Boxes,
  ChevronRight,
  AlertTriangle,
  Lock,
  LockOpen,
  ArrowUp,
  ArrowDown,
  SkipBack,
  SkipForward,
  Play,
  Pause,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useHomeAssistantStatus,
  useHomeAssistantEntityStates,
  useToggleEntity,
  useLockControl,
  useCoverControl,
  useMediaPlayerControl,
  useVacuumCommand,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import { useRooms } from "@/hooks/use-rooms-table";
import { useCatalogue } from "@/hooks/use-catalogue";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { iconFor } from "@/components/home-assistant/room-icon";
/*
  The optimistic-settle rule now lives in `lib/home-assistant-optimism.ts`:
  the detail sheet's sliders and steppers need the same three exits the tiles
  have, and two copies of the number would drift.
*/
import { OPTIMISTIC_SETTLE_MS, POLL_MS } from "@/lib/home-assistant-optimism";
import type { CatalogueItem, Room } from "@/types/database";
import type { HAEntity } from "@/types/home-assistant";

/** Domains whose tile is a plain on/off switch. */
const TOGGLE_DOMAINS = new Set(["light", "switch", "input_boolean", "fan"]);

/**
 * Domains with too many meaningful actions for one tap to be unambiguous —
 * a tap opens the detail sheet instead of guessing between play/pause,
 * heat/cool or start/dock.
 */
const DETAIL_DOMAINS = new Set(["media_player", "climate", "vacuum"]);

/** States that mean "Home Assistant has no reading for this right now". */
const NO_READING = new Set(["unavailable", "unknown", ""]);

/**
 * Is there a reading we can act against?
 *
 * `undefined` (the entity is not in the poll at all) and every member of
 * `NO_READING` mean the same thing: Home Assistant is not telling us what
 * this device is doing. A control offered in that state is a trap. The
 * service call still returns 200 — Home Assistant accepts a call for an
 * entity it cannot reach — so nothing throws, nothing reverts, and the
 * optimistic guess sits on the tile for its full timeout. A wall panel that
 * says "Locked" for twenty seconds about a door whose lock has a dead
 * battery, then silently flips back, is exactly the lie the brief calls
 * worse than a slow update.
 *
 * One function, four call sites — the toggle, the lock pair, the cover pair
 * and the detail sheet. It is a helper rather than a repeated predicate
 * because the repeated predicate is how the lock and cover tiles came to be
 * missing half of it while the toggle three lines above them had it.
 */
function hasReading(state: string | undefined): boolean {
  return state !== undefined && !NO_READING.has(state);
}

const COVER_STATES = new Set(["open", "opening", "closed", "closing"]);
const LOCK_STATES = new Set(["locked", "unlocked", "locking", "unlocking", "jammed"]);
const MEDIA_STATES = new Set(["playing", "paused", "idle", "off", "standby", "buffering"]);
const VACUUM_STATES = new Set(["cleaning", "docked", "paused", "idle", "returning", "error", "charging"]);
const HVAC_MODES = new Set(["auto", "heat", "cool", "heat_cool", "dry", "fan_only", "off"]);

/** A catalogue row narrowed to one that actually has an entity behind it. */
type WithEntity = CatalogueItem & { entity_id: string };

function hasEntity(item: CatalogueItem): item is WithEntity {
  return typeof item.entity_id === "string" && item.entity_id.length > 0;
}

function domainOf(entityId: string): string {
  return entityId.split(".")[0];
}

export default function HausautomationPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const router = useRouter();
  const t = useTranslations("homeAutomation");
  const tState = useTranslations("homeAutomation.entityState");
  const tCover = useTranslations("homeAutomation.coverState");
  const tLock = useTranslations("homeAutomation.lockState");
  const tMedia = useTranslations("homeAutomation.mediaPlayerState");
  const tVacuum = useTranslations("homeAutomation.vacuumStatus");
  const tHvac = useTranslations("homeAutomation.hvacMode");
  const tDetail = useTranslations("homeAutomation.entityDetail");

  const {
    data: settings,
    isLoading: loadingSettings,
    isError: settingsError,
    refetch: refetchSettings,
  } = useHomeAssistantStatus();
  const {
    data: rooms,
    isLoading: roomsLoading,
    isError: roomsError,
    refetch: refetchRooms,
  } = useRooms();
  const {
    data: catalogue,
    isLoading: catalogueLoading,
    isError: catalogueError,
    refetch: refetchCatalogue,
  } = useCatalogue();

  /**
   * "Configured", not "answering". The same derivation the page has always
   * used; kept because it is the only thing that distinguishes "nobody has
   * set Home Assistant up" from "it is set up and currently down", and those
   * two have different next actions for the household.
   *
   * It is false in a third case too — the settings query failed — which is
   * why `settingsError` is read separately below. Falsy here means "we cannot
   * drive anything", which is true either way; it does *not* license the page
   * to tell somebody they have not connected Home Assistant when the honest
   * answer is that we could not find out.
   */
  const isConnected = !!settings?.url && !!settings?.access_token;

  /**
   * Every entity we need a state for, deduped and stable.
   *
   * `entityIds` is part of the query key, so an array rebuilt every render
   * would refetch every render. Catalogue rows without an `entity_id` are
   * excluded deliberately: the catalogue holds things that are not smart
   * devices, and asking Home Assistant about them would be asking about
   * nothing.
   */
  const entityIds = useMemo(
    () => Array.from(new Set(catalogue.filter(hasEntity).map((i) => i.entity_id))).sort(),
    [catalogue]
  );

  const {
    data: entities = [],
    isFetching: fetchingStates,
    isError: statesError,
    refetch: refetchStates,
  } = useHomeAssistantEntityStates(entityIds, isConnected, POLL_MS);

  const stateByEntity = useMemo(
    () => new Map(entities.map((e) => [e.entity_id, e])),
    [entities]
  );

  // ── Optimism ────────────────────────────────────────────────────────────
  // A tile flips the moment it is tapped, then reconciles: the entry clears
  // when a poll comes back agreeing with it, when the call fails, or when
  // OPTIMISTIC_SETTLE_MS passes without either.
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const forget = useCallback((entityId: string) => {
    const timer = timers.current[entityId];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[entityId];
    }
    setOptimistic((prev) => {
      if (!(entityId in prev)) return prev;
      const next = { ...prev };
      delete next[entityId];
      return next;
    });
  }, []);

  const expectState = useCallback(
    (entityId: string, expected: string) => {
      setOptimistic((prev) => ({ ...prev, [entityId]: expected }));
      if (timers.current[entityId]) clearTimeout(timers.current[entityId]);
      timers.current[entityId] = setTimeout(() => forget(entityId), OPTIMISTIC_SETTLE_MS);
    },
    [forget]
  );

  // Reconcile against the poll: an entity that now reads what we asked for
  // no longer needs a guess in front of it.
  useEffect(() => {
    const settled = entities
      .filter((e) => optimistic[e.entity_id] === e.state)
      .map((e) => e.entity_id);
    if (settled.length === 0) return;
    settled.forEach(forget);
  }, [entities, optimistic, forget]);

  // Nothing should keep firing after the page is gone.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
    };
  }, []);

  const { toggle } = useToggleEntity();
  const { lock, unlock } = useLockControl();
  const { open: openCover, close: closeCover } = useCoverControl();
  const { play, pause: pauseMedia, previous, next, isPending: mediaPending } = useMediaPlayerControl();
  const { start, pause: pauseVacuum, returnToBase, isPending: vacuumPending } = useVacuumCommand();

  /**
   * Drive one control.
   *
   * `expected` is the state the tile should show while we wait for the poll
   * to agree — or `null` for an action whose result is not a state we can
   * name in advance. "Next track" is the honest example: the player stays
   * `playing` either way, so guessing a state would be inventing one. Those
   * still get the failure toast; they simply have nothing to be optimistic
   * about.
   */
  const run = useCallback(
    async (entityId: string, expected: string | null, call: () => Promise<void>) => {
      if (expected !== null) expectState(entityId, expected);
      try {
        await call();
      } catch {
        forget(entityId);
        toast.error(t("controlFailed"));
      }
    },
    [expectState, forget, t]
  );

  // ── Detail sheet ────────────────────────────────────────────────────────
  const [detailFor, setDetailFor] = useState<CatalogueItem | null>(null);
  const detailEntity =
    detailFor && hasEntity(detailFor) ? stateByEntity.get(detailFor.entity_id) : undefined;
  const detailEntityId = detailFor && hasEntity(detailFor) ? detailFor.entity_id : null;
  const detailDomain = detailEntityId ? domainOf(detailEntityId) : null;
  /**
   * The same rule the tiles use, plus the sheet's own in-flight calls: an
   * action is offered only when Home Assistant is configured, answering, and
   * currently reporting a state for this entity — pressing a button that
   * cannot reach anything is worse than one that is visibly out of reach.
   */
  const detailActionsDisabled =
    !isConnected ||
    statesError ||
    !hasReading(detailEntity?.state) ||
    mediaPending ||
    vacuumPending;

  /**
   * The state a tile shows: the guess if we are holding one, otherwise the
   * poll, otherwise nothing at all. `undefined` means "we do not know", which
   * is what the page renders as "Not reachable" — never as "off".
   */
  const displayState = useCallback(
    (entityId: string): string | undefined => {
      const guess = optimistic[entityId];
      if (guess !== undefined) return guess;
      const entity = stateByEntity.get(entityId);
      if (!entity || NO_READING.has(entity.state)) return undefined;
      return entity.state;
    },
    [optimistic, stateByEntity]
  );

  /** Human wording for a raw Home Assistant state, per domain. */
  const labelFor = useCallback(
    (entityId: string, state: string | undefined, entity: HAEntity | undefined): string => {
      if (state === undefined) return t("unavailable");
      const domain = domainOf(entityId);
      if (domain === "cover" && COVER_STATES.has(state)) return tCover(state);
      if (domain === "lock" && LOCK_STATES.has(state)) return tLock(state);
      if (domain === "media_player" && MEDIA_STATES.has(state)) return tMedia(state);
      if (domain === "vacuum" && VACUUM_STATES.has(state)) return tVacuum(state);
      if (domain === "climate" && HVAC_MODES.has(state)) return tHvac(state);
      if (state === "on") return tState("on");
      if (state === "off") return tState("off");
      const unit = entity?.attributes?.unit_of_measurement;
      return unit ? `${state} ${unit}` : state;
    },
    [t, tState, tCover, tLock, tMedia, tVacuum, tHvac]
  );

  /**
   * Grouped by `room_id`, never by the legacy free-text `room` column.
   * `rooms` already arrives ordered by position then name, so iterating it
   * directly gives the household's own order for free — do not re-sort.
   *
   * A `room_id` pointing at a room that no longer exists (the FK is
   * `ON DELETE SET NULL`, so it shouldn't, but it is asserted rather than
   * assumed) falls into the same "no room" bucket as a null one instead of
   * vanishing from the page.
   */
  const grouped = useMemo(() => {
    const byRoom = new Map<string, CatalogueItem[]>();
    for (const room of rooms) byRoom.set(room.id, []);
    const unroomed: CatalogueItem[] = [];
    for (const item of catalogue) {
      if (item.room_id && byRoom.has(item.room_id)) byRoom.get(item.room_id)!.push(item);
      else unroomed.push(item);
    }
    return { byRoom, unroomed };
  }, [catalogue, rooms]);

  /**
   * Which room a device is in is unknown while the rooms query is in flight
   * or after it failed. Grouping anyway would file every roomed device under
   * "No room" — the wrong-while-loading bug this branch has already paid for
   * twice on the devices screen. Devices still render (nothing about *them*
   * is unknown), just flat and without committing to a heading.
   */
  const roomsUnknown = roomsLoading || roomsError;

  const renderTile = (item: CatalogueItem) => (
    <DeviceTile
      key={item.id}
      item={item}
      state={item.entity_id ? displayState(item.entity_id) : undefined}
      label={
        item.entity_id
          ? labelFor(
              item.entity_id,
              displayState(item.entity_id),
              stateByEntity.get(item.entity_id)
            )
          : undefined
      }
      controlsDisabled={!isConnected || statesError}
      onToggle={(entityId, current) =>
        void run(entityId, current === "on" ? "off" : "on", () => toggle(entityId, current ?? "off"))
      }
      onLock={(entityId) => void run(entityId, "locked", () => lock(entityId))}
      onUnlock={(entityId) => void run(entityId, "unlocked", () => unlock(entityId))}
      onOpen={(entityId) => void run(entityId, "open", () => openCover(entityId))}
      onClose={(entityId) => void run(entityId, "closed", () => closeCover(entityId))}
      onDetail={() => setDetailFor(item)}
      t={t}
    />
  );

  return (
    <main
      id="main-content"
      className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="page-gradient" />
      <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Home}
          title={t("title")}
          subtitle={t("subtitleRooms")}
          actions={
            <>
              {fetchingStates && (
                <Badge variant="outline" className="text-xs">
                  <RefreshCw className="size-3 mr-1 animate-spin" />
                  {t("refreshingBadge")}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void refetchStates()}
                disabled={fetchingStates || !isConnected}
                aria-label={t("refreshAria")}
              >
                <RefreshCw className={`size-5 ${fetchingStates ? "animate-spin" : ""}`} />
              </Button>
              <Link href="/settings/homeassistant">
                <Button variant="ghost" size="icon" aria-label={t("settingsAria")}>
                  <Settings className="size-5" />
                </Button>
              </Link>
            </>
          }
        />

        {/*
          We could not read the settings at all.

          Distinct from the two banners below, and it has to be: `isConnected`
          is falsy here as well, so without this the page would tell a
          household with a working Home Assistant that they had never
          connected one and should go and set it up. Nothing about their setup
          changed; we just cannot see it. The retry reloads the settings, not
          the entity states.
        */}
        {settingsError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
          >
            <AlertTriangle className="size-5 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-semibold">{t("settingsUnavailableTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("settingsUnavailableBody")}</p>
            </div>
            <Button variant="outline" onClick={() => void refetchSettings()}>
              {t("unreachableRetry")}
            </Button>
          </div>
        )}

        {/*
          Not configured. A banner, not a full-page takeover: the rooms, the
          names and the pictures are ours, they are still true, and a wall
          panel that shows the house with the states greyed out is far more
          use than a page of nothing behind a "go to settings" button.
        */}
        {!loadingSettings && !settingsError && !isConnected && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3"
          >
            <WifiOff className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-semibold">{t("notConnectedTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("notConnectedDescription")}</p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/settings/homeassistant">{t("notConnectedAction")}</Link>
            </Button>
          </div>
        )}

        {/*
          Configured but not answering. Deliberately a different message from
          the one above: "you have not set this up" and "the thing you set up
          is down" ask the household for different things.
        */}
        {isConnected && statesError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3"
          >
            <WifiOff className="size-5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-semibold">{t("unreachableTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("unreachableBody")}</p>
            </div>
            <Button variant="outline" onClick={() => void refetchStates()} disabled={fetchingStates}>
              {t("unreachableRetry")}
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/settings/homeassistant">{t("unreachableSettings")}</Link>
            </Button>
          </div>
        )}

        {catalogueLoading ? (
          /* Still finding out what is in the house. Not "there is nothing in
             the house" — those are different sentences and this page must
             not say the second one while the first is true. */
          <div className="flex flex-col gap-6" aria-busy="true">
            {[0, 1].map((group) => (
              <div key={group} className="flex flex-col gap-3">
                <Skeleton className="h-5 w-32 rounded-md" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-28 w-full rounded-2xl" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : catalogueError ? (
          /* We could not read the catalogue at all — so we cannot honestly
             claim it is empty either. */
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
          >
            <AlertTriangle className="size-5 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden="true" />
            <p className="min-w-0 flex-1 font-display text-base font-semibold">
              {t("unreachableTitle")}
            </p>
            <Button variant="outline" onClick={() => void refetchCatalogue()}>
              {t("unreachableRetry")}
            </Button>
          </div>
        ) : catalogue.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={t("noDevices")}
            description={t("noDevicesHint")}
            action={{
              label: t("noDevicesAction"),
              onClick: () => router.push("/settings/catalogue"),
              variant: "default",
            }}
          />
        ) : roomsUnknown ? (
          <div className="flex flex-col gap-3">
            {roomsLoading && <Skeleton className="h-5 w-32 rounded-md" />}
            {/*
              The devices are all here and all true; only the grouping is
              missing, so this is a banner above them rather than a takeover.
              It needs the retry its two neighbours have precisely because
              this screen is the wall panel: nothing refocuses a window that
              is never touched, so without a button a transient /api/rooms
              500 leaves the whole house as one flat list until somebody
              walks over and reloads the browser.
            */}
            {roomsError && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
              >
                <AlertTriangle className="size-5 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden="true" />
                <p className="min-w-0 flex-1 font-display text-base font-semibold">
                  {t("roomsUnavailable")}
                </p>
                <Button variant="outline" onClick={() => void refetchRooms()}>
                  {t("unreachableRetry")}
                </Button>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {catalogue.map(renderTile)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {rooms.map((room) => {
              const items = grouped.byRoom.get(room.id) ?? [];
              // A heading with nothing under it tells a wall panel nothing.
              if (items.length === 0) return null;
              return <RoomGroup key={room.id} room={room}>{items.map(renderTile)}</RoomGroup>;
            })}

            {grouped.unroomed.length > 0 && (
              <RoomGroup room={null} unroomedLabel={t("unroomed")}>
                {grouped.unroomed.map(renderTile)}
              </RoomGroup>
            )}
          </div>
        )}

        {catalogue.length > 0 && isConnected && !statesError && (
          <div className="text-center text-xs text-muted-foreground pt-2">
            {t("autoRefreshNote")}
          </div>
        )}
      </div>

      {/*
        The detail sheet for media players, thermostats and vacuums.

        These three route here rather than to a tile control because one tap
        cannot mean play, pause, next and volume at once — the point is to let
        the household pick which action they meant, not to withhold the
        actions. So the sheet names them. `climate` is the exception: there is
        no thermostat hook to call and inventing a temperature UI is a feature
        this screen was not asked for, so it says so rather than showing an
        empty actions block that reads as broken.
      */}
      <Sheet open={detailFor !== null} onOpenChange={(open) => !open && setDetailFor(null)}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle>{detailFor?.name}</SheetTitle>
            <SheetDescription>{detailFor?.entity_id}</SheetDescription>
          </SheetHeader>
          {detailEntityId && (
            <div className="mt-4 flex flex-col gap-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{tDetail("currentStateLabel")}</span>
                <span className="font-medium">
                  {labelFor(detailEntityId, displayState(detailEntityId), detailEntity)}
                </span>
              </div>
              {detailDomain === "climate" ? (
                <p className="text-muted-foreground">{tDetail("climateReadOnly")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="font-medium">{tDetail("actionsHeading")}</p>
                  <div className="flex flex-wrap gap-2">
                    {detailDomain === "media_player" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={detailActionsDisabled}
                          onClick={() =>
                            void run(detailEntityId, null, () => previous(detailEntityId))
                          }
                        >
                          <SkipBack className="mr-1.5 size-3.5" aria-hidden="true" />
                          {tDetail("mediaPrevious")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={detailActionsDisabled}
                          onClick={() =>
                            void run(detailEntityId, "playing", () => play(detailEntityId))
                          }
                        >
                          <Play className="mr-1.5 size-3.5" aria-hidden="true" />
                          {tDetail("mediaPlay")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={detailActionsDisabled}
                          onClick={() =>
                            void run(detailEntityId, "paused", () => pauseMedia(detailEntityId))
                          }
                        >
                          <Pause className="mr-1.5 size-3.5" aria-hidden="true" />
                          {tDetail("mediaPause")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={detailActionsDisabled}
                          onClick={() =>
                            void run(detailEntityId, null, () => next(detailEntityId))
                          }
                        >
                          <SkipForward className="mr-1.5 size-3.5" aria-hidden="true" />
                          {tDetail("mediaNext")}
                        </Button>
                      </>
                    )}
                    {detailDomain === "vacuum" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={detailActionsDisabled}
                          onClick={() =>
                            void run(detailEntityId, "cleaning", () => start(detailEntityId))
                          }
                        >
                          <Play className="mr-1.5 size-3.5" aria-hidden="true" />
                          {tDetail("vacuumStart")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={detailActionsDisabled}
                          onClick={() =>
                            void run(detailEntityId, "paused", () => pauseVacuum(detailEntityId))
                          }
                        >
                          <Pause className="mr-1.5 size-3.5" aria-hidden="true" />
                          {tDetail("vacuumPause")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={detailActionsDisabled}
                          onClick={() =>
                            void run(detailEntityId, "returning", () => returnToBase(detailEntityId))
                          }
                        >
                          <Home className="mr-1.5 size-3.5" aria-hidden="true" />
                          {tDetail("vacuumReturn")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* No state came back at all — Home Assistant is unconfigured or
                  down. Say that where the attributes would have been, rather
                  than closing the sheet or leaving a blank panel. */}
              {detailEntity ? (
                <div className="flex flex-col gap-2">
                  <p className="font-medium">{tDetail("attributesHeading")}</p>
                  {Object.entries(detailEntity.attributes ?? {}).map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">{key}</span>
                      <span className="text-right break-all">
                        {Array.isArray(value) ? value.join(", ") : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">{tDetail("unavailableNotice")}</p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}

/** A room heading plus its tiles. `room` null is the "No room" group. */
function RoomGroup({
  room,
  unroomedLabel,
  children,
}: {
  room: Room | null;
  unroomedLabel?: string;
  children: React.ReactNode;
}) {
  const Icon = room ? iconFor(room.icon) : Boxes;
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10"
          style={
            room?.color
              ? { backgroundColor: `${room.color}20`, color: room.color }
              : undefined
          }
        >
          <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h2 className="font-display text-lg font-medium">{room ? room.name : unroomedLabel}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {children}
      </div>
    </motion.section>
  );
}

function DeviceTile({
  item,
  state,
  label,
  controlsDisabled,
  onToggle,
  onLock,
  onUnlock,
  onOpen,
  onClose,
  onDetail,
  t,
}: {
  item: CatalogueItem;
  /** The state to render, already optimism-aware. `undefined` = not known. */
  state: string | undefined;
  label: string | undefined;
  controlsDisabled: boolean;
  onToggle: (entityId: string, current: string | undefined) => void;
  onLock: (entityId: string) => void;
  onUnlock: (entityId: string) => void;
  onOpen: (entityId: string) => void;
  onClose: (entityId: string) => void;
  onDetail: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const entityId = item.entity_id;
  const domain = entityId ? domainOf(entityId) : null;
  const isDetail = domain !== null && DETAIL_DOMAINS.has(domain);
  /**
   * Every control on this tile is gated on the same thing: Home Assistant is
   * reachable *and* is currently reporting a state for this device. The
   * second half is not optional — see `hasReading`.
   */
  const canDrive = !controlsDisabled && hasReading(state);

  const picture = (
    <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
      {item.image_url ? (
        <img src={item.image_url} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center">
          <ImageIcon className="size-5 text-muted-foreground/50" aria-hidden="true" />
        </div>
      )}
    </div>
  );

  const body = (
    <div className="flex items-center gap-3">
      {picture}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.name}</p>
        {/* No entity behind this row means it is not a smart device at all —
            a bike, a lawnmower. It gets a picture and a name and no invented
            state, rather than being filtered out or called "unavailable". */}
        {entityId && (
          <p
            className={`truncate text-xs ${
              state === undefined ? "text-muted-foreground/70 italic" : "text-muted-foreground"
            }`}
          >
            {label}
          </p>
        )}
      </div>
      {isDetail && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </div>
  );

  if (isDetail) {
    return (
      <Card className="p-3">
        <button
          type="button"
          onClick={onDetail}
          className="w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={item.name}
        >
          {body}
        </button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-3">
      {body}

      {entityId && domain !== null && TOGGLE_DOMAINS.has(domain) && (
        <div className="flex items-center justify-end">
          <Switch
            checked={state === "on"}
            disabled={!canDrive}
            onCheckedChange={() => onToggle(entityId, state)}
            aria-label={item.name}
          />
        </div>
      )}

      {entityId && domain === "lock" && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!canDrive}
            onClick={() => onLock(entityId)}
          >
            <Lock className="mr-1.5 size-3.5" aria-hidden="true" />
            {t("lock")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!canDrive}
            onClick={() => onUnlock(entityId)}
          >
            <LockOpen className="mr-1.5 size-3.5" aria-hidden="true" />
            {t("unlock")}
          </Button>
        </div>
      )}

      {entityId && domain === "cover" && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!canDrive}
            onClick={() => onOpen(entityId)}
          >
            <ArrowUp className="mr-1.5 size-3.5" aria-hidden="true" />
            {t("open")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!canDrive}
            onClick={() => onClose(entityId)}
          >
            <ArrowDown className="mr-1.5 size-3.5" aria-hidden="true" />
            {t("close")}
          </Button>
        </div>
      )}
    </Card>
  );
}
