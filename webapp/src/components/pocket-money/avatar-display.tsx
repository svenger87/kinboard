"use client";

import { tierFromBalance } from "@/lib/pocket-money/interest";
import type { AvatarSpecies, AvatarTier } from "@/lib/pocket-money/types";
import { motion } from "framer-motion";

interface Props {
  species: AvatarSpecies;
  /** Current balance — the stage tracks what's in the account now. */
  balanceCents: number;
  /**
   * The stage to show, when the caller has worked it out (avatarStage in
   * lib/pocket-money/points.ts) -- in points mode it does not follow the
   * balance at all.
   */
  tier?: AvatarTier;
  size?: number;
  className?: string;
}

export function AvatarDisplay({ species, balanceCents, tier: given, size = 200, className = "" }: Props) {
  const tier = given ?? tierFromBalance(balanceCents);
  const src = `/pocket-money/avatars/${species}-${tier}.svg`;

  return (
    <motion.img
      key={`${species}-${tier}`}
      src={src}
      width={size}
      height={size}
      alt={`${species} stage ${tier}`}
      className={className}
      initial={{ scale: 0.96, opacity: 0.6 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    />
  );
}
