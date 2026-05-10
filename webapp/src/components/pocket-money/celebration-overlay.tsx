"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type CelebrationKind = "evolution" | "goal-reached" | "interest-pay";

interface Props {
  /** When this changes to a non-null value, the overlay fires the matching animation once. */
  kind: CelebrationKind | null;
  /** Called when the animation finishes; clear `kind` in response. */
  onDone: () => void;
}

const DURATIONS: Record<CelebrationKind, number> = {
  "evolution": 4000,
  "goal-reached": 3000,
  "interest-pay": 3000,
};

export function CelebrationOverlay({ kind, onDone }: Props) {
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

  return (
    <AnimatePresence>
      {active === "evolution" && (
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
