"use client";

import { motion } from "framer-motion";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";

const LOCALES = [
  { code: "en", label: "English", native: "English" },
  { code: "de", label: "German", native: "Deutsch" },
] as const;

export default function LanguageSettingsPage() {
  const t = useTranslations("settings.language");
  const current = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function pick(code: string) {
    if (code === current || pending) return;
    setPending(code);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: code }),
      });
      if (!response.ok) throw new Error("locale change failed");
      router.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setPending(null);
    }
  }

  return (
    <main id="main-content" className="min-h-screen p-4 md:p-8 relative safe-area-inset">
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />

      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          icon={Languages}
          backHref="/settings"
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <GlassCard className="p-6">
            <div className="space-y-3">
              {LOCALES.map(({ code, label, native }) => {
                const isCurrent = code === current;
                return (
                  <Button
                    key={code}
                    variant={isCurrent ? "default" : "outline"}
                    onClick={() => pick(code)}
                    disabled={pending !== null || isCurrent}
                    className="w-full justify-between h-auto py-4 px-5"
                  >
                    <span className="flex flex-col items-start gap-0.5">
                      <span className="font-medium">{native}</span>
                      <span className="text-xs opacity-70">{t(`name_${code}`)}</span>
                    </span>
                    {isCurrent && <span className="text-xs">{t("current")}</span>}
                    {pending === code && <span className="text-xs">…</span>}
                  </Button>
                );
              })}
            </div>
          </GlassCard>
        </motion.div>
      </div>
    </main>
  );
}
