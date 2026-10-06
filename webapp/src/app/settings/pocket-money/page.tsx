"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { CalendarClock, ChevronRight, PiggyBank, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  useCurrency,
  CURRENCIES,
  useUpdateSetting,
  usePocketMoneyAccounts,
  useCreatePocketMoneyAccount,
  useUpdatePocketMoneyAccount,
  useDeletePocketMoneyAccount,
  useCreatePocketMoneyTransaction,
  useWithdrawalRequests,
  useDecideWithdrawalRequest,
  usePeople,
} from "@/hooks";
import { nextAllowanceDate, daysUntil } from "@/lib/pocket-money/allowance";
import { formatCents } from "@/lib/pocket-money/format";
import { BalanceForecast } from "@/components/pocket-money/balance-forecast";
import { AmountDialog } from "@/components/pocket-money/amount-dialog";
import { toast } from "sonner";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Locale-aware short weekday names indexed 0=Sun..6=Sat. Built once
// per locale via Intl.DateTimeFormat off a known Sunday so we don't
// need 7 hand-rolled translation keys per locale.
function useLocalizedDayNames(): readonly string[] {
  const locale = useLocale();
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    // 2024-01-07 is a Sunday in UTC; offset by 0..6 to walk the week.
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 7 + i));
      return fmt.format(d);
    });
  }, [locale]);
}

// Common cadences exposed in the UI. Custom values still go through
// the underlying allowance_interval_days column; this list is the
// "reasonable defaults" UI surface.
const ALLOWANCE_INTERVAL_OPTIONS: ReadonlyArray<{ days: number; labelKey: string }> = [
  { days: 7, labelKey: "intervalWeekly" },
  { days: 14, labelKey: "intervalBiweekly" },
  { days: 28, labelKey: "intervalEveryFourWeeks" },
];

/** Server codes turned into something a parent can act on. */
function decideError(err: unknown, t: (key: string) => string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("already_decided")) return t("errorAlreadyDecided");
  if (raw.includes("insufficient_funds")) return t("errorInsufficientFunds");
  return t("errorGeneric");
}

export default function PocketMoneySettingsPage() {
  const t = useTranslations("settings.pocketMoney");
  const locale = useLocale();
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const { data: people = [] } = usePeople();
  const kids = people.filter((p) => p.is_child);
  const create = useCreatePocketMoneyAccount();
  const update = useUpdatePocketMoneyAccount();
  const del = useDeletePocketMoneyAccount();
  const txn = useCreatePocketMoneyTransaction();

  const { currency } = useCurrency();
  const updateCurrency = useUpdateSetting<string>();
  const [currencySaving, setCurrencySaving] = useState(false);

  /**
   * Changing the currency **re-labels**; it does not convert. A balance of 500
   * is five of whatever unit the household counts in — the ledger is theirs,
   * and inventing an exchange rate for a child's pocket money would be worse
   * than a wrong symbol. Every account moves together, because one household
   * keeps one set of books.
   */
  async function pickCurrency(next: string) {
    if (next === currency || currencySaving) return;
    setCurrencySaving(true);
    try {
      await updateCurrency.mutateAsync({ key: SETTINGS_KEYS.currency, value: next });
      await Promise.all(
        accounts
          .filter((a) => a.currency !== next)
          .map((a) => update.mutateAsync({ id: a.id, update: { currency: next } })),
      );
    } catch {
      toast.error(t("errorGeneric"));
    } finally {
      setCurrencySaving(false);
    }
  }

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [depositTarget, setDepositTarget] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<string | null>(null);
  const activeAcct = (target: string | null) =>
    target ? accounts.find((a) => a.id === target) : undefined;

  const liabilityTotal = accounts.reduce((sum, a) => sum + a.balance_cents, 0);

  const accountedPersonIds = new Set(accounts.map((a) => a.person_id));
  const kidsWithoutAccount = kids.filter((k) => !accountedPersonIds.has(k.id));

  const days = useLocalizedDayNames();

  return (
    <main
      id="main-content"
      className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 max-w-3xl mx-auto space-y-6">
        <PageHeader title={t("title")} icon={PiggyBank} />

        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        <Card id="currency" data-setting="currency" className="p-4">
          <div className="mb-3">
            <p className="font-medium text-sm">{t("currencyLabel")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("currencyDescription")}
            </p>
          </div>
          <Select value={currency} onValueChange={pickCurrency} disabled={currencySaving}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>

        {accounts.length > 0 && (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              {t("liabilityTotal")}:{" "}
              <strong>
                {formatCents(liabilityTotal, accounts[0].currency)}
              </strong>
            </p>
          </Card>
        )}

        {/* Creatures, task points and rewards moved out of pocket money
            (RFC-017): this page keeps the euros. */}
        <Link
          href="/settings/creatures"
          className="block rounded-xl border border-border p-4 transition hover:bg-white/[0.04]"
          data-testid="creatures-link"
        >
          <span className="flex items-center gap-3">
            <Sparkles className="size-5 shrink-0 text-month-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t("creaturesLinkTitle")}</span>
              <span className="block text-xs text-muted-foreground">{t("creaturesLinkDescription")}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </span>
        </Link>

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
            <Card key={acct.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">
                    {kidPerson?.name ?? acct.person_id.slice(0, 8)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {formatCents(acct.balance_cents, acct.currency)} ·{" "}
                    {t("aprSummaryLabel", { pct: (acct.apr_bps / 100).toFixed(1) })} ·{" "}
                    {t("allowancePerInterval", {
                      amount: formatCents(acct.weekly_allowance_cents, acct.currency),
                      days: acct.allowance_interval_days ?? 7,
                    })}
                  </p>
                  {/* The schedule is only trustworthy if you can see when
                      it next fires. Without this a correctly-working
                      fortnightly allowance is indistinguishable from a
                      broken cron for up to 13 days. */}
                  {(() => {
                    if (acct.weekly_allowance_cents <= 0) return null;
                    const next = nextAllowanceDate({
                      lastAllowanceAt: acct.last_allowance_at,
                      intervalDays: acct.allowance_interval_days ?? 7,
                      dayOfWeek: acct.allowance_day_of_week,
                    });
                    if (!next) return null;
                    const days = daysUntil(next);
                    return (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <CalendarClock className="size-3.5 shrink-0" />
                        {t("nextAllowanceSummary", {
                          date: next.toLocaleDateString(locale, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          }),
                          days,
                        })}
                        {acct.last_allowance_at && (
                          <span className="opacity-70">
                            ·{" "}
                            {t("lastAllowanceSummary", {
                              date: new Date(acct.last_allowance_at).toLocaleDateString(locale, {
                                day: "numeric",
                                month: "short",
                              }),
                            })}
                          </span>
                        )}
                      </p>
                    );
                  })()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingDelete(acct.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>

              <>
              {/* Allowance first: it's the setting a parent actually
                  revisits. Interest is set once and forgotten, so it
                  sits below under its own heading rather than
                  interleaved with the allowance knobs in one flat grid. */}
              <div className="pt-3 border-t border-border">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {t("groupInterest")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>
                    {t("aprLabel")} ({(acct.apr_bps / 100).toFixed(1)}%)
                  </Label>
                  <Slider
                    // Uncontrolled with `key` so the slider has internal
                    // drag state — fully-controlled `value={[...]}` against
                    // server state freezes the thumb mid-drag because
                    // there's no local state to update before commit.
                    key={`apr-${acct.id}-${acct.apr_bps}`}
                    defaultValue={[acct.apr_bps]}
                    min={0}
                    max={5000}
                    step={100}
                    onValueCommit={([v]) =>
                      update
                        .mutateAsync({ id: acct.id, update: { apr_bps: v } })
                        // These controls are uncontrolled, so a rejected save
                        // left the widget showing the new value as if it had
                        // stuck. Say so instead.
                        .catch(() => toast.error(t("errorGeneric")))
                    }
                  />
                  {acct.apr_bps > 2000 && (
                    <p className="text-xs text-amber-500">
                      {t("aprHighWarning")}
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-border">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {t("groupAllowance")}
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("groupAllowanceHint")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                        .catch(() => toast.error(t("errorGeneric")));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("allowanceIntervalLabel")}</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3"
                    defaultValue={acct.allowance_interval_days ?? 7}
                    onChange={(e) =>
                      update
                        .mutateAsync({
                          id: acct.id,
                          update: {
                            allowance_interval_days: Number(e.target.value),
                          },
                        })
                        .catch(() => toast.error(t("errorGeneric")))
                    }
                  >
                    {ALLOWANCE_INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.days} value={opt.days}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </select>
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
                        .catch(() => toast.error(t("errorGeneric")))
                    }
                  >
                    {days.map((d, i) => (
                      <option key={i} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Interest commits daily now (was weekly on the
                    configured day-of-week). The column is preserved on
                    existing rows for backwards-compat but is no longer
                    surfaced — the picker would be a no-op control. */}
              </div>

              <div className="flex gap-2 pt-3 border-t border-border">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDepositTarget(acct.id)}
                >
                  {t("deposit")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setWithdrawTarget(acct.id)}
                >
                  {t("withdraw")}
                </Button>
              </div>

              <BalanceForecast
                balanceCents={acct.balance_cents}
                pendingInterestCents={acct.pending_interest_cents}
                maxBalanceEligibleCents={acct.max_balance_eligible_cents}
                aprBps={acct.apr_bps}
                weeklyAllowanceCents={acct.weekly_allowance_cents}
                allowanceIntervalDays={acct.allowance_interval_days ?? 7}
                currency={acct.currency}
              />
              </>
            </Card>
          );
        })}

        {kidsWithoutAccount.map((kid) => (
          <CreateAccountCard
            key={kid.id}
            kid={kid}
            onCreate={() =>
              create
                .mutateAsync({ person_id: kid.id, currency })
                .catch(() => toast.error(t("errorGeneric")))
            }
            isPending={create.isPending}
          />
        ))}

        {kids.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            {t("noKidsHint")}
          </Card>
        )}

        <AmountDialog
          open={Boolean(depositTarget)}
          onOpenChange={(o) => !o && setDepositTarget(null)}
          title={t("deposit")}
          description={t("depositDialogDescription")}
          confirmLabel={t("deposit")}
          currency={activeAcct(depositTarget)?.currency ?? "EUR"}
          onConfirm={async (cents) => {
            if (!depositTarget) return;
            await txn.mutateAsync({
              accountId: depositTarget,
              amount_cents: cents,
              type: "manual_deposit",
            });
          }}
          isSubmitting={txn.isPending}
        />

        <AmountDialog
          open={Boolean(withdrawTarget)}
          onOpenChange={(o) => !o && setWithdrawTarget(null)}
          title={t("withdraw")}
          description={t("withdrawDialogDescription")}
          confirmLabel={t("withdraw")}
          currency={activeAcct(withdrawTarget)?.currency ?? "EUR"}
          onConfirm={async (cents) => {
            if (!withdrawTarget) return;
            await txn.mutateAsync({
              accountId: withdrawTarget,
              amount_cents: -cents,
              type: "withdrawal",
            });
          }}
          isSubmitting={txn.isPending}
        />

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
                    del
                      .mutateAsync(pendingDelete)
                      // The dialog closes on click either way, so a failed
                      // delete looked exactly like a successful one — the
                      // account just quietly reappeared.
                      .catch(() => toast.error(t("errorGeneric")));
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
    <Card className="p-4 space-y-2">
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
              // One decision at a time per request: a double tap must not
              // send a second approval while the first is still on its way.
              disabled={decide.isPending && decide.variables?.id === r.id}
              onClick={() =>
                decide
                  .mutateAsync({ id: r.id, status: "approved" })
                  // 409 already_decided (another device got there first)
                  // and an auto-deny for insufficient funds both landed
                  // here silently, leaving the row looking pending
                  // forever with no explanation to anyone.
                  .catch((err) => toast.error(decideError(err, t)))
              }
            >
              {t("approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending && decide.variables?.id === r.id}
              onClick={() =>
                decide
                  .mutateAsync({ id: r.id, status: "denied" })
                  .catch((err) => toast.error(decideError(err, t)))
              }
            >
              {t("deny")}
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

interface CreateAccountKid { id: string; name: string }

function CreateAccountCard({
  kid,
  onCreate,
  isPending,
}: {
  kid: CreateAccountKid;
  onCreate: () => void;
  isPending: boolean;
}) {
  const t = useTranslations("settings.pocketMoney");

  // The euros only. A creature is switched on separately, under Settings ->
  // Creatures & rewards (RFC-017).
  return (
    <Card className="p-4 space-y-3">
      <p className="text-sm font-medium">
        {t("createAccountForKid", { name: kid.name })}
      </p>
      <Button className="w-full" disabled={isPending} onClick={onCreate}>
        <Plus className="size-4 mr-1" />
        {t("create")}
      </Button>
    </Card>
  );
}
