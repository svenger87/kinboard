"use client";

import { useTranslations } from "next-intl";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { EnergyRows } from "@/components/screensaver-rows";
import { FittedCard, NotSetUp, type SaverWidgetProps } from "./shared";

/** The house's solar power, battery and grid: the built-in screensaver's figures on a card that fills its box, side by side when it is wide (FittedCard). */
export function EnergyWidget({ box, editing }: SaverWidgetProps) {
  const { showEnergyWidget, solarPower, batterySoc, gridPower } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  if (!showEnergyWidget) return editing ? <NotSetUp text={t("notSetUp.energy")} /> : null;
  return (
    <FittedCard box={box} deps={[solarPower, batterySoc, gridPower]}>
      <EnergyRows solarPower={solarPower} batterySoc={batterySoc} gridPower={gridPower} scale="box" />
    </FittedCard>
  );
}
