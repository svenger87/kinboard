#!/usr/bin/env node
/**
 * Full Wallpaper Generation Script
 * Generates wallpapers for a given month using the chosen model,
 * with upscaling via RealESRGAN_x2plus and resume support.
 *
 * Usage:
 *   node scripts/generate-wallpapers.mjs --model=z-image-turbo --month=march --count=30 [--resume] [--upload] [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const WIDTH = 768;
const HEIGHT = 1344;
const UPSCALED_WIDTH = 1536;
const UPSCALED_HEIGHT = 2688;
const PROGRESS_FILE = join(__dirname, '.generation-progress.json');

const MONTH_NAMES_DE = {
  january: 'Januar', february: 'Februar', march: 'März', april: 'April',
  may: 'Mai', june: 'Juni', july: 'Juli', august: 'August',
  september: 'September', october: 'Oktober', november: 'November', december: 'Dezember',
};

// ---------------------------------------------------------------------------
// Model definitions (same structure as compare, but with upscale node)
// ---------------------------------------------------------------------------

function buildZImageWorkflow(prompt, seed) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'z-image-turbo-Q8_0.gguf' } },
    '2': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
    '3': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: 'Qwen3-4B-Q8_0.gguf', type: 'qwen_image' } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: 'ae_zimage.safetensors' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: prompt } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: '' } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0],
        seed, control_after_generate: 'fixed', steps: 8, cfg: 1.0,
        sampler_name: 'euler', scheduler: 'simple', denoise: 1.0,
      },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['4', 0] } },
    // Upscale
    '20': { class_type: 'UpscaleModelLoader', inputs: { model_name: 'RealESRGAN_x2plus.pth' } },
    '21': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['9', 0] } },
    '22': { class_type: 'SaveImage', inputs: { images: ['21', 0], filename_prefix: 'wallpaper/z-image-turbo' } },
  };
}

function buildFluxDevWorkflow(prompt, seed) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux1-dev-Q6_K.gguf' } },
    '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: 't5xxl_fp8_e4m3fn.safetensors', clip_name2: 'clip_l.safetensors', type: 'flux' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'ae_flux.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 } },
    '7': { class_type: 'BasicScheduler', inputs: { model: ['1', 0], scheduler: 'normal', steps: 30, denoise: 1.0 } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '9': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '10': { class_type: 'CFGGuider', inputs: { model: ['1', 0], positive: ['4', 0], negative: ['5', 0], cfg: 3.5 } },
    '11': {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['9', 0], guider: ['10', 0], sampler: ['8', 0], sigmas: ['7', 0], latent_image: ['6', 0] },
    },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    // Upscale
    '20': { class_type: 'UpscaleModelLoader', inputs: { model_name: 'RealESRGAN_x2plus.pth' } },
    '21': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['12', 0] } },
    '22': { class_type: 'SaveImage', inputs: { images: ['21', 0], filename_prefix: 'wallpaper/flux1-dev' } },
  };
}

function buildQwenImageWorkflow(prompt, seed, negative) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'Qwen_Image_Distill-Q4_K_S.gguf' } },
    '3': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: 'Qwen3-4B-Q8_0.gguf', type: 'qwen_image' } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: prompt } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: negative || '' } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0],
        seed, control_after_generate: 'fixed', steps: 15, cfg: 1.0,
        sampler_name: 'euler', scheduler: 'simple', denoise: 1.0,
      },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['4', 0] } },
    // Upscale
    '20': { class_type: 'UpscaleModelLoader', inputs: { model_name: 'RealESRGAN_x2plus.pth' } },
    '21': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['9', 0] } },
    '22': { class_type: 'SaveImage', inputs: { images: ['21', 0], filename_prefix: 'wallpaper/qwen-image' } },
  };
}

function buildFlux2KleinWorkflow(prompt, seed) {
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
    // Upscale
    '20': { class_type: 'UpscaleModelLoader', inputs: { model_name: 'RealESRGAN_x2plus.pth' } },
    '21': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['12', 0] } },
    '22': { class_type: 'SaveImage', inputs: { images: ['21', 0], filename_prefix: 'wallpaper/flux2-klein' } },
  };
}

const MODEL_CONFIGS = {
  'z-image-turbo': {
    name: 'Z-Image Turbo',
    supportsNegative: false,
    formatPrompt: (p) => `${p}, highly detailed, 8K, photorealistic, natural textures`,
    build: (prompt, seed) => buildZImageWorkflow(prompt, seed),
  },
  'flux1-dev': {
    name: 'FLUX.1 Dev',
    supportsNegative: false,
    formatPrompt: (p) => `${p}. Shot on Canon EOS R5, 85mm f/1.4 lens. 8K, ultra-high resolution, tack sharp, fine detail.`,
    build: (prompt, seed) => buildFluxDevWorkflow(prompt, seed),
  },
  'flux2-klein': {
    name: 'FLUX.2 Klein',
    supportsNegative: false,
    formatPrompt: (p) => `${p}. 8K, ultra-high resolution, razor sharp, fine detail, crisp textures, tack sharp focus.`,
    build: (prompt, seed) => buildFlux2KleinWorkflow(prompt, seed),
  },
  'qwen-image': {
    name: 'Qwen-Image',
    supportsNegative: true,
    negativePrompt: 'blurry, low quality, text, watermark, oversaturated, distorted, ugly, cropped, out of frame',
    formatPrompt: (p) => `A photograph of ${p}, soft ambient light`,
    build: (prompt, seed, neg) => buildQwenImageWorkflow(prompt, seed, neg),
  },
};

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return { completed: [] };
}

function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ---------------------------------------------------------------------------
// ComfyUI API helpers
// ---------------------------------------------------------------------------

async function queuePrompt(workflow) {
  const body = JSON.stringify({ prompt: workflow, client_id: 'generate-wallpapers' });
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
    const wsUrl = COMFYUI_URL.replace(/^http/, 'ws') + '/ws?clientId=generate-wallpapers';
    const ws = new WebSocket(wsUrl);
    let timeout;

    const cleanup = () => { clearTimeout(timeout); ws.close(); };

    timeout = setTimeout(() => { cleanup(); reject(new Error('Timeout')); }, 900_000);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'executed' && msg.data?.prompt_id === promptId) { cleanup(); resolve(msg.data); }
        if (msg.type === 'execution_error' && msg.data?.prompt_id === promptId) {
          cleanup(); reject(new Error(`Execution error: ${JSON.stringify(msg.data)}`));
        }
        if (msg.type === 'progress' && msg.data?.prompt_id === promptId) {
          const { value, max } = msg.data;
          process.stdout.write(`\r    Sampling ${value}/${max}...`);
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

async function downloadImage(filename, subfolder, outputDir, localName) {
  const params = new URLSearchParams({ filename, subfolder: subfolder || '', type: 'output' });
  const resp = await fetch(`${COMFYUI_URL}/view?${params}`);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const outPath = join(outputDir, localName);
  writeFileSync(outPath, buf);
  return outPath;
}

// ---------------------------------------------------------------------------
// Seed generation from prompt text (deterministic but varied)
// ---------------------------------------------------------------------------

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
  const modelArg = args.find((a) => a.startsWith('--model='))?.split('=')[1];
  const monthArg = args.find((a) => a.startsWith('--month='))?.split('=')[1]?.toLowerCase();
  const countArg = parseInt(args.find((a) => a.startsWith('--count='))?.split('=')[1] || '30', 10);
  const resume = args.includes('--resume');
  const upload = args.includes('--upload');
  const dryRun = args.includes('--dry-run');

  if (!modelArg || !MODEL_CONFIGS[modelArg]) {
    console.error(`Usage: --model=z-image-turbo|flux1-dev|qwen-image --month=<month> [--count=30] [--resume] [--upload] [--dry-run]`);
    process.exit(1);
  }
  if (!monthArg || !MONTH_NAMES_DE[monthArg]) {
    console.error(`Invalid month. Valid: ${Object.keys(MONTH_NAMES_DE).join(', ')}`);
    process.exit(1);
  }

  const model = MODEL_CONFIGS[modelArg];
  const monthDE = MONTH_NAMES_DE[monthArg];
  const data = JSON.parse(readFileSync(join(__dirname, 'seasonal-prompts.json'), 'utf8'));
  const monthPrompts = data.months[monthArg]?.prompts;

  if (!monthPrompts || monthPrompts.length === 0) {
    console.error(`No prompts found for ${monthArg}`);
    process.exit(1);
  }

  const outputDir = join(__dirname, '..', 'assets', 'wallpapers', monthArg);
  mkdirSync(outputDir, { recursive: true });

  const progress = resume ? loadProgress() : { completed: [] };
  const completedSet = new Set(progress.completed);

  console.log(`Model: ${model.name}`);
  console.log(`Month: ${monthArg} (${monthDE})`);
  console.log(`Output: ${outputDir}`);
  console.log(`Generating ${countArg} wallpapers (${UPSCALED_WIDTH}×${UPSCALED_HEIGHT})`);
  if (resume) console.log(`Resuming: ${completedSet.size} already done`);
  console.log();

  let generated = 0;
  const totalTimes = [];

  for (let i = 0; i < countArg && i < monthPrompts.length; i++) {
    const rawPrompt = monthPrompts[i];
    const seed = hashString(`${monthArg}-${i}-${rawPrompt}`) % 2147483647;
    const localName = `${monthDE}_${String(i + 1).padStart(3, '0')}.png`;
    const key = `${modelArg}/${monthArg}/${localName}`;

    if (completedSet.has(key)) {
      console.log(`  [${i + 1}/${countArg}] SKIP (already done): ${localName}`);
      continue;
    }

    const formattedPrompt = model.formatPrompt(rawPrompt);
    const negative = model.supportsNegative ? model.negativePrompt : undefined;

    console.log(`  [${i + 1}/${countArg}] ${rawPrompt.slice(0, 70)}...`);

    if (dryRun) {
      console.log(`    → ${localName} (seed=${seed})`);
      console.log(`    Prompt: ${formattedPrompt.slice(0, 80)}...`);
      continue;
    }

    const workflow = model.build(formattedPrompt, seed, negative);
    const start = Date.now();

    try {
      const { prompt_id } = await queuePrompt(workflow);
      await waitForCompletion(prompt_id);
      process.stdout.write('\r' + ' '.repeat(40) + '\r');

      const history = await getHistory(prompt_id);
      const outputs = history[prompt_id]?.outputs;
      const saveNodeOutputs = Object.values(outputs).find((o) => o.images);
      if (!saveNodeOutputs?.images?.[0]) {
        console.log(`    WARNING: No image output`);
        continue;
      }

      const img = saveNodeOutputs.images[0];
      const outPath = await downloadImage(img.filename, img.subfolder, outputDir, localName);
      const elapsed = (Date.now() - start) / 1000;
      totalTimes.push(elapsed);
      generated++;

      progress.completed.push(key);
      saveProgress(progress);

      console.log(`    Done in ${elapsed.toFixed(1)}s → ${outPath}`);
    } catch (err) {
      console.error(`    ERROR: ${err.message}`);
    }
  }

  if (totalTimes.length > 0) {
    const avg = totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length;
    console.log(`\nGenerated ${generated} wallpapers. Avg time: ${avg.toFixed(1)}s/image`);
  }

  if (upload && !dryRun) {
    console.log(`\nUploading to Immich...`);
    const { execSync } = await import('child_process');
    execSync(`node "${join(__dirname, 'upload-to-immich.mjs')}" --month=${monthArg} --dir="${outputDir}"`, {
      stdio: 'inherit',
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
