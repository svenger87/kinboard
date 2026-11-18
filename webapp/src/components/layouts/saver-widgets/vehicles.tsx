"use client";

import { useTranslations } from "next-intl";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { TeslaRows } from "@/components/screensaver-rows";
import { NotSetUp, type SaverWidgetProps } from "./shared";

/** The car's charge, range and charging power: the built-in screensaver's Tesla figures, centred. */
export function VehiclesWidget({ editing }: SaverWidgetProps) {
  const { showTeslaWidget, teslaBattery, teslaRange, teslaChargingRate } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  if (!showTeslaWidget) return editing ? <NotSetUp text={t("notSetUp.vehicles")} /> : null;
  return (
    <div className="flex size-full items-center justify-center">
      <div className="flex flex-col gap-[0.75em] rounded-[0.75em] bg-black/50 p-[1em] gpu-blur">
        <TeslaRows teslaBattery={teslaBattery} teslaRange={teslaRange} teslaChargingRate={teslaChargingRate} scale="box" />
      </div>
    </div>
  );
}
