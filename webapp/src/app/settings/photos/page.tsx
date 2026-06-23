"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import {
  Camera,
  Check,
  RefreshCw,
  AlertCircle,
  Server,
  Key,
  Loader2,
  Image as ImageIcon,
  FolderOpen,
  Eye,
  EyeOff,
  RotateCcw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { IntegrationStatusBanner } from "@/components/integration-status-banner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useImmichStatus,
  useImmichAlbums,
  useSaveImmichSettings,
  useTestImmichConnection,
  useDisconnectImmich,
  useUnsplashStatus,
  useSaveUnsplashSettings,
  useTestUnsplashConnection,
  useDisconnectUnsplash,
  useSetting,
  useUpdateSetting,
} from "@/hooks";
import { toast } from "sonner";
import { DEFAULT_MONTHLY_TERMS } from "@/lib/unsplash-defaults";
import { PageHeader } from "@/components/page-header";
import { IntegrationConfigHint } from "@/components/integration-config-hint";

export default function PhotoSettingsPage() {
  const t = useTranslations("settings.photos");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);

  // Localized month names (1-indexed)
  const monthName = (idx: number): string => {
    const date = new Date(2000, idx, 1);
    return format(date, "MMMM", { locale: dateLocale });
  };

  // ── Photo source toggle ──
  const { data: photoSourceRaw, isLoading: loadingSource } = useSetting<{ source: string } | null>("photo_source", null);
  const updateSetting = useUpdateSetting();
  const photoSource: "immich" | "unsplash" = (photoSourceRaw?.source as "immich" | "unsplash") || "immich";

  // ── Immich hooks ──
  const { data: immichSettings, isLoading: loadingImmich } = useImmichStatus();
  const saveImmichSettings = useSaveImmichSettings();
  const testImmichConnection = useTestImmichConnection();
  const disconnectImmichMutation = useDisconnectImmich();

  const immichConnected = !!immichSettings?.url && !!immichSettings?.api_key;
  const { data: albums, isLoading: loadingAlbums, refetch: refetchAlbums } = useImmichAlbums(immichConnected);

  // ── Immich local state ──
  const [immichUrl, setImmichUrl] = useState("");
  const [immichApiKey, setImmichApiKey] = useState("");
  const [showImmichKey, setShowImmichKey] = useState(false);
  const [immichDialogOpen, setImmichDialogOpen] = useState(false);
  const [immichError, setImmichError] = useState("");
  const [immichTestSuccess, setImmichTestSuccess] = useState(false);

  // ── Unsplash hooks ──
  const { data: unsplashSettings, isLoading: loadingUnsplash } = useUnsplashStatus();
  const saveUnsplashSettings = useSaveUnsplashSettings();
  const testUnsplashConnection = useTestUnsplashConnection();
  const disconnectUnsplashMutation = useDisconnectUnsplash();

  const unsplashConnected = !!unsplashSettings?.access_key;

  // ── Unsplash local state ──
  const [unsplashKey, setUnsplashKey] = useState("");
  const [showUnsplashKey, setShowUnsplashKey] = useState(false);
  const [unsplashDialogOpen, setUnsplashDialogOpen] = useState(false);
  const [unsplashError, setUnsplashError] = useState("");
  const [unsplashTestSuccess, setUnsplashTestSuccess] = useState(false);
  const [monthlyTerms, setMonthlyTerms] = useState<Record<string, string[]>>(
    Object.fromEntries(Object.entries(DEFAULT_MONTHLY_TERMS).map(([k, v]) => [k, [...v]]))
  );
  const [termsChanged, setTermsChanged] = useState(false);
  const [newTermInputs, setNewTermInputs] = useState<Record<string, string>>({});

  // Sync monthly terms from saved settings
  // Old single-string format is discarded in favor of new array defaults
  useEffect(() => {
    if (unsplashSettings?.monthly_terms) {
      const merged: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(DEFAULT_MONTHLY_TERMS)) {
        const saved = unsplashSettings.monthly_terms[k];
        if (Array.isArray(saved) && saved.length > 0) {
          merged[k] = saved;
        } else {
          merged[k] = [...v];
        }
      }
      setMonthlyTerms(merged);
    }
  }, [unsplashSettings?.monthly_terms]);

  // ── Loading state ──
  const isLoading = loadingSource || loadingImmich || loadingUnsplash;

  if (isLoading) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
          <PageHeader
            icon={Camera}
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

  // ── Source toggle handler ──
  const handleSourceChange = (value: string) => {
    updateSetting.mutate({ key: "photo_source", value: { source: value } });
  };

  // ── Immich handlers ──
  const selectedAlbum = immichSettings?.selected_album;

  const handleImmichConnect = async () => {
    if (!immichUrl || !immichApiKey) return;

    setImmichError("");
    setImmichTestSuccess(false);

    const cleanUrl = immichUrl.replace(/\/+$/, "");

    try {
      await testImmichConnection.mutateAsync({ url: cleanUrl, api_key: immichApiKey });
      setImmichTestSuccess(true);

      await saveImmichSettings.mutateAsync({
        url: cleanUrl,
        api_key: immichApiKey,
      });

      setImmichDialogOpen(false);
      setImmichUrl("");
      setImmichApiKey("");
      setImmichTestSuccess(false);
    } catch {
      setImmichError(t("immichConnectionFailed"));
    }
  };

  const handleImmichDisconnect = async () => {
    try {
      await disconnectImmichMutation.mutateAsync();
    } catch {
      toast.error(t("immichDisconnectFailed"));
    }
  };

  const handleAlbumChange = async (albumId: string) => {
    if (!immichSettings) return;

    try {
      await saveImmichSettings.mutateAsync({
        ...immichSettings,
        selected_album: albumId === "auto" ? undefined : albumId,
      });
    } catch {
      toast.error(t("immichAlbumChangeFailed"));
    }
  };

  // Find current month album for display
  const currentMonth = new Date();
  const intlLocale = getIntlLocale(locale);
  const monthPatterns = [
    `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}`,
    currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    currentMonth.toLocaleDateString(intlLocale, { month: "long", year: "numeric" }),
  ];
  const currentMonthAlbum = albums?.find((album) =>
    monthPatterns.some((pattern) =>
      album.name.toLowerCase().includes(pattern.toLowerCase())
    )
  );

  // ── Unsplash handlers ──
  const handleUnsplashConnect = async () => {
    if (!unsplashKey) return;

    setUnsplashError("");
    setUnsplashTestSuccess(false);

    try {
      await testUnsplashConnection.mutateAsync(unsplashKey);
      setUnsplashTestSuccess(true);

      await saveUnsplashSettings.mutateAsync({
        access_key: unsplashKey,
        monthly_terms: monthlyTerms,
      });

      setUnsplashDialogOpen(false);
      setUnsplashKey("");
      setUnsplashTestSuccess(false);
    } catch {
      setUnsplashError(t("unsplashConnectionFailed"));
    }
  };

  const handleUnsplashDisconnect = async () => {
    try {
      await disconnectUnsplashMutation.mutateAsync();
    } catch {
      toast.error(t("unsplashDisconnectFailed"));
    }
  };

  const handleResetTerms = () => {
    setMonthlyTerms(
      Object.fromEntries(Object.entries(DEFAULT_MONTHLY_TERMS).map(([k, v]) => [k, [...v]]))
    );
    setNewTermInputs({});
    setTermsChanged(true);
  };

  const handleAddTerm = (month: string) => {
    const term = (newTermInputs[month] || "").trim();
    if (!term) return;
    setMonthlyTerms((prev) => ({
      ...prev,
      [month]: [...(prev[month] || []), term],
    }));
    setNewTermInputs((prev) => ({ ...prev, [month]: "" }));
    setTermsChanged(true);
  };

  const handleRemoveTerm = (month: string, index: number) => {
    setMonthlyTerms((prev) => ({
      ...prev,
      [month]: prev[month].filter((_, i) => i !== index),
    }));
    setTermsChanged(true);
  };

  const handleSaveTerms = async () => {
    if (!unsplashSettings) return;

    try {
      await saveUnsplashSettings.mutateAsync({
        ...unsplashSettings,
        monthly_terms: monthlyTerms,
      });
      setTermsChanged(false);
      toast.success(t("termsSavedToast"));
    } catch {
      toast.error(t("termsSaveFailed"));
    }
  };

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Camera}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
        />

        {!immichConnected && !unsplashConnected && (
          <IntegrationConfigHint
            title={t("notConfiguredTitle")}
            description={t("notConfiguredDescription")}
            docsHref="https://github.com/svenger87/kinboard/wiki/Immich"
            docsLabel={t("notConfiguredDocsLabel")}
          />
        )}

        {/* Source Selector */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <div className="p-6">
              <h2 className="font-medium mb-4">{t("sourceHeading")}</h2>
              <RadioGroup
                value={photoSource}
                onValueChange={handleSourceChange}
                className="flex flex-col gap-3"
              >
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="immich" id="source-immich" />
                  <Label htmlFor="source-immich" className="flex items-center gap-2 cursor-pointer">
                    <Server className="size-4" />
                    {t("sourceImmichLabel")}
                    <span className="text-xs text-muted-foreground">{t("sourceImmichSuffix")}</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="unsplash" id="source-unsplash" />
                  <Label htmlFor="source-unsplash" className="flex items-center gap-2 cursor-pointer">
                    <ImageIcon className="size-4" />
                    {t("sourceUnsplashLabel")}
                    <span className="text-xs text-muted-foreground">{t("sourceUnsplashSuffix")}</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════ IMMICH SECTION ═══════════════ */}
        {photoSource === "immich" && (
          <>
            {/* Immich Connection Status */}
            <IntegrationStatusBanner
              connected={immichConnected}
              icon={<Server className="size-6" strokeWidth={1.75} />}
              serviceName={t("immichConnectionTitle")}
              connectedLabel={t("immichConnectedBadge")}
              connectedSubtitle={immichConnected ? immichSettings?.url : undefined}
              onConnect={immichConnected ? undefined : () => setImmichDialogOpen(true)}
              onDisconnect={immichConnected ? handleImmichDisconnect : undefined}
              connectLabel={t("immichConnectButton")}
              disconnectLabel={t("immichDisconnectButton")}
              disconnectedTitle={t("immichConnectionTitle")}
              disconnectedBody={t("immichNotConnected")}
            />

            {/* Immich connect dialog */}
            <Dialog open={immichDialogOpen} onOpenChange={setImmichDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("immichDialogTitle")}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 mt-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="immich-url">
                      <Server className="size-4 inline mr-2" />
                      {t("immichUrlLabel")}
                    </Label>
                    <Input
                      id="immich-url"
                      type="url"
                      placeholder={t("immichUrlPlaceholder")}
                      value={immichUrl}
                      onChange={(e) => setImmichUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("immichUrlHint")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="immich-api-key">
                      <Key className="size-4 inline mr-2" />
                      {t("immichApiKeyLabel")}
                    </Label>
                    <div className="relative">
                      <Input
                        id="immich-api-key"
                        type={showImmichKey ? "text" : "password"}
                        placeholder={t("immichApiKeyPlaceholder")}
                        value={immichApiKey}
                        onChange={(e) => setImmichApiKey(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowImmichKey(!showImmichKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showImmichKey ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("immichApiKeyHint")}
                    </p>
                  </div>

                  {immichError && (
                    <div className="flex items-center gap-2 text-destructive text-sm">
                      <AlertCircle className="size-4" />
                      {immichError}
                    </div>
                  )}

                  {immichTestSuccess && (
                    <div className="flex items-center gap-2 text-success text-sm">
                      <Check className="size-4" />
                      {t("immichConnectionSuccess")}
                    </div>
                  )}

                  <Button
                    onClick={handleImmichConnect}
                    disabled={!immichUrl || !immichApiKey || testImmichConnection.isPending || saveImmichSettings.isPending}
                    className="w-full"
                  >
                    {testImmichConnection.isPending || saveImmichSettings.isPending ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        {t("immichConnecting")}
                      </>
                    ) : (
                      <>
                        <Check className="size-4 mr-2" />
                        {t("immichConnectSubmit")}
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Immich album details (connected only) */}
            {immichConnected && (
              <Card className="p-6">
                <div className="flex flex-col gap-4">
                  {/* Album Selection */}
                  <div className="flex flex-col gap-2">
                    <Label>{t("albumLabel")}</Label>
                    <Select
                      value={selectedAlbum || "auto"}
                      onValueChange={handleAlbumChange}
                      disabled={loadingAlbums}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("albumPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">
                          <div className="flex items-center gap-2">
                            <FolderOpen className="size-4" />
                            <span>{t("albumAuto")}</span>
                          </div>
                        </SelectItem>
                        {albums?.map((album) => (
                          <SelectItem key={album.id} value={album.id}>
                            <div className="flex items-center justify-between gap-4">
                              <span>{album.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {t("albumPhotosCount", { count: album.assetCount })}
                              </Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!selectedAlbum && currentMonthAlbum && (
                      <p className="text-xs text-muted-foreground">
                        {t("currentMonthAlbumHint", {
                          name: currentMonthAlbum.name,
                          count: currentMonthAlbum.assetCount,
                        })}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchAlbums()}
                      disabled={loadingAlbums}
                    >
                      <RefreshCw
                        className={`size-4 mr-2 ${loadingAlbums ? "animate-spin" : ""}`}
                      />
                      {t("albumsRefreshButton")}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {/* Album Preview */}
            {immichConnected && albums && albums.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <Card>
                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <ImageIcon className="size-5 text-primary" />
                      <h2 className="font-medium">{t("albumsHeading")}</h2>
                      <Badge variant="outline">{t("albumsCountBadge", { count: albums.length })}</Badge>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {albums.slice(0, 8).map((album) => (
                        <div
                          key={album.id}
                          className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                            selectedAlbum === album.id || (!selectedAlbum && currentMonthAlbum?.id === album.id)
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                          onClick={() => handleAlbumChange(album.id)}
                        >
                          <p className="font-medium text-sm truncate">{album.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("albumPhotosCount", { count: album.assetCount })}
                          </p>
                        </div>
                      ))}
                    </div>
                    {albums.length > 8 && (
                      <p className="text-xs text-muted-foreground mt-3">
                        {t("albumsMore", { count: albums.length - 8 })}
                      </p>
                    )}
                  </div>
                </Card>
              </motion.div>
            )}
          </>
        )}

        {/* ═══════════════ UNSPLASH SECTION ═══════════════ */}
        {photoSource === "unsplash" && (
          <>
            {/* Unsplash Connection Status */}
            <IntegrationStatusBanner
              connected={unsplashConnected}
              icon={<ImageIcon className="size-6" strokeWidth={1.75} />}
              serviceName={t("unsplashConnectionTitle")}
              connectedLabel={t("unsplashConnectedBadge")}
              connectedSubtitle={unsplashConnected ? t("unsplashApiKeyConfigured") : undefined}
              onConnect={unsplashConnected ? undefined : () => setUnsplashDialogOpen(true)}
              onDisconnect={unsplashConnected ? handleUnsplashDisconnect : undefined}
              connectLabel={t("unsplashConnectButton")}
              disconnectLabel={t("unsplashDisconnectButton")}
              disconnectedTitle={t("unsplashConnectionTitle")}
              disconnectedBody={t("unsplashNotConnected")}
            />

            {/* Unsplash connect dialog */}
            <Dialog open={unsplashDialogOpen} onOpenChange={setUnsplashDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("unsplashDialogTitle")}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 mt-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="unsplash-key">
                      <Key className="size-4 inline mr-2" />
                      {t("unsplashAccessKeyLabel")}
                    </Label>
                    <div className="relative">
                      <Input
                        id="unsplash-key"
                        type={showUnsplashKey ? "text" : "password"}
                        placeholder={t("unsplashAccessKeyPlaceholder")}
                        value={unsplashKey}
                        onChange={(e) => setUnsplashKey(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowUnsplashKey(!showUnsplashKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showUnsplashKey ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("unsplashAccessKeyHint")}
                    </p>
                  </div>

                  {unsplashError && (
                    <div className="flex items-center gap-2 text-destructive text-sm">
                      <AlertCircle className="size-4" />
                      {unsplashError}
                    </div>
                  )}

                  {unsplashTestSuccess && (
                    <div className="flex items-center gap-2 text-success text-sm">
                      <Check className="size-4" />
                      {t("unsplashConnectionSuccess")}
                    </div>
                  )}

                  <Button
                    onClick={handleUnsplashConnect}
                    disabled={!unsplashKey || testUnsplashConnection.isPending || saveUnsplashSettings.isPending}
                    className="w-full"
                  >
                    {testUnsplashConnection.isPending || saveUnsplashSettings.isPending ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        {t("unsplashConnecting")}
                      </>
                    ) : (
                      <>
                        <Check className="size-4 mr-2" />
                        {t("unsplashConnectSubmit")}
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Monthly Search Terms */}
            {unsplashConnected && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <Card>
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <ImageIcon className="size-5 text-primary" />
                        <h2 className="font-medium">{t("termsHeading")}</h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleResetTerms}
                        >
                          <RotateCcw className="size-4 mr-2" />
                          {t("termsResetButton")}
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("termsIntro")}
                    </p>
                    <div className="flex flex-col gap-4">
                      {Array.from({ length: 12 }, (_, index) => {
                        const month = String(index + 1);
                        const terms = monthlyTerms[month] || [];
                        return (
                          <div key={index} className="flex flex-col gap-2">
                            <Label className="text-xs font-medium">{monthName(index)}</Label>
                            <div className="flex flex-wrap gap-1.5">
                              {terms.map((term, termIndex) => (
                                <span
                                  key={termIndex}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-xs text-foreground"
                                >
                                  {term}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveTerm(month, termIndex)}
                                    className="ml-0.5 hover:text-destructive transition-colors"
                                    aria-label={t("termsRemoveAria", { term })}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <Input
                                value={newTermInputs[month] || ""}
                                onChange={(e) => setNewTermInputs((prev) => ({ ...prev, [month]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleAddTerm(month);
                                  }
                                }}
                                placeholder={t("termsAddPlaceholder")}
                                className="text-sm h-8"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleAddTerm(month)}
                                className="h-8 px-3 shrink-0"
                              >
                                +
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {termsChanged && (
                      <div className="flex justify-end mt-4">
                        <Button
                          onClick={handleSaveTerms}
                          disabled={saveUnsplashSettings.isPending}
                          size="sm"
                        >
                          {saveUnsplashSettings.isPending ? (
                            <>
                              <Loader2 className="size-4 mr-2 animate-spin" />
                              {t("termsSavingButton")}
                            </>
                          ) : (
                            <>
                              <Check className="size-4 mr-2" />
                              {t("termsSaveButton")}
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              </motion.div>
            )}
          </>
        )}

        {/* Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <div className="p-6">
              <h3 className="font-medium mb-2">{t("infoHeading")}</h3>
              <ul className="text-sm text-muted-foreground flex flex-col gap-1">
                {photoSource === "immich" ? (
                  <>
                    <li>&#8226; {t("immichInfo1")}</li>
                    <li>&#8226; {t("immichInfo2")}</li>
                    <li>&#8226; {t("immichInfo3")}</li>
                    <li>&#8226; {t("immichInfo4")}</li>
                  </>
                ) : (
                  <>
                    <li>&#8226; {t("unsplashInfo1")}</li>
                    <li>&#8226; {t("unsplashInfo2")}</li>
                    <li>&#8226; {t("unsplashInfo3")}</li>
                    <li>&#8226; {t("unsplashInfo4")}</li>
                  </>
                )}
              </ul>
            </div>
          </Card>
        </motion.div>
      </div>
    </main>
  );
}
