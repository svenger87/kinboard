import { useFamilyStore } from "@/stores/family-store";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePocketMoneyAccounts } from "./use-pocket-money-accounts";
import type {
  PocketMoneyWithdrawalRequest,
  PocketMoneyWithdrawalRequestInsert,
} from "@/types/database";

const KEY = "pocket-money-withdrawal-requests";

export function useWithdrawalRequests(
  accountId: string | undefined,
  status?: "pending" | "approved" | "denied"
) {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [KEY, accountId, status ?? "all"],
    enabled: Boolean(accountId),
    queryFn: async (): Promise<PocketMoneyWithdrawalRequest[]> => {
      const params = new URLSearchParams({ family_id: family?.id ?? "" });
      if (status) params.set("status", status);
      const url = `/api/pocket-money/accounts/${accountId}/withdrawal-requests?${params}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`requests: ${r.status}`);
      return ((await r.json()) as { requests: PocketMoneyWithdrawalRequest[] }).requests;
    },
  });
}

export function useCreateWithdrawalRequest() {
  const { family } = useFamilyStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      accountId,
      input,
    }: {
      accountId: string;
      input: Omit<PocketMoneyWithdrawalRequestInsert, "account_id" | "status">;
    }) => {
      const r = await fetch(`/api/pocket-money/accounts/${accountId}/withdrawal-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, family_id: family?.id }),
      });
      if (!r.ok) throw new Error(`create request: ${r.status}`);
      return ((await r.json()) as { request: PocketMoneyWithdrawalRequest }).request;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, vars.accountId] });
    },
  });
}

export function useDecideWithdrawalRequest() {
  const { family } = useFamilyStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      parent_decided_by_person_id,
    }: {
      id: string;
      status: "approved" | "denied";
      parent_decided_by_person_id?: string;
    }) => {
      const r = await fetch(`/api/pocket-money/withdrawal-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, parent_decided_by_person_id, family_id: family?.id }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `decide: ${r.status}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY] });
      // Cross-invalidate the accounts query — an approved withdrawal
      // changes balance_cents. Keep this string in sync with the KEY
      // constant in use-pocket-money-accounts.ts.
      qc.invalidateQueries({ queryKey: ["pocket-money-accounts"] });
    },
  });
}

/**
 * Family-wide count of spend requests waiting on a parent.
 *
 * Approval lives on the pocket-money settings screen, which a parent has
 * no reason to open on a normal day — so a child's request could sit
 * unnoticed indefinitely, with the child assuming they'd been ignored.
 * This feeds the navigation badge, making a waiting request visible from
 * anywhere in the app.
 *
 * One query per account rather than a bespoke aggregate endpoint: a
 * household has a handful of children, the per-account queries are
 * already cached for the screens that show them, and this reuses that
 * cache instead of adding a second source of truth.
 */
export function usePendingWithdrawalCount(): number {
  const { family } = useFamilyStore();
  const { data: accounts = [] } = usePocketMoneyAccounts();

  const results = useQueries({
    queries: accounts.map((account) => ({
      queryKey: [KEY, account.id, "pending"],
      queryFn: async (): Promise<PocketMoneyWithdrawalRequest[]> => {
        const r = await fetch(
          `/api/pocket-money/accounts/${account.id}/withdrawal-requests?status=pending&family_id=${family?.id ?? ""}`,
        );
        if (!r.ok) throw new Error(`requests: ${r.status}`);
        return ((await r.json()) as { requests: PocketMoneyWithdrawalRequest[] })
          .requests;
      },
      staleTime: 30_000,
    })),
  });

  return results.reduce((sum, r) => sum + (r.data?.length ?? 0), 0);
}
