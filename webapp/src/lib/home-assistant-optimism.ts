/**
 * How long a Kinboard surface may show a state it asked for but has not seen
 * confirmed.
 *
 * Lifted out of `app/home-automation/page.tsx`, where the tiles have used it
 * since RFC-007, because the entity detail sheet's sliders and steppers need
 * exactly the same rule and a second copy of the number would let the two
 * surfaces drift apart. One definition, two importers.
 */

/**
 * How often the entity states are re-read while an automation surface is open.
 *
 * Matches the `autoRefreshNote` copy in the footer, which has said "every 15
 * seconds" since long before the RFC-007 rewrite. It is also what bounds the
 * optimistic settle below: a control must never be able to sit on a guessed
 * state for longer than it takes the truth to arrive.
 */
export const POLL_MS = 15_000;

/**
 * How long a control may show a state we asked for but have not seen
 * confirmed.
 *
 * `useCallService` invalidates the entity-state query on success, so the usual
 * reconciliation is immediate. This timeout is for the case that is easy to
 * forget: **the service call returned 200, and the device did nothing.**
 * Without it a tile would show "on" forever for a bulb that never lit, and a
 * slider would read 80% forever for a bulb that stayed at 20% — the reading
 * never *moves*, so "clear the guess when the source changes" can never fire.
 * One poll interval plus headroom, so a merely-slow device still reconciles
 * normally rather than snapping back.
 *
 * There are exactly three ways an optimistic value ends: the source moves, the
 * call fails, or this elapses. A surface that implements fewer than three has
 * a way of being confidently wrong for as long as the panel is on.
 */
export const OPTIMISTIC_SETTLE_MS = POLL_MS + 5_000;
