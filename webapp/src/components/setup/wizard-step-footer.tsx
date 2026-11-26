"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { WizardStep } from "@/lib/first-run";
import { useWizardNav } from "@/components/setup/use-wizard-nav";

interface Props {
  /** The step this footer is on; Back and Continue follow the family's step list (lib/first-run.ts). */
  step: WizardStep;
  onNextClick?: () => void | Promise<void>;
  /** Runs on Skip as well as after a successful Continue, before leaving; never stops the user. */
  onLeave?: () => void | Promise<void>;
  nextLabel?: string;
  /** Render the "Skip for now" button — defaults to true. Pass false for the
   *  final step where there's nothing to skip. */
  showSkip?: boolean;
  /** Disable the primary button while a save is in flight. */
  disabled?: boolean;
}

export function WizardStepFooter({
  step,
  onNextClick,
  onLeave,
  nextLabel,
  showSkip = true,
  disabled,
}: Props) {
  const t = useTranslations("setup");
  const router = useRouter();
  const { back: backHref, next: nextHref } = useWizardNav(step);

  const leave = async () => {
    try {
      if (onLeave) await onLeave();
    } catch (err) {
      // Never a reason to keep someone on a skippable step.
      console.error(`setup/${step}: leaving failed:`, err);
    }
    router.push(nextHref);
  };

  const goNext = async () => {
    try {
      if (onNextClick) await onNextClick();
    } catch {
      // The step's onNextClick threw — assume it surfaced its own error
      // (toast, inline message, etc.) and stay on the current page.
      return;
    }
    await leave();
  };

  // The footer wraps rather than overflowing: all three buttons are
  // whitespace-nowrap and cannot shrink, so on a 390px phone Back + Skip +
  // Continue need more width than the step has, and `justify-between` pins the
  // left group while pushing the right one off screen. Only the steps passing
  // `backHref` carry all three, which is why exactly those scrolled sideways.
  // German and French need noticeably more width than English, so this has to
  // hold for the longest translation rather than the shortest.
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mt-8">
      <div className="flex items-center gap-2">
        {backHref ? (
          <Button variant="ghost" size="sm" onClick={() => router.push(backHref)} data-testid="wizard-back">
            <ArrowLeft className="size-4 mr-2" />
            {t("back")}
          </Button>
        ) : (
          <span />
        )}
      </div>
      <div className="flex items-center gap-2">
        {showSkip && (
          <Button
            variant="ghost"
            size="sm"
            onClick={leave}
            disabled={disabled}
            data-testid="wizard-skip"
          >
            <X className="size-4 mr-2" />
            {t("skipStep")}
          </Button>
        )}
        <Button onClick={goNext} disabled={disabled} data-testid="wizard-continue">
          {nextLabel ?? t("continue")}
          <ArrowRight className="size-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
