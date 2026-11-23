"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Car, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useHomeAssistantEntityStates, useHomeAssistantStatus } from "@/hooks";
import { useVehicles } from "@/hooks/use-vehicles";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { getIntlLocale } from "@/i18n/intl-locale";
import { formatReading, READING_DIGITS } from "@/plugins/vehicles/entity-read";
import { readVehicle, type VehicleEntityConfig } from "@/plugins/vehicles/readings";
import type { Vehicle } from "@/types/database";
import type { HomeWidgetProps } from "./shared";
import { BoxCard, SetUpBox, useShrinkStep } from "./rest-shared";

/** As the card: one car at a time, the next every eight seconds. */
const ROTATE_INTERVAL_MS = 8000;

/** The entities the dashboard card reads: the charge, the range and whether it is charging. */
const WIDGET_KEYS = ["battery_level", "battery_range", "charging_rate", "charger_power", "charging_state"] as const;

/**
 * A car's charge, range and charging power, read the way every driver reads
 * them (plugins/vehicles/readings.ts), from the same entities as the
 * dashboard card. The generic driver's configs from before 1.8 name the
 * range `range`; it is folded in as that driver does.
 */
function useVehicleSummary(vehicle: Vehicle | undefined) {
  const { data: ha } = useHomeAssistantStatus();
  const haConnected = Boolean(ha?.url && ha?.access_token);
  const config = useMemo<VehicleEntityConfig>(() => {
    const raw = (vehicle?.config ?? {}) as VehicleEntityConfig & { range?: string };
    return { ...raw, battery_range: raw.battery_range ?? raw.range };
  }, [vehicle?.config]);
  const entityIds = useMemo(
    () => Array.from(new Set(WIDGET_KEYS.map((k) => config[k]).filter((id): id is string => !!id))),
    [config],
  );
  const { data: entities = [] } = useHomeAssistantEntityStates(entityIds, haConnected && entityIds.length > 0);
  const readings = useMemo(
    () => readVehicle(config, new Map(entities.map((e) => [e.entity_id, e]))),
    [config, entities],
  );
  return { haConnected, configured: entityIds.length > 0, readings };
}

/** Richest first: the car's picture; its name; the range or charging power; the charge alone. */
const STEPS = [
  { image: true, name: true, side: true },
  { image: false, name: true, side: true },
  { image: false, name: false, side: true },
  { image: false, name: false, side: false },
] as const;

/**
 * The vehicles card in a box (RFC-022 §3.1, fixed): the charge large, then
 * the range (or the charging power), the car's name and its picture while
 * the box has room for them. The whole box opens /vehicles, as the card
 * does, so it is one target of any size.
 */
export function VehiclesHomeWidget({ box }: HomeWidgetProps) {
  const t = useTranslations("dashboard.pluginDiscover");
  const tGeneric = useTranslations("vehicles.drivers.generic-ev");
  const intlLocale = getIntlLocale(useLocale());
  const enabled = useIsPluginEnabled("vehicles");
  const { data: vehicles = [] } = useVehicles();
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (vehicles.length <= 1) return;
    const id = setInterval(() => setActiveIdx((i) => (i + 1) % vehicles.length), ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [vehicles.length]);

  const v = vehicles[activeIdx >= vehicles.length ? 0 : activeIdx];
  const { haConnected, configured, readings: r } = useVehicleSummary(v);
  const ref = useRef<HTMLDivElement>(null);
  const step = useShrinkStep(ref, STEPS.length, [box.width, box.height, v?.id, r.charging, Boolean(r.range), Boolean(r.battery)]);
  const s = STEPS[step];

  if (!enabled) {
    return <SetUpBox box={box} icon={Car} title={t("vehiclesName")} description={t("vehiclesDisabled")} href="/settings/plugins" testId="home-vehicles" />;
  }
  if (!v) {
    return <SetUpBox box={box} icon={Car} title={t("vehiclesName")} description={t("vehiclesEmpty")} href="/vehicles" testId="home-vehicles" />;
  }
  if (!haConnected || !configured) {
    return (
      <SetUpBox
        box={box}
        icon={Car}
        title={v.nickname}
        description={tGeneric(haConnected ? "notConfigured" : "haNotConnected")}
        href="/vehicles"
        testId="home-vehicles"
      />
    );
  }

  const battery = r.battery?.value ?? 0;
  const batteryColor = battery > 60 ? "text-success" : battery > 20 ? "text-warning" : "text-destructive";
  const image = v.image_url ?? (v.vendor === "tesla" ? "/images/tesla-model-y.png" : null);

  return (
    <Link href="/vehicles" className="block size-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" data-testid="home-vehicles">
      <BoxCard box={box} ref={ref} step={step} className="justify-center gap-[0.4em]">
        {s.image && (
          <div className="flex min-h-[3em] flex-1 items-center justify-center">
            {image ? (
              <img src={image} alt="" className="max-h-full max-w-full object-contain drop-shadow-lg" style={{ maxHeight: "100%" }} />
            ) : (
              <Car className="size-[2.5em] text-muted-foreground" aria-hidden="true" />
            )}
          </div>
        )}
        <div className="flex shrink-0 items-end justify-between gap-[0.6em]">
          <div className="min-w-0">
            <p className={`whitespace-nowrap text-[1.8em] font-bold leading-none tabular-nums ${batteryColor}`}>
              {r.battery ? Math.round(r.battery.value) : "—"}
              <span className="text-[0.5em] text-muted-foreground">%</span>
            </p>
            {s.name && <p className="truncate text-[0.7em] text-muted-foreground">{v.nickname}</p>}
          </div>
          {s.side && (
            <div className="shrink-0 text-right">
              {r.charging ? (
                <span className="flex items-center gap-[0.2em] whitespace-nowrap text-energy-grid">
                  <Zap className="size-[0.9em]" aria-hidden="true" />
                  <span className="text-[0.85em] font-semibold">
                    {formatReading(r.power, { digits: READING_DIGITS.power, locale: intlLocale })}
                  </span>
                </span>
              ) : (
                <span className="whitespace-nowrap text-[1.2em] font-semibold tabular-nums">
                  {formatReading(r.range, { digits: READING_DIGITS.distance, locale: intlLocale })}
                </span>
              )}
            </div>
          )}
        </div>
      </BoxCard>
    </Link>
  );
}
