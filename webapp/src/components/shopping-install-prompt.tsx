"use client";

import { useState, useEffect } from "react";
import { useIsStandalone } from "@/hooks";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingCart, X, Smartphone, ExternalLink, Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Link from "next/link";

const DISMISSED_COOKIE_NAME = "shopping-pwa-prompt-dismissed";
// Separate dismiss state for the "open in Safari" hint shown when the
// user is already inside the Kinboard PWA on iOS — they may dismiss
// the install prompt itself but want to be reminded later about
// installing the Shopping app from Safari, or vice versa.
const STANDALONE_HINT_DISMISSED_COOKIE = "shopping-pwa-standalone-hint-dismissed";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, days: number = 365): void {
  if (typeof document === "undefined") return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

export function ShoppingInstallPrompt() {
  const t = useTranslations("components.shoppingPrompt");
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  // Shared with /einkaufen, which hides its out-of-scope "back" link on the
  // same signal — one definition of "installed" for both.
  const isStandalone = useIsStandalone();
  const [dismissed, setDismissed] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);

  useEffect(() => {
    // Check if iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    // Check if user has dismissed this prompt before (check both cookie and localStorage for migration)
    const hasDismissedCookie = getCookie(DISMISSED_COOKIE_NAME) === "true";
    const hasDismissedLocal = localStorage.getItem(DISMISSED_COOKIE_NAME) === "true";
    const hasDismissedHint = getCookie(STANDALONE_HINT_DISMISSED_COOKIE) === "true";
    setHintDismissed(hasDismissedHint);

    if (hasDismissedCookie || hasDismissedLocal) {
      setDismissed(true);
      // Migrate to cookie if only in localStorage
      if (hasDismissedLocal && !hasDismissedCookie) {
        setCookie(DISMISSED_COOKIE_NAME, "true");
      }
      return;
    }

    // Show prompt after a short delay
    if (!isStandalone) {
      const timer = setTimeout(() => setShowPrompt(true), 2000);
      return () => clearTimeout(timer);
    }
    // Depends on isStandalone because useIsStandalone resolves after mount:
    // reading it once would schedule the prompt on an installed app before the
    // real launch mode is known. Re-running clears the timer when it flips.
  }, [isStandalone]);

  const handleDismiss = () => {
    setShowPrompt(false);
    setDismissed(true);
    // Store in both cookie (cross-PWA) and localStorage (backwards compat)
    setCookie(DISMISSED_COOKIE_NAME, "true");
    localStorage.setItem(DISMISSED_COOKIE_NAME, "true");
  };

  const handleHintDismiss = () => {
    setHintDismissed(true);
    setCookie(STANDALONE_HINT_DISMISSED_COOKIE, "true");
  };

  // Special case: inside the Kinboard PWA on iOS. The install prompt
  // can't fire here because iOS only allows "Add to Home Screen" from
  // Safari, not from another installed PWA. Show a small explainer
  // pointing the user at Safari (separately dismissible) instead of
  // silently hiding — otherwise users searching for the prompt inside
  // the PWA hit a wall with no signal as to where to find it.
  if (isStandalone && isIOS && !hintDismissed) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <Card className="p-4 border-info/30 bg-info/5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-info/20 shrink-0">
              <Compass className="size-5 text-info" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-info">{t("iosStandaloneHintTitle")}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t("iosStandaloneHintBody")}
              </p>
            </div>
            <button
              onClick={handleHintDismiss}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all shrink-0"
              aria-label={t("dismissAria")}
            >
              <X className="size-5" />
            </button>
          </div>
        </Card>
      </motion.div>
    );
  }

  // Other paths: standalone (Android or already-installed Shopping
  // PWA) or user dismissed the install prompt — show nothing.
  if (isStandalone || dismissed) {
    return null;
  }

  return (
    <AnimatePresence>
      {showPrompt && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="mb-6"
        >
          <Card className="p-4 border-success/30 bg-success/5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-success/20 shrink-0">
                <Smartphone className="size-5 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-success">{t("title")}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {isIOS ? t("iosBody") : t("androidBody")}
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Link href="/einkaufen">
                    <Button variant="outline" size="sm" className="border-success/30 hover:bg-success/10">
                      {isIOS ? (
                        <>
                          <ExternalLink className="size-4 mr-2" />
                          {t("iosOpen")}
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="size-4 mr-2" />
                          {t("androidOpen")}
                        </>
                      )}
                    </Button>
                  </Link>
                </div>
              </div>
              <button
                onClick={handleDismiss}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all shrink-0"
                aria-label={t("dismissAria")}
              >
                <X className="size-5" />
              </button>
            </div>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
