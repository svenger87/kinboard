"use client";

import { useTranslations } from "next-intl";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { TeslaRows } from "@/components/screensaver-rows";
import { NotSetUp, type SaverWidgetProps } from "./shared";

/** The car's charge, range and charging power: the built-in screensaver's Tesla figures, filling its box so its edges are the grid's. */
export function VehiclesWidget({ editing }: SaverWidgetProps) {
  const { showTeslaWidget, teslaBattery, teslaRange, teslaChargingRate } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  if (!showTeslaWidget) return editing ? <NotSetUp text={t("notSetUp.vehicles")} /> : null;
  return (
    <div className="flex size-full flex-col justify-center gap-[0.75em] overflow-hidden rounded-[0.75em] bg-black/50 p-[1em] gpu-blur" data-fills-box>
      <TeslaRows teslaBattery={teslaBattery} teslaRange={teslaRange} teslaChargingRate={teslaChargingRate} scale="box" />
    </div>
  );
}
