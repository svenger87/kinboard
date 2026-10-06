"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AvatarSpecies, AvatarTier } from "@/lib/pocket-money/types";
import { effectiveStyle } from "@/lib/pocket-money/creatures";
import { CreatureAvatar, useParticles } from "./creature-avatar";
import type { CreatureLook } from "@/lib/pocket-money/creatures/look";

type CelebrationKind = "evolution" | "goal-reached" | "interest-pay";

interface Props {
  /** When this changes to a non-null value, the overlay fires the matching animation once. */
  kind: CelebrationKind | null;
  /** Called when the animation finishes; clear `kind` in response. */
  onDone: () => void;
  /**
   * The child's avatar and the stages it grew between. In a drawn look the
   * promotion plays as a hatching scene; classic keeps the glow below.
   */
  creature?: {
    species: AvatarSpecies;
    style: string | null | undefined;
    look?: CreatureLook;
    from: number;
    to: number;
  };
}

const DURATIONS: Record<CelebrationKind, number> = {
  "evolution": 4000,
  "goal-reached": 3000,
  "interest-pay": 3000,
};

export function CelebrationOverlay({ kind, onDone, creature }: Props) {
  const [active, setActive] = useState<CelebrationKind | null>(null);

  useEffect(() => {
    if (!kind) return;
    setActive(kind);
    const t = setTimeout(() => {
      setActive(null);
      onDone();
    }, DURATIONS[kind]);
    return () => clearTimeout(t);
  }, [kind, onDone]);

  const drawn = creature && effectiveStyle(creature.species, creature.style) !== "classic" ? creature : null;

  return (
    <AnimatePresence>
      {active === "evolution" && drawn && (
        <motion.div
          key="hatching"
          data-testid="hatching-scene"
          className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center bg-background/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <HatchingScene {...drawn} />
        </motion.div>
      )}

      {active === "evolution" && !drawn && (
        <motion.div
          key="evolution"
          className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0"
            initial={{ scale: 0 }}
            animate={{ scale: 4, opacity: 0 }}
            transition={{ duration: 1.5, ease: "easeOut" }}
            style={{
              background: "radial-gradient(circle, hsl(var(--month-primary) / 0.5), transparent 70%)",
            }}
          />
        </motion.div>
      )}

      {active === "goal-reached" && (
        <motion.div
          key="goal"
          className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.img
            src="/pocket-money/animations/trophy.svg"
            alt=""
            width={200}
            height={200}
            initial={{ y: -200, rotate: -30, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 12 }}
          />
        </motion.div>
      )}

      {active === "interest-pay" && (
        <motion.div
          key="coins"
          className="fixed inset-0 z-[200] pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <motion.img
              key={i}
              src="/pocket-money/animations/coin.svg"
              alt=""
              width={40}
              height={40}
              className="absolute"
              initial={{ x: `${Math.random() * 100}vw`, y: -50, rotate: 0 }}
              animate={{ y: "110vh", rotate: 360 + Math.random() * 360 }}
              transition={{
                duration: 2.5 + Math.random() * 1,
                delay: Math.random() * 0.5,
                ease: "easeIn",
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const clampTier = (n: number): AvatarTier => Math.min(8, Math.max(1, Math.floor(n) || 1)) as AvatarTier;

type Phase = "egg" | "cracked" | "old" | "new";

/**
 * The approved prototype's growing sequence. From the egg: it shakes, cracks
 * and shakes again, then the new stage pops out. From any other stage: a
 * flash, the old one shrinks away, the new one pops. Stars burst either way.
 * With reduced motion it simply shows the new stage.
 */
function HatchingScene({ species, style, look, from, to }: NonNullable<Props["creature"]>) {
  const toTier = clampTier(to);
  const fromTier = from < toTier ? clampTier(from) : clampTier(toTier - 1);
  const fromEgg = fromTier === 1;
  // Only ever mounted on the client, after a promotion: matchMedia is there.
  const [reduce] = useState(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  const [phase, setPhase] = useState<Phase>(reduce ? "new" : fromEgg ? "egg" : "old");
  const { burst, layer } = useParticles();
  const size = 260;

  useEffect(() => {
    if (reduce) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const arrive = () => {
      setPhase("new");
      burst("star", 10, size / 2, size * 0.42);
    };
    if (fromEgg) {
      timers.push(setTimeout(() => setPhase("cracked"), 900));
      timers.push(setTimeout(arrive, 1800));
    } else {
      timers.push(setTimeout(arrive, 380));
    }
    return () => timers.forEach(clearTimeout);
  }, [fromEgg, burst, reduce]);

  const tier = phase === "new" ? toTier : fromTier;
  const motionClass =
    phase === "egg" || phase === "cracked" ? "creature-shake" : phase === "old" ? "creature-grow-out" : "creature-pop";

  return (
    <div className="relative" style={{ width: size, height: size }} data-phase={phase}>
      {phase === "old" && <span className="creature-flash" aria-hidden="true" />}
      {/* A new key per phase remounts the body, which starts its one-shot animation. */}
      <span key={phase} className={`creature-body ${motionClass}`}>
        <CreatureAvatar
          species={species}
          tier={tier}
          style={style}
          look={look}
          size={size}
          cracked={phase === "cracked"}
          label=""
        />
      </span>
      {layer}
    </div>
  );
}
