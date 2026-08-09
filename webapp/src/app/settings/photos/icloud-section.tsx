"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Cloud, Check, Loader2, Images } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import {
  useIcloudStatus,
  useIcloudPhotos,
  useTestIcloudAlbum,
  useSaveIcloudSettings,
} from "@/hooks/use-icloud";

/**
 * Connecting an iCloud Shared Album.
 *
 * One field, because that is genuinely all it takes: the public link. The help
 * text carries the two steps on the phone that people miss — the album has to
 * exist and its "Public Website" switch has to be on — since a link to a
 * private album fails in a way that looks exactly like a wrong link.
 */
export function IcloudSection() {
  const t = useTranslations("settings.photos.icloud");
  const tCommon = useTranslations("common");

  const { data: settings, isLoading } = useIcloudStatus();
  const connected = Boolean(settings?.token);

  const testAlbum = useTestIcloudAlbum();
  const saveSettings = useSaveIcloudSettings();
  const { data: photos = [], isFetching: loadingPhotos } = useIcloudPhotos(12, connected);

  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  const handleConnect = async () => {
    setError("");
    const value = link.trim();
    if (!value) return;

    const result = await testAlbum.mutateAsync(value);
    if (!result.ok || !result.token) {
      setError(result.error === "not_an_icloud_link" ? t("errorNotIcloud") : t("errorUnreachable"));
      return;
    }

    await saveSettings.mutateAsync({ token: result.token, album_name: result.streamName });
    setLink("");
    toast.success(t("connected", { album: result.streamName ?? "", count: result.photoCount ?? 0 }));
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
              <Cloud className="size-5 text-month-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-medium">{t("heading")}</h2>
              <p className="text-sm text-muted-foreground truncate">
                {connected ? (settings?.album_name || t("defaultName")) : t("subtitle")}
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
                <Label htmlFor="icloud-link">{t("linkLabel")}</Label>
                <Input
                  id="icloud-link"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://share.icloud.com/photos/…"
                  inputMode="url"
                />
                <p className="text-xs text-muted-foreground">{t("linkHelp")}</p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                onClick={handleConnect}
                disabled={!link.trim() || testAlbum.isPending || saveSettings.isPending}
                className="self-start min-h-[44px]"
              >
                {testAlbum.isPending || saveSettings.isPending ? (
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
              <span className="flex items-center gap-2 text-sm text-muted-foreground flex-1">
                <Images className="size-4" />
                {loadingPhotos ? tCommon("loading") : t("photoCount", { count: photos.length })}
              </span>
              <ConfirmDestructive
                title={t("disconnectTitle")}
                description={t("disconnectBody")}
                onConfirm={() => {
                  void saveSettings.mutateAsync(null).then(() => toast.success(t("disconnected")));
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

      {connected && photos.length > 0 && (
        <Card>
          <div className="p-6 flex flex-col gap-3">
            <h3 className="font-medium">{t("previewHeading")}</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.slice(0, 8).map((photo) => (
                // Apple's own URL, straight to the browser: https already, and
                // signed for about an hour — see the route for why it is not
                // proxied or stored.
                <img
                  key={photo.id}
                  src={photo.url}
                  alt={photo.caption ?? ""}
                  loading="lazy"
                  className="aspect-square w-full rounded-lg object-cover bg-muted"
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("previewNote")}</p>
          </div>
        </Card>
      )}
    </motion.div>
  );
}
