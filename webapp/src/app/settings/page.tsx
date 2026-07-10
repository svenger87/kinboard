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
} from "lucide-react";
import { PinGuard } from "@/components/pin-guard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IntegrationStatusRow } from "@/components/integration-status-row";
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
import { useKeyboardShortcuts, useSwipeNavigation, useSetting, useUpdateSetting, useIsOnline, useDeleteDevice, useIsPluginEnabled, useHomeAssistantStatus, useHomeAssistantConnectionCheck, useGoogleCalendarStatus, useBringSettings, useImmichStatus, useUnsplashStatus, useRegenerateJoinCode } from "@/hooks";
import { useVersionCheck } from "@/hooks/use-version-check";
import React, { useState, useRef } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export default function SettingsPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { family, device, clearSession } = useFamilyStore();
  const deleteDevice = useDeleteDevice();
  const isOnline = useIsOnline();
  const { data: version } = useVersionCheck();
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
  const { data: storedPin } = useSetting<string | null>("settings_pin", null);
  const updatePin = useUpdateSetting<string | null>();
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
  const [regenDialogOpen, setRegenDialogOpen] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [selectedTtl, setSelectedTtl] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);

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

  const copyJoinCode = () => {
    if (family?.join_code) {
      navigator.clipboard.writeText(family.join_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
    if (entered.length === 4) {
      updatePin.mutate(
        { key: "settings_pin", value: entered },
        {
          onSuccess: () => {
            // Refresh the unlock session so the new PIN becomes the current session proof
            try { sessionStorage.setItem("kinboard_settings_unlock", entered); } catch { /* noop */ }
            toast.success(t("pinSavedToastTitle"), { description: t("pinSavedToastDescription") });
            setPinDialogOpen(false);
            setPinDigits(["", "", "", ""]);
          },
        }
      );
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pinDigits[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
    }
  };

  const handleRemovePin = () => {
    updatePin.mutate(
      { key: "settings_pin", value: null },
      {
        onSuccess: () => {
          try { sessionStorage.removeItem("kinboard_settings_unlock"); } catch { /* noop */ }
          toast.success(t("pinRemovedToastTitle"), { description: t("pinRemovedToastDescription") });
          setPinDialogOpen(false);
        },
      }
    );
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
                    {storedPin ? t("pinProtected") : t("pinNotSet")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {storedPin && (
                  <Button variant="ghost" size="icon" onClick={handleRemovePin} className="text-destructive hover:text-destructive">
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
                      {storedPin ? t("pinChangeButton") : t("pinSetButton")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle>{storedPin ? t("pinDialogTitleChange") : t("pinDialogTitleSet")}</DialogTitle>
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
            {version?.current
              ? t("appVersionDynamic", { version: version.current })
              : t("appVersion")}
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
