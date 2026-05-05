"use client";

import { useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Monitor, Smartphone, Tablet, Pencil, Trash2, Check, Wifi, WifiOff, Loader2, AlertCircle, RefreshCw, TvMinimal, Radar, Copy, HelpCircle } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { useFamilyStore } from "@/stores/family-store";
import { useDevices, useUpdateDevice, useDeleteDevice } from "@/hooks/use-supabase-queries";
import type { Device } from "@/types/database";

function getDeviceType(userAgent: string | null): string {
  if (!userAgent) return "display";
  const ua = userAgent.toLowerCase();
  if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) {
    if (ua.includes("tablet") || ua.includes("ipad")) return "tablet";
    return "phone";
  }
  return "display";
}

function getDeviceIcon(type: string) {
  switch (type) {
    case "phone":
      return Smartphone;
    case "tablet":
      return Tablet;
    default:
      return Monitor;
  }
}

function isOnline(lastSeen: string): boolean {
  const date = new Date(lastSeen);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  // Consider online if seen within last 5 minutes
  return diffMs < 5 * 60 * 1000;
}

export default function DevicesSettingsPage() {
  const t = useTranslations("settings.devices");
  const { device: currentDevice } = useFamilyStore();
  const { data: devices, isLoading, error, refetch } = useDevices();
  const updateDevice = useUpdateDevice();
  const deleteDevice = useDeleteDevice();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatLastSeen = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("lastSeenJustNow");
    if (diffMins < 60) return t("lastSeenMinutes", { minutes: diffMins });
    if (diffHours < 24) return t("lastSeenHours", { hours: diffHours });
    return t("lastSeenDays", { days: diffDays });
  };

  const handleCopyDeviceId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleStartEdit = (device: Device) => {
    setEditingId(device.id);
    setEditName(device.name);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) return;

    try {
      await updateDevice.mutateAsync({ id, name: editName.trim() });
      setEditingId(null);
      setEditName("");
    } catch {
      toast.error(t("updateFailed"));
    }
  };

  const handleDeleteDevice = async (id: string) => {
    try {
      await deleteDevice.mutateAsync(id);
    } catch {
      toast.error(t("deleteFailed"));
    }
  };

  const handleToggleKiosk = async (id: string, isKiosk: boolean) => {
    try {
      await updateDevice.mutateAsync({ id, is_kiosk: isKiosk });
    } catch {
      toast.error(t("settingFailed"));
    }
  };

  const handleTogglePresenceSensor = async (id: string, hasPresenceSensor: boolean) => {
    try {
      await updateDevice.mutateAsync({ id, has_presence_sensor: hasPresenceSensor });
    } catch {
      toast.error(t("settingFailed"));
    }
  };

  const onlineCount = devices?.filter((d) => isOnline(d.last_seen)).length ?? 0;
  const totalCount = devices?.length ?? 0;

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          icon={Monitor}
          title={t("title")}
          subtitle={isLoading ? t("subtitleLoading") : t("subtitleCount", { online: onlineCount, total: totalCount })}
          backHref="/settings"
          className="mb-8"
        />

        {/* Devices List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <GlassCard className="divide-y divide-border/50">
            {error ? (
              <div className="p-8 text-center">
                <AlertCircle className="size-12 mx-auto mb-3 text-destructive opacity-50" />
                <p className="text-destructive font-medium">{t("loadErrorTitle")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("loadErrorDescription")}
                </p>
                <Button
                  variant="outline"
                  onClick={() => refetch()}
                  className="mt-4"
                >
                  <RefreshCw className="size-4 mr-2" />
                  {t("retryButton")}
                </Button>
              </div>
            ) : isLoading ? (
              // Loading skeletons
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex items-center gap-4 p-4">
                  <Skeleton className="w-11 h-11 rounded-xl" />
                  <div className="flex-1">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))
            ) : devices && devices.length > 0 ? (
              devices.map((device, index) => {
                const deviceType = getDeviceType(null); // user_agent not available in current schema
                const Icon = getDeviceIcon(deviceType);
                const isCurrentDevice = currentDevice?.id === device.id;
                const isEditing = editingId === device.id;
                const deviceIsOnline = isOnline(device.last_seen);

                return (
                  <motion.div
                    key={device.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-center gap-4 p-4"
                  >
                    {/* Icon */}
                    <div
                      className={`p-3 rounded-xl ${
                        deviceIsOnline
                          ? "bg-success/10 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="size-5" strokeWidth={1.5} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(device.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 size-8"
                            onClick={() => handleSaveEdit(device.id)}
                            disabled={updateDevice.isPending}
                          >
                            {updateDevice.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4 text-success" />
                            )}
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{device.name}</p>
                            {isCurrentDevice && (
                              <Badge variant="outline" className="text-xs">
                                {t("thisDeviceBadge")}
                              </Badge>
                            )}
                            {device.is_kiosk && (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <TvMinimal className="size-3" />
                                {t("kioskBadge")}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {deviceIsOnline ? (
                              <Wifi className="size-3 text-success" />
                            ) : (
                              <WifiOff className="size-3 text-muted-foreground" />
                            )}
                            <span className="text-xs text-muted-foreground">
                              {deviceIsOnline ? t("onlineLabel") : formatLastSeen(device.last_seen)}
                            </span>
                          </div>
                          {/* Device ID (shown when presence sensor is enabled) */}
                          {device.has_presence_sensor && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <code className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded font-mono">
                                {device.id.slice(0, 8)}...
                              </code>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-5"
                                      onClick={() => handleCopyDeviceId(device.id)}
                                    >
                                      {copiedId === device.id ? (
                                        <Check className="size-3 text-success" />
                                      ) : (
                                        <Copy className="size-3" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{copiedId === device.id ? t("copiedTooltip") : t("copyDeviceIdTooltip")}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Kiosk Toggle */}
                    {!isEditing && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center">
                              <Switch
                                checked={device.is_kiosk}
                                onCheckedChange={(checked) => handleToggleKiosk(device.id, checked)}
                                disabled={updateDevice.isPending}
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{device.is_kiosk ? t("kioskTooltipDisable") : t("kioskTooltipEnable")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}

                    {/* Presence Sensor Toggle (only shown for kiosk devices) */}
                    {!isEditing && device.is_kiosk && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1">
                              <Radar className={`size-4 ${device.has_presence_sensor ? "text-success" : "text-muted-foreground"}`} />
                              <Switch
                                checked={device.has_presence_sensor}
                                onCheckedChange={(checked) => handleTogglePresenceSensor(device.id, checked)}
                                disabled={updateDevice.isPending}
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{device.has_presence_sensor ? t("presenceTooltipDisable") : t("presenceTooltipEnable")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}

                    {/* Actions */}
                    {!isEditing && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleStartEdit(device)}
                        >
                          <Pencil className="size-4" />
                        </Button>

                        {!isCurrentDevice && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                aria-label={t("removeAria", { name: device.name })}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("removeDialogTitle")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("removeDialogDescription", { name: device.name })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("removeCancel")}</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => handleDeleteDevice(device.id)}
                                >
                                  {t("removeConfirm")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <Monitor className="size-12 mx-auto mb-3 opacity-50" />
                <p>{t("emptyTitle")}</p>
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* Info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-sm text-muted-foreground text-center mt-6 flex flex-col gap-3"
        >
          <p>{t("infoText")}</p>

          {/* Presence Sensor Help */}
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <HelpCircle className="size-4" />
                {t("presenceHelpButton")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Radar className="size-5 text-month-primary" />
                  {t("presenceHelpTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("presenceHelpDescription")}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4 text-sm">
                <div>
                  <h4 className="font-medium mb-2">{t("presenceHelpStep1Heading")}</h4>
                  <p className="text-muted-foreground">
                    {t.rich("presenceHelpStep1Body", {
                      bold: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </p>
                </div>

                <div>
                  <h4 className="font-medium mb-2">{t("presenceHelpStep2Heading")}</h4>
                  <p className="text-muted-foreground mb-2">
                    {t.rich("presenceHelpStep2Body", {
                      code: (chunks) => <code className="bg-muted px-1 rounded">{chunks}</code>,
                    })}
                  </p>
                  <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
{`# Installation
pip install aio-ld2410 requests

# Run
python presence_detector.py \\
  --device-id YOUR_DEVICE_ID \\
  --url http://localhost:3000`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2">{t("presenceHelpStep3Heading")}</h4>
                  <p className="text-muted-foreground">
                    {t("presenceHelpStep3Body")}
                  </p>
                </div>

                <div>
                  <h4 className="font-medium mb-2">{t("presenceHelpStep4Heading")}</h4>
                  <p className="text-muted-foreground">
                    {t.rich("presenceHelpStep4Body", {
                      bold: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </p>
                  <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
{`python presence_simulator.py \\
  --device-id YOUR_DEVICE_ID \\
  --url http://localhost:3000`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2">{t("presenceHelpStep5Heading")}</h4>
                  <p className="text-muted-foreground">
                    {t.rich("presenceHelpStep5Body", {
                      bold: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </p>
                  <ul className="list-disc list-inside text-muted-foreground mt-1 flex flex-col gap-1">
                    <li>
                      {t.rich("presenceHelpStep5BulletMode", {
                        bold: (chunks) => <strong>{chunks}</strong>,
                      })}
                    </li>
                    <li>
                      {t.rich("presenceHelpStep5BulletDelay", {
                        bold: (chunks) => <strong>{chunks}</strong>,
                      })}
                    </li>
                  </ul>
                </div>

                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    {t.rich("presenceHelpTip", {
                      bold: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </motion.div>
      </div>
    </main>
  );
}
