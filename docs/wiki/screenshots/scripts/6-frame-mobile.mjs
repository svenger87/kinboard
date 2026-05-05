#!/usr/bin/env node
// 6-frame-mobile.mjs — composite mobile screenshots into an iPhone 17 Pro
// device frame for the marketing/hero shots in the wiki + README.
//
// Input:  docs/wiki/images/mobile/*.png      (raw mobile-viewport captures)
// Output: docs/wiki/images/mobile-framed/*.png  (composited into frame)
//
// Frame asset: docs/wiki/screenshots/frames/iphone-17-pro.png
//   This must be a PNG with transparency where the screen area is and
//   the device bezel/notch/buttons rendered around it. Any free-licensed
//   iPhone 17 Pro mockup (Mockuphone, Facebook Design Resources, etc.)
//   works — drop it at the path above.
//
// The compositor auto-detects the screen rectangle by walking the alpha
// channel (transparent = screen area). The screenshot is resized to fit
// that rectangle.

import { readdir, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(SCREENSHOT_ROOT, "..", "..", "..");

const FRAME_PATH = resolve(SCREENSHOT_ROOT, "frames", "iphone-17-pro.png");
const MOBILE_DIR = resolve(REPO_ROOT, "docs", "wiki", "images", "mobile");
const FRAMED_DIR = resolve(REPO_ROOT, "docs", "wiki", "images", "mobile-framed");

if (!existsSync(FRAME_PATH)) {
  console.error(`error: frame asset missing at ${FRAME_PATH}`);
  console.error("");
  console.error("Drop a free-licensed iPhone 17 Pro mockup PNG at that path.");
  console.error("Sources (CC / free-for-personal-use):");
  console.error("  - https://mockuphone.com/");
  console.error("  - https://design.facebook.com/toolsandresources/devices/");
  console.error("  - Figma Community: search 'iPhone 17 Pro mockup'");
  console.error("");
  console.error("The PNG should have transparency where the screen area is.");
  process.exit(1);
}

if (!existsSync(MOBILE_DIR)) {
  console.error(`error: no mobile screenshots at ${MOBILE_DIR} — run the mobile spec first.`);
  process.exit(1);
}

await mkdir(FRAMED_DIR, { recursive: true });

// -----------------------------------------------------------------------
// Detect the screen rectangle inside the frame: scan the alpha channel
// and find the contiguous transparent region. Cache it for reuse.
// -----------------------------------------------------------------------
console.log(`Inspecting frame: ${basename(FRAME_PATH)} …`);
const frame = sharp(FRAME_PATH);
const meta = await frame.metadata();
console.log(`  Frame: ${meta.width}×${meta.height}, channels=${meta.channels}, alpha=${meta.hasAlpha}`);

if (!meta.hasAlpha) {
  console.error("error: frame must have an alpha channel (transparent screen area).");
  process.exit(2);
}

const { data, info } = await frame.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4 + 3; // alpha channel
    if (data[i] < 16) { // ~ fully transparent
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
const screenW = maxX - minX + 1;
const screenH = maxY - minY + 1;
if (screenW < 100 || screenH < 100) {
  console.error("error: detected screen area is tiny — does the frame really have a transparent screen region?");
  process.exit(3);
}
console.log(`  Screen rect: ${screenW}×${screenH} at offset (${minX},${minY})`);
console.log("");

// -----------------------------------------------------------------------
// Composite each mobile screenshot
// -----------------------------------------------------------------------
const files = (await readdir(MOBILE_DIR)).filter((f) => f.endsWith(".png"));
if (files.length === 0) {
  console.warn(`No PNGs in ${MOBILE_DIR} — nothing to do.`);
  process.exit(0);
}

let count = 0;
for (const file of files) {
  const inPath = resolve(MOBILE_DIR, file);
  const outPath = resolve(FRAMED_DIR, file);

  // Resize the screenshot to fit the screen area (cover, so it fills),
  // then composite under the frame.
  const screenshotResized = await sharp(inPath)
    .resize(screenW, screenH, { fit: "cover", position: "top" })
    .toBuffer();

  await sharp(FRAME_PATH)
    .composite([
      { input: screenshotResized, left: minX, top: minY, blend: "dest-over" },
    ])
    .toFile(outPath);

  console.log(`  ${file}  →  mobile-framed/${file}`);
  count++;
}

console.log("");
console.log(`Done. ${count} framed shots in ${FRAMED_DIR}`);
