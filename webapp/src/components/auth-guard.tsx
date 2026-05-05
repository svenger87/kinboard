"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { useFamilyStore } from "@/stores/family-store";
import {
  useUpdateDeviceLastSeen,
  useRestoreDeviceSession,
  useValidateStoredFamily,
} from "@/hooks/use-supabase-queries";
import { Loader2 } from "lucide-react";

const PUBLIC_PATHS = ["/join"];
const HEARTBEAT_INTERVAL = 60000; // Update last_seen every 60 seconds

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { family, device, clearSession } = useFamilyStore();
  const [isHydrated, setIsHydrated] = useState(false);
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const updateLastSeen = useUpdateDeviceLastSeen();
  const restoreSession = useRestoreDeviceSession();
  const validateFamily = useValidateStoredFamily(family?.id);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const restoreAttemptedRef = useRef(false);
  const orphanHandledRef = useRef(false);

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

    // If not authenticated and not on public path, redirect to join
    if (!family && !isPublicPath) {
      router.replace("/join");
    }

    // If authenticated and on join page, redirect to dashboard
    if (family && pathname === "/join") {
      router.replace("/");
    }
  }, [family, pathname, router, isHydrated, restoreAttempted, validateFamily.data, clearSession]);

  // Show loading while hydrating or restoring
  if (!isHydrated || !restoreAttempted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Don't render protected content until we verify auth
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  if (!family && !isPublicPath) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
