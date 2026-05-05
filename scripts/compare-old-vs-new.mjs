#!/usr/bin/env node
/**
 * Compare old Immich wallpapers vs new FLUX.2 Klein tuned output.
 * Picks random wallpapers from an Immich album, extracts the prompt index,
 * downloads the old image, generates a new one with tuned parameters,
 * and saves both for side-by-side comparison.
 *
 * Usage:
 *   node scripts/compare-old-vs-new.mjs --month=march --count=10 [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8000';
const IMMICH_URL = process.env.IMMICH_URL;
const IMMICH_API_KEY = process.env.IMMICH_API_KEY;
if (!IMMICH_URL || !IMMICH_API_KEY) {
  console.error('Set IMMICH_URL and IMMICH_API_KEY environment variables before running this script.');
  process.exit(1);
}
const WIDTH = 768;
const HEIGHT = 1344;

const MONTH_NAMES_DE = {
  january: 'Januar', february: 'Februar', march: 'März', april: 'April',
  may: 'Mai', june: 'Juni', july: 'Juli', august: 'August',
  september: 'September', october: 'Oktober', november: 'November', december: 'Dezember',
};

// ---------------------------------------------------------------------------
// Immich helpers
// ---------------------------------------------------------------------------

async function immichFetch(path) {
  const resp = await fetch(`${IMMICH_URL}/api${path}`, {
    headers: { 'x-api-key': IMMICH_API_KEY },
  });
  if (!resp.ok) throw new Error(`Immich ${path} failed (${resp.status})`);
  return resp.json();
}

async function downloadImmichAsset(assetId, outputPath) {
  const resp = await fetch(`${IMMICH_URL}/api/assets/${assetId}/original`, {
    headers: { 'x-api-key': IMMICH_API_KEY },
  });
  if (!resp.ok) throw new Error(`Download asset failed (${resp.status})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(outputPath, buf);
  return outputPath;
}

// ---------------------------------------------------------------------------
// ComfyUI helpers (same as sweep script)
// ---------------------------------------------------------------------------

async function queuePrompt(workflow) {
  const body = JSON.stringify({ prompt: workflow, client_id: 'compare-old-new' });
  const resp = await fetch(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!resp.ok) throw new Error(`ComfyUI queue failed (${resp.status}): ${await resp.text()}`);
  return resp.json();
}

function waitForCompletion(promptId) {
  return new Promise((resolve, reject) => {
    const wsUrl = COMFYUI_URL.replace(/^http/, 'ws') + '/ws?clientId=compare-old-new';
    const ws = new WebSocket(wsUrl);
    let timeout;
    const cleanup = () => { clearTimeout(timeout); ws.close(); };
    timeout = setTimeout(() => { cleanup(); reject(new Error('Timeout')); }, 600_000);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'executed' && msg.data?.prompt_id === promptId) { cleanup(); resolve(msg.data); }
        if (msg.type === 'execution_error' && msg.data?.prompt_id === promptId) {
          cleanup(); reject(new Error(`Execution error: ${JSON.stringify(msg.data)}`));
        }
        if (msg.type === 'progress' && msg.data?.prompt_id === promptId) {
          process.stdout.write(`\r    Sampling ${msg.data.value}/${msg.data.max}...`);
        }
      } catch { /* ignore */ }
    });
    ws.on('error', (err) => { cleanup(); reject(err); });
  });
}

async function getHistory(promptId) {
  const resp = await fetch(`${COMFYUI_URL}/history/${promptId}`);
  if (!resp.ok) throw new Error(`History failed: ${resp.status}`);
  return resp.json();
}

async function downloadComfyImage(filename, subfolder, outputDir, localName) {
  const params = new URLSearchParams({ filename, subfolder: subfolder || '', type: 'output' });
  const resp = await fetch(`${COMFYUI_URL}/view?${params}`);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const outPath = join(outputDir, localName);
  writeFileSync(outPath, buf);
  return outPath;
}

// ---------------------------------------------------------------------------
// FLUX.2 Klein tuned workflow (no negative, 8 steps, cfg 2.0)
// ---------------------------------------------------------------------------

function buildTunedWorkflow(prompt, seed) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux-2-klein-4b-Q8_0.gguf' } },
    '2': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: 'Qwen3-4B-Q8_0.gguf', type: 'flux2' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 } },
    '7': { class_type: 'BasicScheduler', inputs: { model: ['1', 0], scheduler: 'simple', steps: 8, denoise: 1.0 } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '9': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '10': { class_type: 'CFGGuider', inputs: { model: ['1', 0], positive: ['4', 0], negative: ['5', 0], cfg: 2.0 } },
    '11': {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['9', 0], guider: ['10', 0], sampler: ['8', 0], sigmas: ['7', 0], latent_image: ['6', 0] },
    },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '13': { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'compare-old-new/flux2-tuned' } },
  };
}

function formatPrompt(base) {
  return `${base}. 8K, ultra-high resolution, razor sharp, fine detail, crisp textures, tack sharp focus.`;
}

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const monthArg = args.find(a => a.startsWith('--month='))?.split('=')[1]?.toLowerCase();
  const countArg = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] || '10', 10);
  const dryRun = args.includes('--dry-run');

  if (!monthArg || !MONTH_NAMES_DE[monthArg]) {
    console.error(`Usage: --month=<month> [--count=10] [--dry-run]`);
    process.exit(1);
  }

  const monthDE = MONTH_NAMES_DE[monthArg];
  const albumName = `Wallpaper ${monthDE}`;

  // Load prompts
  const data = JSON.parse(readFileSync(join(__dirname, 'seasonal-prompts.json'), 'utf8'));
  const prompts = data.months[monthArg]?.prompts;
  if (!prompts) { console.error(`No prompts for ${monthArg}`); process.exit(1); }

  // Find Immich album
  console.log(`Looking for album "${albumName}" on Immich...`);
  const albums = await immichFetch('/albums');
  const album = albums.find(a => a.albumName === albumName);
  if (!album) { console.error(`Album "${albumName}" not found`); process.exit(1); }

  // Get album assets
  const albumData = await immichFetch(`/albums/${album.id}`);
  const assets = albumData.assets.filter(a => a.originalFileName.endsWith('.png'));
  console.log(`Found ${assets.length} wallpapers in "${albumName}"`);

  // Parse filenames to extract prompt indices: march_008_01_fullhd.png → 1-based index 8 → prompts[7]
  const parsed = assets.map(a => {
    const match = a.originalFileName.match(/^[a-z]+_(\d+)_\d+_fullhd\.png$/);
    if (!match) return null;
    const fileIdx = parseInt(match[1], 10); // 1-based
    const promptIdx = fileIdx - 1;           // 0-based
    if (promptIdx < 0 || promptIdx >= prompts.length) return null;
    return { asset: a, promptIdx, fileIdx, prompt: prompts[promptIdx] };
  }).filter(Boolean);

  console.log(`Matched ${parsed.length} assets to prompts`);

  // Pick random subset
  const shuffled = parsed.sort(() => Math.random() - 0.5).slice(0, countArg);

  const outputDir = join(__dirname, '..', 'assets', 'comparison', `old-vs-new-${monthArg}`);
  mkdirSync(outputDir, { recursive: true });

  console.log(`\nComparing ${shuffled.length} images: old vs tuned FLUX.2 Klein`);
  console.log(`Output: ${outputDir}\n`);

  for (let i = 0; i < shuffled.length; i++) {
    const { asset, promptIdx, fileIdx, prompt } = shuffled[i];
    const seed = hashString(`${monthArg}-${promptIdx}-${prompt}`) % 2147483647;
    const formattedPrompt = formatPrompt(prompt);
    const prefix = String(fileIdx).padStart(3, '0');

    console.log(`[${i + 1}/${shuffled.length}] #${fileIdx} (idx ${promptIdx}): ${prompt.slice(0, 55)}...`);

    if (dryRun) {
      console.log(`  Old: ${asset.originalFileName} (${asset.id})`);
      console.log(`  New: ${prefix}_new.png (seed=${seed})`);
      console.log(`  Prompt: ${formattedPrompt.slice(0, 80)}...`);
      continue;
    }

    // Download old image from Immich
    const oldPath = join(outputDir, `${prefix}_old.png`);
    console.log(`  Downloading old image...`);
    await downloadImmichAsset(asset.id, oldPath);
    console.log(`  → ${oldPath}`);

    // Generate new image
    console.log(`  Generating new image (seed=${seed})...`);
    const workflow = buildTunedWorkflow(formattedPrompt, seed);
    const start = Date.now();

    try {
      const { prompt_id } = await queuePrompt(workflow);
      await waitForCompletion(prompt_id);
      process.stdout.write('\r' + ' '.repeat(40) + '\r');

      const history = await getHistory(prompt_id);
      const outputs = history[prompt_id]?.outputs;
      const saveNode = Object.values(outputs).find(o => o.images);
      if (!saveNode?.images?.[0]) {
        console.log(`  WARNING: No image output`);
        continue;
      }

      const img = saveNode.images[0];
      const newPath = await downloadComfyImage(img.filename, img.subfolder, outputDir, `${prefix}_new.png`);
      const elapsed = (Date.now() - start) / 1000;
      console.log(`  → ${newPath} (${elapsed.toFixed(1)}s)`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  console.log(`\nDone! Compare images in ${outputDir}`);
  console.log(`Files named {idx}_old.png vs {idx}_new.png`);
  console.log(`Open scripts/classify.html and load the folder to rate them.`);
}

main().catch(err => { console.error(err); process.exit(1); });
