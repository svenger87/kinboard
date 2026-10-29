"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  blockedAsMixedContent,
  dashboardFrameUrl,
  EMBED_HELP_URL,
  FRAME_HINT_MS,
  frameAllow,
} from "@/lib/ha-embed";
import type { HaEmbeddedDashboard } from "@/types/home-assistant";

interface HaDashboardFrameProps {
  dashboard: HaEmbeddedDashboard;
  /** The address a browser opens Home Assistant at (`embedBaseUrl`). */
  baseUrl: string | undefined;
}

/**
 * One Home Assistant dashboard, drawn by Home Assistant inside a frame that
 * fills the rest of the screen. Kinboard cannot see into it: when Home
 * Assistant refuses to be shown inside another page, the browser puts its own
 * error page in the frame (and calls it loaded), so every newly opened tab
 * shows its help link under the frame for a few seconds.
 *
 * Sandboxed with what Home Assistant needs — its scripts, its storage (to stay
 * signed in), its forms, popups and dialogs — and without
 * `allow-top-navigation`, so nothing framed can send the whole display away
 * from Kinboard. That holds only while Home Assistant is on an origin of its
 * own (a sibling subdomain is fine): under Kinboard's own origin, scripts and
 * the same origin together could reach into Kinboard's page. The microphone
 * reaches the frame only when the tab is switched on for it (`frameAllow`),
 * and only on an https Kinboard: browsers keep it from any frame whose page
 * isn't a secure context. The camera stays off — Kinboard's Permissions-Policy
 * refuses it to the page and every frame in it.
 */
export function HaDashboardFrame({ dashboard, baseUrl }: HaDashboardFrameProps) {
  const t = useTranslations("homeAutomation");
  const src = dashboardFrameUrl(baseUrl, dashboard);
  const [loaded, setLoaded] = useState(false);
  const [hint, setHint] = useState(true);
  // The page's protocol is only known in the browser; the first render is the server's.
  const [mixed, setMixed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setHint(true);
    setMixed(src !== null && blockedAsMixedContent(window.location.protocol, src));
    const timer = setTimeout(() => setHint(false), FRAME_HINT_MS);
    return () => clearTimeout(timer);
  }, [src]);

  if (src === null || mixed) {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-sm">{src === null ? t("dashboardNoAddress") : t("dashboardMixedContent")}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href="/settings/homeassistant/dashboards">{t("dashboardSettingsLink")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border bg-card"
      style={{ height: "calc(100dvh - var(--nav-spacing) - 14rem)", minHeight: "24rem" }}
    >
      <iframe
        key={src}
        src={src}
        title={t("dashboardFrameTitle", { name: dashboard.title })}
        className="absolute inset-0 size-full border-0"
        allow={frameAllow(dashboard)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
      />
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t("dashboardLoading", { name: dashboard.title })}</p>
        </div>
      )}
      {hint && (
        <p className="absolute inset-x-0 bottom-0 border-t border-border bg-card px-4 py-2 text-center text-xs text-muted-foreground">
          {t("dashboardSlowHint")}{" "}
          <a href={EMBED_HELP_URL} target="_blank" rel="noopener noreferrer" className="underline">
            {t("dashboardHelpLink")}
          </a>
        </p>
      )}
    </div>
  );
}
