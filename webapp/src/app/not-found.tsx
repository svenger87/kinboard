"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Home, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function NotFound() {
  const t = useTranslations("components.notFound");
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, hsl(var(--month-primary) / 0.06) 0%, transparent 70%)" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        <GlassCard className="p-8 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring" }}
            className="mb-6"
          >
            <span className="text-7xl font-display font-light text-month-primary/30">
              404
            </span>
          </motion.div>

          <h2 className="text-2xl font-display font-light mb-2">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {t("description")}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="month" className="gap-2" asChild>
              <Link href="/">
                <Home className="size-4" />
                {t("home")}
              </Link>
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => router.back()}
            >
              <ArrowLeft className="size-4" />
              {t("back")}
            </Button>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}
