/**
 * Pocket money through the Integration API (RFC-012 §3): reading the
 * children's accounts, and asking for a booking that a family member then
 * allows on a Kinboard screen with the settings PIN.
 *
 * An assistant never books. `POST /pocket-money/bookings` checks the request
 * and stores it as a `pocket_money` confirmation request
 * (`lib/home/action-requests.ts`) — the same PIN, deny, two-minute expiry,
 * token re-check and per-assistant limits as a door unlock — and answers 202.
 * Only an approval runs it, through the atomic booking in
 * `lib/pocket-money/booking.ts`.
 *
 * Who can be booked for: a person of the token's family, not in the recycle
 * bin, who is a child and has a pocket-money account. Everyone else is
 * refused with a code saying which of those it was.
 *
 * `requestPocketMoneyBooking` takes its I/O as dependencies so every refusal
 * — and "nothing was stored" — is tested against fakes
 * (`e2e/integration-pocket-money.spec.ts`); the live ones are below it.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { familyHasPin } from "@/lib/settings-pin";
import { retryAfterSeconds, type Budget } from "@/lib/integration-limits";
import { amountToCents } from "@/lib/pocket-money/booking";
import { lookupChild, type ChildLookup } from "@/lib/pocket-money/children";
import {
  BOOKING_NOTE_MAX, UUID, submitActionRequest, trustedAnswer, pocketMoneyBookingFrom, stripInvisible, type ActionRequestRow, type CreateKindRequestInput, type PocketMoneyBooking,
} from "@/lib/home/action-requests";
import { liveConfirmationBudget, liveSubmitDeps } from "@/lib/home/action-requests-live";

const db = () => createAdminClient() as any;

// ── reading ──────────────────────────────────────────────────────────────────

export interface PocketMoneyGoal {
  id: string;
  name: string;
  target: number;
  /** The balance counted towards it, capped at the target, as on the family summary. */
  saved: number;
  percent: number;
  is_primary: boolean;
}

export interface PocketMoneyAccountView {
  person_id: string;
  name: string;
  currency: string;
  balance: number;
  lifetime_saved: number;
  allowance: { amount: number; every_days: number } | null;
  goals: PocketMoneyGoal[];
}

/**
 * Every child's account — people in the recycle bin left out — in currency
 * units, with the allowance (null when there is none) and the active goals,
 * primary first. Progress is the balance against the target, as the family
 * summary measures it: one account per child, goals are targets on it.
 */
export async function listPocketMoney(familyId: string): Promise<PocketMoneyAccountView[]> {
  const [people, accounts, goals] = await Promise.all([
    db().from("people").select("id, name, is_child").eq("family_id", familyId).is("deleted_at", null),
    db().from("pocket_money_accounts")
      .select("id, person_id, currency, balance_cents, lifetime_saved_cents, weekly_allowance_cents, allowance_interval_days")
      .eq("family_id", familyId)
      .order("created_at", { ascending: true }),
    db().from("pocket_money_goals")
      .select("id, account_id, name, target_amount_cents, is_primary, position, pocket_money_accounts!inner(family_id)")
      .eq("pocket_money_accounts.family_id", familyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("position", { ascending: true }),
  ]);
  for (const r of [people, accounts, goals]) {
    if (r.error) throw new Error(`Failed to read pocket money: ${r.error.message}`);
  }
  const children = new Map(
    ((people.data ?? []) as { id: string; name: string; is_child: boolean | null }[])
      .filter((p) => p.is_child === true)
      .map((p) => [p.id, p.name]),
  );
  const goalRows = (goals.data ?? []) as {
    id: string; account_id: string; name: string; target_amount_cents: number; is_primary: boolean;
  }[];

  return ((accounts.data ?? []) as {
    id: string; person_id: string; currency: string | null; balance_cents: number | null;
    lifetime_saved_cents: number | null; weekly_allowance_cents: number | null; allowance_interval_days: number | null;
  }[])
    .filter((a) => children.has(a.person_id))
    .map((a) => {
      const balanceCents = a.balance_cents ?? 0;
      const allowanceCents = a.weekly_allowance_cents ?? 0;
      return {
        person_id: a.person_id,
        name: children.get(a.person_id) as string,
        currency: a.currency ?? "EUR",
        balance: balanceCents / 100,
        lifetime_saved: (a.lifetime_saved_cents ?? 0) / 100,
        allowance: allowanceCents > 0 ? { amount: allowanceCents / 100, every_days: a.allowance_interval_days ?? 7 } : null,
        goals: goalRows
          .filter((g) => g.account_id === a.id)
          .sort((x, y) => Number(y.is_primary) - Number(x.is_primary))
          .map((g) => {
            const savedCents = Math.min(Math.max(balanceCents, 0), g.target_amount_cents);
            return {
              id: g.id,
              name: g.name,
              target: g.target_amount_cents / 100,
              saved: savedCents / 100,
              percent: g.target_amount_cents > 0 ? Math.round((savedCents / g.target_amount_cents) * 100) : 0,
              is_primary: g.is_primary,
            };
          }),
      };
    });
}

// ── asking for a booking ────────────────────────────────────────────────────

/**
 * What in `BookingRequestDeps` acts: storing (or, for a trusted assistant, running) the
 * request. Everything before it only reads (`markBefore`).
 */
export const BOOKING_SIDE_EFFECTS = ["createRequest"] as const satisfies readonly (keyof BookingRequestDeps)[];

export interface BookingRequestDeps {
  lookupChild: (familyId: string, personId: string) => Promise<ChildLookup>;
  familyHasPin: (familyId: string) => Promise<boolean>;
  /** `liveConfirmationBudget`: spends the budget when it says yes; throws when unreadable. */
  confirmationBudget: (familyId: string, tokenId: string) => Promise<Budget>;
  /** `submitActionRequest`: `request` is set when a trusted assistant's request already ran. */
  createRequest: (input: CreateKindRequestInput) => Promise<{ id: string; expiresAt: string; request?: ActionRequestRow }>;
}

export interface BookingRequestInput {
  familyId: string;
  tokenId: string;
  clientName: string;
  body: unknown;
}

export interface BookingRequestResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): BookingRequestResult =>
  ({ status, body: { error, code, ...extra } });

/** The body, checked: what a booking request is, or the 400 that says what is wrong. */
export function parseBookingBody(body: unknown):
  | { ok: true; personId: string; amountCents: number; type: "deposit" | "withdrawal"; note: string | null }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "A JSON object body is required" };
  const b = body as Record<string, unknown>;
  if (typeof b.person_id !== "string" || !UUID.test(b.person_id)) {
    return { ok: false, error: "person_id must be the id of a child (GET /pocket-money)" };
  }
  const amountCents = amountToCents(b.amount);
  if (amountCents === null) {
    return { ok: false, error: "amount must be a number from 0.01 to 500 in the account's currency, with at most two decimals" };
  }
  if (b.type !== "deposit" && b.type !== "withdrawal") return { ok: false, error: "type must be deposit or withdrawal" };
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string") return { ok: false, error: "note must be a string" };
    const trimmed = stripInvisible(b.note).trim();
    if (trimmed.length > BOOKING_NOTE_MAX) return { ok: false, error: `note must be at most ${BOOKING_NOTE_MAX} characters` };
    note = trimmed.length > 0 ? trimmed : null;
  }
  return { ok: true, personId: b.person_id, amountCents, type: b.type, note };
}

/**
 * Ask the family to allow a booking. Nothing is booked here: the answer is
 * 202 `pending_confirmation` with the request to follow at
 * `GET /actions/{id}`, or a refusal, after which nothing was stored or pushed.
 * Unless the family trusts this assistant: then the booking runs at once,
 * through the handler an approval runs, and the answer says how it ended
 * (`trustedAnswer`).
 */
export async function requestPocketMoneyBooking(
  input: BookingRequestInput,
  deps: BookingRequestDeps,
): Promise<BookingRequestResult> {
  const parsed = parseBookingBody(input.body);
  if (!parsed.ok) return fail(400, "invalid_request", parsed.error);

  const child = await deps.lookupChild(input.familyId, parsed.personId);
  if (child.status === "no_person") {
    return fail(404, "not_found", "No such person in this family", { reason: "no_person" });
  }
  if (child.status === "not_a_child") {
    return fail(400, "invalid_request", "Pocket money is only for children; this person is not marked as a child", { reason: "not_a_child" });
  }
  if (child.status === "no_account") {
    return fail(404, "not_found", "This child has no pocket money account", { reason: "no_account" });
  }
  // Said now rather than after a family member typed the PIN. The booking
  // checks again, atomically, when it runs.
  if (parsed.type === "withdrawal" && parsed.amountCents > child.account.balanceCents) {
    return fail(400, "invalid_request", "That is more than this child has; nothing was asked", { reason: "insufficient_funds" });
  }

  const data: PocketMoneyBooking = {
    person_id: parsed.personId,
    person_name: child.name,
    amount_cents: parsed.amountCents,
    currency: child.account.currency,
    type: parsed.type,
    note: parsed.note,
  };
  // Exactly what the handler will accept when it runs: a request it would
  // refuse after a family member typed the PIN is refused now instead,
  // before it reaches any screen.
  if (!pocketMoneyBookingFrom({ ...data })) {
    return fail(400, "invalid_request", "This booking cannot be stored as asked (the child's name or the account's currency is unusable); nothing was asked");
  }

  let hasPin: boolean;
  try {
    hasPin = await deps.familyHasPin(input.familyId);
  } catch {
    return fail(503, "unavailable", "Kinboard could not check whether this booking can be confirmed, so nothing was done");
  }
  if (!hasPin) {
    return fail(
      403,
      "forbidden",
      "A pocket money booking needs a family member to allow it with the settings PIN, and this family has none. Set a settings PIN in Kinboard to allow this. Nothing was done.",
      { reason: "pin_required" },
    );
  }

  let budget: Budget;
  try {
    budget = await deps.confirmationBudget(input.familyId, input.tokenId);
  } catch {
    return fail(503, "unavailable", "Kinboard could not check this assistant's pending requests, so nothing was done");
  }
  if (!budget.ok) {
    return {
      ...fail(
        429,
        "rate_limited",
        "This assistant already has requests waiting for confirmation, or has asked too often. Wait for a family member to answer, then try again. Nothing was done.",
      ),
      headers: { "retry-after": String(retryAfterSeconds(budget.retryAfterMs)) },
    };
  }

  const pending = await deps.createRequest({
    kind: "pocket_money",
    familyId: input.familyId,
    tokenId: input.tokenId,
    clientName: input.clientName,
    data: { ...data },
  });
  // A trusted assistant's booking has already run, or not, through the same
  // handler an approval uses: say what happened.
  if (pending.request) return trustedAnswer(pending.request);
  return {
    status: 202,
    body: { status: "pending_confirmation", request_id: pending.id, expires_at: pending.expiresAt },
  };
}

export const liveBookingRequestDeps: BookingRequestDeps = {
  lookupChild,
  familyHasPin: (familyId) => familyHasPin(familyId),
  confirmationBudget: liveConfirmationBudget,
  createRequest: (input) => submitActionRequest(input, liveSubmitDeps),
};
