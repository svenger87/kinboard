"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { settingsBackHref } from "@/lib/constants";
import { useTranslations } from "next-intl";
import { PinGuard } from "@/components/pin-guard";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isSubPage = pathname !== "/settings";
  const t = useTranslations("settings");

  return (
    <PinGuard cancelHref="/">
      <div className="min-h-page relative">
      {/* Background */}
      <div className="page-gradient fixed inset-0 pointer-events-none z-[-1]" />

      {/* Back button for sub-pages */}
      {isSubPage && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="fixed top-4 left-4 z-50 safe-area-inset"
          style={{ paddingTop: 'env(safe-area-inset-top, 0)', paddingLeft: 'env(safe-area-inset-left, 0)' }}
        >
          <Link
            href={settingsBackHref(pathname)}
            // The label is `hidden sm:inline`, so below 640px this link is an
            // icon alone. Without an explicit name it reached assistive tech as
            // an unnamed link on all 18 settings sub-pages — and it is the only
            // way back out of them on a phone (audit KB-17).
            aria-label={t("layoutBackLabel")}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors group bg-card border border-border rounded-full px-3 py-2 elev-sm"
          >
            <ChevronLeft className="size-5 group-hover:-translate-x-1 transition-transform" strokeWidth={1.75} />
            <span className="text-sm font-medium hidden sm:inline">{t("layoutBackLabel")}</span>
          </Link>
        </motion.div>
      )}

      {children}
    </div>
    </PinGuard>
  );
}
