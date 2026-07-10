"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { usePWA } from "@/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";

/**
 * PWA Provider component that handles service worker registration
 * and shows update/install prompts
 */
export function PWAProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("components.pwa");
  const { isUpdateAvailable, updateServiceWorker, isInstallable, promptInstall } = usePWA();

  // Show update toast when new version is available
  useEffect(() => {
    if (isUpdateAvailable) {
      toast(t("updateTitle"), {
        description: t("updateDescription"),
        duration: Infinity,
        action: {
          label: t("updateAction"),
          onClick: updateServiceWorker,
        },
        icon: <RefreshCw className="size-4" />,
      });
    }
  }, [isUpdateAvailable, updateServiceWorker, t]);

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
