"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Calendar, Rss, ChevronRight, Check, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useGoogleCalendarStatus, useCalendars } from "@/hooks";

/**
 * Calendar settings landing — unified entry point for the two calendar
 * sources Kinboard supports today: Google Calendar (OAuth) and ICS
 * feeds (read-only public URLs, e.g. iCloud Family Sharing). Each
 * source has its own detail page reachable via the Manage link; this
 * landing just shows current connection state at a glance.
 *
 * Light unification (per "A first" decision): keep the existing
 * /settings/google and /settings/ics detail pages, point at them
 * from here. The settings landing's two separate Calendar entries
 * collapse into one "Calendar" entry pointing here.
 */
export default function CalendarSettingsPage() {
  const t = useTranslations("settings.calendar");
  const { data: googleStatus, isLoading: googleLoading } = useGoogleCalendarStatus();
  const { data: allCalendars = [], isLoading: calendarsLoading } = useCalendars();

  const icsCount = useMemo(
    () => allCalendars.filter((c) => Boolean(c.ics_url)).length,
    [allCalendars],
  );

  // GoogleCalendarSettings has no boolean `connected` field — presence
  // of `access_token` (set after OAuth callback completes) is the
  // canonical "is this family connected" signal. `connected_at` is
  // useful as a "since when" hint but `access_token` is the gate.
  const googleConnected = Boolean(googleStatus?.access_token);
  const googleEmail = googleStatus?.email ?? null;

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
    <div className="relative z-10 max-w-2xl mx-auto space-y-6">
      <PageHeader title={t("title")} icon={Calendar} backHref="/settings" />

      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {/* Google Calendar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <Link
          href="/settings/google"
          className="block group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-4 focus-visible:ring-offset-background rounded-lg"
        >
          <Card className="p-5 flex items-center gap-4 group-hover:bg-muted/30 transition-colors">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Calendar className="size-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium">{t("googleHeading")}</h3>
                {googleLoading ? (
                  <Skeleton className="h-5 w-20" />
                ) : googleConnected ? (
                  <Badge variant="outline" className="border-success/50 text-success text-xs">
                    <Check className="size-3 mr-1" />
                    {t("statusConnected")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    {t("statusNotConnected")}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">
                {googleConnected && googleEmail
                  ? googleEmail
                  : t("googleDescription")}
              </p>
            </div>
            <ChevronRight className="size-5 text-muted-foreground shrink-0" />
          </Card>
        </Link>
      </motion.div>

      {/* ICS feeds */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.05 }}
      >
        <Link
          href="/settings/ics"
          className="block group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-4 focus-visible:ring-offset-background rounded-lg"
        >
          <Card className="p-5 flex items-center gap-4 group-hover:bg-muted/30 transition-colors">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Rss className="size-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium">{t("icsHeading")}</h3>
                {calendarsLoading ? (
                  <Skeleton className="h-5 w-16" />
                ) : icsCount > 0 ? (
                  <Badge variant="outline" className="border-success/50 text-success text-xs">
                    {t("statusFeedCount", { count: icsCount })}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    {t("statusNoFeeds")}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{t("icsDescription")}</p>
            </div>
            <ChevronRight className="size-5 text-muted-foreground shrink-0" />
          </Card>
        </Link>
      </motion.div>

      {/* Why two sources? */}
      <Card className="p-4 bg-muted/20 border-muted-foreground/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">{t("whyTwoSourcesTitle")}</p>
            <p>{t("whyTwoSourcesBody")}</p>
          </div>
        </div>
      </Card>
    </div>
    </main>
  );
}
