"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Puzzle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PLUGINS } from "@/plugins/registry";
import { useEnabledPlugins, useUpdateEnabledPlugins } from "@/hooks/use-enabled-plugins";
import type { EnabledPluginsMap } from "@/hooks/use-enabled-plugins";

export default function PluginsSettingsPage() {
  const t = useTranslations("settings.plugins");
  const { data: enabled = {} as EnabledPluginsMap } = useEnabledPlugins();
  const update = useUpdateEnabledPlugins();

  function isEnabled(id: string): boolean {
    return enabled[id] !== false;
  }

  async function toggle(id: string, next: boolean) {
    try {
      await update.mutateAsync({
        key: "enabled_plugins",
        value: { ...enabled, [id]: next },
      });
    } catch {
      // The Switch snaps back to the saved value on its own; without a
      // toast that reads as the click not registering.
      toast.error(t("toggleFailed"));
    }
  }

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto space-y-6">
        <PageHeader
          title={t("title")}
          icon={Puzzle}
        />

        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-4">{t("intro")}</p>

          {PLUGINS.length === 0 ? (
            <p className="text-muted-foreground">{t("noPlugins")}</p>
          ) : (
            <div className="space-y-4">
              {PLUGINS.map((p) => {
                const Icon = p.navItem.icon;
                const checked = isEnabled(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-0"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon className="size-5 mt-0.5 text-muted-foreground" />
                      <div className="min-w-0">
                        <Label className="font-medium" htmlFor={`plugin-${p.id}`}>
                          {t(`label.${p.id}` as never)}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {t(`description.${p.id}` as never)}
                        </p>
                      </div>
                    </div>
                    <Switch
                      // htmlFor does not associate a <label> with a button, which is
                      // what Radix Switch renders — the visible Label above is
                      // decorative to assistive tech (audit KB-18).
                      aria-label={t(`label.${p.id}` as never)}
                      id={`plugin-${p.id}`}
                      checked={checked}
                      onCheckedChange={(v) => toggle(p.id, v)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <p className="text-xs text-muted-foreground">{t("footnote")}</p>
      </div>
    </main>
  );
}
