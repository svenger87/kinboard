"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
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
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useHomeAssistantStatus,
  useHomeAssistantEntityStates,
  useToggleEntity,
  useLockControl,
  useCoverControl,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import { useRooms } from "@/hooks/use-rooms-table";
import { useCatalogue } from "@/hooks/use-catalogue";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { iconFor } from "@/components/home-assistant/room-icon";
import { EntityDetailSheet } from "@/components/home-assistant/entity-detail-sheet";
import { useDangerousActionRunner } from "@/components/home-assistant/dangerous-action-gate";
import { isRestingUnknown, restingUnknownCopyKey } from "@/lib/ha-entity-display";
import { dangerousAction } from "@/lib/ha-dangerous-actions";
/*
  The optimistic-settle rule now lives in `lib/home-assistant-optimism.ts`:
  the detail sheet's sliders and steppers need the same three exits the tiles
  have, and two copies of the number would drift.
*/
import { OPTIMISTIC_SETTLE_MS, POLL_MS } from "@/lib/home-assistant-optimism";
import type { CatalogueItem, Room } from "@/types/database";
import type { HAEntity, HAServiceCall } from "@/types/home-assistant";

/** Domains whose tile is a plain on/off switch. */
const TOGGLE_DOMAINS = new Set(["light", "switch", "input_boolean", "fan"]);

/**
 * Domains with too many meaningful actions for one tap to be unambiguous, so
 * the tile carries no inline control at all and the detail sheet is the whole
 * interaction: there is no honest guess between play and pause, heat and cool,
 * or start and dock.
 *
 * **This is not the set of tappable tiles.** It used to be — before RFC-008
 * these three were the only rows a household could open — and reading it that
 * way now is the trap this comment exists for. Every catalogue row with an
 * `entity_id` opens {@link EntityDetailSheet}; a `sensor` has no inline control
 * either and is deliberately not listed here, because for a sensor that is not
 * a decision anybody took, it is just a domain with nothing to drive.
 */
const SHEET_ONLY_DOMAINS = new Set(["media_player", "climate", "vacuum"]);

/**
 * Which control, if any, this tile carries beside its name.
 *
 * `null` means the sheet is the whole interaction. {@link SHEET_ONLY_DOMAINS}
 * is consulted first so that the three rich domains stay control-free even if
 * one of them is later added to a control set above — their tiles are quiet by
 * decision, not by omission.
 */
function inlineControlFor(domain: string | null): "toggle" | "lock" | "cover" | null {
  if (domain === null || SHEET_ONLY_DOMAINS.has(domain)) return null;
  if (TOGGLE_DOMAINS.has(domain)) return "toggle";
  if (domain === "lock" || domain === "cover") return domain;
  return null;
}

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
 * One function, three call sites — the toggle, the lock pair and the cover
 * pair. It is a helper rather than a repeated predicate because the repeated
 * predicate is how the lock and cover tiles came to be missing half of it
 * while the toggle three lines above them had it.
 *
 * RFC-008 R1: the domains whose resting state is legitimately `unknown` are
 * exempt, and the list of them is shared with the detail sheet's own gate
 * rather than written out twice — see {@link isRestingUnknown}. `unavailable`
 * is exempt from nothing.
 */
function hasReading(domain: string | null, state: string | undefined): boolean {
  if (domain !== null && isRestingUnknown(domain, state)) return true;
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
  /**
   * A tile flips the moment it is tapped, then reconciles.
   *
   * Three exits, the same three the detail sheet's `usePendingNumber` has: the
   * source moves, the call fails, or `OPTIMISTIC_SETTLE_MS` passes without
   * either. Fewer than three is a way of being confidently wrong for as long as
   * the panel is on.
   *
   * `seen` is what the poll said when the guess was made, and it is what makes
   * the first exit correct. "Clear when the poll agrees with the guess" is not
   * the same rule and is subtly weaker: tap Unlock on a tile, then Lock from
   * that entity's own detail sheet. Home Assistant unlocks and re-locks inside
   * one poll interval, so the next reading is `locked` — equal to neither the
   * guess nor, under an equality rule, anything that clears it. The tile then
   * says "Unlocked" for the full timeout about a door that is shut.
   *
   * Which is why `seen` carries `last_changed` and not only the state. Home
   * Assistant moves that timestamp on every state change, so a device that went
   * away and came back is distinguishable from one that never moved — and "the
   * device never moved" is precisely the case the settle exists for. Comparing
   * states alone cannot tell those two apart.
   */
  const [optimistic, setOptimistic] = useState<
    Record<string, { expected: string; seen: { state?: string; changedAt?: string } }>
  >({});
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
    (entityId: string, expected: string, seen: { state?: string; changedAt?: string }) => {
      setOptimistic((prev) => ({ ...prev, [entityId]: { expected, seen } }));
      if (timers.current[entityId]) clearTimeout(timers.current[entityId]);
      timers.current[entityId] = setTimeout(() => forget(entityId), OPTIMISTIC_SETTLE_MS);
    },
    [forget]
  );

  // Reconcile against the poll: an entity whose reading has moved at all — to
  // what we asked for, to something else, or away and back again — no longer
  // needs a guess in front of it.
  useEffect(() => {
    const settled = entities
      .filter((e) => {
        const guess = optimistic[e.entity_id];
        if (guess === undefined) return false;
        return e.state !== guess.seen.state || e.last_changed !== guess.seen.changedAt;
      })
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
  const { lock } = useLockControl();
  const { open: openCover, close: closeCover } = useCoverControl();


  /**
   * The §6 confirmation, on the tiles as well as in the sheet.
   *
   * One runner for the whole page rather than one per tile: the dialog is a
   * modal and only one question can be on screen anyway. Before this, the
   * sheet's Unlock asked and the tile's Unlock — the same service, half an inch
   * to the left — did not, so the confirmation only guarded the longer route.
   * `run` below goes through it, which is why no control on this page calls a
   * hook directly any more.
   */
  const { run: runGuarded, dialog: confirmDialog } = useDangerousActionRunner();

  /**
   * Drive one control.
   *
   * `expected` is the state the tile should show while we wait for the poll
   * to agree — or `null` for an action whose result is not a state we can
   * name in advance.
   *
   * `call` is the service descriptor, not a thunk: it is what the §6 lookup
   * reads, and stating it is the only way to call anything. `via` is the
   * convenience hook where one exists — except for a service §6 names, which
   * sends the descriptor itself so that the call confirmed and the call sent
   * are one object.
   *
   * A refusal *and* a dismissal both come back `false`, and both drop the
   * guess: nothing was sent in the second case, so keeping it would be showing
   * a state nobody agreed to. The failure toast belongs to the runner, so there
   * is not a second one here.
   *
   * **A question on screen is not a decision.** For an action §6 confirms, the
   * guess waits for the answer. Flipping the tile the moment the button is
   * pressed would put "Unlocked" under a dialog still asking whether to unlock
   * — the panel answering on the household's behalf, and reading wrong for as
   * long as they think about it. Everything else keeps the immediate flip,
   * because there is nothing to wait for.
   *
   * `seen` is still read *before* the call, not after: it is the reading the
   * guess is being measured against, and by the time a confirmed call returns
   * the poll may already have moved.
   */
  const run = useCallback(
    async (
      entityId: string,
      expected: string | null,
      call: HAServiceCall,
      displayName: string,
      via?: () => Promise<void>
    ) => {
      const polled = stateByEntity.get(entityId);
      const seen = { state: polled?.state, changedAt: polled?.last_changed };
      const asksFirst = dangerousAction(call) !== undefined;
      if (expected !== null && !asksFirst) expectState(entityId, expected, seen);
      const fired = await runGuarded(call, via, displayName);
      if (!fired) forget(entityId);
      else if (expected !== null && asksFirst) expectState(entityId, expected, seen);
    },
    [expectState, forget, runGuarded, stateByEntity]
  );

  /**
   * The state a tile shows: the guess if we are holding one, otherwise the
   * poll, otherwise nothing at all. `undefined` means "we do not know", which
   * is what the page renders as "Not reachable" — never as "off".
   */
  const displayState = useCallback(
    (entityId: string): string | undefined => {
      const guess = optimistic[entityId];
      if (guess !== undefined) return guess.expected;
      const entity = stateByEntity.get(entityId);
      if (!entity || NO_READING.has(entity.state)) return undefined;
      return entity.state;
    },
    [optimistic, stateByEntity]
  );

  /** Human wording for a raw Home Assistant state, per domain. */
  const labelFor = useCallback(
    (entityId: string, state: string | undefined, entity: HAEntity | undefined): string => {
      const domain = domainOf(entityId);
      if (state === undefined) {
        /*
          RFC-008 R1, on the tile as well as in the sheet. `displayState` has
          already folded `unknown` into "no reading", which for a scene after a
          Home Assistant restart — every scene in the house — is not "we cannot
          reach it" but "nobody has run it yet". Saying "Not reachable" here
          while the sheet one tap away says "Not activated yet" is the same
          entity described two ways on one screen.

          `entity === undefined` means the poll does not carry it at all, which
          really is out of reach; `isRestingUnknown` also refuses `unavailable`.
        */
        if (entity && isRestingUnknown(domain, entity.state)) {
          return tDetail(restingUnknownCopyKey(domain));
        }
        return t("unavailable");
      }
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
    [t, tDetail, tState, tCover, tLock, tMedia, tVacuum, tHvac]
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

  // ── Detail sheet ────────────────────────────────────────────────────────
  /**
   * The catalogue row whose sheet is open, or `null`.
   *
   * The *row*, not the entity: the sheet is headed with the household's own
   * name for the thing and their own photograph of it, and both of those live
   * in the catalogue rather than in Home Assistant. A row with no `entity_id`
   * can never get here — it is a bike or a lawnmower, and there is nothing to
   * open.
   */
  const [detailFor, setDetailFor] = useState<WithEntity | null>(null);

  /**
   * The entity the sheet reads, with this page's optimistic guess in front of
   * it.
   *
   * Two things it must not do. It must not disagree with the tile that opened
   * it: flip a lamp on and tap it within the settle, and a sheet reading the
   * raw poll would say "Off" underneath a tile saying "On" about the same lamp
   * on the same screen. And it must not refuse to open — an entity Home
   * Assistant has never reported (nothing configured, the instance down, an
   * `entity_id` nobody fixed after renaming it) still has a name and a picture
   * worth showing, so it opens as `unavailable`, which is the honest reading
   * and the one the sheet's own gate answers by offering no controls at all.
   */
  const detailEntity = useMemo((): HAEntity | null => {
    if (!detailFor) return null;
    const polled = stateByEntity.get(detailFor.entity_id);
    if (!polled) {
      return {
        entity_id: detailFor.entity_id,
        domain: domainOf(detailFor.entity_id),
        name: detailFor.name,
        state: "unavailable",
        attributes: {},
        // Empty, not `now`: we have never had a reading for this entity, so
        // there is no moment it last changed. The sheet omits the line rather
        // than dating our own ignorance to this second.
        last_changed: "",
      };
    }
    const guess = optimistic[detailFor.entity_id];
    return guess === undefined ? polled : { ...polled, state: guess.expected };
  }, [detailFor, stateByEntity, optimistic]);

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
      /*
        Every control states the service it calls, exactly as the sheet's
        controls do, because that descriptor is what the §6 lookup reads. The
        convenience hook comes second where one exists — except for `unlock`,
        which §6 names: that one sends the descriptor itself, so the call that
        was confirmed and the call that goes out are one object.
      */
      onToggle={(entityId, current) =>
        void run(
          entityId,
          current === "on" ? "off" : "on",
          {
            domain: domainOf(entityId),
            service: current === "on" ? "turn_off" : "turn_on",
            entity_id: entityId,
          },
          item.name,
          () => toggle(entityId, current ?? "off")
        )
      }
      onLock={(entityId) =>
        void run(
          entityId,
          "locked",
          { domain: "lock", service: "lock", entity_id: entityId },
          item.name,
          () => lock(entityId)
        )
      }
      onUnlock={(entityId) =>
        void run(
          entityId,
          "unlocked",
          { domain: "lock", service: "unlock", entity_id: entityId },
          item.name
        )
      }
      onOpen={(entityId) =>
        void run(
          entityId,
          "open",
          { domain: "cover", service: "open_cover", entity_id: entityId },
          item.name,
          () => openCover(entityId)
        )
      }
      onClose={(entityId) =>
        void run(
          entityId,
          "closed",
          { domain: "cover", service: "close_cover", entity_id: entityId },
          item.name,
          () => closeCover(entityId)
        )
      }
      onDetail={hasEntity(item) ? () => setDetailFor(item) : undefined}
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
        The detail sheet, opened by any tile with an entity behind it.

        This replaces the sheet that used to live inline here — a state line, a
        handful of hard-coded media and vacuum buttons and a raw dump of
        `Object.entries(attributes)`, reachable from three domains. RFC-008
        §4.5: every entity-backed tile opens the same rich sheet, which brings
        its own per-domain controls, an honest 24h history and the confirmations
        of §6. The household's name and photograph come from the catalogue row;
        everything else comes from the entity.

        Mounted only while a row is chosen, so the sheet's history query — keyed
        on the entity — never runs for a sheet nobody has opened.
      */}
      {/*
        The §6 question, for whichever tile control raised it. One dialog for
        the whole page — see `useDangerousActionRunner` above.
      */}
      {confirmDialog}

      {detailFor && detailEntity && (
        <EntityDetailSheet
          open
          onOpenChange={(open) => {
            if (!open) setDetailFor(null);
          }}
          entity={detailEntity}
          displayName={detailFor.name}
          imageUrl={detailFor.image_url ?? undefined}
        />
      )}
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
  /** Absent for a catalogue row with no entity behind it — there is nothing to open. */
  onDetail?: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const entityId = item.entity_id;
  const domain = entityId ? domainOf(entityId) : null;
  const inlineControl = inlineControlFor(domain);
  /**
   * Every control on this tile is gated on the same thing: Home Assistant is
   * reachable *and* is currently reporting a state for this device. The
   * second half is not optional — see `hasReading`.
   */
  const canDrive = !controlsDisabled && hasReading(domain, state);

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
      {onDetail && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </div>
  );

  return (
    <Card className="flex flex-col gap-3 p-3">
      {/*
        The name, the picture and the reading open the detail sheet; the
        controls below stay on the tile.

        A button rather than a click handler on the Card, and the controls as
        its *siblings* rather than inside it: a `<button>` inside a `<button>`
        is invalid HTML and the inner one stops working in some engines, which
        is how "the light switch does nothing on the wall panel" gets reported.
        A row with no entity behind it is not a smart device at all and gets no
        button — it keeps its picture and its name and opens nothing.
      */}
      {onDetail ? (
        <button
          type="button"
          onClick={onDetail}
          className="w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={item.name}
        >
          {body}
        </button>
      ) : (
        body
      )}

      {entityId && inlineControl === "toggle" && (
        <div className="flex items-center justify-end">
          <Switch
            checked={state === "on"}
            disabled={!canDrive}
            onCheckedChange={() => onToggle(entityId, state)}
            aria-label={item.name}
          />
        </div>
      )}

      {entityId && inlineControl === "lock" && (
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

      {entityId && inlineControl === "cover" && (
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
