"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LOCALES } from "@/i18n/locales";
import { postLocale } from "@/lib/locale-client";
import { useFamilyStore } from "@/stores/family-store";

export function LocaleSwitcher({ className }: { className?: string }) {
  const current = useLocale();
  const router = useRouter();
  const t = useTranslations("localeSwitcher");
  const { family } = useFamilyStore();
  const [pending, setPending] = useState<string | null>(null);

  async function pick(code: string) {
    if (pending) return;
    // Even when re-picking the CURRENT locale, still persist — this is the
    // repair path for families whose locale setting was never written.
    // Only the UI refresh is skipped, since there's nothing to re-render.
    const isSame = code === current;
    setPending(code);
    try {
      // family may be null on the pre-family /join switcher; the route
      // treats a missing familyId as cookie-only (no settings write).
      await postLocale(code, family?.id);
      if (!isSame) router.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background p-1 text-xs",
        className,
      )}
      role="group"
      aria-label={t("label")}
    >
      {LOCALES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => pick(code)}
          disabled={pending !== null}
          className={cn(
            // min-h-11 gives the 44px touch target without touching the
            // text size or the horizontal padding, so the pills stay narrow.
            "inline-flex min-h-11 items-center justify-center px-3 py-1 rounded-full transition-colors",
            current === code
              ? "bg-month-primary text-month-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={current === code}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
