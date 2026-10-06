"use client";
/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AvatarSpecies, AvatarTier } from "@/lib/pocket-money/types";
import {
  classicAvatarSrc,
  classicIsDrawn,
  drawCreature,
  effectiveStyle,
  speciesArt,
  type AvatarStyle,
  type CreatureLook,
  type CreatureMood,
} from "@/lib/pocket-money/creatures";

export interface CreatureAvatarProps {
  species: AvatarSpecies;
  tier: AvatarTier;
  /** The account's avatar_style. Classic, or a species without drawings, shows the classic picture. */
  style?: AvatarStyle | string | null;
  mood?: CreatureMood;
  size?: number;
  /**
   * Idle motion (breathing, blinking, wings, tail). Off for thumbnails: a
   * sheet of eight breathing dragons is eight times the work on a Pi for
   * nothing anyone looks at.
   */
  animated?: boolean;
  /**
   * The child's own avatar: tapping it makes it hop and send up hearts, or,
   * as an egg, shake.
   */
  tappable?: boolean;
  /** Stage 1 only: show the egg cracked (the hatching scene). */
  cracked?: boolean;
  /** Reserved for a child's own choices; resolved in one place (resolveStyle). */
  look?: CreatureLook;
  /** Accessible name; defaults to "<species> stage <tier>". "" marks it decorative (a labelled button around it). */
  label?: string;
  /** For a tappable avatar: the button's accessible name. */
  tapLabel?: string;
  className?: string;
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Restart a one-shot animation class on an element. */
export function replayClass(el: Element | null, cls: string) {
  if (!el) return;
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  el.classList.add(cls);
}

const HEART_COLORS = ["#FF6B8B", "#FFC83D", "#5FD39A", "#56B6E8", "#B58CFF"];

interface Particle {
  id: number;
  left: number;
  top: number;
  dx: number;
  delay: number;
  color: string;
  kind: "heart" | "star";
}

export function ParticleIcon({ kind, color }: { kind: "heart" | "star"; color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {kind === "heart" ? (
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.4h3C14.2 6.1 15.6 5 17.6 5 21 5 23.1 8.4 21.6 11.8 19.5 16.4 12 21 12 21z" fill={color} />
      ) : (
        <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.2l7.1-.6z" fill={color} />
      )}
    </svg>
  );
}

/** Hearts or stars floating up from around (cx, cy), removed once they have faded. */
export function useParticles() {
  const [particles, setParticles] = useState<Particle[]>([]);
  const next = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const burst = useCallback((kind: "heart" | "star", n: number, cx: number, cy: number) => {
    if (prefersReducedMotion()) return;
    const made: Particle[] = Array.from({ length: n }, (_, i) => ({
      id: next.current++,
      left: cx + (Math.random() - 0.5) * 120,
      top: cy + (Math.random() - 0.5) * 40,
      dx: (Math.random() - 0.5) * 80,
      delay: i * 40,
      color: HEART_COLORS[i % HEART_COLORS.length],
      kind,
    }));
    setParticles((p) => [...p, ...made]);
    const ids = new Set(made.map((p) => p.id));
    timers.current.push(setTimeout(() => setParticles((p) => p.filter((x) => !ids.has(x.id))), 1200 + n * 40));
  }, []);
  const layer = (
    <span className="creature-particles" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="creature-particle"
          style={{ left: p.left, top: p.top, animationDelay: `${p.delay}ms`, ["--creature-dx" as string]: `${p.dx}px` }}
        >
          <ParticleIcon kind={p.kind} color={p.color} />
        </span>
      ))}
    </span>
  );
  return { burst, layer };
}

/**
 * A child's pocket-money avatar, in their chosen style.
 *
 * Drawn styles render an inline SVG from lib/pocket-money/creatures; classic,
 * and any species not drawn yet, render the classic picture exactly as before;
 * a species with no classic pictures shows its Gumdrop drawing, still.
 */
export function CreatureAvatar({
  species,
  tier,
  style,
  mood = "happy",
  size = 200,
  animated = true,
  tappable = false,
  cracked = false,
  look,
  label,
  tapLabel,
  className = "",
}: CreatureAvatarProps) {
  // useId's characters (colons, guillemets, underscores depending on the React
  // version) are not all safe inside url(#…); the digits make it unique.
  const uid = `cr${useId().replace(/[^A-Za-z0-9]/g, "")}`;
  const shown = effectiveStyle(species, style);
  const art = speciesArt(species);
  // A creature that only exists drawn has no classic picture: Classic is its
  // Gumdrop drawing, standing still.
  const stillDrawing = classicIsDrawn(species, style);
  const drawnStyle = shown === "classic" ? (stillDrawing ? "gumdrop" : null) : shown;
  const moving = animated && !stillDrawing;
  const name = label ?? `${species} stage ${tier}`;
  // Inside a button that names it (a tappable avatar, a picker option), the
  // picture itself says nothing, or a screen reader reads it twice.
  const decorative = tappable || name === "";
  const bodyRef = useRef<HTMLSpanElement>(null);
  const { burst, layer } = useParticles();

  const picture =
    drawnStyle === null || !art ? (
      <img
        key={`${species}-${tier}`}
        src={classicAvatarSrc(species, tier)}
        width={size}
        height={size}
        alt={decorative ? "" : name}
        className="creature-img-in"
        data-avatar-style="classic"
      />
    ) : (
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : name}
        aria-hidden={decorative ? true : undefined}
        className={`creature-svg${moving ? " creature-animated" : ""}`}
        data-avatar-style={shown}
        data-species={species}
        data-tier={tier}
        overflow="visible"
      >
        {drawCreature({ art, style: drawnStyle, tier, mood, uid, cracked, look })}
      </svg>
    );

  if (!tappable) {
    return (
      <span className={`creature-avatar ${className}`} style={{ width: size, height: size }}>
        {picture}
      </span>
    );
  }

  const onTap = () => {
    if (prefersReducedMotion()) return;
    if (tier === 1) {
      replayClass(bodyRef.current, "creature-shake");
      return;
    }
    replayClass(bodyRef.current, "creature-hop");
    burst("heart", 5, size / 2, size * 0.42);
  };

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={tapLabel ?? name}
      className={`creature-avatar creature-tap ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        ref={bodyRef}
        className="creature-body"
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.classList.remove("creature-hop", "creature-shake");
        }}
      >
        {picture}
      </span>
      {layer}
    </button>
  );
}
