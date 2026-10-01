import { test, expect } from "@playwright/test";
import { groupCamerasByRoom } from "../src/lib/camera-rooms";
import type { CameraConfig } from "../src/types/home-assistant";

/**
 * A camera can be placed in a room, and the Automation page then shows its
 * feed above that room's devices. These are the rules for which cameras land
 * in which room.
 */
const camera = (id: string, room_id?: string | null): CameraConfig => ({
  id,
  name: `Camera ${id}`,
  stream_type: "rtsp",
  stream_url: "rtsp://192.0.2.10:554/live",
  enabled: true,
  position: 0,
  created_at: "2026-10-01T00:00:00Z",
  room_id,
});

test("a camera is filed under its room, and several keep their order", () => {
  const byRoom = groupCamerasByRoom(
    [camera("porch", "front"), camera("drive", "front"), camera("garden", "back")],
    ["front", "back"],
  );
  expect(byRoom.get("front")?.map((c) => c.id)).toEqual(["porch", "drive"]);
  expect(byRoom.get("back")?.map((c) => c.id)).toEqual(["garden"]);
});

test("a camera with no room stays off the page -- it is on /cameras", () => {
  const byRoom = groupCamerasByRoom([camera("hall", null), camera("attic")], ["front"]);
  expect(byRoom.size).toBe(0);
});

test("a camera whose room was deleted is left out, not gathered into a 'no room' group", () => {
  const byRoom = groupCamerasByRoom([camera("shed", "gone")], ["front"]);
  expect(byRoom.size).toBe(0);
});

test("a room with no camera gets no entry", () => {
  const byRoom = groupCamerasByRoom([camera("porch", "front")], ["front", "back"]);
  expect(byRoom.has("back")).toBe(false);
});
