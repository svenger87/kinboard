"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { usePWA, useIdleTimeout } from "@/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";

/**
 * How long the device has to go untouched before a pending update installs
 * itself. Long enough that it never interrupts someone mid-task on a phone,
 * short enough that the kitchen panel is never more than a few minutes of
 * quiet away from the current build.
 */
const UPDATE_IDLE_DELAY_MS = 5 * 60 * 1000;

/**
 * Applying an update reloads the page, and the reload is what clears the
 * "update available" flag. If an update ever fails to take — a worker that
 * won't hand over, a cache serving the old build back — the flag returns and
 * the kiosk would reload itself every five minutes, forever. Remembering the
 * last automatic attempt across the reload caps that at roughly two an hour
 * while still letting a genuine later update through; the manual "Refresh"
 * action is never gated by it.
 */
const AUTO_UPDATE_COOLDOWN_MS = 30 * 60 * 1000;
const AUTO_UPDATE_MARKER_KEY = "pwa-auto-update-last-attempt";

/**
 * PWA Provider component that handles service worker registration
 * and shows update/install prompts
 */
export function PWAProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("components.pwa");
  const { isUpdateAvailable, updateServiceWorker, isInstallable, promptInstall } = usePWA();

  // Why an idle timer of our own rather than the screensaver's idle state:
  // PWAProvider sits *above* ScreensaverProvider in the tree (see providers.tsx),
  // so that state isn't reachable as context — and it wouldn't be enough
  // anyway, because the screensaver deliberately never activates on phones,
  // on handheld-width screens, or when the family has set the timeout to
  // "off". Those devices still need to leave a stale build behind. This is
  // the same hook the screensaver is built on, just with a longer fuse.
  const { isIdle } = useIdleTimeout({ timeout: UPDATE_IDLE_DELAY_MS });

  // Show update toast when new version is available
  useEffect(() => {
    if (isUpdateAvailable) {
      toast(t("updateTitle"), {
        description: t("updateDescriptionAuto"),
        duration: Infinity,
        action: {
          label: t("updateAction"),
          onClick: updateServiceWorker,
        },
        icon: <RefreshCw className="size-4" />,
      });
    }
  }, [isUpdateAvailable, updateServiceWorker, t]);

  // Apply the update unattended.
  //
  // The toast alone made the wall display the worst case of both halves: a
  // notice that never expires, sitting over the clock all evening, on a
  // device where nobody is there to press "Refresh" — so the kiosk could run
  // a stale build indefinitely. Waiting for idle keeps the polite behaviour
  // for someone actually holding a phone: the reload only lands once they've
  // put it down.
  const hasAppliedRef = useRef(false);
  useEffect(() => {
    if (!isUpdateAvailable || !isIdle || hasAppliedRef.current) return;

    const lastAttempt = Number(localStorage.getItem(AUTO_UPDATE_MARKER_KEY) ?? 0);
    if (Date.now() - lastAttempt < AUTO_UPDATE_COOLDOWN_MS) return;

    hasAppliedRef.current = true;
    localStorage.setItem(AUTO_UPDATE_MARKER_KEY, String(Date.now()));
    updateServiceWorker();
  }, [isUpdateAvailable, isIdle, updateServiceWorker]);

  // Show install toast after a delay (only on first visit)
  useEffect(() => {
    if (!isInstallable) return;

    // Check if we've already shown the prompt
    const hasShownPrompt = localStorage.getItem("pwa-install-prompt-shown");
    if (hasShownPrompt) return;

    // Show after 30 seconds
    const timer = setTimeout(() => {
      toast(t("installTitle"), {
        description: t("installDescription"),
        duration: 10000,
        action: {
          label: t("installAction"),
          onClick: async () => {
            await promptInstall();
            localStorage.setItem("pwa-install-prompt-shown", "true");
          },
        },
        icon: <Download className="size-4" />,
      });
      localStorage.setItem("pwa-install-prompt-shown", "true");
    }, 30000);

    return () => clearTimeout(timer);
  }, [isInstallable, promptInstall, t]);

  return <>{children}</>;
}

/**
 * Install button component for settings page
 */
export function InstallButton() {
  const t = useTranslations("components.pwa");
  const { isInstallable, isInstalled, promptInstall } = usePWA();

  if (isInstalled) {
    return (
      <Button variant="outline" disabled className="gap-2">
        <Download className="size-4" />
        {t("alreadyInstalled")}
      </Button>
    );
  }

  if (!isInstallable) {
    return null;
  }

  return (
    <Button onClick={promptInstall} className="gap-2">
      <Download className="size-4" />
      {t("installButton")}
    </Button>
  );
}
