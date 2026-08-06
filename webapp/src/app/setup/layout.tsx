"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("setup");

  return (
    <main className="min-h-page flex flex-col safe-area-inset relative">
      <div className="page-gradient" />
      {/* flex-wrap: the wordmark plus the locale pills and a long "exit"
          label (fr: "Quitter l'installation") don't fit one 390px row and
          would otherwise push the whole page sideways. ml-auto keeps the
          controls right-aligned once they drop to a second line. */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
        <Link href="/" className="text-sm font-display tracking-tight">
          Kinboard
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <LogOut className="size-4 mr-2" />
              {t("exit")}
            </Link>
          </Button>
        </div>
      </header>
      {/* px-4 on phones: .safe-area-inset on <main> already contributes
          16px per side, so px-6 here left only 310px of a 390px screen. */}
      <div className="relative z-10 flex-1 flex items-start justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-2xl">{children}</div>
      </div>
    </main>
  );
}
