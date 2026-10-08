import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { isPinRequired, relockSettings } from "@/lib/pin-session";
import type {
  PocketMoneyAccount,
  PocketMoneyAccountInsert,
  PocketMoneyAccountUpdate,
  PocketMoneyTransaction,
} from "@/types/database";

const KEY = "pocket-money-accounts";

/**
 * Refetch everything a pocket-money screen shows: the accounts and their
 * balances, each ledger, the goals and the spend requests. By prefix, so
 * every account's queries go at once — a change arriving over realtime, or a
 * booking this screen allowed, says which table moved, not which account's
 * cache holds it. Keep the strings in sync with the KEY constants in
 * use-pocket-money-goals.ts and use-pocket-money-withdrawal-requests.ts.
 */
export function invalidatePocketMoney(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: [KEY] });
  qc.invalidateQueries({ queryKey: ["pocket-money-goals"] });
  qc.invalidateQueries({ queryKey: ["pocket-money-withdrawal-requests"] });
}

export function usePocketMoneyAccounts() {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [KEY, family?.id],
    enabled: Boolean(family?.id),
    queryFn: async (): Promise<PocketMoneyAccount[]> => {
      const r = await fetch(`/api/pocket-money/accounts?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`accounts: ${r.status}`);
      return ((await r.json()) as { accounts: PocketMoneyAccount[] }).accounts;
    },
  });
}

export function usePocketMoneyAccount(id: string | undefined) {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [KEY, "one", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<PocketMoneyAccount> => {
      const r = await fetch(
        `/api/pocket-money/accounts/${id}?family_id=${family?.id ?? ""}`,
      );
      if (!r.ok) throw new Error(`account: ${r.status}`);
      return ((await r.json()) as { account: PocketMoneyAccount }).account;
    },
  });
}

export function usePocketMoneyAccountTransactions(accountId: string | undefined) {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [KEY, "transactions", accountId],
    enabled: Boolean(accountId),
    queryFn: async (): Promise<PocketMoneyTransaction[]> => {
      const r = await fetch(
        `/api/pocket-money/accounts/${accountId}/transactions?family_id=${family?.id ?? ""}`,
      );
      if (!r.ok) throw new Error(`txns: ${r.status}`);
      return ((await r.json()) as { transactions: PocketMoneyTransaction[] }).transactions;
    },
  });
}

export function useCreatePocketMoneyAccount() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (input: Omit<PocketMoneyAccountInsert, "family_id">) => {
      const r = await fetch("/api/pocket-money/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, family_id: family?.id }),
      });
      // The server wants the PIN again (RFC-010 §3.5): PinGuard re-prompts
      // and says why, so this is not an error to toast as well.
      if (await isPinRequired(r)) {
        relockSettings();
        return null;
      }
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `create: ${r.status}`);
      }
      return ((await r.json()) as { account: PocketMoneyAccount }).account;
    },
    onSuccess: (account) => {
      if (!account) return;
      qc.invalidateQueries({ queryKey: [KEY, family?.id] });
    },
  });
}

export function useUpdatePocketMoneyAccount() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: PocketMoneyAccountUpdate }) => {
      const r = await fetch(`/api/pocket-money/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // The route requires family_id in the body and 400s without it. Every
        // other call in this file passes it — create, delete and the
        // transaction POST — and this one did not, so *every* edit on
        // /settings/pocket-money (interest rate, allowance, interval) failed
        // silently, as did the avatar-stage tracking on every page load.
        body: JSON.stringify({ ...update, family_id: family?.id }),
      });
      if (!r.ok) {
        // Allowance, interest, currency, species and the reward mode need the
        // settings PIN on the server (#359); the per-page-load avatar-stage
        // write never does, so a kid's own screen is never relocked.
        if (await isPinRequired(r)) {
          relockSettings();
          throw new Error("pin_required");
        }
        throw new Error(`update: ${r.status}`);
      }
      return ((await r.json()) as { account: PocketMoneyAccount }).account;
    },
    onSuccess: (saved) => {
      if (!saved) return;
      qc.invalidateQueries({ queryKey: [KEY, family?.id] });
      qc.invalidateQueries({ queryKey: [KEY, "one", saved.id] });
    },
  });
}

export function useDeletePocketMoneyAccount() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(
        `/api/pocket-money/accounts/${id}?family_id=${family?.id ?? ""}`,
        { method: "DELETE" },
      );
      if (await isPinRequired(r)) {
        relockSettings();
        return false;
      }
      if (!r.ok) throw new Error(`delete: ${r.status}`);
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      qc.invalidateQueries({ queryKey: [KEY, family?.id] });
    },
  });
}

export function useCreatePocketMoneyTransaction() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async ({
      accountId,
      amount_cents,
      type,
      note,
      related_goal_id,
      created_by_person_id,
    }: {
      accountId: string;
      amount_cents: number;
      type: "allowance" | "manual_deposit" | "interest" | "withdrawal" | "adjustment";
      note?: string | null;
      related_goal_id?: string | null;
      created_by_person_id?: string | null;
    }) => {
      const r = await fetch(`/api/pocket-money/accounts/${accountId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_cents,
          type,
          note,
          related_goal_id,
          created_by_person_id,
          family_id: family?.id,
        }),
      });
      if (await isPinRequired(r)) {
        relockSettings();
        return null;
      }
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `txn: ${r.status}`);
      }
      return r.json();
    },
    onSuccess: (result, vars) => {
      if (!result) return;
      qc.invalidateQueries({ queryKey: [KEY, "transactions", vars.accountId] });
      qc.invalidateQueries({ queryKey: [KEY, "one", vars.accountId] });
      qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}

/** Used by the SurfacePlugin's useOwnDataCount hook for nav-gating. */
export function usePocketMoneyAccountsCount(): { count: number | undefined; loading: boolean } {
  const { data, isPending } = usePocketMoneyAccounts();
  return { count: data?.length, loading: isPending };
}
