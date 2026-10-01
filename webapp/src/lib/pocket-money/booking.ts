/**
 * One pocket-money booking: the transaction row and the account's balance,
 * together, or neither.
 *
 * Every change to a balance goes through `book_pocket_money()`: the session
 * route (`/api/pocket-money/accounts/{id}/transactions`), the RFC-001
 * `add_pocket_money` service and an approved assistant booking (RFC-012 §3)
 * call it from here; an approved withdrawal request, the allowance cron and
 * the interest cron reach it through their own SQL functions
 * (`lib/pocket-money/runs.ts`). It is `book_pocket_money()`
 * (`docker/migration_zzzzz_pocket_money_booking.sql`), which moves the balance
 * with one conditional UPDATE — `balance_cents + delta >= 0` is checked by the
 * statement that changes it, so two withdrawals racing on one account cannot
 * both pass — and inserts the transaction in the same call, so a failed insert
 * leaves the balance as it was.
 *
 * lifetime_saved_cents (the avatar tier) grows only with genuine earnings: a
 * positive amount that is not an `adjustment`.
 */

export type TransactionType = "allowance" | "manual_deposit" | "interest" | "withdrawal" | "adjustment";

export interface BookingInput {
  familyId: string;
  accountId: string;
  /** Signed: negative takes money out. Never 0. */
  amountCents: number;
  type: TransactionType;
  note?: string | null;
  relatedGoalId?: string | null;
  createdByPersonId?: string | null;
}

export type BookingResult =
  | { ok: true; transaction: Record<string, unknown>; balanceCents: number }
  /** Nothing was written. */
  | { ok: false; error: "insufficient_funds" }
  | { ok: false; error: "not_found" }
  /** The database refused or could not be reached; nothing was written as far as is known. */
  | { ok: false; error: "failed"; message: string };

/** The one call the booking needs: an RPC on the admin client. */
export interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function bookPocketMoney(supabase: RpcClient, input: BookingInput): Promise<BookingResult> {
  const { data, error } = await supabase.rpc("book_pocket_money", {
    p_family_id: input.familyId,
    p_account_id: input.accountId,
    p_amount_cents: input.amountCents,
    p_type: input.type,
    p_note: input.note ?? null,
    p_related_goal_id: input.relatedGoalId ?? null,
    p_created_by_person_id: input.createdByPersonId ?? null,
  });
  if (error) return { ok: false, error: "failed", message: error.message };
  const answer = data as { ok?: unknown; error?: unknown; transaction?: unknown; balance_cents?: unknown } | null;
  if (answer?.ok === true && typeof answer.balance_cents === "number" && answer.transaction && typeof answer.transaction === "object") {
    return { ok: true, transaction: answer.transaction as Record<string, unknown>, balanceCents: answer.balance_cents };
  }
  if (answer?.error === "insufficient_funds") return { ok: false, error: "insufficient_funds" };
  if (answer?.error === "not_found") return { ok: false, error: "not_found" };
  return { ok: false, error: "failed", message: "unexpected answer from book_pocket_money" };
}

/** The most an assistant may ask to book at once, in cents (RFC-012 §3). */
export const MAX_ASSISTANT_BOOKING_CENTS = 50_000;

/**
 * An amount in currency units — 0.01 to 500, at most two decimals — as whole
 * cents, or null. Converted from its decimal text, never by multiplying the
 * float, so 0.29 is 29 and not 28.999…; a number whose shortest text has more
 * than two decimals (0.1 + 0.2) is refused rather than rounded.
 */
export function amountToCents(value: unknown, max = MAX_ASSISTANT_BOOKING_CENTS): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > max) return null;
  return cents;
}

export type InterestCommitResult =
  | { ok: true; amountCents: number; balanceCents: number }
  /** Nothing was pending (another run got there first), or no such account: nothing written. */
  | { ok: false; error: "nothing_pending" | "not_found" | "insufficient_funds" }
  | { ok: false; error: "failed"; message: string };

/**
 * Move an account's pending interest into its balance:
 * `commit_pocket_money_interest()` reads what is pending under the row lock,
 * books it through `book_pocket_money()` as an `interest` delta and takes
 * exactly that off pending — so a booking or an accrual running alongside
 * keeps its own part.
 */
export async function commitPendingInterest(supabase: RpcClient, accountId: string, note: string): Promise<InterestCommitResult> {
  const { data, error } = await supabase.rpc("commit_pocket_money_interest", { p_account_id: accountId, p_note: note });
  if (error) return { ok: false, error: "failed", message: error.message };
  const answer = data as { ok?: unknown; error?: unknown; amount_cents?: unknown; balance_cents?: unknown } | null;
  if (answer?.ok === true && typeof answer.amount_cents === "number" && typeof answer.balance_cents === "number") {
    return { ok: true, amountCents: answer.amount_cents, balanceCents: answer.balance_cents };
  }
  if (answer?.error === "nothing_pending" || answer?.error === "not_found" || answer?.error === "insufficient_funds") {
    return { ok: false, error: answer.error };
  }
  return { ok: false, error: "failed", message: "unexpected answer from commit_pocket_money_interest" };
}

/**
 * Add a day's interest to what is pending, as a delta, once per `today`
 * (`accrue_pocket_money_interest()`). True when it was added now; false when
 * that day was already accrued.
 */
export async function accruePendingInterest(
  supabase: RpcClient,
  input: { accountId: string; addCents: number; carryMicros: number; today: string },
): Promise<{ ok: true; accrued: boolean } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("accrue_pocket_money_interest", {
    p_account_id: input.accountId,
    p_add_cents: input.addCents,
    p_carry_micros: input.carryMicros,
    p_today: input.today,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, accrued: data === true };
}
