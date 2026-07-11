"use client";

import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import {
  Settings,
  Users,
  Palette,
  Monitor,
  Wifi,
  Calendar,
  ShoppingCart,
  ChevronRight,
  Copy,
  Check,
  GraduationCap,
  Cloud,
  Camera,
  Video,
  Home,
  Car,
  Zap,
  Bell,
  Lock,
  Trash2,
  LayoutGrid,
  Languages,
  Newspaper,
  Puzzle,
  LineChart,
  PiggyBank,
  ListOrdered,
  RefreshCw,
  DatabaseBackup,
  Pencil,
  X,
  Activity,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { PinGuard } from "@/components/pin-guard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegrationStatusRow } from "@/components/integration-status-row";
import { useRealtimeStatusStore } from "@/stores/realtime-status-store";
import { usePushServerConfigured } from "@/hooks/use-push-notifications";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useFamilyStore } from "@/stores/family-store";
import { useKeyboardShortcuts, useSwipeNavigation, useIsOnline, useDeleteDevice, useIsPluginEnabled, useHomeAssistantStatus, useHomeAssistantConnectionCheck, useGoogleCalendarStatus, useBringSettings, useImmichStatus, useUnsplashStatus, useRegenerateJoinCode, useRenameFamily } from "@/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVersionCheck } from "@/hooks/use-version-check";
import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { WhatsNewDialog } from "@/components/whats-new-dialog";

// Diagnostics-only push status row. usePushServerConfigured() fires a fetch
// on mount — isolating it here (rendered only while the diagnostics
// collapsible is open) keeps that probe from firing on every settings-page
// load.
function DiagnosticsPushRow({
  label,
  okLabel,
  notConfiguredLabel,
}: {
  label: string;
  okLabel: string;
  notConfiguredLabel: string;
}) {
  const pushServerConfigured = usePushServerConfigured();
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/50 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-sm font-medium">
        {pushServerConfigured ? (
          <span className="text-success">{okLabel}</span>
        ) : (
          <span className="text-muted-foreground">{notConfiguredLabel}</span>
        )}
        <span
          className={`block size-2 rounded-full ${pushServerConfigured ? "bg-success" : "bg-muted-foreground/40"}`}
          aria-hidden="true"
        />
      </span>
    </div>
  );
}

export default function SettingsPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { family, device, clearSession } = useFamilyStore();
  const deleteDevice = useDeleteDevice();
  const isOnline = useIsOnline();
  const { data: version } = useVersionCheck();
  const realtimeStatus = useRealtimeStatusStore((s) => s.status);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const { data: haStatus } = useHomeAssistantStatus();
  const haConnected = !!haStatus?.url && !!haStatus?.access_token;
  const { data: haConn } = useHomeAssistantConnectionCheck(haConnected);
  const haNeedsReauth = haConnected && haConn === "unauthorized";
  const { data: googleStatus } = useGoogleCalendarStatus();
  const googleConnected = !!googleStatus?.access_token;
  const googleNeedsReauth = googleConnected && !!googleStatus?.needs_reauth;
  const { data: bringSettings } = useBringSettings();
  const bringConnected = !!bringSettings?.credentials;
  const { data: immichStatus } = useImmichStatus();
  const { data: unsplashStatus } = useUnsplashStatus();
  const photosConnected = (!!immichStatus?.url && !!immichStatus?.api_key) || !!unsplashStatus?.access_key;
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const { data: pinStatus } = useQuery({
    queryKey: ["pin-status", family?.id],
    queryFn: async (): Promise<{ set: boolean }> => {
      const res = await fetch(`/api/pin?family_id=${family!.id}`);
      if (!res.ok) throw new Error("Failed to load PIN status");
      return res.json();
    },
    enabled: !!family?.id,
  });
  const pinIsSet = !!pinStatus?.set;
  const [pinSaving, setPinSaving] = useState(false);
  const vehiclesPluginEnabled = useIsPluginEnabled("vehicles");
  const energyPluginEnabled = useIsPluginEnabled("energy");
  const camerasPluginEnabled = useIsPluginEnabled("cameras");
  const stonksPluginEnabled = useIsPluginEnabled("stonks");
  const pocketMoneyPluginEnabled = useIsPluginEnabled("pocket-money");
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinDigits, setPinDigits] = useState<string[]>(["", "", "", ""]);
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const regenerateJoinCode = useRegenerateJoinCode();
  const renameFamily = useRenameFamily();
  const [regenDialogOpen, setRegenDialogOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [selectedTtl, setSelectedTtl] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [feedEnabled, setFeedEnabled] = useState(false);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [deleteFamilyOpen, setDeleteFamilyOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isDeletingFamily, setIsDeletingFamily] = useState(false);

  useEffect(() => {
    if (!family?.id) return;
    let cancelled = false;
    fetch(`/api/calendar/feed/status?family_id=${family.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setFeedEnabled(!!data.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [family?.id]);

  const handleFeedGenerate = async () => {
    if (!family?.id || feedLoading) return;
    setFeedLoading(true);
    try {
      const res = await fetch("/api/calendar/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family.id }),
      });
      if (!res.ok) throw new Error(`Feed request failed: ${res.status}`);
      const data = await res.json();
      setFeedUrl(data.url);
      setFeedEnabled(true);
    } catch (err) {
      console.error("settings: calendar feed failed:", err);
      toast.error(t("feedFailed"));
    } finally {
      setFeedLoading(false);
    }
  };

  const handleFeedCopy = () => {
    if (!feedUrl) return;
    navigator.clipboard
      .writeText(feedUrl)
      .then(() => {
        setFeedCopied(true);
        setTimeout(() => setFeedCopied(false), 2000);
      })
      .catch((err) => {
        console.error("settings: calendar feed copy failed:", err);
        toast.error(t("feedFailed"));
      });
  };

  const handleExport = async () => {
    if (!family?.id || isExporting) return;
    setIsExporting(true);
    try {
      const res = await fetch(`/api/export?family_id=${family.id}`);
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kinboard-export-${format(new Date(), "yyyy-MM-dd")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("settings: export failed:", err);
      toast.error(t("exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  const statusDot = (color: string) => (
    <span className={`block size-2 rounded-full ${color}`} aria-hidden="true" />
  );
  const integrationStatus = (
    connected: boolean,
    needsReauth: boolean
  ): { node: React.ReactNode; right: React.ReactNode } => {
    if (needsReauth) {
      return {
        node: <span className="text-destructive font-medium">{t("statusError")}</span>,
        right: statusDot("bg-destructive"),
      };
    }
    if (connected) {
      return {
        node: <span className="text-success font-medium">{t("statusConnected")}</span>,
        right: statusDot("bg-success"),
      };
    }
    return {
      node: <span className="text-muted-foreground">{t("statusNotConnected")}</span>,
      right: statusDot("bg-muted-foreground/40"),
    };
  };

  // Diagnostics card row: label + colored dot + status text. Reuses the
  // statusDot()/integrationStatus() pattern above rather than a heavier
  // component — this card renders zero new queries, only existing hooks.
  const diagRow = (label: string, status: React.ReactNode, dot: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/50 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-sm font-medium">
        {status}
        {dot}
      </span>
    </div>
  );

  const copyJoinCode = () => {
    if (family?.join_code) {
      navigator.clipboard.writeText(family.join_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startEditingName = () => {
    setNameDraft(family?.name ?? "");
    setEditingName(true);
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setNameDraft(family?.name ?? "");
  };

  const handleSaveName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === family?.name) {
      // No-op: unchanged or empty name never fires the mutation.
      setEditingName(false);
      setNameDraft(family?.name ?? "");
      return;
    }
    renameFamily.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          toast.success(t("familyRenamed"));
          setEditingName(false);
        },
        onError: (err) => {
          console.error("settings: rename family failed:", err);
          toast.error(t("renameFailed"));
        },
      }
    );
  };

  const handleDeleteFamily = async () => {
    if (!family?.id || isDeletingFamily) return;
    setIsDeletingFamily(true);
    try {
      const res = await fetch("/api/family", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          confirm_name: deleteConfirmName,
        }),
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      clearSession();
      window.location.href = "/join";
    } catch (err) {
      console.error("settings: delete family failed:", err);
      toast.error(t("deleteFamilyFailed"));
      setIsDeletingFamily(false);
    }
  };

  const handlePinDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...pinDigits];
    newDigits[index] = digit;
    setPinDigits(newDigits);

    if (digit && index < 3) {
      pinInputRefs.current[index + 1]?.focus();
    }

    // Auto-save when all 4 digits entered
    const entered = newDigits.join("");
    if (entered.length === 4 && family?.id && !pinSaving) {
      setPinSaving(true);
      fetch("/api/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family.id, action: "set", pin: entered }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`PIN save failed: ${res.status}`);
          // Refresh the unlock session so the new PIN becomes the current session proof
          try { sessionStorage.setItem("kinboard_settings_unlock", "unlocked"); } catch { /* noop */ }
          toast.success(t("pinSavedToastTitle"), { description: t("pinSavedToastDescription") });
          setPinDialogOpen(false);
          setPinDigits(["", "", "", ""]);
          queryClient.invalidateQueries({ queryKey: ["pin-status", family.id] });
        })
        .catch((err) => {
          console.error("settings: PIN save failed:", err);
          toast.error(t("pinSaveFailed"));
        })
        .finally(() => setPinSaving(false));
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pinDigits[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
    }
  };

  const handleRemovePin = () => {
    if (!family?.id) return;
    fetch("/api/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_id: family.id, action: "remove" }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`PIN remove failed: ${res.status}`);
        try { sessionStorage.removeItem("kinboard_settings_unlock"); } catch { /* noop */ }
        toast.success(t("pinRemovedToastTitle"), { description: t("pinRemovedToastDescription") });
        setPinDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["pin-status", family.id] });
      })
      .catch((err) => {
        console.error("settings: PIN remove failed:", err);
        toast.error(t("pinRemoveFailed"));
      });
  };

  const settingsSections = [
    {
      title: t("sectionFamily"),
      items: [
        {
          icon: Users,
          label: t("itemPeopleLabel"),
          description: t("itemPeopleDescription"),
          href: "/settings/people",
        },
        {
          icon: Monitor,
          label: t("itemDevicesLabel"),
          description: device?.name || t("itemDevicesFallback"),
          href: "/settings/devices",
        },
        {
          icon: GraduationCap,
          label: t("itemScheduleLabel"),
          description: t("itemScheduleDescription"),
          href: "/settings/schedule",
        },
      ],
    },
    {
      title: t("sectionDisplay"),
      items: [
        {
          icon: LayoutGrid,
          label: t("itemWidgetsLabel"),
          description: t("itemWidgetsDescription"),
          href: "/settings/widgets",
        },
        {
          icon: ListOrdered,
          label: t("itemNavigationLabel"),
          description: t("itemNavigationDescription"),
          href: "/settings/navigation",
        },
        {
          icon: Palette,
          label: t("itemThemeLabel"),
          description: t("itemThemeDescription"),
          href: "/settings/theme",
        },
        {
          icon: Monitor,
          label: t("itemScreensaverLabel"),
          description: t("itemScreensaverDescription"),
          href: "/settings/screensaver",
        },
        {
          icon: Cloud,
          label: t("itemWeatherLabel"),
          description: t("itemWeatherDescription"),
          href: "/settings/weather",
        },
        {
          icon: Bell,
          label: t("itemNotificationsLabel"),
          description: t("itemNotificationsDescription"),
          href: "/settings/notifications",
        },
        {
          icon: Languages,
          label: t("itemLanguageLabel"),
          description: t("itemLanguageDescription"),
          href: "/settings/language",
        },
        {
          icon: Newspaper,
          label: t("itemNewsLabel"),
          description: t("itemNewsDescription"),
          href: "/settings/news",
        },
        {
          icon: Puzzle,
          label: t("itemPluginsLabel"),
          description: t("itemPluginsDescription"),
          href: "/settings/plugins",
        },
      ],
    },
    {
      title: t("sectionIntegrations"),
      items: [
        {
          icon: Calendar,
          label: t("itemCalendarLabel"),
          description: t("itemCalendarDescription"),
          href: "/settings/calendar",
        },
        {
          icon: ShoppingCart,
          label: t("itemBringLabel"),
          description: t("itemBringDescription"),
          href: "/settings/bring",
        },
        {
          icon: Camera,
          label: t("itemPhotosLabel"),
          description: t("itemPhotosDescription"),
          href: "/settings/photos",
        },
        {
          icon: Home,
          label: t("itemHomeAssistantLabel"),
          description: t("itemHomeAssistantDescription"),
          href: "/settings/homeassistant",
        },
        ...(vehiclesPluginEnabled ? [{
          icon: Car,
          label: t("itemVehiclesLabel"),
          description: t("itemVehiclesDescription"),
          href: "/settings/vehicles",
        }] : []),
        ...(energyPluginEnabled ? [{
          icon: Zap,
          label: t("itemEnergyLabel"),
          description: t("itemEnergyDescription"),
          href: "/settings/energy",
        }] : []),
        ...(camerasPluginEnabled ? [{
          icon: Video,
          label: t("itemCamerasLabel"),
          description: t("itemCamerasDescription"),
          href: "/settings/cameras",
        }] : []),
        ...(stonksPluginEnabled ? [{
          icon: LineChart,
          label: t("itemStonksLabel"),
          description: t("itemStonksDescription"),
          href: "/settings/stonks",
        }] : []),
        ...(pocketMoneyPluginEnabled ? [{
          icon: PiggyBank,
          label: t("itemPocketMoneyLabel"),
          description: t("itemPocketMoneyDescription"),
          href: "/settings/pocket-money",
        }] : []),
      ],
    },
  ];

  const integrationStatusByHref: Record<string, { connected: boolean; needsReauth: boolean }> = {
    "/settings/calendar": { connected: googleConnected, needsReauth: googleNeedsReauth },
    "/settings/bring": { connected: bringConnected, needsReauth: false },
    "/settings/photos": { connected: photosConnected, needsReauth: false },
    "/settings/homeassistant": { connected: haConnected, needsReauth: haNeedsReauth },
  };

  return (
    <PinGuard cancelHref="/">
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-8"
        >
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Settings className="size-6 text-primary" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-2xl font-display font-light">{t("title")}</h1>
            <p className="text-sm text-muted-foreground truncate">
              {family?.name || t("subtitleNoFamily")}
              {device?.name ? ` · ${device.name}` : ""}
            </p>
          </div>
        </motion.div>

        {/* Join Code Card */}
        {family && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="p-6 mb-6">
              <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border">
                {editingName ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      className="h-9"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveName();
                        if (e.key === "Escape") cancelEditingName();
                      }}
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-9 shrink-0"
                      onClick={handleSaveName}
                      disabled={renameFamily.isPending}
                      aria-label={t("saveFamilyNameAria")}
                    >
                      <Check className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0"
                      onClick={cancelEditingName}
                      disabled={renameFamily.isPending}
                      aria-label={t("cancelRenameAria")}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <p className="truncate text-lg font-semibold">{family.name}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      aria-label={t("renameFamilyAria")}
                      onClick={startEditingName}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground mb-1">
                    {t("joinCodeLabel")}
                  </p>
                  <p className="text-3xl font-mono tracking-[0.3em] font-medium">
                    {family.join_code}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {family.join_code_expires_at
                      ? t("joinCodeExpiresAt", {
                          date: format(new Date(family.join_code_expires_at), "Pp", { locale: dateLocale }),
                        })
                      : t("joinCodeNoExpiry")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("joinCodeHint")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t("copyJoinCodeAria")}
                    onClick={copyJoinCode}
                  >
                    {copied ? (
                      <Check className="size-4 text-success" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                  {/* Regenerate trigger — opens the TTL picker */}
                  <Button
                    variant="outline"
                    size="icon"
                    title={t("regenerateCode")}
                    aria-label={t("regenerateCode")}
                    onClick={() => setRegenDialogOpen(true)}
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Settings Sections */}
        {settingsSections.map((section, sectionIndex) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + sectionIndex * 0.1 }}
            className="mb-6"
          >
            <h2 className="mb-3 px-1 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {section.title}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {section.items.map((item) => {
                const status = integrationStatusByHref[item.href];
                if (status) {
                  const s = integrationStatus(status.connected, status.needsReauth);
                  return (
                    <Link key={item.label} href={item.href} className="rounded-xl">
                      <IntegrationStatusRow
                        icon={item.icon}
                        name={item.label}
                        status={s.node}
                        right={s.right}
                        className="hover:bg-accent/50 transition-colors"
                      />
                    </Link>
                  );
                }
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex min-h-[56px] items-center gap-3 rounded-xl border border-border bg-card px-4 elev-sm transition-colors hover:bg-accent/50"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary">
                      <item.icon className="size-5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          </motion.div>
        ))}

        {/* PIN Protection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="mb-6"
        >
          <h2 className="mb-3 px-1 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {t("sectionSecurity")}
          </h2>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Lock className="size-5 text-primary" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="font-medium">{t("pinLabel")}</p>
                  <p className="text-sm text-muted-foreground">
                    {pinIsSet ? t("pinProtected") : t("pinNotSet")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {pinIsSet && (
                  <Button variant="ghost" size="icon" onClick={handleRemovePin} aria-label={t("pinRemoveAria")} className="text-destructive hover:text-destructive">
                    <Trash2 className="size-4" />
                  </Button>
                )}
                <Dialog open={pinDialogOpen} onOpenChange={(open) => {
                  setPinDialogOpen(open);
                  if (open) {
                    setPinDigits(["", "", "", ""]);
                    setTimeout(() => pinInputRefs.current[0]?.focus(), 100);
                  }
                }}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      {pinIsSet ? t("pinChangeButton") : t("pinSetButton")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle>{pinIsSet ? t("pinDialogTitleChange") : t("pinDialogTitleSet")}</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col items-center gap-4 py-4">
                      <p className="text-sm text-muted-foreground text-center">
                        {t("pinDialogDescription")}
                      </p>
                      <div className="flex gap-3">
                        {pinDigits.map((digit, i) => (
                          <input
                            key={i}
                            ref={(el) => { pinInputRefs.current[i] = el; }}
                            type="password"
                            inputMode="numeric"
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handlePinDigitChange(i, e.target.value)}
                            onKeyDown={(e) => handlePinKeyDown(i, e)}
                            className="w-14 h-16 text-center text-2xl font-mono rounded-xl border-2 bg-background/50 outline-none transition-all duration-200 border-border focus:border-primary/60"
                            autoComplete="off"
                          />
                        ))}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Network Status */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Wifi className={`size-5 ${isOnline ? "text-success" : "text-destructive"}`} />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {isOnline ? t("networkConnected") : t("networkOffline")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isOnline ? t("networkConnectedDescription") : t("networkOfflineDescription")}
                </p>
              </div>
              <div className={`size-2 rounded-full ${isOnline ? "bg-success animate-pulse" : "bg-destructive"}`} />
            </div>
          </Card>
        </motion.div>

        {/* Logout */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-8 text-center"
        >
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
              >
                {t("leaveFamilyButton")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("leaveFamilyTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("leaveFamilyDescription", { name: family?.name ?? "" })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={async () => {
                    // Delete the device row server-side BEFORE clearing the
                    // local cookie — otherwise the next visit to /join
                    // re-recognizes this device by fingerprint and shows a
                    // "Welcome back" rejoin card, making "leave" feel
                    // broken. The mutation throws if it fails; we swallow
                    // the error so the local cookie still clears (better
                    // to be logged out client-side than stuck).
                    if (device?.id) {
                      try {
                        await deleteDevice.mutateAsync(device.id);
                      } catch (err) {
                        console.error("leave-family: device delete failed:", err);
                      }
                    }
                    clearSession();
                    window.location.href = "/join";
                  }}
                >
                  {t("leaveFamilyConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </motion.div>

        {/* Danger zone: delete family */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.62 }}
          className="mt-2 text-center"
        >
          <AlertDialog
            open={deleteFamilyOpen}
            onOpenChange={(open) => {
              setDeleteFamilyOpen(open);
              if (!open) setDeleteConfirmName("");
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
              >
                {t("deleteFamilyButton")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteFamilyTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("deleteFamilyDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={family?.name ?? ""}
                autoComplete="off"
              />
              <AlertDialogFooter>
                <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={
                    !family?.name ||
                    deleteConfirmName !== family.name ||
                    isDeletingFamily
                  }
                  onClick={() => {
                    handleDeleteFamily();
                  }}
                >
                  {t("deleteFamilyConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </motion.div>

        {/* Data & backup */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          className="mt-8"
        >
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DatabaseBackup className="size-5 text-primary" strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{t("dataCardTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("dataCardDescription")}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="mt-4 w-full"
              onClick={handleExport}
              disabled={isExporting || !family?.id}
            >
              {t("exportButton")}
            </Button>

            <div className="mt-4 pt-4 border-t">
              <p className="font-medium text-sm">{t("feedTitle")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("feedDescription")}
              </p>

              {feedUrl && (
                <div className="mt-3 flex items-center gap-2">
                  <Input
                    readOnly
                    value={feedUrl}
                    className="text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t("feedCopy")}
                    onClick={handleFeedCopy}
                    className="shrink-0"
                  >
                    {feedCopied ? (
                      <Check className="size-4 text-success" strokeWidth={1.75} />
                    ) : (
                      <Copy className="size-4" strokeWidth={1.75} />
                    )}
                  </Button>
                </div>
              )}

              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={handleFeedGenerate}
                disabled={feedLoading || !family?.id}
              >
                {feedEnabled || feedUrl ? t("feedRotate") : t("feedEnable")}
              </Button>

              {(feedEnabled || feedUrl) && (
                <p className="text-xs text-muted-foreground mt-2">{t("feedHint")}</p>
              )}
            </div>
          </Card>
        </motion.div>

        {/* Diagnostics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-8"
        >
          <Card className="p-4">
            <button
              type="button"
              onClick={() => setDiagnosticsOpen((open) => !open)}
              className="w-full flex items-center gap-3"
              aria-expanded={diagnosticsOpen}
            >
              <div className="p-2 rounded-lg bg-primary/10">
                <Activity className="size-5 text-primary" strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium">{t("diagnosticsTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("diagnosticsDescription")}
                </p>
              </div>
              {diagnosticsOpen ? (
                <ChevronUp className="size-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground shrink-0" />
              )}
            </button>

            {diagnosticsOpen && (
              <div className="mt-4 pt-4 border-t">
                {diagRow(
                  t("diagnosticsVersionLabel"),
                  <span className="text-muted-foreground font-normal">
                    {version?.current ?? "—"}
                  </span>,
                  statusDot("bg-muted-foreground/40")
                )}
                {diagRow(
                  t("diagnosticsNetworkLabel"),
                  isOnline ? (
                    <span className="text-success">{t("diagnosticsStatusOk")}</span>
                  ) : (
                    <span className="text-destructive">{t("diagnosticsStatusOffline")}</span>
                  ),
                  statusDot(isOnline ? "bg-success" : "bg-destructive")
                )}
                {diagRow(
                  t("diagnosticsRealtimeLabel"),
                  realtimeStatus === "connected" ? (
                    <span className="text-success">{t("diagnosticsStatusOk")}</span>
                  ) : realtimeStatus === "connecting" ? (
                    <span className="text-warning">{t("diagnosticsStatusReconnecting")}</span>
                  ) : (
                    <span className="text-destructive">{t("diagnosticsStatusOffline")}</span>
                  ),
                  statusDot(
                    realtimeStatus === "connected"
                      ? "bg-success"
                      : realtimeStatus === "connecting"
                        ? "bg-warning"
                        : "bg-destructive"
                  )
                )}
                <DiagnosticsPushRow
                  label={t("diagnosticsPushLabel")}
                  okLabel={t("diagnosticsStatusOk")}
                  notConfiguredLabel={t("diagnosticsStatusNotConfigured")}
                />
                {(() => {
                  const ha = integrationStatus(haConnected, haNeedsReauth);
                  const google = integrationStatus(googleConnected, googleNeedsReauth);
                  const bring = integrationStatus(bringConnected, false);
                  const photos = integrationStatus(photosConnected, false);
                  return (
                    <>
                      {diagRow(t("itemHomeAssistantLabel"), ha.node, ha.right)}
                      {diagRow(t("itemCalendarLabel"), google.node, google.right)}
                      {diagRow(t("itemBringLabel"), bring.node, bring.right)}
                      {diagRow(t("itemPhotosLabel"), photos.node, photos.right)}
                    </>
                  );
                })()}
              </div>
            )}
          </Card>
        </motion.div>

        {/* Back link */}
        <div className="mt-8 text-center">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("backToDashboard")}
          </Link>
        </div>

        {/* App info footer */}
        <div className="mt-6 pb-4 text-center text-[11px] text-muted-foreground/40 space-y-0.5">
          <p>
            <button
              type="button"
              onClick={() => setWhatsNewOpen(true)}
              aria-label={t("whatsNewButtonLabel")}
              className="hover:text-foreground hover:underline transition-colors"
            >
              {version?.current
                ? t("appVersionDynamic", { version: version.current })
                : t("appVersion")}
            </button>
            {version?.updateAvailable && version.releaseUrl && (
              <>
                {" · "}
                <a
                  href={version.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {t("updateAvailable", { version: version.latest ?? "" })}
                </a>
              </>
            )}
          </p>
          {device && <p>{t("deviceLabel", { name: device.name || device.id.slice(0, 8) })}</p>}
        </div>
      </div>
    </main>

    <WhatsNewDialog open={whatsNewOpen} onOpenChange={setWhatsNewOpen} />

    {/* TTL picker — sibling root, no nesting with AlertDialog */}
    <Dialog open={regenDialogOpen} onOpenChange={setRegenDialogOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("regenerateCode")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          {(
            [
              { label: t("ttlNever"), value: null },
              { label: t("ttl1h"), value: 1 },
              { label: t("ttl24h"), value: 24 },
              { label: t("ttl7d"), value: 168 },
            ] as { label: string; value: number | null }[]
          ).map(({ label, value }) => (
            <Button
              key={String(value)}
              variant={selectedTtl === value ? "default" : "outline"}
              className="w-full justify-start"
              onClick={() => {
                setSelectedTtl(value);
                setRegenDialogOpen(false);
                setRegenConfirmOpen(true);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>

    {/* Confirm dialog — sibling root, no nesting with Dialog */}
    <AlertDialog open={regenConfirmOpen} onOpenChange={setRegenConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("regenerateCode")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("regenerateConfirm")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setRegenConfirmOpen(false)}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setRegenConfirmOpen(false);
              regenerateJoinCode.mutate(
                { ttlHours: selectedTtl },
                {
                  onSuccess: () => {
                    toast.success(t("regenerateSuccess"));
                  },
                }
              );
            }}
          >
            {t("regenerateCode")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </PinGuard>
  );
}
