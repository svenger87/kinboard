"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
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
  Rss,
} from "lucide-react";
import { PinGuard } from "@/components/pin-guard";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useKeyboardShortcuts, useSwipeNavigation, useSetting, useUpdateSetting, useIsOnline, useDeleteDevice, useIsPluginEnabled } from "@/hooks";
import { useVersionCheck } from "@/hooks/use-version-check";
import { useState, useRef } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const { family, device, clearSession } = useFamilyStore();
  const deleteDevice = useDeleteDevice();
  const isOnline = useIsOnline();
  const { data: version } = useVersionCheck();
  const [copied, setCopied] = useState(false);
  const { data: storedPin } = useSetting<string | null>("settings_pin", null);
  const updatePin = useUpdateSetting<string | null>();
  const vehiclesPluginEnabled = useIsPluginEnabled("vehicles");
  const energyPluginEnabled = useIsPluginEnabled("energy");
  const camerasPluginEnabled = useIsPluginEnabled("cameras");
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinDigits, setPinDigits] = useState<string[]>(["", "", "", ""]);
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

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
            toast({ title: t("pinSavedToastTitle"), description: t("pinSavedToastDescription") });
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
          toast({ title: t("pinRemovedToastTitle"), description: t("pinRemovedToastDescription") });
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
      title: t("sectionIntegrations"),
      items: [
        {
          icon: Calendar,
          label: t("itemGoogleLabel"),
          description: t("itemGoogleDescription"),
          href: "/settings/google",
        },
        {
          icon: Rss,
          label: t("itemIcsLabel"),
          description: t("itemIcsDescription"),
          href: "/settings/ics",
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
  ];

  return (
    <PinGuard cancelHref="/">
    <main id="main-content" className="min-h-screen p-4 md:p-8 relative safe-area-inset">
      {/* Background */}
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />

      <div className="relative z-10 max-w-2xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-8"
        >
          <div className="p-2.5 rounded-xl bg-month-primary/10 shadow-[0_0_20px_hsl(var(--month-primary)/0.15)]">
            <Settings className="size-6 text-month-primary" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-2xl font-display font-light">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">
              {family?.name || t("subtitleNoFamily")}
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
            <GlassCard className="p-6 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    {t("joinCodeLabel")}
                  </p>
                  <p className="text-3xl font-mono tracking-[0.3em] font-medium">
                    {family.join_code}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("joinCodeHint")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyJoinCode}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="size-4 text-success" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
            </GlassCard>
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
            <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
              {section.title}
            </h2>
            <GlassCard className="divide-y divide-border/50">
              {section.items.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-4 p-4 hover:bg-white/[0.04] hover:shadow-[0_0_12px_hsl(var(--month-primary)/0.05)] transition-all duration-200 first:rounded-t-2xl last:rounded-b-2xl"
                >
                  <div className="p-2 rounded-lg bg-month-primary/10">
                    <item.icon
                      className="size-5 text-month-primary"
                      strokeWidth={1.5}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <ChevronRight className="size-5 text-muted-foreground" />
                </Link>
              ))}
            </GlassCard>
          </motion.div>
        ))}

        {/* PIN Protection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="mb-6"
        >
          <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
            {t("sectionSecurity")}
          </h2>
          <GlassCard className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-month-primary/10">
                  <Lock className="size-5 text-month-primary" strokeWidth={1.5} />
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
                            className="w-14 h-16 text-center text-2xl font-mono rounded-xl border-2 bg-background/50 outline-none transition-all duration-200 border-border focus:border-month-primary/60"
                            autoComplete="off"
                          />
                        ))}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Network Status */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <GlassCard className="p-4">
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
          </GlassCard>
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
                  className="text-month-primary hover:underline"
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
    </PinGuard>
  );
}
