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

/** The confirmation this service needs, or `undefined` if it needs none. */
export function dangerousAction(domain: string, service: string): DangerousAction | undefined {
  return DANGEROUS_ACTIONS[`${domain}.${service}`];
}
