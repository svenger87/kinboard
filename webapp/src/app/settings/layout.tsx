"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isSubPage = pathname !== "/settings";

  return (
    <div className="min-h-screen relative">
      {/* Background */}
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none z-[-1]" />

      {/* Back button for sub-pages */}
      {isSubPage && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="fixed top-4 left-4 z-50 safe-area-inset"
          style={{ paddingTop: 'env(safe-area-inset-top, 0)', paddingLeft: 'env(safe-area-inset-left, 0)' }}
        >
          <Link
            href="/settings"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors group bg-background/80 backdrop-blur-sm rounded-full px-3 py-2"
          >
            <ChevronLeft className="size-5 group-hover:-translate-x-1 transition-transform" />
            <span className="text-sm font-medium hidden sm:inline">Einstellungen</span>
          </Link>
        </motion.div>
      )}

      {children}
    </div>
  );
}
