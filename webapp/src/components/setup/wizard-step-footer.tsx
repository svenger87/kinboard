"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

interface Props {
  backHref?: string;
  nextHref: string;
  onNextClick?: () => void | Promise<void>;
  nextLabel?: string;
  /** Render the "Skip for now" button — defaults to true. Pass false for the
   *  final step where there's nothing to skip. */
  showSkip?: boolean;
  /** Disable the primary button while a save is in flight. */
  disabled?: boolean;
}

export function WizardStepFooter({
  backHref,
  nextHref,
  onNextClick,
  nextLabel,
  showSkip = true,
  disabled,
}: Props) {
  const t = useTranslations("setup");
  const router = useRouter();

  const goNext = async () => {
    if (onNextClick) await onNextClick();
    router.push(nextHref);
  };

  return (
    <div className="flex items-center justify-between mt-8">
      <div className="flex items-center gap-2">
        {backHref ? (
          <Button variant="ghost" size="sm" onClick={() => router.push(backHref)}>
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
            onClick={() => router.push(nextHref)}
            disabled={disabled}
          >
            <X className="size-4 mr-2" />
            {t("skipStep")}
          </Button>
        )}
        <Button variant="month" onClick={goNext} disabled={disabled}>
          {nextLabel ?? t("continue")}
          <ArrowRight className="size-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
