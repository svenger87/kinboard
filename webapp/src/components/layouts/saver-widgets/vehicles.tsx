"use client";

import { useTranslations } from "next-intl";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { TeslaRows } from "@/components/screensaver-rows";
import { FittedCard, NotSetUp, type SaverWidgetProps } from "./shared";

/** The car's charge, range and charging power: the built-in screensaver's figures on a card that fills its box, side by side when it is wide (FittedCard). */
export function VehiclesWidget({ box, editing }: SaverWidgetProps) {
  const { showTeslaWidget, teslaBattery, teslaRange, teslaChargingRate } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  if (!showTeslaWidget) return editing ? <NotSetUp text={t("notSetUp.vehicles")} /> : null;
  return (
    <FittedCard box={box} deps={[teslaBattery, teslaRange, teslaChargingRate]}>
      <TeslaRows teslaBattery={teslaBattery} teslaRange={teslaRange} teslaChargingRate={teslaChargingRate} scale="box" />
    </FittedCard>
  );
}
