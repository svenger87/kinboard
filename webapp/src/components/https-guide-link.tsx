"use client";

import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { HTTPS_GUIDE_URL } from "@/lib/https-guide";

/**
 * "How to get HTTPS", linking the wiki's HTTPS page: the one link the app
 * shows wherever plain http keeps something off (the scanner's live camera,
 * push in the first-run sequence). One component so they all say the same.
 */
export function HttpsGuideLink({ testId }: { testId: string }) {
  const t = useTranslations("common");
  return (
    <a
      href={HTTPS_GUIDE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
      data-testid={testId}
    >
      {t("httpsGuide")}
      <ExternalLink className="size-3" />
    </a>
  );
}
