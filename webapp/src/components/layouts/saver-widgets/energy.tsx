"use client";

import { useTranslations } from "next-intl";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { EnergyRows } from "@/components/screensaver-rows";
import { NotSetUp, type SaverWidgetProps } from "./shared";

/** The house's solar power, battery and grid: the built-in screensaver's energy card, filling its box so its edges are the grid's. */
export function EnergyWidget({ editing }: SaverWidgetProps) {
  const { showEnergyWidget, solarPower, batterySoc, gridPower } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  if (!showEnergyWidget) return editing ? <NotSetUp text={t("notSetUp.energy")} /> : null;
  return (
    <div className="flex size-full flex-col justify-center gap-[0.75em] overflow-hidden rounded-[0.75em] bg-black/50 p-[1em] gpu-blur" data-fills-box>
      <EnergyRows solarPower={solarPower} batterySoc={batterySoc} gridPower={gridPower} scale="box" />
    </div>
  );
}
