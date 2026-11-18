"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { useScreensaverData } from "@/hooks/use-screensaver-data";

/** Everything the screensaver shows, as one call to useScreensaverData returns it. */
export type ScreensaverData = ReturnType<typeof useScreensaverData>;

const ScreensaverDataContext = createContext<ScreensaverData | null>(null);

/**
 * Hands the screensaver's data to the widgets drawn inside it. The hook also
 * runs the photo rotation, so it is called once per screen, by whoever renders
 * the screensaver, and its result passed down here (memoised by the caller:
 * the widgets' effects depend on the identity of what they read).
 */
export function ScreensaverDataProvider({ value, children }: { value: ScreensaverData; children: ReactNode }) {
  return <ScreensaverDataContext.Provider value={value}>{children}</ScreensaverDataContext.Provider>;
}

export function useScreensaverDataContext(): ScreensaverData {
  const value = useContext(ScreensaverDataContext);
  if (!value) {
    throw new Error(
      "useScreensaverDataContext: no ScreensaverDataProvider above this widget. Render screensaver widgets inside the screensaver (or a ScreensaverDataProvider fed by useScreensaverData).",
    );
  }
  return value;
}

/**
 * useScreensaverData's result as a value that changes only when one of its
 * fields does (the hook builds a new object every render), for the provider.
 */
export function useScreensaverDataValue(data: ScreensaverData): ScreensaverData {
  const {
    hours, minutes, date, nightNow, formattedDate, soon, weather,
    upcomingEvents, upcomingBirthdays, eventsAhead, birthdaysAhead, news,
    showEnergyWidget, showTeslaWidget, solarPower, batterySoc, gridPower,
    teslaBattery, teslaRange, teslaChargingRate,
    photoUrls, photoCount, photoIndex, previousPhotoIndex,
    currentBlobUrl, previousBlobUrl, aspectAt, currentPhotoMetadata,
  } = data;
  return useMemo(
    () => ({
      hours, minutes, date, nightNow, formattedDate, soon, weather,
      upcomingEvents, upcomingBirthdays, eventsAhead, birthdaysAhead, news,
      showEnergyWidget, showTeslaWidget, solarPower, batterySoc, gridPower,
      teslaBattery, teslaRange, teslaChargingRate,
      photoUrls, photoCount, photoIndex, previousPhotoIndex,
      currentBlobUrl, previousBlobUrl, aspectAt, currentPhotoMetadata,
    }),
    [
      hours, minutes, date, nightNow, formattedDate, soon, weather,
      upcomingEvents, upcomingBirthdays, eventsAhead, birthdaysAhead, news,
      showEnergyWidget, showTeslaWidget, solarPower, batterySoc, gridPower,
      teslaBattery, teslaRange, teslaChargingRate,
      photoUrls, photoCount, photoIndex, previousPhotoIndex,
      currentBlobUrl, previousBlobUrl, aspectAt, currentPhotoMetadata,
    ],
  );
}
