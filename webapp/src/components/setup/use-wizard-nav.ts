"use client";

import { useInstanceSetup } from "@/hooks/use-instance-setup";
import { installStepsListed, stepNeighbours, wizardSteps, type WizardStep } from "@/lib/first-run";

/**
 * The wizard's steps for this family and where Back and Continue lead from
 * `current`. The install's two steps (RFC-024 §8) are in the list only for
 * the install's operator during its own first run; until that is known, the
 * family's steps alone, which is what every other family sees.
 */
export function useWizardNav(current: WizardStep) {
  const { data: instance } = useInstanceSetup();
  const steps = wizardSteps(installStepsListed(instance));
  const { back, next } = stepNeighbours(steps, current);
  return { steps, back, next, instance };
}
