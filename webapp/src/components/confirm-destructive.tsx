"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ConfirmDestructiveProps {
  /**
   * The control that triggers the action, rendered via asChild.
   *
   * Omit it and drive `open`/`onOpenChange` instead. That is needed when the
   * trigger lives inside a dropdown menu: selecting an item closes the menu and
   * unmounts the trigger, which would take the dialog with it.
   */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  /** Defaults to the shared "Delete" label. */
  confirmLabel?: string;
  onConfirm: () => void;
}

/**
 * A confirmation step in front of something that destroys data.
 *
 * Every screen that had one of these was inlining the same twenty-odd lines of
 * AlertDialog, which is why the screens that lacked one never got it: adding
 * the guard cost more than leaving the button bare. The ones still missing it
 * were all in settings and secondary components — a school subject could be
 * removed by a single tap on a 12px icon, taking its timetable entries with
 * it, and a gift idea by one tap with no undo. Both are reachable by a child
 * on the wall tablet, which is how this came up.
 *
 * Deliberately not applied to the shopping list: that one deletes on a single
 * tap on purpose and backs it with an Undo toast, which is the right trade for
 * a list you work through in a supermarket aisle.
 */
export function ConfirmDestructive({
  children,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: ConfirmDestructiveProps) {
  const t = useTranslations("common");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {children ? <AlertDialogTrigger asChild>{children}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {confirmLabel ?? t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
