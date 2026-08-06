"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Home,
  Settings,
  RefreshCw,
  LayoutGrid,
  Activity,
  Power,
  PowerOff,
  CircleDot,
  Zap,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useHomeAssistantStatus,
  useHomeAssistantEntityStates,
  useDashboards,
  useCreateDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { EntityCard } from "@/components/home-assistant/entity-card";
import { DashboardSelector } from "@/components/home-assistant/dashboard-selector";
import type { Dashboard } from "@/types/home-assistant";

export default function HausautomationPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("homeAutomation");
  const router = useRouter();
  const { data: settings, isLoading: loadingSettings, refetch } = useHomeAssistantStatus();
  const { data: dashboards = [], isLoading: loadingDashboards } = useDashboards();
  const createDashboard = useCreateDashboard();
  const updateDashboard = useUpdateDashboard();
  const deleteDashboard = useDeleteDashboard();

  // Active dashboard state (stored in URL or local state)
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(null);

  // Set the first dashboard as active when dashboards load
  useEffect(() => {
    if (dashboards.length > 0 && !activeDashboardId) {
      // Sort by position and select first custom dashboard
      const sorted = [...dashboards].sort((a, b) => a.position - b.position);
      const firstCustom = sorted.find((d) => d.type === "custom") || sorted[0];
      setActiveDashboardId(firstCustom.id);
    }
  }, [dashboards, activeDashboardId]);

  const isConnected = !!settings?.url && !!settings?.access_token;

  // Get active dashboard
  const activeDashboard = dashboards.find((d) => d.id === activeDashboardId);
  const dashboardCards = activeDashboard?.cards || [];
  const entityIds = dashboardCards.map((c) => c.entity_id);

  // Fetch entity states for all configured cards
  const {
    data: entities = [],
    isLoading: loadingEntities,
    isFetching,
    isError: entitiesError,
  } = useHomeAssistantEntityStates(entityIds, isConnected && entityIds.length > 0);

  // With Home Assistant unreachable, every card degrades individually to
  // "unavailable" — which is the right per-card behaviour, but it left the page
  // showing five identical shrugs and no statement of the cause or route to a
  // fix (audit KB-51). "All of them at once" means the integration is down.
  const allUnavailable =
    entityIds.length > 0 &&
    entities.length > 0 &&
    entities.every((e) => e.state === "unavailable");
  const haUnreachable = entitiesError || allUnavailable;

  // Create a map for quick lookup
  const entityMap = useMemo(
    () => new Map(entities.map((e) => [e.entity_id, e])),
    [entities]
  );

  // Dashboard management handlers
  const handleCreateDashboard = async (name: string, icon?: string, type?: "custom" | "energy") => {
    try {
      await createDashboard.mutateAsync({ name, icon, type: type || "custom" });
    } catch {
      toast.error(t("toastCreateFailed"));
    }
  };

  const handleUpdateDashboard = async (id: string, updates: Partial<Dashboard>) => {
    try {
      await updateDashboard.mutateAsync({ dashboardId: id, updates });
    } catch {
      toast.error(t("toastUpdateFailed"));
    }
  };

  const handleDeleteDashboard = async (id: string) => {
    try {
      await deleteDashboard.mutateAsync(id);
      // If we deleted the active dashboard, reset to first available
      if (activeDashboardId === id) {
        const remaining = dashboards.filter((d) => d.id !== id);
        if (remaining.length > 0) {
          setActiveDashboardId(remaining[0].id);
        } else {
          setActiveDashboardId(null);
        }
      }
    } catch {
      toast.error(t("toastDeleteFailed"));
    }
  };

  // Show loading state
  if (loadingSettings || loadingDashboards) {
    return (
      <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="page-gradient" />
        <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 min-w-0"
          >
            <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
              <Home className="size-6 text-primary" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-display font-light truncate">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitleLoading")}</p>
            </div>
          </motion.div>
          <div className="flex items-center gap-2 mb-2">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-24 mb-1" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-8 w-full rounded-lg" />
              </Card>
            ))}
          </div>
        </div>
      </main>
    );
  }

  // Not connected state
  if (!isConnected) {
    return (
      <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="page-gradient" />
        <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 min-w-0 mb-8"
          >
            <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
              <Home className="size-6 text-primary" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-display font-light truncate">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitleDashboard")}</p>
            </div>
          </motion.div>

          <Card>
            <CardContent className="p-8 text-center">
              <Home className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("notConnectedTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("notConnectedDescription")}
              </p>
              <Link href="/settings/homeassistant">
                <Button>
                  <Settings className="size-4 mr-2" />
                  {t("notConnectedAction")}
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  // No dashboards exist yet
  if (dashboards.length === 0) {
    return (
      <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="page-gradient" />
        <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
                <Home className="size-6 text-primary" strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-display font-light truncate">{t("title")}</h1>
                <p className="text-sm text-muted-foreground">{t("subtitleDashboard")}</p>
              </div>
            </div>
            <Link href="/settings/homeassistant">
              <Button variant="ghost" size="icon" aria-label={t("settingsAria")}>
                <Settings className="size-5" />
              </Button>
            </Link>
          </motion.div>

          <EmptyState
            icon={LayoutGrid}
            title={t("noDashboardsTitle")}
            description={t("noDashboardsDescription")}
            action={{
              label: t("noDashboardsAction"),
              onClick: () => handleCreateDashboard(t("defaultDashboardName"), "home", "custom"),
              variant: "default",
              disabled: createDashboard.isPending,
              loading: createDashboard.isPending,
            }}
          />
        </div>
      </main>
    );
  }

  // Dashboard view
  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="page-gradient" />
      <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
        {haUnreachable && !loadingEntities && (
          <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
            <WifiOff className="size-5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-semibold">{t("unreachableTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("unreachableBody")}</p>
            </div>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {t("unreachableRetry")}
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/settings/homeassistant">{t("unreachableSettings")}</Link>
            </Button>
          </div>
        )}

        <PageHeader
          icon={Home}
          title={t("title")}
          subtitle={activeDashboard ? activeDashboard.name : "Dashboard"}
          className="mb-8"
          actions={
            <>
              {isFetching && (
                <Badge variant="outline" className="text-xs">
                  <RefreshCw className="size-3 mr-1 animate-spin" />
                  {t("refreshingBadge")}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-label={t("refreshAria")}
              >
                <RefreshCw className={`size-5 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
              <Link href="/settings/homeassistant">
                <Button variant="ghost" size="icon" aria-label={t("settingsAria")}>
                  <Settings className="size-5" />
                </Button>
              </Link>
            </>
          }
        />

        {/* Dashboard Selector */}
        <DashboardSelector
          dashboards={dashboards}
          activeDashboardId={activeDashboardId}
          onSelect={setActiveDashboardId}
          onCreateDashboard={handleCreateDashboard}
          onUpdateDashboard={handleUpdateDashboard}
          onDeleteDashboard={handleDeleteDashboard}
          isCreating={createDashboard.isPending}
        />

        {/* Empty Dashboard State */}
        {dashboardCards.length === 0 && activeDashboard?.type !== "energy" && (
          <EmptyState
            icon={LayoutGrid}
            title={t("emptyDashboardTitle")}
            description={t("emptyDashboardDescription")}
            action={{
              label: t("emptyDashboardAction"),
              onClick: () => router.push(`/settings/homeassistant?dashboard=${activeDashboardId}`),
              variant: "default",
            }}
          />
        )}

        {/* Energy Dashboard - Redirect to dedicated page */}
        {activeDashboard?.type === "energy" && (
          <Card>
            <CardContent className="p-8 text-center">
              <Home className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("energyRedirectTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("energyRedirectDescription")}
              </p>
              <div className="flex items-center justify-center gap-3">
                <Link href="/energy">
                  <Button>
                    <Zap className="size-4 mr-2" />
                    {t("energyRedirectAction")}
                  </Button>
                </Link>
                <Link href="/settings/homeassistant/energy">
                  <Button variant="outline">
                    <Settings className="size-4 mr-2" />
                    {t("energyConfigure")}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Device Status Summary */}
        {dashboardCards.length > 0 && activeDashboard?.type !== "energy" && entities.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="flex flex-wrap gap-3"
          >
            {(() => {
              const activeEntities = entities.filter((e) =>
                ["on", "home", "playing", "cleaning", "returning"].includes(e.state)
              );
              const offEntities = entities.filter((e) =>
                ["off", "idle", "standby", "docked", "unavailable"].includes(e.state)
              );
              const otherEntities = entities.filter((e) =>
                !["on", "home", "playing", "cleaning", "returning", "off", "idle", "standby", "docked", "unavailable"].includes(e.state)
              );

              return (
                <>
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm text-muted-foreground">
                    <Activity className="size-3.5 text-primary" />
                    {t("statusDevices", { count: entities.length })}
                  </div>
                  {activeEntities.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/[0.14] text-sm text-success">
                      <Power className="size-3.5" />
                      {t("statusActive", { count: activeEntities.length })}
                    </div>
                  )}
                  {offEntities.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm text-muted-foreground">
                      <PowerOff className="size-3.5" />
                      {t("statusOff", { count: offEntities.length })}
                    </div>
                  )}
                  {otherEntities.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-state-cool/10 text-sm text-state-cool">
                      <CircleDot className="size-3.5" />
                      {t("statusOther", { count: otherEntities.length })}
                    </div>
                  )}
                </>
              );
            })()}
          </motion.div>
        )}

        {/* Scenes — the user's actual HA scene/script entities, surfaced as a prominent flat row */}
        {(() => {
          const sceneCards = dashboardCards
            .filter((c) => c.card_type === "scene" || c.card_type === "script")
            .sort((a, b) => a.position - b.position);
          if (sceneCards.length === 0 || activeDashboard?.type === "energy") return null;
          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="flex flex-col gap-2"
            >
              <h2 className="text-sm font-medium text-muted-foreground">{t("scenesHeading")}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sceneCards.map((card) => (
                  <EntityCard
                    key={card.id}
                    card={card}
                    entity={entityMap.get(card.entity_id)}
                    isLoading={loadingEntities}
                  />
                ))}
              </div>
            </motion.div>
          );
        })()}

        {/* Cards Grid (for custom dashboards with cards) */}
        {dashboardCards.length > 0 && activeDashboard?.type !== "energy" && (
          <>
            <motion.div
              key={activeDashboardId}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            >
              {dashboardCards
                .filter((card) => card.card_type !== "scene" && card.card_type !== "script")
                .sort((a, b) => a.position - b.position)
                .map((card, index) => (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={
                      card.size === "large"
                        ? "sm:col-span-2"
                        : card.size === "full"
                        ? "col-span-full"
                        : ""
                    }
                  >
                    <EntityCard
                      card={card}
                      entity={entityMap.get(card.entity_id)}
                      isLoading={loadingEntities}
                    />
                  </motion.div>
                ))}
            </motion.div>

            {/* Info Footer */}
            <div className="text-center text-xs text-muted-foreground pt-4">
              {t("autoRefreshNote")}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
