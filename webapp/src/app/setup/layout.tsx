"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("setup");

  return (
    <main className="min-h-screen flex flex-col safe-area-inset relative">
      <div className="page-gradient" />
      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <Link href="/" className="text-sm font-display tracking-tight">
          Kinboard
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <LogOut className="size-4 mr-2" />
              {t("exit")}
            </Link>
          </Button>
        </div>
      </header>
      <div className="relative z-10 flex-1 flex items-start justify-center px-6 py-8">
        <div className="w-full max-w-2xl">{children}</div>
      </div>
    </main>
  );
}
