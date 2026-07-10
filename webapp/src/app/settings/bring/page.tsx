"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  ShoppingCart,
  RefreshCw,
  AlertCircle,
  Clock,
  Eye,
  EyeOff,
  Mail,
  Lock,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { IntegrationStatusBanner } from "@/components/integration-status-banner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
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
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  useBringSettings,
  useBringLogin,
  useBringLogout,
  useBringLists,
  useBringItems,
  useUpdateBringSettings,
} from "@/hooks";
import { toast } from "sonner";

export default function BringSettingsPage() {
  const t = useTranslations("settings.bring");
  const { data: settings, isLoading: loadingSettings } = useBringSettings();
  const { data: lists, isLoading: loadingLists, refetch: refetchLists } = useBringLists();
  const { data: itemsData, refetch: refetchItems, isRefetching } = useBringItems();
  const loginMutation = useBringLogin();
  const logoutMutation = useBringLogout();
  const updateSettings = useUpdateBringSettings();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginError, setLoginError] = useState("");

  const isConnected = !!settings?.credentials;
  const selectedListId = settings?.selectedListId;

  const handleLogin = async () => {
    if (!email || !password) return;

    setLoginError("");
    try {
      await loginMutation.mutateAsync({ email, password });
      setLoginDialogOpen(false);
      setEmail("");
      setPassword("");
    } catch {
      setLoginError(t("loginFailed"));
    }
  };

  const handleDisconnect = async () => {
    await logoutMutation.mutateAsync();
  };

  const handleSync = async () => {
    try {
      await refetchLists();
      await refetchItems();
    } catch {
      toast.error(t("syncFailed"));
    }
  };

  const handleListChange = async (listId: string) => {
    try {
      await updateSettings.mutateAsync({ selectedListId: listId });
    } catch {
      toast.error(t("listChangeFailed"));
    }
  };

  const handleSettingChange = async (key: "autoSync" | "twoWaySync" | "syncCategories", value: boolean) => {
    try {
      await updateSettings.mutateAsync({ [key]: value });
    } catch {
      toast.error(t("settingSaveFailed"));
    }
  };

  const selectedList = lists?.find((l) => l.id === selectedListId);

  if (loadingSettings) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto">
          <PageHeader
            icon={ShoppingCart}
            title={t("title")}
            subtitle={t("subtitle")}
            backHref="/settings"
            className="mb-8"
          />
          <Card className="p-6">
            <Skeleton className="h-5 w-32 mb-4" />
            <Skeleton className="h-10 w-full mb-3" />
            <Skeleton className="h-10 w-full mb-4" />
            <Skeleton className="h-10 w-32" />
          </Card>
        </div>
      </main>
    );
  }

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto">
          <PageHeader
            icon={ShoppingCart}
            title={t("title")}
            subtitle={t("subtitle")}
            backHref="/settings"
            className="mb-8"
          />

          <IntegrationStatusBanner
            connected={isConnected}
            icon={<ShoppingCart className="size-6" strokeWidth={1.75} />}
            serviceName={t("accountTitle")}
            connectedLabel={t("connectedBadge")}
            connectedSubtitle={settings?.credentials?.email ?? undefined}
            onConnect={() => setLoginDialogOpen(true)}
            onDisconnect={isConnected ? handleDisconnect : undefined}
            connectLabel={t("loginButton")}
            disconnectLabel={t("disconnectButton")}
            disconnectedTitle={t("notConnectedTitle")}
            disconnectedBody={t("notConnectedDescription")}
            className="mb-6"
          />

          {/* Login dialog — opened by banner connect CTA */}
          <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("loginDialogTitle")}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 pt-4">
                <div className="flex flex-col gap-2">
                  <Label>{t("emailLabel")}</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder={t("emailPlaceholder")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("passwordLabel")}</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                {loginError && (
                  <div className="flex items-center gap-2 text-destructive text-sm">
                    <AlertCircle className="size-4" />
                    {loginError}
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleLogin}
                  disabled={!email || !password || loginMutation.isPending}
                >
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      {t("loginSubmitting")}
                    </>
                  ) : (
                    t("loginSubmit")
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  {t("loginSecurityHint")}
                </p>
              </div>
            </DialogContent>
          </Dialog>

          {isConnected && (
            <>
              {/* List Selection */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mb-6"
              >
                <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                  {t("activeListHeading")}
                </h2>
                <Card className="p-4">
                  <div className="flex items-center gap-4">
                    <Select
                      value={selectedListId || ""}
                      onValueChange={handleListChange}
                      disabled={loadingLists}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={loadingLists ? t("listSelectLoading") : t("listSelectPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(lists || []).map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            {list.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedList && itemsData && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t("itemCount", { count: itemsData.items?.length || 0 })}
                    </p>
                  )}
                </Card>
              </motion.div>

              {/* Sync Status */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mb-6"
              >
                <Card className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Clock className="size-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{t("syncTitle")}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("lastSyncTapHint")}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSync}
                      disabled={isRefetching}
                    >
                      <RefreshCw
                        className={`size-4 mr-2 ${isRefetching ? "animate-spin" : ""}`}
                      />
                      {isRefetching ? t("syncing") : t("syncNow")}
                    </Button>
                  </div>
                </Card>
              </motion.div>

              {/* Sync Settings */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                  {t("settingsHeading")}
                </h2>
                <Card className="divide-y divide-border/50">
                  <div className="flex items-center justify-between p-4">
                    <div>
                      <Label className="font-medium">{t("autoSyncLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("autoSyncDescription")}
                      </p>
                    </div>
                    <Switch
                      checked={settings?.autoSync ?? true}
                      onCheckedChange={(checked) => handleSettingChange("autoSync", checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div>
                      <Label className="font-medium">{t("twoWayLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("twoWayDescription")}
                      </p>
                    </div>
                    <Switch
                      checked={settings?.twoWaySync ?? true}
                      onCheckedChange={(checked) => handleSettingChange("twoWaySync", checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div>
                      <Label className="font-medium">{t("categoriesLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("categoriesDescription")}
                      </p>
                    </div>
                    <Switch
                      checked={settings?.syncCategories ?? true}
                      onCheckedChange={(checked) => handleSettingChange("syncCategories", checked)}
                    />
                  </div>
                </Card>
              </motion.div>
            </>
          )}

          {/* Info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-6 p-4 rounded-xl bg-warning/5 border border-warning/10"
          >
            <div className="flex gap-3">
              <AlertCircle className="size-5 text-warning shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-warning mb-1">{t("infoHeading")}</p>
                <p className="text-muted-foreground">
                  {t("infoDescription")}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </TooltipProvider>
  );
}
