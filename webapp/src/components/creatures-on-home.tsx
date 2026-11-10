"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CreatureAvatar, useParticles } from "@/components/pocket-money/creature-avatar";
import { useCreatureBedtime, useCreatureMood, useFamilyTimeZone, useMinuteClock } from "@/hooks/use-creature-mood";
import { useCreatures } from "@/hooks/use-creatures";
import { useFestivalLook } from "@/hooks/use-festival";
import { useMotion } from "@/hooks/use-motion";
import { useOwnedItems, usePointTotals } from "@/hooks/use-point-rewards";
import { usePocketMoneyAccounts } from "@/hooks/use-pocket-money-accounts";
import { usePeople } from "@/hooks";
import { useSetting } from "@/hooks/use-supabase-queries";
import { isSleepyTime } from "@/lib/creature-mood";
import { creatureStage } from "@/lib/creatures/stage";
import { creatureChildren } from "@/lib/creatures/surfaces";
import { MINUTE_MS } from "@/lib/minute-clock";
import { classicIsDrawn, effectiveStyle } from "@/lib/pocket-money/creatures";
import { readLook } from "@/lib/pocket-money/creatures/look";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { placeRoamers, poke, pose, stepRoamers, type RoamEvent, type Roamer } from "@/lib/creatures/roam";
import type { Creature, PocketMoneyAccount, Person } from "@/types/database";

/**
 * The children's creatures on Home (Settings -> Creatures -> On Home, off
 * unless switched on): they walk along a floor just above the navigation,
 * rest, hop, play with each other when there are two or more, and at the
 * family's bedtime walk to their spot and lie down until morning. The rules
 * are lib/creatures/roam.ts; this draws them.
 *
 * A wall display's Pi is the measure: the drawings are the widget's, and what
 * moves is one transform per creature, set straight on the element from one
 * animation frame loop (at most 30 a second, stopped while the page is
 * hidden), so nothing re-renders while they walk. The device's animation
 * switch decides: Reduced keeps them standing at their spots (lying down at
 * bedtime), Off leaves them out. Only a creature itself catches a tap: it
 * hops and sends up hearts.
 *
 * Asleep, a drawn creature lies on its side with its eyes closed; a classic
 * picture, which has no moods and so no closed eyes, dozes sitting up
 * (leaning, settled, dimmed) instead of being turned over like a sticker.
 * The drawing's own ground shadow is hidden here: each creature gets one that
 * stays flat on the floor, smaller while it is in the air, longer lying down.
 */
export function CreaturesOnHome() {
  const { data: on } = useSetting<unknown>(SETTINGS_KEYS.creaturesOnHome, false, { refetchInterval: 60_000 });
  const motion = useMotion();
  const { data: people } = usePeople();
  const { data: creatures } = useCreatures();
  const kids = useMemo(() => creatureChildren(people, creatures), [people, creatures]);
  if (on !== true || motion === "off" || kids.length === 0) return null;
  return <CreatureFloor kids={kids} still={motion !== "full"} />;
}

const FRAME_MS = 1000 / 30;
/**
 * A classic picture fills about 94% of its frame and a drawing about three
 * quarters, so at the same size the pictures look bigger (the galaxy most of
 * all, a full square). On Home they are drawn at this share of the size.
 */
const PICTURE_SCALE = 0.8;

interface FloorProps {
  kids: Array<{ person: Person; creature: Creature }>;
  still: boolean;
}

function CreatureFloor({ kids, still }: FloorProps) {
  const t = useTranslations("creaturesOnHome");
  const floorRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const size = Math.round(Math.min(72, Math.max(50, width / 18)));
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const { totalsFor } = usePointTotals();

  // The family's bedtime, on the family's clock, read again each minute.
  const minute = useMinuteClock();
  const timeZone = useFamilyTimeZone();
  const bedtime = useCreatureBedtime();
  const bedtimeNow = minute !== 0 && isSleepyTime(new Date(minute * MINUTE_MS), timeZone, bedtime);

  const cast = useMemo(
    () =>
      kids.map(({ person, creature }) => {
        const account = accounts.find((a) => a.person_id === person.id);
        const stage = creatureStage({ creature, account, earnedPoints: totalsFor(person.id).earned });
        return { person, creature, account, tier: stage.tier };
      }),
    [kids, accounts, totalsFor],
  );
  const castKey = cast.map((c) => `${c.person.id}:${c.tier === 1 ? "egg" : "up"}`).join(",");

  const roamers = useRef<Roamer[]>([]);
  const elements = useRef(new Map<string, { outer: HTMLElement; inner: HTMLElement; shadow: HTMLElement }>());
  const bursts = useRef(new Map<string, (count: number) => void>());
  const [lying, setLying] = useState<ReadonlySet<string>>(new Set());
  const lyingRef = useRef<ReadonlySet<string>>(new Set());
  const sleepingRef = useRef<ReadonlySet<string>>(new Set());
  sleepingRef.current = bedtimeNow ? new Set(cast.map((c) => c.person.id)) : new Set();

  useEffect(() => {
    const el = floorRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Who is on the floor: placed again when a child is added or removed, or an egg hatches.
  useEffect(() => {
    if (width === 0) return;
    roamers.current = placeRoamers(
      cast.map((c) => ({ id: c.person.id, egg: c.tier === 1 })),
      { width, size, now: performance.now() },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castKey, width, size]);

  const show = useCallback(
    (events: RoamEvent[]) => {
      for (const e of events) {
        // The hearts go up from the creature nearest to where they belong.
        let near: Roamer | undefined;
        for (const r of roamers.current) if (!near || Math.abs(r.x - e.x) < Math.abs(near.x - e.x)) near = r;
        if (near) bursts.current.get(near.id)?.(e.count);
      }
    },
    [],
  );

  const draw = useCallback(
    (now: number) => {
      const nextLying = new Set<string>();
      for (const r of roamers.current) {
        const el = elements.current.get(r.id);
        if (!el) continue;
        const p = still ? { lift: 0, tilt: 0, lying: r.state === "asleep" } : pose(r, now, size);
        // Lying down and getting up take 0.7 s.
        const k = r.state === "asleep" ? Math.min(1, (now - r.since) / 700) : r.state === "waking" ? Math.max(0, 1 - (now - r.since) / 700) : 0;
        const ready = still ? (p.lying ? 1 : 0) : k;
        if (ready > 0.5) nextLying.add(r.id);
        const left = (r.x - size / 2).toFixed(1);
        const picture = el.outer.dataset.art === "picture";
        el.outer.style.transform = `translate3d(${left}px, ${(-p.lift).toFixed(1)}px, 0)`;
        el.inner.style.transform = r.egg
          ? // An egg sleeps where it stands: it just stops wobbling (and dims, in CSS).
            `scaleX(${r.dir}) rotate(${p.tilt.toFixed(1)}deg)`
          : picture
          ? // Dozing sitting up: leaning over a little and settled down.
            `scaleX(${r.dir}) rotate(${(-12 * ready + p.tilt).toFixed(1)}deg) scaleY(${(1 - 0.08 * ready).toFixed(3)})`
          : // On its side: turned about its feet, moved back over its spot and down onto the floor.
            `scaleX(${r.dir}) translate(${(ready * size * 0.5).toFixed(1)}px, ${(-ready * size * 0.36).toFixed(1)}px) ` +
            `rotate(${(-90 * ready + p.tilt).toFixed(1)}deg)`;
        // The shadow stays on the floor: smaller and fainter in the air, longer lying down.
        const air = Math.min(1, p.lift / (size * 0.4));
        const stretch = (picture ? PICTURE_SCALE : 1) * (1 - 0.45 * air) + (picture || r.egg ? 0 : 0.35 * ready);
        el.shadow.style.transform = `translate3d(${left}px, 0, 0) scaleX(${stretch.toFixed(3)})`;
        el.shadow.style.opacity = (1 - 0.6 * air).toFixed(2);
        if (el.outer.dataset.state !== r.state) el.outer.dataset.state = r.state;
        const dir = String(r.dir);
        if (el.outer.dataset.dir !== dir) el.outer.dataset.dir = dir;
      }
      const prev = lyingRef.current;
      if (nextLying.size !== prev.size || [...nextLying].some((id) => !prev.has(id))) {
        lyingRef.current = nextLying;
        setLying(nextLying);
      }
    },
    [size, still],
  );

  // The loop: a step and a frame at most 30 times a second; none while hidden.
  useEffect(() => {
    if (width === 0) return;
    let raf = 0;
    let last = performance.now();
    let random = Math.random;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      const dt = Math.min(100, now - last);
      last = now;
      if (!still) {
        const { roamers: next, events } = stepRoamers(
          roamers.current,
          { width, size, now, sleeping: sleepingRef.current },
          dt,
          random,
        );
        roamers.current = next;
        if (events.length) show(events);
      } else {
        // Standing still: only bedtime changes anything.
        roamers.current = roamers.current.map((r) => {
          const asleep = sleepingRef.current.has(r.id);
          if (asleep && r.state !== "asleep") return { ...r, state: "asleep", since: now };
          if (!asleep && r.state === "asleep") return { ...r, state: r.egg ? "egg" : "idle", since: now };
          return r;
        });
      }
      draw(now);
    };
    const start = () => {
      if (!raf && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    random = Math.random;
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [width, size, still, draw, show]);

  const tap = useCallback((id: string) => {
    const { roamers: next, events } = poke(roamers.current, id, performance.now());
    roamers.current = next;
    show(events);
  }, [show]);

  return (
    <div
      ref={floorRef}
      className="creature-floor pointer-events-none fixed inset-x-0 z-[15]"
      style={{ bottom: "var(--nav-spacing, 0px)", height: Math.round(size * 1.6) }}
      data-testid="home-creatures"
      data-count={cast.length}
      aria-label={t("aria")}
      role="group"
    >
      {width > 0 &&
        cast.map((c) => (
          <FloorCreature
            key={c.person.id}
            person={c.person}
            creature={c.creature}
            tier={c.tier}
            size={size}
            lying={lying.has(c.person.id)}
            still={still}
            register={(outer, inner, shadow) => {
              if (outer && inner && shadow) elements.current.set(c.person.id, { outer, inner, shadow });
              else elements.current.delete(c.person.id);
            }}
            registerBurst={(fn) => {
              if (fn) bursts.current.set(c.person.id, fn);
              else bursts.current.delete(c.person.id);
            }}
            onTap={() => tap(c.person.id)}
          />
        ))}
    </div>
  );
}

function FloorCreature({
  person,
  creature,
  tier,
  size,
  lying,
  still,
  register,
  registerBurst,
  onTap,
}: {
  person: Person;
  creature: Creature;
  tier: number;
  size: number;
  lying: boolean;
  still: boolean;
  register: (outer: HTMLElement | null, inner: HTMLElement | null, shadow: HTMLElement | null) => void;
  registerBurst: (fn: ((count: number) => void) | null) => void;
  onTap: () => void;
}) {
  const t = useTranslations("creaturesOnHome");
  const tPM = useTranslations("pocketMoney");
  const mood = useCreatureMood(person.id);
  const { ownedFor } = useOwnedItems();
  const festive = useFestivalLook();
  const look = festive(readLook(creature.look, ownedFor(person.id)));
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLSpanElement>(null);
  const { burst, layer } = useParticles();
  // A classic picture, as CreatureAvatar shows it: no moods, so it dozes instead of lying down.
  const picture = effectiveStyle(creature.species, creature.style) === "classic" && !classicIsDrawn(creature.species, creature.style);

  useEffect(() => {
    register(outer.current, inner.current, shadow.current);
    return () => register(null, null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    registerBurst((count) => burst("heart", count, size / 2, size * 0.2));
    return () => registerBurst(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst, size]);

  // Eyes closed only once lying down: walking to bed it is still awake.
  const shownMood = lying ? "sleepy" : mood === "sleepy" ? "normal" : mood;
  const stageName = tPM(`species.${creature.species}.tier${tier}` as never);

  return (
    <>
      <span
        ref={shadow}
        className="home-creature-shadow absolute left-0 will-change-transform"
        style={{ width: size, bottom: Math.round(size * 0.03), height: Math.round(size * 0.1) }}
        aria-hidden="true"
      />
      <div
        ref={outer}
        className="home-creature absolute bottom-0 left-0 will-change-transform"
        style={{ width: size, height: size, ["--home-creature-size" as string]: `${size}px` }}
        data-testid="home-creature"
        data-person={person.id}
        data-art={picture ? "picture" : "drawn"}
        data-egg={tier === 1 ? "true" : "false"}
        data-lying={lying ? "true" : "false"}
      >
        <div ref={inner} className="home-creature-body size-full" style={{ transformOrigin: "50% 100%" }}>
          <button
            type="button"
            className="pointer-events-auto flex size-full items-end justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50"
            aria-label={t("tapAria", { name: person.name })}
            onClick={onTap}
          >
            <CreatureAvatar
              species={creature.species}
              tier={tier as never}
              style={creature.style}
              look={look}
              mood={shownMood}
              size={picture ? Math.round(size * PICTURE_SCALE) : size}
              animated={!still && !lying}
              label=""
            />
          </button>
        </div>
        {lying && (
          <span className="home-creature-zzz" aria-hidden="true">
            <span>z</span>
            <span>z</span>
          </span>
        )}
        {layer}
      </div>
    </>
  );
}
