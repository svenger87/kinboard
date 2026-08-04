"use client";

import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Hook for PWA service worker registration
 */
export function useServiceWorker() {
  const [isRegistered, setIsRegistered] = useState(false);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const registerSW = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        setRegistration(reg);
        setIsRegistered(true);
        console.log("[PWA] Service worker registered");

        // A worker can already be waiting when the page loads — the
        // update was found during a previous visit and never applied.
        // `updatefound` won't fire again for it, so without this the
        // prompt never appears and the instance sits on the old build.
        if (reg.waiting && navigator.serviceWorker.controller) {
          setIsUpdateAvailable(true);
        }

        // Check for updates
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                setIsUpdateAvailable(true);
                console.log("[PWA] New version available");
              }
            });
          }
        });
      } catch (error) {
        console.error("[PWA] Service worker registration failed:", error);
      }
    };

    registerSW();
  }, []);

  const updateServiceWorker = useCallback(() => {
    const waiting = registration?.waiting;
    if (!waiting) {
      // Nothing is waiting — either there is no update, or the page has
      // been open long enough that the worker already took over. Reload
      // anyway rather than leaving the button inert, which is what it
      // used to be: install() called skipWaiting(), so `waiting` was
      // always null and this whole function was a no-op.
      window.location.reload();
      return;
    }

    // Reload once the new worker is actually in control. Reloading
    // immediately after posting the message races activation, and a page
    // that reloads too early is served by the OLD worker and comes back
    // on the old build — the update appearing not to have worked.
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => window.location.reload(),
      { once: true },
    );

    // If activation never completes, fall back rather than leaving the
    // user staring at a button that did something invisible.
    const fallback = window.setTimeout(() => window.location.reload(), 3000);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => window.clearTimeout(fallback),
      { once: true },
    );

    waiting.postMessage("skipWaiting");
  }, [registration]);

  return { isRegistered, isUpdateAvailable, updateServiceWorker };
}

/**
 * Hook for PWA install prompt
 */
export function useInstallPrompt() {
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if already installed
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
      console.log("[PWA] Install prompt available");
    };

    // Listen for successful install
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      console.log("[PWA] App installed");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === "accepted") {
        setIsInstalled(true);
        setIsInstallable(false);
      }

      setDeferredPrompt(null);
      return outcome === "accepted";
    } catch (error) {
      console.error("[PWA] Install prompt error:", error);
      return false;
    }
  }, [deferredPrompt]);

  return { isInstallable, isInstalled, promptInstall };
}

/**
 * Combined PWA hook
 */
export function usePWA() {
  const sw = useServiceWorker();
  const install = useInstallPrompt();

  return {
    ...sw,
    ...install,
  };
}
