/**
 * The real dependencies of the home routes (`lib/home/devices.ts`).
 *
 * `requestConfirmation` stores a sensitive action and pushes the family
 * (`lib/home/action-requests.ts`, RFC-011 §4.3) — or, for an assistant the
 * family trusts, runs it now through the confirm path (`submitActionRequest`); `recordAction` writes the
 * attribution row for an action that ran without confirmation (RFC-011 §7).
 */

import type { HomeDeps } from "@/lib/home/devices";
import { catalogueEntities, catalogueEntity } from "@/lib/home/catalogue";
import { callHaService, getHaState, getHaStates } from "@/lib/home/ha-client";
import { recordHomeAction, submitActionRequest } from "@/lib/home/action-requests";
import { liveActionStore, liveConfirmationBudget, liveSubmitDeps } from "@/lib/home/action-requests-live";
import { familyHasPin } from "@/lib/settings-pin";

export const liveHomeDeps: HomeDeps = {
  catalogueEntities,
  catalogueEntity,
  getHaStates: (familyId, entityIds) => getHaStates(familyId, entityIds),
  getHaState: (familyId, entityId) => getHaState(familyId, entityId),
  callHaService: (familyId, domain, service, entityId, data) =>
    callHaService(familyId, domain, service, entityId, data),
  requestConfirmation: async (request) => {
    const { id, expiresAt, request: ran } = await submitActionRequest(
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
      liveSubmitDeps,
    );
    return { requestId: id, expiresAt, ran };
  },
  familyHasPin: (familyId) => familyHasPin(familyId),
  confirmationBudget: liveConfirmationBudget,
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
