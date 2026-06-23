"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
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
        <div className="inline-flex items-center justify-center size-20 icon-badge rounded-3xl mb-4">
          <Sparkles className="size-10" strokeWidth={1.75} />
        </div>
        <h1 className="text-3xl font-display font-medium tracking-tight">{t("title")}</h1>
      </div>
      <Card>
        <CardContent className="p-6 md:p-8">
          <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>
          <Button size="kiosk" className="w-full" asChild>
            <Link href="/">
              {t("cta")}
              <ArrowRight className="size-4 ml-2" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
