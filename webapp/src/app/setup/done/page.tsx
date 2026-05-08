"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight } from "lucide-react";
import { useMarkSetupCompleted } from "@/hooks";

export default function SetupDonePage() {
  const t = useTranslations("setup.done");
  const mark = useMarkSetupCompleted();

  useEffect(() => {
    // Fire-and-forget: flip setup_completed on the server so the
    // dashboard banner stops nagging this family. Idempotent — calling
    // again on an already-completed family is a no-op.
    mark.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center size-20 rounded-2xl bg-month-primary/10 border border-month-primary/20 mb-4">
          <Sparkles className="size-10 text-month-primary" strokeWidth={1.5} />
        </div>
        <h1 className="text-3xl font-display tracking-tight">{t("title")}</h1>
      </div>
      <GlassCard className="p-6 md:p-8">
        <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>
        <Button variant="month" size="lg" className="w-full" asChild>
          <Link href="/">
            {t("cta")}
            <ArrowRight className="size-4 ml-2" />
          </Link>
        </Button>
      </GlassCard>
    </>
  );
}
