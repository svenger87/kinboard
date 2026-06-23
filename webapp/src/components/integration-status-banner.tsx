"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface IntegrationStatusBannerMeta {
  label: string;
  value: string;
}

export interface IntegrationStatusBannerProps {
  /** Connected to the service (token/credentials present AND not rejected). */
  connected: boolean;
  /** Saved credential was rejected — show the destructive reconnect state. */
  needsReauth?: boolean;
  /** Service glyph (a lucide icon element or brand SVG). Sized by the caller. */
  icon: ReactNode;
  /** e.g. "Home Assistant" — used by the disconnected/reauth title. */
  serviceName: string;
  /** Subtitle under "Connected" (e.g. server URL or account email). */
  connectedSubtitle?: string;
  /** Extra rows under the subtitle (e.g. version, entity count). */
  meta?: IntegrationStatusBannerMeta[];
  /** Last-sync line, rendered as a meta row when connected. */
  lastSync?: string;
  /** Disconnected CTA. Omit to hide the connect button. */
  onConnect?: () => void;
  /** Connected/destructive disconnect handler. Omit to hide the disconnect button. */
  onDisconnect?: () => void;
  /** Localized "Verbunden" headline (connected state). */
  connectedLabel: string;
  /** Localized connect CTA. */
  connectLabel: string;
  /** Localized disconnect CTA. */
  disconnectLabel: string;
  /** Localized reconnect CTA (reauth state). Falls back to connectLabel. */
  reauthLabel?: string;
  /** Localized reauth headline (e.g. "Reconnect needed"). */
  reauthTitle?: string;
  /** Localized reauth body copy. */
  reauthBody?: string;
  /** Localized "Not connected" headline (disconnected state). */
  disconnectedTitle?: string;
  /** Localized disconnected body copy. */
  disconnectedBody?: string;
  className?: string;
}

/**
 * Flat connection-status banner for credential integrations.
 * - connected           → success-tint, big Check, subtitle + meta, Disconnect.
 * - needsReauth          → destructive-tint, reconnect CTA.
 * - disconnected (else)  → neutral, muted icon, Connect CTA.
 * No glass/backdrop-blur. All copy is supplied by the caller.
 */
export function IntegrationStatusBanner({
  connected,
  needsReauth = false,
  icon,
  serviceName,
  connectedSubtitle,
  meta,
  lastSync,
  onConnect,
  onDisconnect,
  connectedLabel,
  connectLabel,
  disconnectLabel,
  reauthLabel,
  reauthTitle,
  reauthBody,
  disconnectedTitle,
  disconnectedBody,
  className,
}: IntegrationStatusBannerProps) {
  const metaRows: IntegrationStatusBannerMeta[] = [
    ...(lastSync ? [{ label: "", value: lastSync }] : []),
    ...(meta ?? []),
  ];

  // ── Reconnect needed (destructive) ──
  if (needsReauth) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex items-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4",
          className
        )}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-foreground">
            {reauthTitle ?? serviceName}
          </p>
          {reauthBody && (
            <p className="mt-0.5 text-sm text-muted-foreground">{reauthBody}</p>
          )}
        </div>
        {onConnect && (
          <Button onClick={onConnect} className="shrink-0">
            {reauthLabel ?? connectLabel}
          </Button>
        )}
      </motion.div>
    );
  }

  // ── Connected (success) ──
  if (connected) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex items-center gap-4 rounded-2xl border border-success/30 bg-success/10 p-4",
          className
        )}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-success text-success-foreground">
          <Check className="size-6" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-foreground">{connectedLabel}</p>
          {connectedSubtitle && (
            <p className="truncate text-sm text-success">{connectedSubtitle}</p>
          )}
          {metaRows.length > 0 && (
            <p className="mt-0.5 truncate text-sm text-success">
              {metaRows
                .map((m) => (m.label ? `${m.label} ${m.value}` : m.value))
                .join(" · ")}
            </p>
          )}
        </div>
        {onDisconnect && (
          <Button
            variant="outline"
            onClick={onDisconnect}
            className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {disconnectLabel}
          </Button>
        )}
      </motion.div>
    );
  }

  // ── Disconnected (neutral) ──
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-4 rounded-2xl border border-border bg-card p-4 elev-sm",
        className
      )}
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display font-semibold text-foreground">
          {disconnectedTitle ?? serviceName}
        </p>
        {disconnectedBody && (
          <p className="mt-0.5 text-sm text-muted-foreground">{disconnectedBody}</p>
        )}
      </div>
      {onConnect && (
        <Button onClick={onConnect} className="shrink-0">
          {connectLabel}
        </Button>
      )}
    </motion.div>
  );
}

export default IntegrationStatusBanner;
