/**
 * The Home Assistant services that ask before they fire — RFC-008 §6.
 *
 * This screen is a wall panel. It has no login, no per-person identity, and a
 * child can reach it. A handful of the services the detail sheet offers are
 * therefore not like the others: unlocking the front door, throwing a latch
 * that locking again does not retract, disarming the alarm, waking the street
 * with a siren, pressing a button whose meaning the sheet genuinely cannot
 * know, installing firmware, starting blades in a garden.
 *
 * **Why a table and not seven dialogs.** A confirmation written next to the
 * button it guards is exactly as forgettable as no confirmation at all: the
 * eighth dangerous action, added by somebody in six months, simply does not
 * get one, and nothing anywhere says so. So the declaration lives here, keyed
 * by the service, and `entity-actions.tsx` routes *every* action — dangerous
 * or not — through one `run()` that consults this table. An author does not
 * opt in to the confirmation; they state which service they are calling,
 * because that is the only way to call anything, and the table decides. The
 * dialog is one component, mounted once by the dispatcher.
 *
 * **What that does and does not guarantee.** For a service named here, the
 * confirmation cannot be forgotten: it arrives from the lookup, and the author
 * of the control does nothing to get it. For a service *not* named here — a
 * `lock.lock_all` somebody adds next year — `dangerousAction` returns
 * `undefined` and the call fires unconfirmed. The omission is not eliminated;
 * it is moved, from an invisible missing wrapper in a 1700-line component to
 * one missing line in this file, whose whole subject is that question. Judge a
 * new dangerous control against this list; do not assume the mechanism has
 * already thought about it.
 *
 * **Rows for actions that do not exist yet.** `siren`, `button`,
 * `input_button`, `update` and `lawn_mower` are not implemented in this branch
 * — RFC-008 §4.5 puts them in the long tail. Their rows are here anyway, with
 * their copy, so that the branch which adds those controls cannot ship them
 * bare: the moment it writes `run({ domain: "siren", service: "turn_on", … })`
 * the confirmation is already in front of it. Registering a row costs one line
 * and forgetting one costs a household its front door.
 *
 * What is deliberately *not* here is as much of the decision as what is:
 * `vacuum.start` and `cover.open_cover` on a garage move real machinery, but
 * visibly, slowly and reversibly from the same screen, so RFC-008 §6 asks for
 * no confirmation and the friction would cost more than it buys. `lock.lock`
 * is not here either — confirming your way to a locked door every time is
 * friction with no safety benefit.
 */

export interface DangerousAction {
  /**
   * Where the wording lives, under `homeAutomation.entityDetail.confirm`.
   *
   * `<copy>.title` and `<copy>.body` both take `{name}` — the entity's own
   * display name. "Unlock Front door?", never "Are you sure?": this sheet is a
   * modal over a room full of tiles and a household has several locks.
   */
  copy: string;
  /**
   * The confirm button's label, as a key path rooted at `homeAutomation`.
   *
   * A path rather than a string so the button can reuse the label the action's
   * own control already carries — `unlock`, `entityDetail.openLatch`,
   * `entityDetail.disarmButton` — instead of growing a synonym beside it.
   */
  confirmLabelKey: string;
}

/**
 * Every service RFC-008 §6 asks a household to confirm, keyed `domain.service`.
 *
 * The order is the matrix's order.
 */
export const DANGEROUS_ACTIONS: Readonly<Record<string, DangerousAction>> = {
  "lock.unlock": { copy: "unlock", confirmLabelKey: "unlock" },
  // Not the same question as unlocking, and not the same wording: on many
  // locks a thrown latch cannot be retracted remotely, so locking again does
  // not undo it. Somebody has to be at the door.
  "lock.open": { copy: "openLatch", confirmLabelKey: "entityDetail.openLatch" },
  "alarm_control_panel.alarm_disarm": {
    copy: "disarm",
    confirmLabelKey: "entityDetail.disarmButton",
  },
  // ── not implemented yet; see the note above ────────────────────────────
  "siren.turn_on": {
    copy: "soundSiren",
    confirmLabelKey: "entityDetail.confirm.soundSiren.action",
  },
  // `toggle` on a siren that is off *is* turning it on, and the resolver maps
  // `homeassistant.toggle` onto the entity's own domain the same way it maps
  // `turn_on`. Nothing emits it today — the fallback picks `turn_on` or
  // `turn_off` from the state — but a row costs one line and the alternative
  // is a siren sounding on one tap because a later caller reached for the
  // service that happens not to be listed.
  "siren.toggle": {
    copy: "soundSiren",
    confirmLabelKey: "entityDetail.confirm.soundSiren.action",
  },
  // The `button` domain carries no semantics whatsoever — `device_class`
  // offers only `identify`, `restart` and `update`, so the entity behind it
  // may be "Open garage", "Restart Home Assistant" or "Unlock car" and the
  // sheet cannot tell. Hence a prompt that quotes the name rather than
  // describing the action.
  "button.press": { copy: "press", confirmLabelKey: "entityDetail.confirm.press.action" },
  "input_button.press": { copy: "press", confirmLabelKey: "entityDetail.confirm.press.action" },
  "update.install": { copy: "install", confirmLabelKey: "entityDetail.confirm.install.action" },
  "lawn_mower.start_mowing": {
    copy: "startMowing",
    confirmLabelKey: "entityDetail.confirm.startMowing.action",
  },
};

/**
 * The confirmation this call needs, or `undefined` if it needs none.
 *
 * Two lookups, because a service call does not always name the domain it ends
 * up in. `homeassistant.turn_on` is Home Assistant's own generic pair — the one
 * thing that works across any entity with on/off semantics, and therefore what
 * RFC-008 §5.3's fallback offers for a domain nobody wrote a case for. Home
 * Assistant forwards it to the entity's own domain, so
 * `homeassistant.turn_on` on `siren.garden` *is* `siren.turn_on`, row four of
 * this table — and a lookup that only read the literal descriptor would sail
 * straight past it and sound the siren on one tap. That was live: a `siren` has
 * no case of its own yet, so every siren in the house took the fallback.
 *
 * So the entity's own domain is tried as well. Nothing is lost by it: every
 * descriptor in the sheet either already names the entity's domain, in which
 * case the second lookup repeats the first, or names the generic pair, in which
 * case the second lookup is the only one that can be right.
 */
export function dangerousAction(call: {
  domain: string;
  service: string;
  entity_id?: string;
}): DangerousAction | undefined {
  const declared = DANGEROUS_ACTIONS[`${call.domain}.${call.service}`];
  if (declared) return declared;

  const target = call.entity_id?.split(".")[0];
  if (!target || target === call.domain) return undefined;
  return DANGEROUS_ACTIONS[`${target}.${call.service}`];
}
