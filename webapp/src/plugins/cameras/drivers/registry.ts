import { go2rtcDriver } from "./go2rtc";
import type { CameraDriver } from "./types";

export const CAMERA_DRIVERS: readonly CameraDriver<any>[] = [
  go2rtcDriver,
];

export function getDriver(id: string): CameraDriver<any> | undefined {
  return CAMERA_DRIVERS.find((d) => d.id === id);
}
