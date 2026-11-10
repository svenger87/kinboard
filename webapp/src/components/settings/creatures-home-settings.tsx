"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Monitor, Moon, PawPrint } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSetting, useUpdateSetting } from "@/hooks/use-supabase-queries";
import { DEFAULT_BEDTIME, formatClock, parseClock, readBedtime } from "@/lib/creature-mood";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/**
 * Settings -> Creatures -> On Home: the children's creatures walking and
 * playing along the bottom of Home (components/creatures-on-home.tsx), and the
 * family's bedtime, which every creature keeps -- on Home they lie down, in the
 * widget they look sleepy (lib/creature-mood.ts). Saved on change, like the
 * rest of this page.
 */
export function CreaturesHomeSettings() {
  const t = useTranslations("settings.creatures");
  const { data: on } = useSetting<unknown>(SETTINGS_KEYS.creaturesOnHome, false);
  const { data: onIdle } = useSetting<unknown>(SETTINGS_KEYS.creaturesOnIdle, false);
  const { data: storedBedtime } = useSetting<unknown>(SETTINGS_KEYS.creatureBedtime, null);
  const update = useUpdateSetting();
  const bedtime = readBedtime(storedBedtime);
  const [sleep, setSleep] = useState(formatClock(bedtime.sleep));
  const [wake, setWake] = useState(formatClock(bedtime.wake));

  useEffect(() => {
    setSleep(formatClock(bedtime.sleep));
    setWake(formatClock(bedtime.wake));
  }, [bedtime.sleep, bedtime.wake]);

  const save = async (key: string, value: unknown) => {
    try {
      await update.mutateAsync({ key, value });
    } catch {
      toast.error(t("errorGeneric"));
    }
  };

  const commitBedtime = (nextSleep: string, nextWake: string) => {
    const s = parseClock(nextSleep);
    const w = parseClock(nextWake);
    if (s === null || w === null) {
      setSleep(formatClock(bedtime.sleep));
      setWake(formatClock(bedtime.wake));
      return;
    }
    if (s === bedtime.sleep && w === bedtime.wake) return;
    void save(SETTINGS_KEYS.creatureBedtime, { sleep: formatClock(s), wake: formatClock(w) });
  };

  return (
    <Card id="home" data-setting="home" className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="creatures-on-home" className="mb-1 flex items-center gap-2">
            <PawPrint className="size-4 text-month-primary" aria-hidden="true" />
            {t("homeLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("homeHint")}</p>
        </div>
        <Switch
          id="creatures-on-home"
          checked={on === true}
          disabled={update.isPending}
          onCheckedChange={(next) => void save(SETTINGS_KEYS.creaturesOnHome, next)}
        />
      </div>

      {/* Its own switch (RFC-021 §8.3): a family may want them on the wall
          all day and not on the tablet's Home, or the other way round. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="creatures-on-idle" className="mb-1 flex items-center gap-2">
            <Monitor className="size-4 text-month-primary" aria-hidden="true" />
            {t("idleLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("idleHint")}</p>
        </div>
        <Switch
          id="creatures-on-idle"
          checked={onIdle === true}
          disabled={update.isPending}
          onCheckedChange={(next) => void save(SETTINGS_KEYS.creaturesOnIdle, next)}
        />
      </div>

      <div>
        <p className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Moon className="size-4 text-month-primary" aria-hidden="true" />
          {t("bedtimeLabel")}
        </p>
        <p className="mb-2 text-xs text-muted-foreground">{t("bedtimeHint")}</p>
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          <div>
            <Label htmlFor="creature-sleep" className="mb-1 block text-xs">{t("bedtimeSleep")}</Label>
            <Input
              id="creature-sleep"
              type="time"
              value={sleep}
              onChange={(e) => setSleep(e.target.value)}
              onBlur={() => commitBedtime(sleep, wake)}
            />
          </div>
          <div>
            <Label htmlFor="creature-wake" className="mb-1 block text-xs">{t("bedtimeWake")}</Label>
            <Input
              id="creature-wake"
              type="time"
              value={wake}
              onChange={(e) => setWake(e.target.value)}
              onBlur={() => commitBedtime(sleep, wake)}
            />
          </div>
        </div>
        {(bedtime.sleep !== DEFAULT_BEDTIME.sleep || bedtime.wake !== DEFAULT_BEDTIME.wake) && (
          <button
            type="button"
            className="mt-2 text-xs font-medium text-month-primary underline-offset-2 hover:underline"
            onClick={() =>
              void save(SETTINGS_KEYS.creatureBedtime, { sleep: formatClock(DEFAULT_BEDTIME.sleep), wake: formatClock(DEFAULT_BEDTIME.wake) })
            }
          >
            {t("bedtimeReset", { sleep: formatClock(DEFAULT_BEDTIME.sleep), wake: formatClock(DEFAULT_BEDTIME.wake) })}
          </button>
        )}
      </div>
    </Card>
  );
}
