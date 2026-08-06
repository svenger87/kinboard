"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Home,
  Check,
  AlertCircle,
  Server,
  Key,
  Loader2,
  LayoutGrid,
  Plus,
  Trash2,
  GripVertical,
  Settings2,
  Zap,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SecretField } from "@/components/settings/secret-field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useHomeAssistantStatus,
  useHomeAssistantConfig,
  useHomeAssistantConnectionCheck,
  useTestHomeAssistantConnection,
  useSaveHomeAssistantSettings,
  useDisconnectHomeAssistant,
  useDashboards,
  useRemoveCardFromDashboard,
  useAddCardToDashboard,
} from "@/hooks";
import { EntityBrowser } from "@/components/home-assistant/entity-browser";
import { PageHeader } from "@/components/page-header";
import { IntegrationConfigHint } from "@/components/integration-config-hint";
import { IntegrationStatusBanner } from "@/components/integration-status-banner";
import Link from "next/link";
import type { DashboardCard, HAEntity } from "@/types/home-assistant";

function HomeAssistantSettingsContent() {
  const t = useTranslations("settings.homeassistant");
  const tDomains = useTranslations("homeAutomation.domainLabels");
  const searchParams = useSearchParams();
  const initialDashboardId = searchParams.get("dashboard");
  const queryClient = useQueryClient();

  const { data: settings, isLoading: loadingSettings } = useHomeAssistantStatus();
  const { data: dashboards = [], isLoading: loadingDashboards } = useDashboards();
  const saveSettings = useSaveHomeAssistantSettings();
  const testConnection = useTestHomeAssistantConnection();
  const disconnectMutation = useDisconnectHomeAssistant();
  const removeCard = useRemoveCardFromDashboard();
  const addCard = useAddCardToDashboard();

  const [url, setUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [entityBrowserOpen, setEntityBrowserOpen] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [testSuccess, setTestSuccess] = useState(false);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(initialDashboardId);
  const [resyncing, setResyncing] = useState(false);

  const isConnected = !!settings?.url && !!settings?.access_token;

  // Select first custom dashboard when dashboards load
  useEffect(() => {
    if (dashboards.length > 0 && !selectedDashboardId) {
      const customDashboards = dashboards.filter((d) => d.type === "custom");
      if (customDashboards.length > 0) {
        setSelectedDashboardId(customDashboards[0].id);
      }
    }
  }, [dashboards, selectedDashboardId]);

  // Get current dashboard and its cards
  const currentDashboard = dashboards.find((d) => d.id === selectedDashboardId);
  const dashboardCards = currentDashboard?.cards || [];

  // Filter to only custom dashboards for the selector
  const customDashboards = dashboards.filter((d) => d.type === "custom");

  // Get config to verify connection is working
  const { data: config } = useHomeAssistantConfig(isConnected);

  // Live probe: a saved token that HA rejects (401) means the user must
  // reconnect — distinct from HA being unreachable.
  const { data: connectionState } = useHomeAssistantConnectionCheck(isConnected);
  const needsReauth = isConnected && connectionState === "unauthorized";

  // Prefill the URL when reconnecting so the user only re-pastes the token.
  useEffect(() => {
    if (needsReauth && settings?.url && !url) {
      setUrl(settings.url);
    }
  }, [needsReauth, settings?.url, url]);

  // Show loading state
  if (loadingSettings || loadingDashboards) {
    return (
      <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
          <PageHeader
            icon={Home}
            title={t("title")}
            subtitle={t("subtitleLoading")}
            backHref="/settings"
          />
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">{t("loadingHint")}</span>
              </div>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  const handleConnect = async () => {
    if (!url || !accessToken) return;

    setConnectError("");
    setTestSuccess(false);

    // Clean up URL (remove trailing slash)
    const cleanUrl = url.replace(/\/+$/, "");

    try {
      // Test connection first
      await testConnection.mutateAsync({ url: cleanUrl, access_token: accessToken });
      setTestSuccess(true);

      // Save settings with empty dashboards array (will be created on first use)
      await saveSettings.mutateAsync({
        url: cleanUrl,
        access_token: accessToken,
        dashboards: [],
      });

      setConnectDialogOpen(false);
      setUrl("");
      setAccessToken("");
      setTestSuccess(false);
    } catch (error) {
      setConnectError(
        error instanceof Error ? error.message : t("connectionFailed")
      );
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectMutation.mutateAsync();
    } catch {
      toast.error(t("disconnectFailed"));
    }
  };

  const handleResync = async () => {
    setResyncing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["home-assistant-status"] });
      await queryClient.refetchQueries({ queryKey: ["home-assistant-config"] });
      toast.success(t("savedToast"));
    } finally {
      setResyncing(false);
    }
  };

  const handleRemoveCard = async (cardId: string) => {
    if (!selectedDashboardId) return;
    try {
      await removeCard.mutateAsync({ dashboardId: selectedDashboardId, cardId });
    } catch {
      toast.error(t("removeCardFailed"));
    }
  };

  // Helper function to determine card type from domain
  const getCardType = (domain: string): DashboardCard["card_type"] => {
    switch (domain) {
      case "light":
        return "light";
      case "switch":
      case "input_boolean":
        return "switch";
      case "vacuum":
        return "vacuum";
      case "climate":
        return "climate";
      case "cover":
        return "cover";
      case "fan":
        return "fan";
      case "media_player":
        return "media_player";
      case "camera":
        return "camera";
      case "lock":
        return "lock";
      case "alarm_control_panel":
        return "alarm_control_panel";
      case "scene":
        return "scene";
      case "script":
        return "script";
      case "automation":
        return "automation";
      case "person":
      case "device_tracker":
        return "person";
      case "weather":
        return "weather";
      case "sensor":
      case "binary_sensor":
        return "sensor";
      default:
        return "generic";
    }
  };

  const handleAddCard = async (entity: HAEntity) => {
    if (!selectedDashboardId) return;
    await addCard.mutateAsync({
      dashboardId: selectedDashboardId,
      card: {
        entity_id: entity.entity_id,
        display_name: entity.name,
        card_type: getCardType(entity.domain),
        size: "medium",
      },
    });
  };

  const domainLabel = (domain: string): string => {
    try {
      return tDomains(domain);
    } catch {
      return domain;
    }
  };

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Home}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
        />

        {!isConnected && (
          <IntegrationConfigHint
            title={t("notConfiguredTitle")}
            description={t("notConfiguredDescription")}
            docsHref="https://github.com/svenger87/kinboard/wiki/Home-Assistant"
            docsLabel={t("notConfiguredDocsLabel")}
          />
        )}

        {/* Connection Status */}
        <IntegrationStatusBanner
          connected={isConnected && !needsReauth}
          needsReauth={needsReauth}
          icon={<Home className="size-6" strokeWidth={1.75} />}
          serviceName={t("title")}
          connectedLabel={t("connectedLabel")}
          connectedSubtitle={settings?.url ?? undefined}
          meta={[
            ...(config?.config?.location_name
              ? [{ label: t("homeLabel"), value: String(config.config.location_name) }]
              : []),
            ...(config?.config?.version
              ? [{ label: t("versionLabel"), value: String(config.config.version) }]
              : []),
          ]}
          onConnect={() => setConnectDialogOpen(true)}
          onDisconnect={isConnected && !needsReauth ? handleDisconnect : undefined}
          connectLabel={t("connectButton")}
          disconnectLabel={t("disconnectButton")}
          reauthTitle={t("reauthTitle")}
          reauthBody={t("reauthBody")}
          disconnectedTitle={t("statusHeading")}
          disconnectedBody={t("statusNotConnectedSubtitle")}
        />

        {isConnected && !needsReauth && (
          <Link href="/home-automation">
            <Button variant="outline" size="sm">
              <LayoutGrid className="size-4 mr-2" />
              {t("openDashboard")}
            </Button>
          </Link>
        )}

        {/* Connect form (URL + token), opened from the banner CTA */}
        <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("connectDialogTitle")}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 mt-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="url">
                  <Server className="size-4 inline mr-2" />
                  {t("urlLabel")}
                </Label>
                <Input
                  id="url"
                  type="url"
                  placeholder={t("urlPlaceholder")}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("urlHint")}
                </p>
              </div>
              <SecretField
                id="access-token"
                label={t("tokenLabel")}
                icon={Key}
                value={accessToken}
                onChange={setAccessToken}
                placeholder={t("tokenPlaceholder")}
                hint={t("tokenHint")}
                showLabel={t("showToken")}
                hideLabel={t("hideToken")}
              />

              {connectError && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="size-4" />
                  {connectError}
                </div>
              )}

              {testSuccess && (
                <div className="flex items-center gap-2 text-success text-sm">
                  <Check className="size-4" />
                  {t("connectionSuccess")}
                </div>
              )}

              <Button
                onClick={handleConnect}
                disabled={!url || !accessToken || testConnection.isPending || saveSettings.isPending}
                className="w-full"
              >
                {testConnection.isPending || saveSettings.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {t("connecting")}
                  </>
                ) : (
                  <>
                    <Check className="size-4 mr-2" />
                    {t("connectSubmit")}
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Dashboard Cards Configuration */}
        {isConnected && customDashboards.length > 0 && (
          <Card>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <LayoutGrid className="size-5 text-primary" />
                  <h2 className="font-medium">{t("cardsHeading")}</h2>
                </div>
              </div>

              {/* Dashboard Selector */}
              {customDashboards.length > 1 && (
                <div className="mb-4">
                  <Label className="text-xs text-muted-foreground mb-2 block">{t("dashboardSelectorLabel")}</Label>
                  <Select
                    value={selectedDashboardId || ""}
                    onValueChange={setSelectedDashboardId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("dashboardSelectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {customDashboards.map((dashboard) => (
                        <SelectItem key={dashboard.id} value={dashboard.id}>
                          {dashboard.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Add Card Button */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {currentDashboard?.name}
                  </span>
                  <Badge variant="outline">{t("cardsCount", { count: dashboardCards.length })}</Badge>
                </div>
                <Dialog open={entityBrowserOpen} onOpenChange={setEntityBrowserOpen}>
                  <Button size="sm" onClick={() => setEntityBrowserOpen(true)}>
                    <Plus className="size-4 mr-2" />
                    {t("addCardButton")}
                  </Button>
                  <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                      <DialogTitle>
                        {t("addCardDialogTitle", { name: currentDashboard?.name ?? "" })}
                      </DialogTitle>
                    </DialogHeader>
                    <EntityBrowserWithCallback
                      onClose={() => setEntityBrowserOpen(false)}
                      existingEntityIds={dashboardCards.map((c) => c.entity_id)}
                      onAddEntity={handleAddCard}
                    />
                  </DialogContent>
                </Dialog>
              </div>

              {dashboardCards.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Settings2 className="size-10 mx-auto mb-3 opacity-50" />
                  <p>{t("emptyCardsTitle")}</p>
                  <p className="text-sm">
                    {t("emptyCardsDescription")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {dashboardCards.map((card) => (
                    <div
                      key={card.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <GripVertical className="size-4 text-muted-foreground cursor-grab" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {card.display_name || card.entity_id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {domainLabel(card.entity_id.split(".")[0])}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {card.size}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveCard(card.id)}
                        aria-label={t("removeCardAria", { name: card.display_name || card.entity_id })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Energy Dashboard Link */}
        {isConnected && (
          <Card>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-warning/10">
                    <Zap className="size-5 text-warning" />
                  </div>
                  <div>
                    <h2 className="font-medium">{t("energyHeading")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("energyDescription")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link href="/energy">
                    <Button variant="outline" size="sm">
                      {t("energyDashboardButton")}
                    </Button>
                  </Link>
                  <Link href="/settings/homeassistant/energy">
                    <Button variant="outline" size="sm">
                      {t("energyConfigureButton")}
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Rooms Configuration */}
        {isConnected && (
          <Card>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Home className="size-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-medium">{t("roomsHeading")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("roomsDescription")}
                    </p>
                  </div>
                </div>
                <Link href="/settings/homeassistant/rooms">
                  <Button variant="outline" size="sm">
                    {t("roomsManageButton")}
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        )}

        {/* Info */}
        <Card>
          <div className="p-6">
            <h3 className="font-medium mb-2">{t("infoHeading")}</h3>
            <ul className="text-sm text-muted-foreground flex flex-col gap-1">
              <li>• {t("info1")}</li>
              <li>• {t("info2")}</li>
              <li>• {t("info3")}</li>
              <li>• {t("info4")}</li>
              <li>• {t("info5")}</li>
              <li>• {t("info6")}</li>
            </ul>
          </div>
        </Card>

        {/* Sticky resync footer — shown only when connected */}
        {isConnected && !needsReauth && (
          <div className="sticky bottom-[var(--nav-spacing)] -mx-4 mt-2 border-t border-border bg-card/95 px-4 py-3 supports-[backdrop-filter]:bg-card/80 md:-mx-8 md:px-8">
            <div className="mx-auto flex max-w-2xl justify-end">
              <Button variant="outline" onClick={handleResync} disabled={resyncing}>
                <RefreshCw className={`size-4 mr-2 ${resyncing ? "animate-spin" : ""}`} />
                {t("resyncButton")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// EntityBrowser wrapper that adds the onAddEntity callback
interface EntityBrowserWithCallbackProps {
  onClose: () => void;
  existingEntityIds: string[];
  onAddEntity: (entity: HAEntity) => Promise<void>;
}

function EntityBrowserWithCallback({ onClose, existingEntityIds, onAddEntity }: EntityBrowserWithCallbackProps) {
  return (
    <EntityBrowser
      onClose={onClose}
      existingEntityIds={existingEntityIds}
      onAddEntity={onAddEntity}
    />
  );
}

// Main export wrapped in Suspense for useSearchParams
export default function HomeAssistantSettingsPage() {
  return (
    <Suspense fallback={<HomeAssistantSettingsFallback />}>
      <HomeAssistantSettingsContent />
    </Suspense>
  );
}

function HomeAssistantSettingsFallback() {
  const t = useTranslations("settings.homeassistant");
  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Home}
          title={t("title")}
          subtitle={t("subtitleLoading")}
          backHref="/settings"
        />
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">{t("loadingHint")}</span>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
