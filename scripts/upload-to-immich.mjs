#!/usr/bin/env node
/**
 * Upload generated wallpapers to Immich
 * Creates/finds "Wallpaper {German month}" albums and uploads images.
 *
 * Usage:
 *   node scripts/upload-to-immich.mjs --month=march --dir=assets/wallpapers/march
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const IMMICH_URL = process.env.IMMICH_URL;
const IMMICH_API_KEY = process.env.IMMICH_API_KEY;

const MONTH_NAMES_DE = {
  january: 'Januar', february: 'Februar', march: 'März', april: 'April',
  may: 'Mai', june: 'Juni', july: 'Juli', august: 'August',
  september: 'September', october: 'Oktober', november: 'November', december: 'Dezember',
};

// ---------------------------------------------------------------------------
// Immich API helpers
// ---------------------------------------------------------------------------

async function immichFetch(path, options = {}) {
  const url = `${IMMICH_URL}/api${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': IMMICH_API_KEY,
      ...options.headers,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Immich API ${path} failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

async function getAlbums() {
  return immichFetch('/albums');
}

async function createAlbum(name) {
  return immichFetch('/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumName: name }),
  });
}

async function addAssetsToAlbum(albumId, assetIds) {
  return immichFetch(`/albums/${albumId}/assets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: assetIds }),
  });
}

async function uploadAsset(filePath) {
  const fileName = basename(filePath);
  const fileBuffer = readFileSync(filePath);
  const stat = statSync(filePath);

  // Build multipart form data manually
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const parts = [];

  // deviceAssetId field
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="deviceAssetId"\r\n\r\n${fileName}-${stat.mtimeMs}`,
  );

  // deviceId field
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="deviceId"\r\n\r\nwallpaper-generator`,
  );

  // fileCreatedAt field
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="fileCreatedAt"\r\n\r\n${stat.mtime.toISOString()}`,
  );

  // fileModifiedAt field
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="fileModifiedAt"\r\n\r\n${stat.mtime.toISOString()}`,
  );

  // File part
  const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="assetData"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`;
  const fileFooter = `\r\n--${boundary}--\r\n`;

  const textParts = parts.join('\r\n') + '\r\n';
  const textEncoder = new TextEncoder();
  const headerBuf = textEncoder.encode(textParts + fileHeader);
  const footerBuf = textEncoder.encode(fileFooter);

  const body = Buffer.concat([Buffer.from(headerBuf), fileBuffer, Buffer.from(footerBuf)]);

  const url = `${IMMICH_URL}/api/assets`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': IMMICH_API_KEY,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upload failed for ${fileName} (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!IMMICH_URL || !IMMICH_API_KEY) {
    console.error('Set IMMICH_URL and IMMICH_API_KEY environment variables');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const monthArg = args.find((a) => a.startsWith('--month='))?.split('=')[1]?.toLowerCase();
  const dirArg = args.find((a) => a.startsWith('--dir='))?.split('=')[1];

  if (!monthArg || !MONTH_NAMES_DE[monthArg]) {
    console.error(`Invalid --month. Valid: ${Object.keys(MONTH_NAMES_DE).join(', ')}`);
    process.exit(1);
  }

  const monthDE = MONTH_NAMES_DE[monthArg];
  const albumName = `Wallpaper ${monthDE}`;
  const imageDir = dirArg || join(__dirname, '..', 'assets', 'wallpapers', monthArg);

  // Collect PNG files
  const files = readdirSync(imageDir)
    .filter((f) => extname(f).toLowerCase() === '.png')
    .sort()
    .map((f) => join(imageDir, f));

  if (files.length === 0) {
    console.error(`No PNG files found in ${imageDir}`);
    process.exit(1);
  }

  console.log(`Album: "${albumName}"`);
  console.log(`Files: ${files.length} images from ${imageDir}`);

  // Find or create album
  const albums = await getAlbums();
  let album = albums.find((a) => a.albumName === albumName);
  if (album) {
    console.log(`Found existing album: ${album.id}`);
  } else {
    album = await createAlbum(albumName);
    console.log(`Created album: ${album.id}`);
  }

  // Upload each image and collect asset IDs
  const assetIds = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = basename(file);
    process.stdout.write(`  [${i + 1}/${files.length}] Uploading ${name}...`);
    try {
      const result = await uploadAsset(file);
      assetIds.push(result.id);
      const status = result.duplicate ? ' (duplicate)' : '';
      console.log(` OK${status}`);
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }
  }

  // Add to album
  if (assetIds.length > 0) {
    console.log(`\nAdding ${assetIds.length} assets to album...`);
    const result = await addAssetsToAlbum(album.id, assetIds);
    const added = result.filter?.((r) => r.success).length ?? assetIds.length;
    console.log(`Done! ${added} images added to "${albumName}"`);
  } else {
    console.log('\nNo images were uploaded successfully.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
