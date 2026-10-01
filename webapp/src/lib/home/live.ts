/**
 * The real dependencies of the home routes (`lib/home/devices.ts`).
 *
 * `requestConfirmation` is deliberately absent until RFC-011 Task 9 adds the
 * confirmation flow; without it a sensitive action answers 501 and never
 * reaches Home Assistant. Task 9 adds it here.
 */

import type { HomeDeps } from "@/lib/home/devices";
import { catalogueEntities, catalogueEntity } from "@/lib/home/catalogue";
import { callHaService, getHaStates } from "@/lib/home/ha-client";

export const liveHomeDeps: HomeDeps = {
  catalogueEntities,
  catalogueEntity,
  getHaStates: (familyId, entityIds) => getHaStates(familyId, entityIds),
  callHaService: (familyId, domain, service, entityId, data) =>
    callHaService(familyId, domain, service, entityId, data),
};
