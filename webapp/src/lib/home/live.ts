/**
 * The real dependencies of the home routes (`lib/home/devices.ts`).
 *
 * `requestConfirmation` stores a sensitive action and pushes the family
 * (`lib/home/action-requests.ts`, RFC-011 §4.3); `recordAction` writes the
 * attribution row for an action that ran without confirmation (RFC-011 §7).
 */

import type { HomeDeps } from "@/lib/home/devices";
import { catalogueEntities, catalogueEntity } from "@/lib/home/catalogue";
import { callHaService, getHaState, getHaStates } from "@/lib/home/ha-client";
import { createActionRequest, recordHomeAction } from "@/lib/home/action-requests";
import { liveActionStore, pushActionRequest } from "@/lib/home/action-requests-live";
import { familyHasPin } from "@/lib/settings-pin";
import { createAdminClient } from "@/lib/supabase/server";
import { CONFIRM_MAX_PENDING, confirmationBudget, hitConfirmLimit } from "@/lib/integration-limits";

export const liveHomeDeps: HomeDeps = {
  catalogueEntities,
  catalogueEntity,
  getHaStates: (familyId, entityIds) => getHaStates(familyId, entityIds),
  getHaState: (familyId, entityId) => getHaState(familyId, entityId),
  callHaService: (familyId, domain, service, entityId, data) =>
    callHaService(familyId, domain, service, entityId, data),
  requestConfirmation: async (request) => {
    const { id, expiresAt } = await createActionRequest(
      {
        familyId: request.familyId,
        tokenId: request.tokenId,
        clientName: request.tokenName,
        entityId: request.entityId,
        entityName: request.entityName,
        room: request.room,
        domain: request.domain,
        service: request.service,
        data: request.data,
      },
      { store: liveActionStore, push: pushActionRequest },
    );
    return { requestId: id, expiresAt };
  },
  familyHasPin: (familyId) => familyHasPin(familyId),
  confirmationBudget: async (familyId, tokenId) => {
    const now = new Date();
    const { data, error } = await (createAdminClient() as any)
      .from("assistant_action_requests")
      .select("expires_at")
      .eq("family_id", familyId)
      .eq("token_id", tokenId)
      .eq("status", "pending")
      .gt("expires_at", now.toISOString())
      .limit(CONFIRM_MAX_PENDING);
    if (error) throw new Error(`Failed to count pending requests: ${error.message}`);
    const expiries = ((data ?? []) as { expires_at: string }[]).map((r) => r.expires_at);
    return confirmationBudget(expiries, now, () => hitConfirmLimit(tokenId));
  },
  recordAction: (record) =>
    recordHomeAction(
      {
        familyId: record.familyId,
        tokenId: record.tokenId,
        clientName: record.tokenName,
        entityId: record.entityId,
        entityName: record.entityName,
        domain: record.domain,
        service: record.service,
        data: record.data,
        ok: record.ok,
        status: record.status,
      },
      { store: liveActionStore },
    ),
};
