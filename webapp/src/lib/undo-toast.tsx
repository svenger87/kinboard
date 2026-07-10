import { toast } from "sonner";

interface ShowUndoToastOptions {
  /** Shown as the toast body, e.g. t("noteDeleted"). */
  message: string;
  /** Label for the action button, e.g. t("common.undo"). */
  undoLabel: string;
  /** Re-inserts the deleted row. Throw (or reject) to trigger errorMessage. */
  onUndo: () => Promise<void> | void;
  /** Shown via toast.error() if onUndo throws/rejects. */
  errorMessage: string;
}

/**
 * Sonner action-toast for "undo after delete" flows.
 *
 * The toast is dismissed synchronously on click, before onUndo is awaited,
 * and an `invoked` guard blocks re-entry even if the click handler fires
 * again before the toast has unmounted — so a double-click (or double-tap)
 * can't insert the restored row twice.
 */
export function showUndoToast({
  message,
  undoLabel,
  onUndo,
  errorMessage,
}: ShowUndoToastOptions): void {
  let invoked = false;

  const id = toast(message, {
    duration: 6000,
    action: {
      label: undoLabel,
      onClick: async () => {
        if (invoked) return;
        invoked = true;
        toast.dismiss(id);
        try {
          await onUndo();
        } catch {
          toast.error(errorMessage);
        }
      },
    },
  });
}
