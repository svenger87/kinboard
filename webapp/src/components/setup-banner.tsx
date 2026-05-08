"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { ArrowRight, X } from "lucide-react";
import { useSetupState } from "@/hooks";

const DISMISSED_KEY = "kinboard:setup_banner_dismissed";

export function SetupBanner() {
  const t = useTranslations("setup.banner");
  const { data: state } = useSetupState();
  // Start hidden until LS is read; otherwise the banner would flash
  // during hydration before localStorage is available.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "true");
  }, []);

  if (dismissed) return null;
  if (!state) return null;
  if (state.setup_completed) return null;

  return (
    <GlassCard className="p-3 mb-4 border-month-primary/30 bg-month-primary/5">
      <div className="flex items-center gap-3">
        <p className="flex-1 text-sm">{t("message")}</p>
        <Button variant="month" size="sm" asChild>
          <Link href="/setup">
            {t("resume")}
            <ArrowRight className="size-3 ml-1" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, "true");
            setDismissed(true);
          }}
          aria-label={t("dismiss")}
        >
          <X className="size-4" />
        </Button>
      </div>
    </GlassCard>
  );
}
