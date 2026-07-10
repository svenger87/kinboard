"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("components.appError");
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-destructive/5 pointer-events-none" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, hsl(var(--destructive) / 0.08) 0%, transparent 70%)" }} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="p-8 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring" }}
            className="flex justify-center mb-6"
          >
            <div className="p-4 rounded-2xl bg-destructive/10 shadow-[0_0_30px_hsl(var(--destructive)/0.15)]">
              <AlertCircle className="size-10 text-destructive" strokeWidth={1.5} />
            </div>
          </motion.div>

          <h2 className="text-2xl font-display font-light mb-2">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {error.message || t("fallback")}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={reset} className="gap-2">
              <RefreshCw className="size-4" />
              {t("retry")}
            </Button>
            <Button variant="outline" className="gap-2" asChild>
              <Link href="/">
                <Home className="size-4" />
                {t("home")}
              </Link>
            </Button>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
