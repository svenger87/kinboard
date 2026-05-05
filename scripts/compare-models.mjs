#!/usr/bin/env node
/**
 * Model Comparison Script
 * Generates images from 20 fixed prompts × 20 fixed seeds × 3 models
 * for side-by-side quality comparison.
 *
 * Usage:
 *   node scripts/compare-models.mjs --model=z-image-turbo|flux1-dev|flux2-klein|qwen-image|all [--dry-run]
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
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

const FIXED_SEEDS = [
  42, 137, 256, 314, 512, 666, 777, 888, 999, 1024,
  1337, 2048, 3141, 4096, 5555, 6789, 7777, 8192, 9001, 9999,
];

// ---------------------------------------------------------------------------
// Model definitions – each builds its own ComfyUI API workflow
// ---------------------------------------------------------------------------

const MODELS = {
  'z-image-turbo': {
    name: 'Z-Image Turbo',
    supportsNegative: false,
    formatPrompt(base) {
      return `${base}, highly detailed, 8K, photorealistic, natural textures`;
    },
    buildWorkflow(prompt, seed) {
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
            model: ['2', 0],
            positive: ['5', 0],
            negative: ['6', 0],
            latent_image: ['7', 0],
            seed,
            control_after_generate: 'fixed',
            steps: 8,
            cfg: 1.0,
            sampler_name: 'euler',
            scheduler: 'simple',
            denoise: 1.0,
          },
        },
        '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['4', 0] } },
        '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'compare/z-image-turbo' } },
      };
    },
  },

  'flux1-dev': {
    name: 'FLUX.1 Dev',
    supportsNegative: false,
    formatPrompt(base) {
      return `${base}. Shot on Canon EOS R5, 85mm f/1.4 lens. 8K, ultra-high resolution, tack sharp, fine detail.`;
    },
    buildWorkflow(prompt, seed) {
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
          inputs: {
            noise: ['9', 0],
            guider: ['10', 0],
            sampler: ['8', 0],
            sigmas: ['7', 0],
            latent_image: ['6', 0],
          },
        },
        '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
        '13': { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'compare/flux1-dev' } },
      };
    },
  },

  'flux2-klein': {
    name: 'FLUX.2 Klein',
    supportsNegative: false,
    formatPrompt(base) {
      return `${base}. 8K, ultra-high resolution, razor sharp, fine detail, crisp textures, tack sharp focus.`;
    },
    buildWorkflow(prompt, seed) {
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
          inputs: {
            noise: ['9', 0],
            guider: ['10', 0],
            sampler: ['8', 0],
            sigmas: ['7', 0],
            latent_image: ['6', 0],
          },
        },
        '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
        '13': { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'compare/flux2-klein' } },
      };
    },
  },

  'qwen-image': {
    name: 'Qwen-Image',
    supportsNegative: true,
    formatPrompt(base) {
      return `A photograph of ${base}, soft ambient light`;
    },
    negativePrompt: 'blurry, low quality, text, watermark, oversaturated, distorted, ugly, cropped, out of frame',
    buildWorkflow(prompt, seed, negative) {
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
            model: ['1', 0],
            positive: ['5', 0],
            negative: ['6', 0],
            latent_image: ['7', 0],
            seed,
            control_after_generate: 'fixed',
            steps: 15,
            cfg: 1.0,
            sampler_name: 'euler',
            scheduler: 'simple',
            denoise: 1.0,
          },
        },
        '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['4', 0] } },
        '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'compare/qwen-image' } },
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Select 20 diverse test prompts from seasonal-prompts.json
// ---------------------------------------------------------------------------

function selectTestPrompts() {
  const data = JSON.parse(readFileSync(join(__dirname, 'seasonal-prompts.json'), 'utf8'));
  const allMonths = Object.keys(data.months);
  const selected = [];

  // Pick prompts evenly across months to get seasonal diversity
  // 20 prompts: pick from first 10 months, 2 each (idx 0 and 5 for variety)
  const pickIndices = [0, 5];
  for (const month of allMonths.slice(0, 10)) {
    const prompts = data.months[month].prompts;
    for (const idx of pickIndices) {
      if (prompts[idx]) selected.push(prompts[idx]);
    }
    if (selected.length >= 20) break;
  }
  return selected.slice(0, 20);
}

// ---------------------------------------------------------------------------
// ComfyUI API helpers
// ---------------------------------------------------------------------------

async function queuePrompt(workflow) {
  const body = JSON.stringify({ prompt: workflow, client_id: 'compare-models' });
  const resp = await fetch(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ComfyUI queue failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

function waitForCompletion(promptId) {
  return new Promise((resolve, reject) => {
    const wsUrl = COMFYUI_URL.replace(/^http/, 'ws') + '/ws?clientId=compare-models';
    const ws = new WebSocket(wsUrl);
    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      ws.close();
    };

    // 10 min timeout per image
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting for ComfyUI'));
    }, 600_000);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'executed' && msg.data?.prompt_id === promptId) {
          cleanup();
          resolve(msg.data);
        }
        if (msg.type === 'execution_error' && msg.data?.prompt_id === promptId) {
          cleanup();
          reject(new Error(`ComfyUI execution error: ${JSON.stringify(msg.data)}`));
        }
      } catch { /* ignore non-JSON */ }
    });

    ws.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

async function getHistory(promptId) {
  const resp = await fetch(`${COMFYUI_URL}/history/${promptId}`);
  if (!resp.ok) throw new Error(`Failed to get history: ${resp.status}`);
  return resp.json();
}

async function downloadImage(filename, subfolder, outputDir, localName) {
  const params = new URLSearchParams({ filename, subfolder: subfolder || '', type: 'output' });
  const resp = await fetch(`${COMFYUI_URL}/view?${params}`);
  if (!resp.ok) throw new Error(`Failed to download image: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const outPath = join(outputDir, localName);
  writeFileSync(outPath, buf);
  return outPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const modelArg = (args.find((a) => a.startsWith('--model=')) || '--model=all').split('=')[1];
  const dryRun = args.includes('--dry-run');

  const modelsToRun = modelArg === 'all' ? Object.keys(MODELS) : [modelArg];

  for (const key of modelsToRun) {
    if (!MODELS[key]) {
      console.error(`Unknown model: ${key}. Valid: ${Object.keys(MODELS).join(', ')}, all`);
      process.exit(1);
    }
  }

  const testPrompts = selectTestPrompts();
  console.log(`Selected ${testPrompts.length} test prompts`);
  console.log(`Seeds: ${FIXED_SEEDS.length}`);
  console.log(`Models: ${modelsToRun.join(', ')}`);
  console.log(`Total images: ${testPrompts.length * modelsToRun.length} (1 seed per prompt for comparison)\n`);

  // For comparison we use 1 seed per prompt (first seed) to keep it manageable
  // Full 20×20 would be 400 images per model — too many for visual comparison
  const seed = FIXED_SEEDS[0]; // seed 42

  for (const modelKey of modelsToRun) {
    const model = MODELS[modelKey];
    const outputDir = join(__dirname, '..', 'assets', 'comparison', modelKey);
    mkdirSync(outputDir, { recursive: true });

    console.log(`\n=== ${model.name} ===`);

    for (let i = 0; i < testPrompts.length; i++) {
      const rawPrompt = testPrompts[i];
      const formattedPrompt = model.formatPrompt(rawPrompt);
      const negative = model.supportsNegative ? model.negativePrompt : undefined;
      const localName = `${String(i + 1).padStart(3, '0')}_seed${seed}.png`;

      console.log(`  [${i + 1}/${testPrompts.length}] ${rawPrompt.slice(0, 60)}...`);

      if (dryRun) {
        const workflow = model.buildWorkflow(formattedPrompt, seed, negative);
        console.log(`    Workflow nodes: ${Object.keys(workflow).length}`);
        console.log(`    Prompt: ${formattedPrompt.slice(0, 80)}...`);
        if (negative) console.log(`    Negative: ${negative.slice(0, 60)}...`);
        continue;
      }

      const workflow = model.buildWorkflow(formattedPrompt, seed, negative);
      const start = Date.now();

      try {
        const { prompt_id } = await queuePrompt(workflow);
        await waitForCompletion(prompt_id);

        // Get output filename from history
        const history = await getHistory(prompt_id);
        const outputs = history[prompt_id]?.outputs;
        const saveNodeOutputs = Object.values(outputs).find((o) => o.images);
        if (!saveNodeOutputs?.images?.[0]) {
          console.log(`    WARNING: No image output found`);
          continue;
        }

        const img = saveNodeOutputs.images[0];
        const outPath = await downloadImage(img.filename, img.subfolder, outputDir, localName);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`    Done in ${elapsed}s → ${outPath}`);
      } catch (err) {
        console.error(`    ERROR: ${err.message}`);
      }
    }
  }

  if (!dryRun) {
    console.log('\nComparison complete! Review images in assets/comparison/');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
