import type { CameraConfig } from "@/types/home-assistant";

/**
 * Camera feeds filed under the room they are placed in, for the Automation
 * page, in the cameras' own order.
 *
 * Only cameras with a room that currently exists are placed. A camera with no
 * room, or with the id of a room since deleted, is left out rather than
 * gathered into a "no room" group: /cameras already shows every camera, and
 * the Automation page is about rooms.
 */
export function groupCamerasByRoom(
  cameras: readonly CameraConfig[],
  roomIds: Iterable<string>,
): Map<string, CameraConfig[]> {
  const known = new Set(roomIds);
  const byRoom = new Map<string, CameraConfig[]>();
  for (const camera of cameras) {
    if (!camera.room_id || !known.has(camera.room_id)) continue;
    const list = byRoom.get(camera.room_id) ?? [];
    list.push(camera);
    byRoom.set(camera.room_id, list);
  }
  return byRoom;
}
