"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSetupState } from "@/hooks";
import { useInstanceSetup } from "@/hooks/use-instance-setup";
import { firstIncompleteStep, installStepsDue, stepHref } from "@/lib/first-run";

export default function SetupRootPage() {
  const router = useRouter();
  const { data: state, isLoading } = useSetupState();
  const { data: instance, isLoading: instanceLoading } = useInstanceSetup();

  useEffect(() => {
    if (isLoading || instanceLoading || !state) return;
    // Send the user to the first incomplete step: the install's own steps
    // first, once, for its operator (RFC-024 §8), then the family's.
    // Skipping is fine — the user comes back here via the dashboard
    // checklist; we always route forward, never back.
    router.replace(stepHref(firstIncompleteStep(state, installStepsDue(instance))));
  }, [isLoading, instanceLoading, state, instance, router]);

  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}
