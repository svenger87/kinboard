"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

/**
 * Kinboard's main job is an always-on wall display that nobody stands in
 * front of. A card whose only way out is a button press means one transient
 * render error parks the panel on an apology until somebody walks up to it —
 * so we retry on our own, on a backoff, a bounded number of times.
 *
 * The escalating delays give a flaky backend or a mid-deploy server room to
 * come back without us reloading into the same failure every few seconds,
 * and the budget runs out so a genuinely broken build settles on a readable
 * error instead of flashing forever.
 */
const AUTO_RETRY_DELAYS_MS = [20_000, 45_000, 120_000, 300_000];

/**
 * Retry bookkeeping deliberately lives at module scope rather than in state.
 * `reset()` re-runs the failing subtree, and when it throws again Next.js
 * mounts a *fresh* error boundary — component state would start over at zero
 * attempts every time, which is an infinite reload loop rather than a budget.
 *
 * It self-clears after a quiet spell so an unrelated error next week gets a
 * full budget again instead of inheriting this evening's exhausted one.
 */
let autoRetryCount = 0;
let lastAutoRetryAt = 0;
const RETRY_BUDGET_RESET_MS = 15 * 60_000;

/** Delay before the next automatic retry, or `null` once the budget is spent. */
function nextRetryDelayMs(): number | null {
  if (Date.now() - lastAutoRetryAt > RETRY_BUDGET_RESET_MS) autoRetryCount = 0;
  return AUTO_RETRY_DELAYS_MS[autoRetryCount] ?? null;
}

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

  // `null` once the budget is spent — the countdown line then says so
  // instead of pretending something is still going to happen. Seeded from
  // the same helper the effect uses, so the very first paint already shows
  // the real countdown rather than a flash of "gave up".
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() => {
    const delay = nextRetryDelayMs();
    return delay === null ? null : Math.round(delay / 1000);
  });

  // Held in a ref so the per-second countdown re-render can't restart the
  // timer: if `reset` ever changed identity between renders, an effect that
  // depended on it would reschedule every tick and never actually fire.
  const resetRef = useRef(reset);
  resetRef.current = reset;

  useEffect(() => {
    const delay = nextRetryDelayMs();
    if (delay === null) {
      setSecondsLeft(null);
      return;
    }

    const tick = setInterval(() => {
      setSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : 0));
    }, 1000);
    const timer = setTimeout(() => {
      autoRetryCount += 1;
      lastAutoRetryAt = Date.now();
      resetRef.current();
    }, delay);

    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="min-h-page flex items-center justify-center p-4 relative overflow-hidden">
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

          {/* Quiet, but never silent: an unattended panel reloading itself
              out of nowhere is confusing to whoever does eventually look. */}
          <p className="text-xs text-muted-foreground/70 mb-6" aria-live="polite">
            {secondsLeft !== null
              ? t("autoRetry", { seconds: secondsLeft })
              : t("autoRetryExhausted")}
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
