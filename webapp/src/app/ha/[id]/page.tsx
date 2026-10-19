"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HaDashboardFrame } from "@/components/home-assistant/ha-dashboard-frame";
import { useHomeAssistantStatus } from "@/hooks";
import { embedBaseUrl, embeddedDashboards } from "@/lib/ha-embed";

/**
 * A Home Assistant dashboard on a page of its own, for the dashboards the
 * household put in the navigation (Settings -> Home Assistant -> dashboards).
 * The same frame as its tab under Home automation; only the way there is
 * shorter. A dashboard that was removed, or a link from before, says so and
 * points at Home automation instead of showing an empty frame.
 */
export default function HaDashboardPage() {
  const t = useTranslations("homeAutomation");
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? decodeURIComponent(params.id) : "";
  const { data: settings, isPending } = useHomeAssistantStatus();
  const dashboard = useMemo(
    () => embeddedDashboards(settings).find((d) => d.id === id) ?? null,
    [settings, id],
  );

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="page-gradient" />
      <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={LayoutDashboard}
          title={dashboard?.title ?? t("title")}
          subtitle={t("dashboardPageSubtitle")}
        />
        {isPending ? (
          <Skeleton className="h-[60vh] w-full rounded-xl" />
        ) : dashboard ? (
          <HaDashboardFrame dashboard={dashboard} baseUrl={embedBaseUrl(settings)} />
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">{t("dashboardPageMissing")}</p>
            <Link href="/home-automation">
              <Button variant="outline" size="sm">
                {t("dashboardPageOpenAutomation")}
              </Button>
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
