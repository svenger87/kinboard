"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PiggyBank, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
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
import { PageHeader } from "@/components/page-header";
import {
  usePocketMoneyAccounts,
  useCreatePocketMoneyAccount,
  useUpdatePocketMoneyAccount,
  useDeletePocketMoneyAccount,
  useCreatePocketMoneyTransaction,
  useWithdrawalRequests,
  useDecideWithdrawalRequest,
  usePeople,
} from "@/hooks";
import type { AvatarSpecies } from "@/lib/pocket-money/types";
import { formatCents } from "@/lib/pocket-money/format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PocketMoneySettingsPage() {
  const t = useTranslations("settings.pocketMoney");
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const { data: people = [] } = usePeople();
  const kids = people.filter((p) => p.is_child);
  const create = useCreatePocketMoneyAccount();
  const update = useUpdatePocketMoneyAccount();
  const del = useDeletePocketMoneyAccount();
  const txn = useCreatePocketMoneyTransaction();

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const liabilityTotal = accounts.reduce((sum, a) => sum + a.balance_cents, 0);

  const accountedPersonIds = new Set(accounts.map((a) => a.person_id));
  const kidsWithoutAccount = kids.filter((k) => !accountedPersonIds.has(k.id));

  return (
    <main
      id="main-content"
      className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 max-w-3xl mx-auto space-y-6">
        <PageHeader title={t("title")} icon={PiggyBank} backHref="/settings" />

        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        {accounts.length > 0 && (
          <GlassCard className="p-4">
            <p className="text-sm text-muted-foreground">
              {t("liabilityTotal")}:{" "}
              <strong>
                {formatCents(liabilityTotal, accounts[0].currency)}
              </strong>
            </p>
          </GlassCard>
        )}

        {accounts.map((acct) => (
          <AccountInbox
            key={`inbox-${acct.id}`}
            accountId={acct.id}
            currency={acct.currency}
          />
        ))}

        {accounts.map((acct) => {
          const kidPerson = people.find((p) => p.id === acct.person_id);
          return (
            <GlassCard key={acct.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">
                    {kidPerson?.name ?? acct.person_id.slice(0, 8)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {formatCents(acct.balance_cents, acct.currency)} · APR{" "}
                    {(acct.apr_bps / 100).toFixed(1)}% ·{" "}
                    {formatCents(acct.weekly_allowance_cents, acct.currency)}
                    /week
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingDelete(acct.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
                <div className="space-y-1">
                  <Label>
                    {t("aprLabel")} ({(acct.apr_bps / 100).toFixed(1)}%)
                  </Label>
                  <Slider
                    value={[acct.apr_bps]}
                    min={0}
                    max={5000}
                    step={100}
                    onValueCommit={([v]) =>
                      update
                        .mutateAsync({ id: acct.id, update: { apr_bps: v } })
                        .catch(console.error)
                    }
                  />
                  {acct.apr_bps > 2000 && (
                    <p className="text-xs text-amber-500">
                      {t("aprHighWarning")}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>{t("allowanceLabel")}</Label>
                  <Input
                    type="number"
                    step="1"
                    defaultValue={acct.weekly_allowance_cents / 100}
                    onBlur={(e) => {
                      const cents = Math.max(
                        0,
                        Math.round(Number(e.target.value) * 100)
                      );
                      update
                        .mutateAsync({
                          id: acct.id,
                          update: { weekly_allowance_cents: cents },
                        })
                        .catch(console.error);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("allowanceDayLabel")}</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3"
                    defaultValue={acct.allowance_day_of_week}
                    onChange={(e) =>
                      update
                        .mutateAsync({
                          id: acct.id,
                          update: {
                            allowance_day_of_week: Number(e.target.value),
                          },
                        })
                        .catch(console.error)
                    }
                  >
                    {DAYS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>{t("interestDayLabel")}</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3"
                    defaultValue={acct.interest_committed_day_of_week}
                    onChange={(e) =>
                      update
                        .mutateAsync({
                          id: acct.id,
                          update: {
                            interest_committed_day_of_week: Number(
                              e.target.value
                            ),
                          },
                        })
                        .catch(console.error)
                    }
                  >
                    {DAYS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-border">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const amountStr = prompt(t("depositPrompt"));
                    if (!amountStr) return;
                    const cents = Math.round(Number(amountStr) * 100);
                    if (!cents || cents <= 0) return;
                    txn
                      .mutateAsync({
                        accountId: acct.id,
                        amount_cents: cents,
                        type: "manual_deposit",
                      })
                      .catch(console.error);
                  }}
                >
                  {t("deposit")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const amountStr = prompt(t("withdrawPrompt"));
                    if (!amountStr) return;
                    const cents = Math.round(Number(amountStr) * 100);
                    if (!cents || cents <= 0) return;
                    txn
                      .mutateAsync({
                        accountId: acct.id,
                        amount_cents: -cents,
                        type: "withdrawal",
                      })
                      .catch(console.error);
                  }}
                >
                  {t("withdraw")}
                </Button>
              </div>
            </GlassCard>
          );
        })}

        {kidsWithoutAccount.map((kid) => (
          <GlassCard key={kid.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">
                {t("createAccountForKid", { name: kid.name })}
              </p>
              <Button
                onClick={() =>
                  create
                    .mutateAsync({
                      person_id: kid.id,
                      avatar_species: "dragon" as AvatarSpecies,
                    })
                    .catch(console.error)
                }
              >
                <Plus className="size-4 mr-1" /> {t("create")}
              </Button>
            </div>
          </GlassCard>
        ))}

        {kids.length === 0 && (
          <GlassCard className="p-6 text-center text-sm text-muted-foreground">
            {t("noKidsHint")}
          </GlassCard>
        )}

        <AlertDialog
          open={Boolean(pendingDelete)}
          onOpenChange={(o) => !o && setPendingDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("confirmDeleteDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingDelete)
                    del.mutateAsync(pendingDelete).catch(console.error);
                  setPendingDelete(null);
                }}
              >
                {t("delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </main>
  );
}

function AccountInbox({
  accountId,
  currency,
}: {
  accountId: string;
  currency: string;
}) {
  const t = useTranslations("settings.pocketMoney");
  const { data: requests = [] } = useWithdrawalRequests(accountId, "pending");
  const decide = useDecideWithdrawalRequest();

  if (requests.length === 0) return null;

  return (
    <GlassCard className="p-4 space-y-2">
      <h3 className="font-semibold">{t("inboxTitle")}</h3>
      {requests.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {formatCents(r.amount_cents, currency)} —{" "}
            {r.reason || t("noReason")}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                decide
                  .mutateAsync({ id: r.id, status: "approved" })
                  .catch(console.error)
              }
            >
              {t("approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                decide
                  .mutateAsync({ id: r.id, status: "denied" })
                  .catch(console.error)
              }
            >
              {t("deny")}
            </Button>
          </div>
        </div>
      ))}
    </GlassCard>
  );
}
