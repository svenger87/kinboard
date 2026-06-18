"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Check, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { usePocketMoneyGoals, useUpdatePocketMoneyGoal } from "@/hooks";
import { formatCents } from "@/lib/pocket-money/format";
import { GoalAddDialog } from "./goal-add-dialog";
import type { PocketMoneyGoal } from "@/types/database";

// Parent-facing goal management for the settings page: list an account's goals
// (active + bought) with edit + remove. Mirrors the kid view's actions but in a
// compact list. "Remove" abandons the goal (soft delete, FK-safe).
export function GoalsManager({
  accountId,
  currency,
}: {
  accountId: string;
  currency: string;
}) {
  const t = useTranslations("pocketMoney");
  const { data: goals = [] } = usePocketMoneyGoals(accountId);
  const updateGoal = useUpdatePocketMoneyGoal();
  const [editingGoal, setEditingGoal] = useState<PocketMoneyGoal | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toRemove, setToRemove] = useState<PocketMoneyGoal | null>(null);

  const visible = goals.filter(
    (g) => g.status === "active" || g.status === "bought",
  );

  const confirmRemove = () => {
    if (!toRemove) return;
    updateGoal
      .mutateAsync({ id: toRemove.id, accountId, update: { status: "abandoned" } })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
    setToRemove(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t("goalsSectionTitle")}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditingGoal(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4 mr-1" />
          {t("addGoal")}
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noGoalsYet")}</p>
      ) : (
        <ul className="space-y-1">
          {visible.map((g) => (
            <li
              key={g.id}
              className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"
            >
              {g.image_url && (
                <Image
                  src={g.image_url}
                  alt={g.name}
                  width={28}
                  height={28}
                  className="rounded object-cover shrink-0"
                  unoptimized
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{g.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCents(g.target_amount_cents, currency)}
                </p>
              </div>
              {g.status === "bought" && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-500 shrink-0">
                  <Check className="size-3.5" />
                  {t("boughtBadge")}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditingGoal(g);
                  setDialogOpen(true);
                }}
                aria-label={t("editGoalAria")}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground shrink-0"
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setToRemove(g)}
                aria-label={g.status === "bought" ? t("dismissGoalAria") : t("removeGoalAria")}
                className="rounded-md p-1 text-muted-foreground hover:text-destructive shrink-0"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <GoalAddDialog
        accountId={accountId}
        open={dialogOpen}
        goal={editingGoal}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditingGoal(null);
        }}
      />

      <AlertDialog
        open={!!toRemove}
        onOpenChange={(o) => {
          if (!o) setToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toRemove?.status === "bought"
                ? t("dismissGoalConfirmTitle")
                : t("removeGoalConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeGoalConfirmBody", { name: toRemove?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove}>
              {toRemove?.status === "bought" ? t("dismiss") : t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
