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
import { Skeleton } from "@/components/ui/skeleton";

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

  // How many times the unreachable screen has retried by itself. Drives the
  // backoff below and nothing else.
  const [recheckAttempt, setRecheckAttempt] = useState(0);

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

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // Everything that keeps children from rendering, in one place — the early
  // returns below read from it, and so does the auto-recheck, which must not
  // keep polling once the app has come back.
  const isBlocked =
    // Still hydrating Zustand from cookies, or still restoring the device
    // session from the hardware ID.
    !isHydrated ||
    !restoreAttempted ||
    // Not authenticated on a protected path: the redirect to /join is in
    // flight, don't flash protected content in the meantime.
    (!family && !isPublicPath) ||
    // Block child rendering on protected paths until we've confirmed the
    // stored family still exists, OR while the orphan effect is racing
    // to clear the session. Without this, the dashboard mounts and fires
    // dozens of REST calls with a stale family_id before validateFamily
    // resolves, producing a wall of 409 FK-violation errors that don't
    // recover even after the redirect lands.
    (!!family &&
      !isPublicPath &&
      (!validateFamily.isFetched || validateFamily.data === false));

  // The unreachable card used to be a dead end: a button, and nothing else.
  // If Kong or Postgres goes down at 3am the wall display sat on it until
  // somebody walked up and tapped — which is the one thing a kiosk can't
  // count on. So re-check on a timer.
  //
  // Deliberately *not* window.location.reload(): if the Next.js server is
  // the thing that's down, a reload swaps our card for the browser's own
  // "site can't be reached" page, which has no retry of its own at all —
  // turning a recoverable state into a permanently dead panel. Re-running
  // the two calls that got us stuck keeps the recovery inside the app.
  //
  // The work sits behind a ref because both the mutation and the query hand
  // back a new object whenever their own state changes: an effect that
  // depended on them directly would re-arm its timer on every one of those
  // renders and never actually reach the timeout.
  const recheckRef = useRef(() => {});
  recheckRef.current = () => {
    // Let attemptRestore run again — its ref guard is what makes it
    // one-shot, and a hung request left it latched on the failed try.
    restoreAttemptedRef.current = false;
    attemptRestore();
    validateFamily.refetch();
  };

  useEffect(() => {
    if (!loadingDeadlinePassed || !isBlocked) return;

    // 30s, doubling to a 5 minute ceiling: quick enough to catch a stack
    // that came back a minute later, gentle enough not to hammer a server
    // that is still struggling through its own startup.
    const delay = Math.min(30000 * 2 ** recheckAttempt, 300000);
    const timer = setTimeout(() => {
      recheckRef.current();
      setRecheckAttempt((n) => n + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [loadingDeadlinePassed, isBlocked, recheckAttempt]);

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
            {/* Say so, rather than letting the screen look inert: whoever
                does eventually walk past should be able to tell the display
                is still trying, and not have to guess whether tapping is
                the only thing that will help. */}
            <p
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/70"
              aria-live="polite"
            >
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {t("serverUnreachableAutoRetry")}
            </p>
          </div>
        </div>
      );
    }
    // A blank screen with one 24px spinner was the entire first paint of a
    // wall display while data loaded — no clock, no layout, no branding, and on
    // a slow self-hosted stack it could sit there for seconds (audit KB-39).
    // The shell that follows is the dashboard's actual shape, so the page grows
    // into it rather than replacing it.
    return (
      <div className="min-h-screen bg-background" aria-busy="true" aria-live="polite">
        <div className="page-gradient pointer-events-none fixed inset-0 z-0" />
        <div className="relative z-10 flex min-h-screen flex-col p-4 md:p-6 lg:p-8">
          <span className="sr-only">{t("loading")}</span>

          {/* Clock block — the hero the dashboard opens on */}
          <section className="flex flex-1 flex-col items-center justify-center">
            <Skeleton className="h-[96px] w-[280px] rounded-2xl md:h-[130px] md:w-[420px]" />
            <Skeleton className="mt-4 h-4 w-48" />
            <div className="mt-10 flex items-center gap-4 md:gap-6">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <Skeleton className="size-16 rounded-full" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          </section>

          {/* Widget grid — same columns *and the same width* as the real one, so
              nothing jumps. It carried `w-[min(96vw,2200px)]`, which measures the
              window while this wrapper measures `100vw - 32px`; below 800px the
              skeleton therefore ran out under the right-hand padding. Once the
              real grid stopped doing that, the two disagreed and the cards
              visibly shifted the moment loading finished — the jump this
              skeleton exists to prevent. */}
          <section className="mt-auto grid w-full max-w-[2200px] grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-4 portrait:lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 rounded-2xl" />
            ))}
          </section>
        </div>
      </div>
    );
  };

  // Reasons are spelled out where isBlocked is built, above — it lives up
  // there because the auto-recheck effect needs the same answer.
  if (isBlocked) {
    return blockingScreen();
  }

  return <>{children}</>;
}
