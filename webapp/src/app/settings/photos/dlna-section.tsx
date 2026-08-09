"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { HardDrive, FolderOpen, Check, Loader2, ChevronRight, Images } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import {
  useDlnaStatus,
  useDlnaContainers,
  useTestDlnaConnection,
  useSaveDlnaSettings,
  useDisconnectDlna,
  type DlnaSettings,
} from "@/hooks/use-dlna";

/**
 * Connecting a DLNA media server, and choosing which folder the photos come
 * from.
 *
 * Two things shape this screen. There is no discovery — see lib/dlna-client.ts
 * for why — so the first field is a URL the owner has to find, and the help
 * text names the usual ones rather than leaving them to search. And DLNA has
 * folders, not albums: every server arranges them differently, so this walks
 * the tree one level at a time instead of pretending to know where the photos
 * live.
 */
export function DlnaSection() {
  const t = useTranslations("settings.photos.dlna");
  const tCommon = useTranslations("common");

  const { data: settings, isLoading } = useDlnaStatus();
  const connected = Boolean(settings?.control_url);

  const testConnection = useTestDlnaConnection();
  const saveSettings = useSaveDlnaSettings();
  const disconnect = useDisconnectDlna();

  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  // Where the folder browser currently is. Each entry is a container the owner
  // descended into, so the breadcrumb can walk back out.
  const [path, setPath] = useState<{ id: string; title: string }[]>([]);
  const currentId = path.length > 0 ? path[path.length - 1].id : "0";
  const { data: browseResult, isFetching: browsing } = useDlnaContainers(currentId, connected);

  const handleConnect = async () => {
    setError("");
    const trimmed = url.trim();
    if (!trimmed) return;

    const result = await testConnection.mutateAsync(trimmed);
    if (!result.ok || !result.controlUrl) {
      setError(result.error || t("connectFailed"));
      return;
    }

    await saveSettings.mutateAsync({
      description_url: trimmed,
      control_url: result.controlUrl,
      friendly_name: result.friendlyName || t("defaultName"),
      // No folder chosen yet — the root is the honest default, and the picker
      // below is right underneath.
      selected_container: "0",
    });
    setUrl("");
    toast.success(t("connected", { name: result.friendlyName || t("defaultName") }));
  };

  const chooseFolder = async (id: string, title: string) => {
    if (!settings) return;
    const next: DlnaSettings = {
      ...settings,
      selected_container: id,
      selected_container_title: title,
    };
    await saveSettings.mutateAsync(next);
    toast.success(t("folderChosen", { folder: title }));
  };

  if (isLoading) {
    return (
      <Card className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {tCommon("loading")}
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4"
    >
      <Card>
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-month-primary/10">
              <HardDrive className="size-5 text-month-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-medium">{t("heading")}</h2>
              <p className="text-sm text-muted-foreground">
                {connected ? settings?.friendly_name : t("subtitle")}
              </p>
            </div>
            {connected && (
              <span className="ml-auto flex items-center gap-1.5 text-sm text-success">
                <Check className="size-4" />
                {t("statusConnected")}
              </span>
            )}
          </div>

          {!connected ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="dlna-url">{t("urlLabel")}</Label>
                <Input
                  id="dlna-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://192.168.1.10:8200/rootDesc.xml"
                  inputMode="url"
                />
                {/* Naming the usual paths is the difference between this
                    working and the owner giving up: there is no discovery to
                    fall back on. */}
                <p className="text-xs text-muted-foreground">{t("urlHelp")}</p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                onClick={handleConnect}
                disabled={!url.trim() || testConnection.isPending || saveSettings.isPending}
                className="self-start min-h-[44px]"
              >
                {testConnection.isPending || saveSettings.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {t("connecting")}
                  </>
                ) : (
                  t("connectButton")
                )}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground flex-1 truncate">
                {settings?.selected_container_title
                  ? t("currentFolder", { folder: settings.selected_container_title })
                  : t("currentFolderRoot")}
              </p>
              <ConfirmDestructive
                title={t("disconnectTitle")}
                description={t("disconnectBody")}
                onConfirm={() => {
                  void disconnect.mutateAsync().then(() => {
                    setPath([]);
                    toast.success(t("disconnected"));
                  });
                }}
              >
                <Button variant="outline" className="min-h-[44px]">
                  {t("disconnectButton")}
                </Button>
              </ConfirmDestructive>
            </div>
          )}
        </div>
      </Card>

      {connected && (
        <Card>
          <div className="p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="size-4 text-muted-foreground" />
              <h3 className="font-medium">{t("folderHeading")}</h3>
              {browsing && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>

            {/* Breadcrumb — the only way back up a tree the server defines. */}
            <div className="flex flex-wrap items-center gap-1 text-sm">
              <button
                onClick={() => setPath([])}
                className="text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {t("rootCrumb")}
              </button>
              {path.map((crumb, i) => (
                <span key={crumb.id} className="flex items-center gap-1">
                  <ChevronRight className="size-3 text-muted-foreground" />
                  <button
                    onClick={() => setPath(path.slice(0, i + 1))}
                    className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    {crumb.title}
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="flex items-center gap-2 text-sm">
                <Images className="size-4 text-muted-foreground" />
                {t("photosHere", { count: browseResult?.photoCount ?? 0 })}
              </span>
              <Button
                variant={settings?.selected_container === currentId ? "default" : "outline"}
                className="min-h-[44px]"
                disabled={saveSettings.isPending}
                onClick={() =>
                  chooseFolder(
                    currentId,
                    path.length > 0 ? path[path.length - 1].title : t("rootCrumb"),
                  )
                }
              >
                {settings?.selected_container === currentId ? t("folderInUse") : t("useFolder")}
              </Button>
            </div>

            <div className="flex flex-col gap-1">
              {(browseResult?.containers ?? []).map((container) => (
                <button
                  key={container.id}
                  onClick={() => setPath([...path, { id: container.id, title: container.title }])}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent min-h-[44px]"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{container.title}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {container.childCount != null && container.childCount}
                    <ChevronRight className="size-4" />
                  </span>
                </button>
              ))}
              {!browsing && (browseResult?.containers ?? []).length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t("noSubfolders")}</p>
              )}
            </div>
          </div>
        </Card>
      )}
    </motion.div>
  );
}
