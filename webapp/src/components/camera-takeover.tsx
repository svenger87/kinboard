"use client";

import { CameraViewer } from "@/components/camera-viewer";
import type { CameraConfig } from "@/types/home-assistant";

/**
 * The camera `show_camera` put on this screen (#335), in the camera viewer's
 * own full-screen view — the one a tap on a camera opens — with no tile
 * behind it. It goes when the time is up, because the parent stops rendering
 * it, or when somebody closes it here, which only closes it on this screen.
 *
 * The parent resolves the camera (`takeoverCamera`) and renders this only
 * when there is one, so the screensaver gate and what is on screen go by the
 * same answer: a camera removed or disabled since the call shows nothing and
 * holds nothing.
 */
export function CameraTakeover({ camera, onClose }: { camera: CameraConfig; onClose: () => void }) {
  // Keyed by camera, not by start: a second ring for the same camera only
  // moves the end, so the picture must not drop and reconnect.
  return <CameraViewer key={camera.id} camera={camera} fullscreenOnly onClose={onClose} />;
}
