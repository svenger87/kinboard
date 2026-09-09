"use client";

/**
 * One confirmation step in front of every service RFC-008 §6 names — for every
 * surface that can call one.
 *
 * Lifted out of `entity-actions.tsx` when the room screen's tiles turned out to
 * be a way round it. The detail sheet's Unlock asked first; the tile's Unlock,
 * one layer out and half an inch to the left, called `lock.unlock` directly, so
 * a child on the wall panel opened the front door on one tap. A confirmation
 * that only guards the longer route is not one, and a second bespoke dialog on
 * the tile would have been exactly the duplication the table exists to prevent.
 * So the mechanism moved here and both surfaces mount the same one.
 *
 * Two mount styles, one mechanism:
 *
 * - {@link DangerousActionGate} wraps a subtree, renders the dialog and hands
 *   `run` down through context. That is what the detail sheet uses: one entity
 *   is on screen, so it can name it once at mount.
 * - {@link useDangerousActionRunner} returns `run` plus a `dialog` node the
 *   caller renders wherever it likes. That is what the room screen uses: forty
 *   tiles, no entity known until one is tapped, so the name arrives with the
 *   call.
 *
 * Everything that decides *whether to ask*, *what to ask*, and *what happens to
 * the promise* lives in the hook. The gate is a nine-line wrapper round it.
 */

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { useCallService } from "@/hooks";
import { dangerousAction, type DangerousAction } from "@/lib/ha-dangerous-actions";
import type { HAEntity, HAServiceCall } from "@/types/home-assistant";

/**
 * What a control is about to do: the service call itself, and — for the
 * actions a convenience hook already wraps — how to actually make it.
 *
 * The descriptor is mandatory even when `via` does the work, because it is the
 * only thing that identifies the action. `unlock(id)` says nothing a lookup can
 * use; `{ domain: "lock", service: "unlock" }` says everything.
 *
 * `displayName` is for a caller that has many entities on screen and cannot
 * name one at mount. A caller that named it at mount passes nothing and gets
 * that name; the detail sheet's fifty-odd controls are unchanged by its
 * existence.
 */
export type RunAction = (
  call: HAServiceCall,
  via?: () => Promise<unknown>,
  displayName?: string,
) => Promise<boolean>;

/**
 * The runner every control goes through, and the dialog it may have to raise.
 *
 * The caller renders `dialog` — anywhere; it is a modal — and calls `run`.
 * Nothing about the call changes on the way through: the same hook runs it, a
 * refusal still raises the same toast, and the boolean an optimistic control
 * reads still means "the device took it".
 *
 * Dismissal resolves `false` — the same answer a refused call gives — so a
 * control holding an optimistic guess drops it rather than sitting on a value
 * nobody agreed to. And **nothing is sent**: the promise the control is waiting
 * on never reaches `via`.
 *
 * The dialog is `ConfirmDestructive`, the same component behind the recycle
 * bin's permanent delete and the family delete, so the confirm button is the
 * destructive-coloured one on the far side of the footer and Radix puts focus
 * on Cancel — a stray thumb lands on the harmless half.
 */
export function useDangerousActionRunner(defaults?: {
  entity?: HAEntity;
  displayName?: string;
}): { run: RunAction; isPending: boolean; dialog: ReactNode } {
  const t = useTranslations("homeAutomation");
  const { mutateAsync: callService, isPending } = useCallService();

  /*
    The question on screen, and the promise the control is still waiting on.

    Held in a ref as well as in state because the two dialog handlers need the
    record itself, and because whichever of them runs first has to be able to
    take it — Radix closes the dialog after `onConfirm`, which fires
    `onOpenChange(false)` immediately afterwards, and a dismissal handler that
    could not tell those apart would resolve the same promise twice and report
    a confirmed action as cancelled.
  */
  const asked = useRef<{
    action: DangerousAction;
    call: HAServiceCall;
    via?: () => Promise<unknown>;
    name: string;
    settle: (fired: boolean) => void;
  } | null>(null);
  const [pending, setPending] = useState<{ action: DangerousAction; name: string } | null>(null);

  /** Run it for real, say so when Home Assistant refuses, report which it was. */
  const fire = useCallback(
    async (call: HAServiceCall, via?: () => Promise<unknown>): Promise<boolean> => {
      try {
        await (via ? via() : callService(call));
        return true;
      } catch {
        toast.error(t("controlFailed"));
        return false;
      }
    },
    [callService, t],
  );

  const fallbackName = defaults?.displayName || defaults?.entity?.name || "";

  const run = useCallback<RunAction>(
    (call, via, displayName) => {
      const action = dangerousAction(call);
      const name = displayName || fallbackName || call.entity_id || "";
      if (!action) return fire(call, via);
      return new Promise<boolean>((settle) => {
        asked.current = { action, call, via, name, settle };
        setPending({ action, name });
      });
    },
    [fire, fallbackName],
  );

  /** Take the pending question, so only one of the two handlers can answer it. */
  const take = useCallback(() => {
    const record = asked.current;
    asked.current = null;
    setPending(null);
    return record;
  }, []);

  // A surface unmounted with the question still up leaves a control awaiting an
  // answer that can no longer come. Nothing was sent, so the answer is `false`.
  useEffect(() => () => asked.current?.settle(false), []);

  const dialog = pending ? (
    <ConfirmDestructive
      open
      onOpenChange={(open) => {
        if (open) return;
        take()?.settle(false);
      }}
      title={t(`entityDetail.confirm.${pending.action.copy}.title`, { name: pending.name })}
      description={t(`entityDetail.confirm.${pending.action.copy}.body`, { name: pending.name })}
      confirmLabel={t(pending.action.confirmLabelKey)}
      onConfirm={() => {
        const record = take();
        if (record) void fire(record.call, record.via).then(record.settle);
      }}
    />
  ) : null;

  return { run, isPending, dialog };
}

/**
 * The runner every control in the detail sheet uses, supplied by
 * {@link DangerousActionGate}.
 *
 * Context rather than a plain hook so there is exactly one confirmation dialog
 * per sheet, mounted by the dispatcher, rather than one per control — and so
 * that a control physically cannot call a service without going past it.
 */
const RunActionContext = createContext<{ run: RunAction; isPending: boolean } | null>(null);

export function useRunAction() {
  const ctx = useContext(RunActionContext);
  if (!ctx) {
    throw new Error("A detail-sheet control must be rendered inside <EntityActions>.");
  }
  return ctx;
}

/** {@link useDangerousActionRunner} as a provider, for a subtree about one entity. */
export function DangerousActionGate({
  entity,
  displayName,
  children,
}: {
  entity: HAEntity;
  displayName?: string;
  children: ReactNode;
}) {
  const { run, isPending, dialog } = useDangerousActionRunner({ entity, displayName });
  return (
    <RunActionContext.Provider value={{ run, isPending }}>
      {children}
      {dialog}
    </RunActionContext.Provider>
  );
}
