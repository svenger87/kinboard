/**
 * The RFC-001 `add_pocket_money` service (POST /services/add_pocket_money).
 *
 * Money, so it follows the app's own deposit path rather than inventing a
 * second one: insert a transaction AND move the balance, and bump
 * lifetime_saved_cents only for genuine earnings, because that field drives
 * the child's avatar tier. A service that only wrote the transaction would
 * leave the balance stale and the avatar wrong, and nothing would complain.
 *
 * Not for assistants (RFC-012 §3): every booking an assistant asks for
 * waits for a family member's PIN, at POST /pocket-money/bookings. This
 * service books at once, so an OAuth-issued token is refused before
 * anything is read; tokens made by hand (Home Assistant) are unchanged.
 *
 * The family's client comes in as a parameter so the spec can hand it a fake
 * and count the bookings — `e2e/integration-pocket-money.spec.ts` holds that
 * an assistant's token books nothing here.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { bookPocketMoney, type RpcClient } from "@/lib/pocket-money/booking";

export interface ServiceResult {
  status: number;
  response: Record<string, unknown>;
}

/** Trim, reject empty, and bound — free text reaching a database column. */
function text(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

export async function addPocketMoneyService(
  { familyId, body, assistant }: { familyId: string; body: Record<string, unknown>; assistant: boolean },
  client?: unknown,
): Promise<ServiceResult> {
  if (assistant) {
    return {
      status: 403,
      response: {
        error: "Assistants book pocket money with POST /pocket-money/bookings (book_pocket_money), which a family member confirms with the settings PIN. Nothing was booked.",
        code: "forbidden",
      },
    };
  }
  // Only now, after the refusal: an assistant's call never touches the database.
  const db = (client ?? createAdminClient()) as any;
  // RFC-001 §5.2 names the arguments `person_id, amount, reason`, and that
  // is what the Home Assistant component sends. This service first shipped
  // reading `person` (a name) and `note`, so every call from Home Assistant
  // was a 400. The RFC names come first; the old ones stay accepted for
  // anything already written against them.
  const personId = text(body.person_id, 100);
  const personName = personId ? null : text(body.person, 200);
  const amount = typeof body.amount === "number" ? body.amount : null;
  const required = {
    status: 400,
    response: {
      error: "`person_id` (or `person`, a name) and a non-zero `amount` are required",
      code: "invalid_request",
    },
  };
  if ((!personId && !personName) || amount === null || !Number.isFinite(amount) || amount === 0) {
    return required;
  }
  // Currency units in, cents stored. An automation saying `amount: 2.50`
  // means €2.50; making callers send 250 would guarantee somebody one day
  // credits a child two hundred and fifty euros.
  const cents = Math.round(amount * 100);
  // Less than half a cent books nothing: a zero amount, said as such.
  if (cents === 0) return required;

  const { data: people } = await db
    .from("people")
    .select("id, name")
    .eq("family_id", familyId)
    .is("deleted_at", null);

  // Matching against this family's living people is the family check for
  // `person_id` as well as the lookup for `person`: an id from another
  // family, or of someone in the recycle bin, is simply not in the list.
  const candidates = (people ?? []) as { id: string; name: string }[];
  const match = personId
    ? candidates.find((candidate) => candidate.id === personId)
    : candidates.find((candidate) => candidate.name.toLowerCase() === personName!.toLowerCase());
  if (!match) {
    return {
      status: 404,
      response: {
        error: personId ? `No person with id ${personId}` : `No person called ${personName}`,
        code: "not_found",
      },
    };
  }

  const { data: account } = await db
    .from("pocket_money_accounts")
    .select("id")
    .eq("family_id", familyId)
    .eq("person_id", match.id)
    .maybeSingle();
  if (!account) {
    return {
      status: 404,
      response: { error: `${match.name} has no pocket money account`, code: "not_found" },
    };
  }

  // The shared booking (lib/pocket-money/booking.ts): the balance moves
  // with one conditional UPDATE, so a concurrent withdrawal cannot take
  // it below zero, and the transaction row is written with it or not at all.
  const booked = await bookPocketMoney(db as RpcClient, {
    familyId,
    accountId: account.id,
    amountCents: cents,
    type: cents > 0 ? "manual_deposit" : "withdrawal",
    note: text(body.reason, 200) ?? text(body.note, 200) ?? "Home Assistant",
  });
  if (!booked.ok) {
    if (booked.error === "insufficient_funds") {
      return { status: 400, response: { error: "insufficient_funds", code: "invalid_request" } };
    }
    if (booked.error === "not_found") {
      return {
        status: 404,
        response: { error: `${match.name} has no pocket money account`, code: "not_found" },
      };
    }
    return { status: 500, response: { error: "Could not record the transaction" } };
  }
  const newBalance = booked.balanceCents;

  return {
    status: 201,
    response: { person_id: match.id, person: match.name, amount, balance: newBalance / 100 },
  };
}
