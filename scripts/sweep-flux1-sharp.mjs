#!/usr/bin/env node
/**
 * FLUX.1 Dev Sharpness Sweep
 * Tests prompt suffix and CFG variations to maximize sharpness.
 *
 * Usage:
 *   node scripts/sweep-flux1-sharp.mjs [--dry-run]
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8000';
const WIDTH = 768;
const HEIGHT = 1344;
const SEED = 42;

// 5 diverse prompts
const TEST_PROMPTS = [
  'Snow-covered alpine peaks at sunrise, golden light on fresh powder, crisp mountain air',
  'Street food vendor in snow, steam rising, hungry customers waiting',
  'Cherry blossom canopy over quiet path, petals falling like snow, dreamy spring light',
  'Close-up of wildflowers in morning dew, macro detail, soft bokeh background',
  'Fjord in winter, steep snowy cliffs, calm dark water, moody atmosphere',
];

// Variants to test
const VARIANTS = [
  {
    label: 'baseline',
    suffix: '. Shot on Canon EOS R5, 85mm f/1.4 lens. 8K, ultra-high resolution, tack sharp, fine detail.',
    cfg: 3.5,
    steps: 30,
  },
  {
    label: 'sharp-prompt',
    suffix: '. 8K, ultra-high resolution, razor sharp, fine detail, crisp textures, tack sharp focus, shot on Canon EOS R5.',
    cfg: 3.5,
    steps: 30,
  },
  {
    label: 'cfg4',
    suffix: '. Shot on Canon EOS R5, 85mm f/1.4 lens. 8K, ultra-high resolution, tack sharp, fine detail.',
    cfg: 4.0,
    steps: 30,
  },
  {
    label: 'cfg5',
    suffix: '. Shot on Canon EOS R5, 85mm f/1.4 lens. 8K, ultra-high resolution, tack sharp, fine detail.',
    cfg: 5.0,
    steps: 30,
  },
  {
    label: 'sharp-cfg4',
    suffix: '. 8K, razor sharp, extremely detailed, crisp textures, fine grain, professional DSLR photograph, tack sharp focus.',
    cfg: 4.0,
    steps: 30,
  },
  {
    label: 'sharp-cfg4-40steps',
    suffix: '. 8K, razor sharp, extremely detailed, crisp textures, fine grain, professional DSLR photograph, tack sharp focus.',
    cfg: 4.0,
    steps: 40,
  },
];

// ---------------------------------------------------------------------------
// Workflow builder
// ---------------------------------------------------------------------------

function buildWorkflow(prompt, seed, { cfg, steps }) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux1-dev-Q6_K.gguf' } },
    '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: 't5xxl_fp8_e4m3fn.safetensors', clip_name2: 'clip_l.safetensors', type: 'flux' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'ae_flux.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 } },
    '7': { class_type: 'BasicScheduler', inputs: { model: ['1', 0], scheduler: 'normal', steps, denoise: 1.0 } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '9': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '10': { class_type: 'CFGGuider', inputs: { model: ['1', 0], positive: ['4', 0], negative: ['5', 0], cfg } },
    '11': {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['9', 0], guider: ['10', 0], sampler: ['8', 0], sigmas: ['7', 0], latent_image: ['6', 0] },
    },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '13': { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'sweep/flux1-sharp' } },
  };
}

// ---------------------------------------------------------------------------
// ComfyUI helpers
// ---------------------------------------------------------------------------

async function queuePrompt(workflow) {
  const body = JSON.stringify({ prompt: workflow, client_id: 'sweep-flux1' });
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
    const wsUrl = COMFYUI_URL.replace(/^http/, 'ws') + '/ws?clientId=sweep-flux1';
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
          process.stdout.write(`\r      Sampling ${msg.data.value}/${msg.data.max}...`);
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`FLUX.1 Dev Sharpness Sweep`);
  console.log(`${VARIANTS.length} variants × ${TEST_PROMPTS.length} prompts = ${VARIANTS.length * TEST_PROMPTS.length} images\n`);

  const timings = {};

  for (const variant of VARIANTS) {
    const dirName = `flux1-sharp-${variant.label}`;
    const outputDir = join(__dirname, '..', 'assets', 'comparison', dirName);
    mkdirSync(outputDir, { recursive: true });

    console.log(`--- ${variant.label} (cfg=${variant.cfg}, steps=${variant.steps}) ---`);
    console.log(`    Suffix: ${variant.suffix.slice(0, 70)}...`);
    timings[variant.label] = [];

    for (let i = 0; i < TEST_PROMPTS.length; i++) {
      const rawPrompt = TEST_PROMPTS[i];
      const formattedPrompt = rawPrompt + variant.suffix;
      const localName = `${String(i + 1).padStart(3, '0')}_seed${SEED}.png`;

      console.log(`  [${i + 1}/${TEST_PROMPTS.length}] ${rawPrompt.slice(0, 55)}...`);

      if (dryRun) {
        console.log(`    → ${dirName}/${localName}`);
        continue;
      }

      const workflow = buildWorkflow(formattedPrompt, SEED, variant);
      const start = Date.now();

      try {
        const { prompt_id } = await queuePrompt(workflow);
        await waitForCompletion(prompt_id);
        process.stdout.write('\r' + ' '.repeat(40) + '\r');

        const history = await getHistory(prompt_id);
        const outputs = history[prompt_id]?.outputs;
        const saveNode = Object.values(outputs).find(o => o.images);
        if (!saveNode?.images?.[0]) { console.log(`    WARNING: No output`); continue; }

        const img = saveNode.images[0];
        const outPath = await downloadImage(img.filename, img.subfolder, outputDir, localName);
        const elapsed = (Date.now() - start) / 1000;
        timings[variant.label].push(elapsed);
        console.log(`    Done in ${elapsed.toFixed(1)}s → ${outPath}`);
      } catch (err) {
        console.error(`    ERROR: ${err.message}`);
      }
    }
  }

  if (!dryRun) {
    console.log(`\n--- Timing Summary ---`);
    for (const [label, times] of Object.entries(timings)) {
      if (times.length === 0) continue;
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  ${label}: avg ${avg.toFixed(1)}s/image`);
    }
  }

  console.log(`\nDone! Compare in assets/comparison/flux1-sharp-*/`);
}

main().catch(err => { console.error(err); process.exit(1); });
