import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { fingerprintRequest, validateIdempotencyKey, withIdempotency } from "@/lib/integration-idempotency";
import { createListTasks } from "@/lib/integration-tasks";

export const dynamic = "force-dynamic";

const SERVICE = "tasks/batch";

/**
 * POST /api/integration/v1/tasks/batch
 *
 * Several tasks at once, all or none (`create_tasks`, a morning routine):
 * `{ tasks: [...] }`, 1 to 15, each with exactly the fields
 * POST /lists/tasks takes, checked the same way (lib/integration-tasks.ts).
 * A refused task is a 400 naming it by position and title, and nothing is
 * written; the rows are then inserted in one statement, so a failure there
 * keeps none of them. tasks:write, as for one task.
 *
 * The Idempotency-Key is required and reserved before anything runs
 * (`withIdempotency`): a second request with it while the first runs is 409
 * `in_progress`, a retry after a 201 replays it, and the same key with other
 * tasks is 409. A refusal gives the key back, so a corrected retry may use
 * it. A throw once the insert was sent keeps the key: whether the tasks were
 * written is then for list_tasks to say, never for a second insert.
 */
export async function POST(request: NextRequest) {
  return withIntegrationAuth(request, "tasks:write", async (context) => {
    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json(
        { error: "an Idempotency-Key header is required when creating tasks", code: "invalid_request" },
        { status: 400 },
      );
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    try {
      const result = await withIdempotency(
        {
          familyId: context.familyId, key: key.key, service: SERVICE,
          requestHash: fingerprintRequest(SERVICE, body),
          remember: (r) => r.status === 201,
        },
        async (markExecuting) => {
          const out = await createListTasks(createAdminClient({ actor: "integration" }), context.familyId, body, markExecuting);
          return { status: out.status, body: out.response };
        },
      );
      return NextResponse.json(result.body, { status: result.status, headers: result.headers });
    } catch (err) {
      await logApiError("integration/tasks/batch", err);
      return NextResponse.json(
        {
          error: "Could not create the tasks. They are written in one step, so either all of them were created or none: list_tasks shows which.",
          code: "internal_error",
        },
        { status: 500 },
      );
    }
  });
}
