"use client";

import { tierFromBalance } from "@/lib/pocket-money/interest";
import type { AvatarSpecies } from "@/lib/pocket-money/types";
import { motion } from "framer-motion";

interface Props {
  species: AvatarSpecies;
  /** Current balance — the stage tracks what's in the account now. */
  balanceCents: number;
  size?: number;
  className?: string;
}

export function AvatarDisplay({ species, balanceCents, size = 200, className = "" }: Props) {
  const tier = tierFromBalance(balanceCents);
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
