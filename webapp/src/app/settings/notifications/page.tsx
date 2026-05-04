"use client";

import { motion } from "framer-motion";
import { Bell, ShoppingCart, Moon, Send, Loader2, AlertCircle, CheckCircle2, ListTodo } from "lucide-react";
import { useTranslations } from "next-intl";
import { GlassCard } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { useState } from "react";
import {
  usePushNotifications,
  sendTestNotification,
} from "@/hooks/use-push-notifications";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "@/hooks/use-notification-preferences";
import { useFamilyStore } from "@/stores/family-store";

export default function NotificationSettingsPage() {
  const t = useTranslations("settings.notifications");
  const { family, device } = useFamilyStore();
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading: pushLoading,
    error: pushError,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  const { data: preferences, isLoading: prefsLoading } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();

  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const handleTestNotification = async () => {
    if (!device?.id || !family?.id) {
      setTestResult({ success: false, error: t("testErrorMissing") });
      return;
    }

    setTestSending(true);
    setTestResult(null);
    const result = await sendTestNotification(device.id, family.id);
    setTestResult(result);
    setTestSending(false);
    if (result.success) {
      setTimeout(() => setTestResult(null), 5000);
    }
  };

  const handleToggleSubscription = async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  const handlePreferenceChange = (key: string, value: boolean | string | number) => {
    updatePreferences.mutate({ [key]: value });
  };

  const prefs = preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;

  if (prefsLoading) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          icon={Bell}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
          className="mb-8"
        />

        {/* Push Subscription Status */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6"
        >
          <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
            {t("pushStatusHeading")}
          </h2>
          <GlassCard className="p-4">
            {!isSupported ? (
              <div className="flex items-center gap-3 text-muted-foreground">
                <AlertCircle className="size-5 text-warning" />
                <div>
                  <p className="font-medium">{t("unsupportedTitle")}</p>
                  <p className="text-sm">
                    {t("unsupportedDescription")}
                    {typeof window !== "undefined" && !window.isSecureContext && (
                      <span className="block mt-1">
                        {t("unsupportedHttpsHint")}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ) : permission === "denied" ? (
              <div className="flex items-center gap-3 text-muted-foreground">
                <AlertCircle className="size-5 text-destructive" />
                <div>
                  <p className="font-medium">{t("blockedTitle")}</p>
                  <p className="text-sm">
                    {t("blockedDescription")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`size-3 rounded-full ${
                      isSubscribed ? "bg-success animate-pulse" : "bg-muted-foreground"
                    }`} />
                    <div>
                      <Label className="font-medium">{t("pushLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {isSubscribed
                          ? t("pushReceiving")
                          : t("pushEnable")}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={isSubscribed}
                    onCheckedChange={handleToggleSubscription}
                    disabled={pushLoading}
                  />
                </div>

                {pushError && (
                  <p className="text-sm text-destructive">{pushError}</p>
                )}

                {isSubscribed && (
                  <div className="pt-2 border-t border-border/50 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTestNotification}
                        disabled={testSending}
                      >
                        {testSending ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="size-4 mr-2" />
                        )}
                        {t("testButton")}
                      </Button>
                      {testResult?.success && (
                        <span className="text-sm text-success flex items-center gap-1">
                          <CheckCircle2 className="size-4" />
                          {t("testSuccess")}
                        </span>
                      )}
                    </div>
                    {testResult && !testResult.success && testResult.error && (
                      <p className="text-sm text-destructive flex items-center gap-1">
                        <AlertCircle className="size-4 flex-shrink-0" />
                        {testResult.error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* Shopping Notifications */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-6"
        >
          <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
            {t("shoppingHeading")}
          </h2>
          <GlassCard className={`p-4 ${!isSubscribed ? "opacity-50" : ""}`}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShoppingCart className="size-5 text-month-primary" />
                  <div>
                    <Label className="font-medium">{t("shoppingNewItemsLabel")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("shoppingNewItemsDescription")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={prefs.shopping_collaborative}
                  onCheckedChange={(checked) =>
                    handlePreferenceChange("shopping_collaborative", checked)
                  }
                  disabled={!isSubscribed || updatePreferences.isPending}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell className="size-5 text-month-primary" />
                  <div>
                    <Label className="font-medium">{t("shoppingRemindersLabel")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("shoppingRemindersDescription")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={prefs.shopping_reminders}
                  onCheckedChange={(checked) =>
                    handlePreferenceChange("shopping_reminders", checked)
                  }
                  disabled={!isSubscribed || updatePreferences.isPending}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Todo Notifications */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="mb-6"
        >
          <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
            {t("todoHeading")}
          </h2>
          <GlassCard className={`p-4 ${!isSubscribed ? "opacity-50" : ""}`}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ListTodo className="size-5 text-month-primary" />
                  <div>
                    <Label className="font-medium">{t("todoNewLabel")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("todoNewDescription")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={prefs.todo_collaborative}
                  onCheckedChange={(checked) =>
                    handlePreferenceChange("todo_collaborative", checked)
                  }
                  disabled={!isSubscribed || updatePreferences.isPending}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell className="size-5 text-month-primary" />
                  <div>
                    <Label className="font-medium">{t("todoReminderLabel")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("todoReminderDescription")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={prefs.todo_reminders}
                  onCheckedChange={(checked) =>
                    handlePreferenceChange("todo_reminders", checked)
                  }
                  disabled={!isSubscribed || updatePreferences.isPending}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Quiet Hours */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-6"
        >
          <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
            {t("quietHoursHeading")}
          </h2>
          <GlassCard className={`p-4 ${!isSubscribed ? "opacity-50" : ""}`}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Moon className="size-5 text-month-primary" />
                  <div>
                    <Label className="font-medium">{t("quietHoursLabel")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("quietHoursDescription")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={prefs.quiet_hours_enabled}
                  onCheckedChange={(checked) =>
                    handlePreferenceChange("quiet_hours_enabled", checked)
                  }
                  disabled={!isSubscribed || updatePreferences.isPending}
                />
              </div>

              {prefs.quiet_hours_enabled && (
                <div className="flex items-center gap-4 pt-2 border-t border-border/50">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">{t("quietHoursFromLabel")}</Label>
                    <Input
                      type="time"
                      value={prefs.quiet_hours_start}
                      onChange={(e) =>
                        handlePreferenceChange("quiet_hours_start", e.target.value)
                      }
                      disabled={!isSubscribed || updatePreferences.isPending}
                      className="mt-1"
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">{t("quietHoursUntilLabel")}</Label>
                    <Input
                      type="time"
                      value={prefs.quiet_hours_end}
                      onChange={(e) =>
                        handlePreferenceChange("quiet_hours_end", e.target.value)
                      }
                      disabled={!isSubscribed || updatePreferences.isPending}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}
            </div>
          </GlassCard>
        </motion.div>

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <GlassCard className="p-4">
            <h3 className="font-medium mb-2">{t("infoHeading")}</h3>
            <ul className="text-sm text-muted-foreground flex flex-col gap-1.5">
              <li className="flex items-start gap-2">
                <span className="text-month-primary">•</span>
                {t("info1")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-month-primary">•</span>
                {t("info2")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-month-primary">•</span>
                {t("info3")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-month-primary">•</span>
                {t("info4")}
              </li>
            </ul>
          </GlassCard>
        </motion.div>
      </div>
    </main>
  );
}
