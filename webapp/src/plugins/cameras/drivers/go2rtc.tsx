"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Video,
  Plus,
  Pencil,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  GripVertical,
  Power,
  PowerOff,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { CameraGrid } from "@/components/camera-viewer";
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
  useCameras,
  useCameraSettings,
  useAddCamera,
  useUpdateCamera,
  useDeleteCamera,
} from "@/hooks";
import type { CameraConfig, CameraSettings, CameraStreamType } from "@/types/home-assistant";
import type { CameraDriver } from "./types";

// ============================================================================
// Go2rtcCard — the /cameras grid (extracted from app/cameras/page.tsx)
// ============================================================================

function CamerasSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-video rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

function Go2rtcCard() {
  const { cameras, isLoading, error, refetch } = useCameras();
  const router = useRouter();
  const t = useTranslations("cameras");

  if (isLoading) {
    return <CamerasSkeleton />;
  }

  if (error) {
    return (
      <ErrorState
        icon={Video}
        title={t("errorTitle")}
        message={t("errorMessage")}
        onRetry={() => refetch()}
      />
    );
  }

  if (cameras.length === 0) {
    return (
      <EmptyState
        icon={Video}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        action={{
          label: t("emptyAction"),
          onClick: () => router.push("/settings/cameras"),
          variant: "default",
        }}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <CameraGrid
        cameras={cameras}
        columns={cameras.length === 1 ? 1 : cameras.length <= 4 ? 2 : 3}
      />
    </motion.div>
  );
}

// ============================================================================
// Go2rtcConfigForm — the /settings/cameras form
// (extracted from app/settings/cameras/page.tsx)
// ============================================================================

function Go2rtcConfigForm() {
  const t = useTranslations("settings.cameras");
  const { data: settings, isLoading } = useCameraSettings();
  const addCamera = useAddCamera();
  const updateCamera = useUpdateCamera();
  const deleteCamera = useDeleteCamera();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<CameraConfig | null>(null);
  const [error, setError] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [streamType, setStreamType] = useState<CameraStreamType>("mjpeg");
  const [streamUrl, setStreamUrl] = useState("");
  const [snapshotUrl, setSnapshotUrl] = useState("");
  const [showUrls, setShowUrls] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authType, setAuthType] = useState<"basic" | "digest">("digest");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const cameras = settings?.cameras || [];

  const resetForm = () => {
    setName("");
    setStreamType("mjpeg");
    setStreamUrl("");
    setSnapshotUrl("");
    setShowUrls(false);
    setAuthEnabled(false);
    setAuthType("digest");
    setUsername("");
    setPassword("");
    setError("");
    setEditingCamera(null);
  };

  const openAddDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (camera: CameraConfig) => {
    setEditingCamera(camera);
    setName(camera.name);
    setStreamType(camera.stream_type);
    setStreamUrl(camera.stream_url);
    setSnapshotUrl(camera.snapshot_url || "");
    setAuthEnabled(!!camera.auth);
    setAuthType(camera.auth?.type || "digest");
    setUsername(camera.auth?.username || "");
    setPassword(camera.auth?.password || "");
    setError("");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t("errorNameRequired"));
      return;
    }
    if (!streamUrl.trim()) {
      setError(t("errorStreamUrlRequired"));
      return;
    }
    if (authEnabled && (!username.trim() || !password.trim())) {
      setError(t("errorCredentialsRequired"));
      return;
    }

    const authConfig = authEnabled
      ? { username: username.trim(), password: password.trim(), type: authType }
      : undefined;

    try {
      if (editingCamera) {
        await updateCamera.mutateAsync({
          cameraId: editingCamera.id,
          updates: {
            name: name.trim(),
            stream_type: streamType,
            stream_url: streamUrl.trim(),
            snapshot_url: snapshotUrl.trim() || undefined,
            auth: authConfig,
          },
        });
      } else {
        await addCamera.mutateAsync({
          name: name.trim(),
          stream_type: streamType,
          stream_url: streamUrl.trim(),
          snapshot_url: snapshotUrl.trim() || undefined,
          auth: authConfig,
          enabled: true,
        });
      }
      setDialogOpen(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorSaveFailed"));
    }
  };

  const handleToggle = async (camera: CameraConfig) => {
    await updateCamera.mutateAsync({
      cameraId: camera.id,
      updates: { enabled: !camera.enabled },
    });
  };

  const handleDelete = async (cameraId: string) => {
    await deleteCamera.mutateAsync(cameraId);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t("loadingHint")}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Camera List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card>
          <CardContent className="p-6">
            {cameras.length === 0 ? (
              <div className="text-center py-8">
                <Video className="size-12 mx-auto text-muted-foreground/50 mb-4" />
                <h2 className="font-medium mb-2">{t("emptyTitle")}</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("emptyDescription")}
                </p>
                <Button onClick={openAddDialog} variant="outline">
                  <Plus className="size-4 mr-2" />
                  {t("emptyAddButton")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {cameras
                  .sort((a, b) => a.position - b.position)
                  .map((camera) => (
                    <div
                      key={camera.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        camera.enabled
                          ? "border-border bg-background/50"
                          : "border-border/50 bg-muted/30 opacity-60"
                      }`}
                    >
                      <GripVertical className="size-4 text-muted-foreground cursor-grab" />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{camera.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {camera.stream_type.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {camera.stream_url}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggle(camera)}
                          className="size-8"
                          aria-label={camera.enabled ? t("disableAria", { name: camera.name }) : t("enableAria", { name: camera.name })}
                        >
                          {camera.enabled ? (
                            <Power className="size-4 text-success" />
                          ) : (
                            <PowerOff className="size-4 text-muted-foreground" />
                          )}
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(camera)}
                          className="size-8"
                          aria-label={t("editCameraAria", { name: camera.name })}
                        >
                          <Pencil className="size-4" />
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                              aria-label={t("deleteAria", { name: camera.name })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("deleteDialogTitle")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("deleteDialogDescription", { name: camera.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("deleteCancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(camera.id)}
                                className="bg-destructive text-destructive-foreground"
                              >
                                {t("deleteConfirm")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Add Camera button (only shown when list is non-empty) */}
      {cameras.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={openAddDialog}>
            <Plus className="size-4 mr-2" />
            {t("addButton")}
          </Button>
        </div>
      )}

      {/* Info */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card>
          <CardContent className="p-6">
            <h2 className="font-medium mb-3">{t("streamTypesHeading")}</h2>
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <span className="font-medium">{t("streamTypeRtspName")}</span>
                <p className="text-muted-foreground">
                  {t("streamTypeRtspDescription")}
                </p>
              </div>
              <div>
                <span className="font-medium">{t("streamTypeWebrtcName")}</span>
                <p className="text-muted-foreground">
                  {t("streamTypeWebrtcDescription")}
                </p>
              </div>
              <div>
                <span className="font-medium">{t("streamTypeMjpegName")}</span>
                <p className="text-muted-foreground">
                  {t("streamTypeMjpegDescription")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open) resetForm();
        setDialogOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCamera ? t("dialogEditTitle") : t("dialogAddTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="camera-name">{t("nameLabel")}</Label>
              <Input
                id="camera-name"
                placeholder={t("namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="stream-type">{t("streamTypeLabel")}</Label>
              <Select value={streamType} onValueChange={(v) => setStreamType(v as CameraStreamType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rtsp">{t("streamTypeRtspName")}</SelectItem>
                  <SelectItem value="webrtc">{t("streamTypeWebrtcName")}</SelectItem>
                  <SelectItem value="mjpeg">{t("streamTypeMjpegName")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="stream-url">{t("streamUrlLabel")}</Label>
              <div className="relative">
                <Input
                  id="stream-url"
                  type={showUrls ? "text" : "password"}
                  placeholder={
                    streamType === "rtsp"
                      ? t("streamUrlPlaceholderRtsp")
                      : streamType === "webrtc"
                      ? t("streamUrlPlaceholderWebrtc")
                      : t("streamUrlPlaceholderMjpeg")
                  }
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowUrls(!showUrls)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showUrls ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="snapshot-url">{t("snapshotUrlLabel")}</Label>
              <Input
                id="snapshot-url"
                type={showUrls ? "text" : "password"}
                placeholder={t("snapshotUrlPlaceholder")}
                value={snapshotUrl}
                onChange={(e) => setSnapshotUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("snapshotUrlHint")}
              </p>
            </div>

            {/* Authentication */}
            <div className="flex flex-col gap-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <Label htmlFor="auth-enabled">{t("authLabel")}</Label>
                <Switch
                  aria-label={t("authLabel")}
                  id="auth-enabled"
                  checked={authEnabled}
                  onCheckedChange={setAuthEnabled}
                />
              </div>

              {authEnabled && (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="auth-type">{t("authTypeLabel")}</Label>
                    <Select value={authType} onValueChange={(v) => setAuthType(v as "basic" | "digest")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="digest">{t("authTypeDigest")}</SelectItem>
                        <SelectItem value="basic">{t("authTypeBasic")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="username">{t("usernameLabel")}</Label>
                      <Input
                        id="username"
                        placeholder={t("usernamePlaceholder")}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="password">{t("passwordLabel")}</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="size-4" />
                {error}
              </div>
            )}

            <Button
              onClick={handleSave}
              disabled={addCamera.isPending || updateCamera.isPending}
              className="w-full"
            >
              {addCamera.isPending || updateCamera.isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {t("savingButton")}
                </>
              ) : (
                <>
                  <Check className="size-4 mr-2" />
                  {editingCamera ? t("saveButton") : t("addSubmitButton")}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Driver manifest
// ============================================================================

export const go2rtcDriver: CameraDriver<CameraSettings> = {
  id: "go2rtc",
  displayNameKey: "displayName",
  icon: Video,
  Card: Go2rtcCard,
  ConfigForm: Go2rtcConfigForm,
  isConfigured: (config) =>
    Boolean(config?.cameras?.length && config.cameras.length > 0),
};
