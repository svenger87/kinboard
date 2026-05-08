"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { AnimatePresence } from "framer-motion";
import { useRealtimeSync, useIdleTimeout } from "@/hooks";
import { useScreensaverSettings } from "@/hooks/use-screensaver-settings";
import { usePresence } from "@/hooks/use-presence";
import { useFamilyStore } from "@/stores/family-store";
import { Screensaver } from "@/components/screensaver";
import { AuthGuard } from "@/components/auth-guard";
import { PWAProvider } from "@/components/pwa-provider";
import { KioskProvider } from "@/components/kiosk-provider";
import { ThemeSettingsProvider } from "@/components/theme-settings-provider";
import { MobileNav } from "@/components/mobile-nav";
import { DesktopNav } from "@/components/desktop-nav";
import { PageShell } from "@/components/page-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { isNoNavPath } from "@/lib/constants";

// Helper functions for cookie migration
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

// Migrate localStorage to cookies for cross-PWA sharing
function useMigrateStorage() {
  useEffect(() => {
    const STORAGE_KEY = "family-calendar-storage";
    const MIGRATION_KEY = "family-calendar-migrated-to-cookies";

    // Only migrate once
    if (typeof window === "undefined") return;
    if (localStorage.getItem(MIGRATION_KEY)) return;

    // Check if there's data in localStorage but not in cookies
    const localData = localStorage.getItem(STORAGE_KEY);
    const cookieData = getCookie(STORAGE_KEY);

    if (localData && !cookieData) {
      // Migrate localStorage to cookies
      setCookie(STORAGE_KEY, localData);
      console.log("Migrated family-calendar storage from localStorage to cookies");
    }

    // Mark migration as complete
    localStorage.setItem(MIGRATION_KEY, "true");
  }, []);
}

// Component to enable realtime subscriptions
function RealtimeProvider({ children }: { children: ReactNode }) {
  useRealtimeSync();
  return <>{children}</>;
}

// Component to handle storage migration
function StorageMigration({ children }: { children: ReactNode }) {
  useMigrateStorage();
  return <>{children}</>;
}

// Global screensaver - activates on idle on any page (except join/shopping)
function ScreensaverProvider({ children }: { children: ReactNode }) {
  const { screensaverTimeout, presenceTimeout } = useScreensaverSettings();
  const { device } = useFamilyStore();
  const hasPresenceSensor = device?.has_presence_sensor ?? false;
  const presence = usePresence(3000);

  const timeoutMs = screensaverTimeout > 0 ? screensaverTimeout * 1000 : Infinity;
  const presenceTimeoutMs = presenceTimeout * 1000;

  const { isIdle } = useIdleTimeout({
    timeout: timeoutMs,
    presenceDetected: presence.detected,
    presenceEnabled: hasPresenceSensor && !presence.stale,
    presenceTimeout: presenceTimeoutMs,
  });

  // Check if current path should skip screensaver
  const [skipScreensaver, setSkipScreensaver] = useState(false);
  useEffect(() => {
    const path = window.location.pathname;
    setSkipScreensaver(isNoNavPath(path));
  }, []);

  // Hide nav bars during screensaver to save GPU (backdrop-blur is expensive on ARM)
  const showScreensaver = isIdle && !skipScreensaver;
  useEffect(() => {
    if (showScreensaver) {
      document.documentElement.setAttribute("data-screensaver", "true");
    } else {
      document.documentElement.removeAttribute("data-screensaver");
    }
    return () => document.documentElement.removeAttribute("data-screensaver");
  }, [showScreensaver]);

  return (
    <>
      {children}
      <AnimatePresence>
        {showScreensaver && <Screensaver key="screensaver" />}
      </AnimatePresence>
    </>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // Garbage collect after 5 min
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <Toaster position="bottom-right" richColors />
        <StorageMigration>
          <AuthGuard>
            <ThemeSettingsProvider>
              <KioskProvider>
                <PWAProvider>
                  <RealtimeProvider>
                    <ErrorBoundary>
                      <ScreensaverProvider>
                        <PageShell>
                          {children}
                        </PageShell>
                        <MobileNav />
                        <DesktopNav />
                        <KeyboardShortcutsDialog />
                      </ScreensaverProvider>
                    </ErrorBoundary>
                  </RealtimeProvider>
                </PWAProvider>
              </KioskProvider>
            </ThemeSettingsProvider>
          </AuthGuard>
        </StorageMigration>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
