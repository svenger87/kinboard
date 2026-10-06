"use client";
/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.

import { useEffect, useRef } from "react";
import {
  CreatureAvatar,
  ParticleIcon,
  prefersReducedMotion,
  replayClass,
  useParticles,
  type CreatureAvatarProps,
} from "./creature-avatar";
import { HatchingScene } from "./celebration-overlay";
import { useCreatureReaction } from "@/stores/creature-reactions";
import type { StageUp } from "@/lib/pocket-money/creature-reactions";

interface Props extends CreatureAvatarProps {
  /** The child whose ticks this creature cheers for. */
  personId: string;
  /**
   * Play a stage-up in place, as a small hatching (the dashboard widget).
   * Without it the creature only hops, and `onStageUp` is the page's to show.
   */
  compactStageUp?: boolean;
  /** A tick carried the child into a new stage (the pocket-money page's celebration). */
  onStageUp?: (stageUp: StageUp) => void;
}

/**
 * A child's creature that cheers when one of their tasks is ticked off, on
 * this screen or any other (stores/creature-reactions.ts): it hops in a burst
 * of stars -- hearts for a task worth no points -- under a rising "+N ⭐".
 *
 * A one-shot. `animated` is the avatar's own setting the rest of the time:
 * the dashboard widget passes false so a wall display's Pi stays idle, and
 * the creature moves only for the reaction's second and a half. With reduced
 * motion there is no hop, no particles and no idle motion, only the label,
 * fading.
 */
export function ReactingCreature({ personId, compactStageUp = false, onStageUp, ...avatar }: Props) {
  const reaction = useCreatureReaction(personId);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const { burst, layer } = useParticles();
  const size = avatar.size ?? 200;
  const reduce = reaction ? prefersReducedMotion() : false;
  const hatching = Boolean(reaction?.stageUp && compactStageUp && !reduce);

  // The latest callback without replaying a reaction when it changes.
  const onStageUpRef = useRef(onStageUp);
  useEffect(() => {
    onStageUpRef.current = onStageUp;
  }, [onStageUp]);

  useEffect(() => {
    if (!reaction) return;
    if (reaction.stageUp) onStageUpRef.current?.(reaction.stageUp);
    if (prefersReducedMotion() || (reaction.stageUp && compactStageUp)) return;
    replayClass(bodyRef.current, "creature-hop");
    burst(reaction.points > 0 ? "star" : "heart", 6, size / 2, size * 0.42);
    // One reaction, played once: keyed on its id alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reaction?.id]);

  return (
    <span
      className={`creature-reaction ${avatar.className ?? ""}`}
      style={{ width: size, height: size }}
      data-testid="creature-reaction-host"
      data-reacting={reaction ? "true" : undefined}
    >
      <span
        ref={bodyRef}
        className="creature-body"
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.classList.remove("creature-hop");
        }}
      >
        {hatching && reaction?.stageUp ? (
          <HatchingScene
            key={reaction.id}
            species={avatar.species}
            style={avatar.style}
            look={avatar.look}
            from={reaction.stageUp.from}
            to={reaction.stageUp.to}
            size={size}
            stars={6}
          />
        ) : (
          <CreatureAvatar {...avatar} className="" animated={Boolean(avatar.animated ?? true) || (Boolean(reaction) && !reduce)} />
        )}
      </span>
      {reaction && (
        <span
          key={reaction.id}
          className="creature-reaction-label"
          data-testid="creature-reaction"
          aria-hidden="true"
          style={{ fontSize: Math.min(28, Math.max(13, Math.round(size * 0.2))) }}
        >
          {reaction.points > 0 ? (
            `+${reaction.points} ⭐`
          ) : (
            <ParticleIcon kind="heart" color="#FF6B8B" />
          )}
        </span>
      )}
      {layer}
    </span>
  );
}
