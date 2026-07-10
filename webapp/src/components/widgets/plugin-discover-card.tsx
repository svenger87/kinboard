"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { X, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PluginDiscoverCardProps {
  /** Plugin id — also keys the per-device dismissal in localStorage. */
  pluginId: string;
  icon: LucideIcon;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}

// Shown in place of a plugin widget that the user has made visible (in
// /settings/widgets) but which has nothing to render yet — either the
// plugin is disabled, or it's enabled but has no data. Without this the
// widget silently returns null and the user who just turned it on sees an
// empty cell with no explanation. Dismissible per-device so a kiosk that
// doesn't want it stays clean without touching the family-wide settings.
export function PluginDiscoverCard({
  pluginId,
  icon: Icon,
  title,
  description,
  ctaLabel,
  ctaHref,
}: PluginDiscoverCardProps) {
  const t = useTranslations("dashboard.pluginDiscover");
  const storageKey = `kinboard:plugin_discover_dismissed:${pluginId}`;
  // Start hidden until localStorage is read so the card doesn't flash in
  // during hydration before we know whether it was dismissed.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(storageKey) === "true");
  }, [storageKey]);

  if (dismissed) return null;

  return (
    <Card className="p-4 h-full flex flex-col justify-between border-dashed border-month-primary/30 bg-month-primary/5">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-month-primary/10 shrink-0">
          <Icon className="size-5 text-month-primary" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(storageKey, "true");
            setDismissed(true);
          }}
          aria-label={t("dismiss")}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3">
        <Button size="sm" asChild>
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      </div>
    </Card>
  );
}
