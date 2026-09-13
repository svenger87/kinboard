import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import type { HomeAssistantSettings, HAServiceCall } from "@/types/home-assistant";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

// POST: Call a Home Assistant service
// Proxies the household's own Home Assistant with the token stored for that
// family — see the note in ../route.ts. This is the verb that acts rather
// than reads: unlocking a door is a service call.
/**
 * Home Assistant's REST `/api/services/...` **blocks until the service
 * finishes**, so this timeout is a bound on the device, not on the network.
 *
 * It was 10s, which a real device beats: an LG soundbar asked to switch to a
 * radio source turned on, switched, and took longer than that to say so — and
 * Kinboard told the household it had failed while they watched it work.
 *
 * 30s is long enough for a device that has to wake up and change inputs, and
 * still short enough that a genuinely unreachable Home Assistant does not hold
 * the handler open.
 */
const SERVICE_CALL_TIMEOUT_MS = 30_000;

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { family_id, domain, service, entity_id, service_data } = body as HAServiceCall & { family_id: string };

    if (!family_id) {
      return NextResponse.json(
        { error: "family_id is required" },
        { status: 400 }
      );
    }

    if (!familyMatchesSession(auth.session, family_id)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    if (!domain || !service) {
      return NextResponse.json(
        { error: "domain and service are required" },
        { status: 400 }
      );
    }

    // Get Home Assistant settings (with secrets merged in) from Supabase
    const haSettings = await getMergedSetting<HomeAssistantSettings>(family_id, "home_assistant");

    if (!haSettings) {
      return NextResponse.json(
        { error: "Home Assistant not configured" },
        { status: 401 }
      );
    }

    if (!haSettings.url || !haSettings.access_token) {
      return NextResponse.json(
        { error: "Home Assistant URL or access token not configured" },
        { status: 401 }
      );
    }

    // Build service call payload
    const payload: Record<string, unknown> = { ...service_data };
    if (entity_id) {
      payload.entity_id = entity_id;
    }

    // Call Home Assistant service
    const response = await fetch(
      `${haSettings.url}/api/services/${domain}/${service}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${haSettings.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SERVICE_CALL_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Home Assistant service call error:", response.status, errorText);
      return NextResponse.json(
        { error: `Service call failed: ${response.status}` },
        { status: response.status }
      );
    }

    // Service calls return the new states of affected entities
    const result = await response.json();

    return NextResponse.json({
      success: true,
      affected_entities: result.length || 0,
    });
  } catch (err) {
    /*
      A timeout is not a failure, and saying so was the bug.

      The request reached Home Assistant; what ran out was our patience waiting
      for it to confirm. Reporting failure for a command the household can see
      working is the same wall-panel lie as claiming success for one that did
      nothing, just inverted — and the client already knows how to handle "we
      do not know yet": the optimistic value stands until a poll agrees with
      it, disagrees with it, or the settle elapses.

      So: 202, which `response.ok` accepts, leaving that machinery to decide.
    */
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      console.warn(
        `Home Assistant did not confirm the service call within ${SERVICE_CALL_TIMEOUT_MS}ms; ` +
          `it was delivered, and the next poll decides what happened`,
      );
      return NextResponse.json({ success: true, timedOut: true }, { status: 202 });
    }
    console.error("Error calling Home Assistant service:", err);
    return NextResponse.json(
      { error: "Failed to call Home Assistant service" },
      { status: 500 }
    );
  }
}
