import { NextRequest, NextResponse } from "next/server";
import { collectSignals, resetSignalCaches } from "@/lib/attention/signals";
import { evaluate } from "@/lib/attention/engine";
import { RULES } from "@/lib/attention/rules";
import { createAdminClient } from "@/lib/supabase/server";
import type { FamilyRuleState } from "@/lib/attention/engine";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST /api/attention/simulate — what would the board say at a given moment?
 *
 * The plan asks for a simulation mode with an arbitrary clock and fixtures.
 * The engine has always taken `now` as an argument rather than reading it, so
 * this route is thin by design: there is no clock to fake and no special mode
 * to enter, only a different value for something that was already a parameter.
 *
 * **It writes nothing.** Asking what the board would say tonight must not
 * cause tonight's reminders to be raised now, acknowledged now, and therefore
 * silent when they actually matter. That is the whole difference between this
 * and the cron route, and it is why they are separate rather than one endpoint
 * with a flag somebody could forget.
 *
 * Behind the cron secret: it reads a family's whole day — appointments,
 * children's timetables, what is in the house — and answers over HTTP.
 */
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { family_id?: string; at?: string; time_zone?: string; rules?: Record<string, boolean> };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const at = body.at ? new Date(body.at) : new Date();
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json(
      { error: "`at` must be an ISO 8601 instant", code: "invalid_request" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  let familyId = body.family_id;
  if (!familyId) {
    const { data } = await (supabase as any).from("families").select("id").limit(2);
    const families = (data ?? []) as { id: string }[];
    // Guessing on a multi-family instance would silently answer about the
    // wrong household, which is worse than refusing.
    if (families.length !== 1) {
      return NextResponse.json(
        { error: "`family_id` is required on an instance with more than one family" },
        { status: 400 }
      );
    }
    familyId = families[0].id;
  }

  try {
    resetSignalCaches();
    const signals = await collectSignals(familyId, { now: at, timeZone: body.time_zone });

    // Stored per-family settings are used, so a simulation reflects the rules
    // this family actually has on. `rules` overrides them for a what-if.
    const { data: stored } = await (supabase as any)
      .from("context_rules")
      .select("rule_id, enabled, config")
      .eq("family_id", familyId);

    const ruleState: Record<string, FamilyRuleState> = {};
    for (const row of stored ?? []) {
      ruleState[String(row.rule_id)] = {
        enabled: row.enabled !== false,
        config: (row.config ?? {}) as Record<string, unknown>,
      };
    }
    for (const [ruleId, enabled] of Object.entries(body.rules ?? {})) {
      ruleState[ruleId] = { enabled, config: ruleState[ruleId]?.config ?? {} };
    }

    const items = evaluate(signals, RULES, { ruleState });

    return NextResponse.json({
      at: at.toISOString(),
      time_zone: signals.timeZone,
      // What the rules were actually looking at, so an empty result is
      // diagnosable rather than mysterious — "no items" and "no timetable
      // loaded" look identical from the outside otherwise.
      signals: {
        events: signals.events.length,
        todos: signals.todos.length,
        lessons: signals.lessons.length,
        meals: signals.meals.length,
        birthdays: signals.birthdays.length,
        shopping_items: signals.shoppingItemCount,
        weather: signals.weather ? "available" : "not configured",
        home_assistant: signals.home ? "available" : "not configured",
      },
      items: items.map((i) => ({
        rule_id: i.ruleId,
        key: i.key,
        title: i.title,
        detail: i.detail ?? null,
        priority: i.priority,
        context: i.context,
        evidence: i.evidence ?? {},
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "simulation failed" },
      { status: 500 }
    );
  }
}
