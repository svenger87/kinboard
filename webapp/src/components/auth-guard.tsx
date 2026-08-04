"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useFamilyStore } from "@/stores/family-store";
import {
  useUpdateDeviceLastSeen,
  useRestoreDeviceSession,
  useValidateStoredFamily,
} from "@/hooks/use-supabase-queries";
import { Button } from "@/components/ui/button";
import { Loader2, ServerOff } from "lucide-react";

const PUBLIC_PATHS = ["/join"];

/**
 * Where to go after joining.
 *
 * Only same-origin absolute paths are honoured, and never "/join" itself. A
 * `next` that starts with "//" is protocol-relative — the browser reads
 * "//evil.example/x" as another origin — so anything the caller supplies is
 * checked rather than trusted, even though today it only ever comes from our
 * own redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.startsWith("/join")) return "/";
  return next;
}
const HEARTBEAT_INTERVAL = 60000; // Update last_seen every 60 seconds

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("common");
  const { family, device, clearSession } = useFamilyStore();
  const [isHydrated, setIsHydrated] = useState(false);
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const updateLastSeen = useUpdateDeviceLastSeen();
  const restoreSession = useRestoreDeviceSession();
  const validateFamily = useValidateStoredFamily(family?.id);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const restoreAttemptedRef = useRef(false);
  const orphanHandledRef = useRef(false);

  // If we're still in a blocking-loading state after this long, the
  // server is likely unreachable — show an explanation instead of a
  // spinner that never resolves (Kong/Postgres down, wrong SITE_URL, …).
  const [loadingDeadlinePassed, setLoadingDeadlinePassed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoadingDeadlinePassed(true), 12000);
    return () => clearTimeout(timer);
  }, []);

  // Wait for Zustand to hydrate from cookies
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Stable restore function
  const attemptRestore = useCallback(async () => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    try {
      const result = await restoreSession.mutateAsync();
      if (result) {
        console.log("Device session restored from hardware ID");
      }
    } catch (e) {
      // No existing device found, user needs to join
      console.log("No existing device found for this hardware ID");
    } finally {
      setRestoreAttempted(true);
    }
  }, [restoreSession]);

  // Try to restore session from hardware ID if no family is set
  useEffect(() => {
    if (!isHydrated) return;

    // If family already exists (from cookie), no need to restore
    if (family) {
      setRestoreAttempted(true);
      return;
    }

    // Try to restore from hardware ID
    attemptRestore();
  }, [isHydrated, family, attemptRestore]);

  // Heartbeat: periodically update device last_seen
  useEffect(() => {
    if (!isHydrated || !device?.id) return;

    // Update immediately on mount
    updateLastSeen.mutate();

    // Then update periodically
    heartbeatRef.current = setInterval(() => {
      updateLastSeen.mutate();
    }, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, device?.id]);

  useEffect(() => {
    // Wait for hydration and restore attempt to complete
    if (!isHydrated || !restoreAttempted) return;

    const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

    // Stored family points at a row that no longer exists — typically
    // because the maintainer wiped the DB or restored an old backup.
    // Without this guard, every API call FK-violates and the UI gets
    // stuck mid-render with no signal to the user. Clear the session
    // and bounce to /join with a one-shot toast.
    if (
      family &&
      validateFamily.data === false &&
      !orphanHandledRef.current
    ) {
      orphanHandledRef.current = true;
      toast.error(
        "Your previous session was reset on the server. Joining again — your data may need to be re-imported.",
        { duration: 8000 },
      );
      clearSession();
      router.replace("/join");
      return;
    }

    // If not authenticated and not on public path, redirect to join —
    // remembering where they were going.
    //
    // Without this, joining always landed on "/". Opening the installed
    // shopping app while signed out therefore walked /einkaufen -> /join ->
    // "/", leaving the user in the main dashboard inside the shopping app's
    // window — which reads as the shopping PWA routing to the main one.
    if (!family && !isPublicPath) {
      router.replace(`/join?next=${encodeURIComponent(pathname)}`);
    }

    // If authenticated and on join page, redirect — into the wizard if
    // onboarding hasn't completed, otherwise straight to the dashboard.
    // Routing to `/setup` (root) lets the wizard's own redirector pick
    // the first incomplete step.
    //
    // The `setup_completed === false` check (rather than `!family.setup_completed`)
    // means pre-1.0.10 stored families that lack the field default to
    // the dashboard, preserving the legacy behavior for upgraders.
    if (family && pathname === "/join") {
      const target =
        (family as { setup_completed?: boolean }).setup_completed === false
          ? "/setup"
          : safeNextPath(searchParams.get("next"));
      router.replace(target);
    }
  }, [family, pathname, searchParams, router, isHydrated, restoreAttempted, validateFamily.data, clearSession]);

  const blockingScreen = () => {
    if (loadingDeadlinePassed) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-sm w-full rounded-lg border border-border bg-card p-6 text-center space-y-3">
            <ServerOff className="size-8 mx-auto text-muted-foreground" aria-hidden />
            <h1 className="font-medium">{t("serverUnreachableTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("serverUnreachableBody")}</p>
            <Button onClick={() => window.location.reload()}>
              {t("serverUnreachableRetry")}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  };

  // Show loading while hydrating or restoring
  if (!isHydrated || !restoreAttempted) {
    return blockingScreen();
  }

  // Don't render protected content until we verify auth
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  if (!family && !isPublicPath) {
    return blockingScreen();
  }

  // Block child rendering on protected paths until we've confirmed the
  // stored family still exists, OR while the orphan effect is racing
  // to clear the session. Without this, the dashboard mounts and fires
  // dozens of REST calls with a stale family_id before validateFamily
  // resolves, producing a wall of 409 FK-violation errors that don't
  // recover even after the redirect lands.
  if (
    family &&
    !isPublicPath &&
    (!validateFamily.isFetched || validateFamily.data === false)
  ) {
    return blockingScreen();
  }

  return <>{children}</>;
}
