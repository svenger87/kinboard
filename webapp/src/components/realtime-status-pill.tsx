"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRealtimeStatusStore } from "@/stores/realtime-status-store";

// Grace period before the pill appears: brief flaps during page
// navigation or supabase-js's own rejoin shouldn't flash a warning.
const SHOW_AFTER_MS = 5000;

export function RealtimeStatusPill() {
  const t = useTranslations("common");
  const status = useRealtimeStatusStore((s) => s.status);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status !== "disconnected") {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-warning/40 bg-card px-3 py-1.5 text-xs text-muted-foreground elev-md"
      style={{ bottom: "calc(var(--nav-spacing, 0px) + 0.75rem)" }}
    >
      <WifiOff className="size-3.5 text-warning" aria-hidden />
      {t("liveUpdatesPaused")}
    </div>
  );
}
