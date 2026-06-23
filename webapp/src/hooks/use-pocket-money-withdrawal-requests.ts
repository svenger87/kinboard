import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PocketMoneyWithdrawalRequest,
  PocketMoneyWithdrawalRequestInsert,
} from "@/types/database";

const KEY = "pocket-money-withdrawal-requests";

export function useWithdrawalRequests(
  accountId: string | undefined,
  status?: "pending" | "approved" | "denied"
) {
  return useQuery({
    queryKey: [KEY, accountId, status ?? "all"],
    enabled: Boolean(accountId),
    queryFn: async (): Promise<PocketMoneyWithdrawalRequest[]> => {
      const url = `/api/pocket-money/accounts/${accountId}/withdrawal-requests${status ? `?status=${status}` : ""}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`requests: ${r.status}`);
      return ((await r.json()) as { requests: PocketMoneyWithdrawalRequest[] }).requests;
    },
  });
}

export function useCreateWithdrawalRequest() {
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
        body: JSON.stringify(input),
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
        body: JSON.stringify({ status, parent_decided_by_person_id }),
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
