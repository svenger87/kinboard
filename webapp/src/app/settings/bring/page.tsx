"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  ShoppingCart,
  Check,
  RefreshCw,
  Unlink,
  AlertCircle,
  Clock,
  Eye,
  EyeOff,
  Mail,
  Lock,
  Loader2,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
          <GlassCard className="p-6">
            <Skeleton className="h-5 w-32 mb-4" />
            <Skeleton className="h-10 w-full mb-3" />
            <Skeleton className="h-10 w-full mb-4" />
            <Skeleton className="h-10 w-32" />
          </GlassCard>
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

          {/* Connection Status */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <GlassCard className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Bring Icon */}
                  <div className="size-12 rounded-xl bg-[#455A64] flex items-center justify-center">
                    <ShoppingCart className="size-6 text-white" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{t("accountTitle")}</p>
                      {isConnected ? (
                        <Badge className="bg-success/10 text-success border-success/20">
                          <Check className="size-3 mr-1" />
                          {t("connectedBadge")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("disconnectedBadge")}
                        </Badge>
                      )}
                    </div>
                    {isConnected && settings?.credentials && (
                      <p className="text-sm text-muted-foreground">
                        {settings.credentials.email}
                      </p>
                    )}
                  </div>
                </div>

                {isConnected ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-destructive">
                        <Unlink className="size-4 mr-2" />
                        {t("disconnectButton")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("disconnectDialogTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("disconnectDialogDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("disconnectCancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={handleDisconnect}
                        >
                          {logoutMutation.isPending ? t("disconnecting") : t("disconnectButton")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="month">{t("loginButton")}</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("loginDialogTitle")}</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col gap-4 pt-4">
                        {loginError && (
                          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                            {loginError}
                          </div>
                        )}
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
                        <Button
                          variant="month"
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
                )}
              </div>
            </GlassCard>
          </motion.div>

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
                <GlassCard className="p-4">
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
                </GlassCard>
              </motion.div>

              {/* Sync Status */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mb-6"
              >
                <GlassCard className="p-4">
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
                </GlassCard>
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
                <GlassCard className="divide-y divide-border/50">
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
                </GlassCard>
              </motion.div>
            </>
          )}

          {/* Not Connected State */}
          {!isConnected && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <GlassCard className="p-8 text-center">
                <div className="size-16 rounded-2xl bg-[#455A64]/10 flex items-center justify-center mx-auto mb-4">
                  <ShoppingCart className="size-8 text-[#455A64]" />
                </div>
                <h3 className="text-lg font-medium mb-2">
                  {t("notConnectedTitle")}
                </h3>
                <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
                  {t("notConnectedDescription")}
                </p>
                <Button variant="month" onClick={() => setLoginDialogOpen(true)}>
                  {t("loginButton")}
                </Button>
              </GlassCard>
            </motion.div>
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
