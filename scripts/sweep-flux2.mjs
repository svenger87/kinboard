#!/usr/bin/env node
/**
 * FLUX.2 Klein Parameter Sweep Script
 * Runs systematic A/B comparisons to find optimal parameters.
 *
 * Usage:
 *   node scripts/sweep-flux2.mjs --sweep=steps [--dry-run]
 *   node scripts/sweep-flux2.mjs --sweep=cfg [--dry-run]
 *   node scripts/sweep-flux2.mjs --sweep=sampler [--dry-run]
 *   node scripts/sweep-flux2.mjs --sweep=negative [--dry-run]
 *   node scripts/sweep-flux2.mjs --sweep=all [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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
const SEED = 42;

// 5 diverse prompts covering landscape, people, urban, nature close-up, moody
const TEST_PROMPTS = [
  'Snow-covered alpine peaks at sunrise, golden light on fresh powder, crisp mountain air',
  'Street food vendor in snow, steam rising, hungry customers waiting',
  'Cherry blossom canopy over quiet path, petals falling like snow, dreamy spring light',
  'Close-up of wildflowers in morning dew, macro detail, soft bokeh background',
  'Fjord in winter, steep snowy cliffs, calm dark water, moody atmosphere',
];

const NEGATIVE_ANATOMY = 'deformed hands, extra fingers, fused fingers, mutated hands, bad anatomy, malformed limbs, extra limbs, distorted face, ugly, blurry, low quality';

const NEGATIVE_KITCHEN_SINK = 'deformed hands, extra fingers, fused fingers, mutated hands, bad anatomy, malformed limbs, extra limbs, distorted face, ugly, blurry, low quality, watermark, text, signature, cropped, out of frame, worst quality, jpeg artifacts, duplicate, morbid, mutilated, poorly drawn, disfigured';

// ---------------------------------------------------------------------------
// Sweep definitions
// ---------------------------------------------------------------------------

const SWEEPS = {
  steps: {
    name: 'Steps Sweep',
    description: 'Testing step counts: 4, 6, 8, 10, 12, 15',
    variants: [
      { label: '4',  steps: 4,  cfg: 2.0, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: '6',  steps: 6,  cfg: 2.0, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: '8',  steps: 8,  cfg: 2.0, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: '10', steps: 10, cfg: 2.0, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: '12', steps: 12, cfg: 2.0, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: '15', steps: 15, cfg: 2.0, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
    ],
  },

  cfg: {
    name: 'CFG Sweep',
    description: 'Testing CFG guidance: 1.0, 1.5, 2.0, 2.5, 3.0',
    variants: [
      { label: '1.0', steps: 10, cfg: 1.0, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: '1.5', steps: 10, cfg: 1.5, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: '2.0', steps: 10, cfg: 2.0, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: '2.5', steps: 10, cfg: 2.5, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: '3.0', steps: 10, cfg: 3.0, sampler: 'euler', scheduler: 'simple', negative: NEGATIVE_ANATOMY },
    ],
  },

  sampler: {
    name: 'Sampler + Scheduler Sweep',
    description: 'Testing sampler/scheduler combos',
    variants: [
      { label: 'euler-simple',     steps: 10, cfg: 2.0, sampler: 'euler',      scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: 'euler-beta',       steps: 10, cfg: 2.0, sampler: 'euler',      scheduler: 'beta',   negative: NEGATIVE_ANATOMY },
      { label: 'euler-normal',     steps: 10, cfg: 2.0, sampler: 'euler',      scheduler: 'normal', negative: NEGATIVE_ANATOMY },
      { label: 'dpmpp_2m-simple',  steps: 10, cfg: 2.0, sampler: 'dpmpp_2m',   scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: 'dpmpp_2m-beta',    steps: 10, cfg: 2.0, sampler: 'dpmpp_2m',   scheduler: 'beta',   negative: NEGATIVE_ANATOMY },
      { label: 'dpmpp_sde-simple', steps: 10, cfg: 2.0, sampler: 'dpmpp_sde',  scheduler: 'simple', negative: NEGATIVE_ANATOMY },
    ],
  },

  negative: {
    name: 'Negative Prompt Sweep',
    description: 'Testing negative prompt strategies × 2 samplers (euler+simple, dpmpp_2m+beta)',
    variants: [
      { label: 'euler-none',         steps: 10, cfg: 2.0, sampler: 'euler',    scheduler: 'simple', negative: null },
      { label: 'euler-anatomy',      steps: 10, cfg: 2.0, sampler: 'euler',    scheduler: 'simple', negative: NEGATIVE_ANATOMY },
      { label: 'euler-kitchen-sink', steps: 10, cfg: 2.0, sampler: 'euler',    scheduler: 'simple', negative: NEGATIVE_KITCHEN_SINK },
      { label: 'dpmpp-none',         steps: 10, cfg: 2.0, sampler: 'dpmpp_2m', scheduler: 'beta',   negative: null },
      { label: 'dpmpp-anatomy',      steps: 10, cfg: 2.0, sampler: 'dpmpp_2m', scheduler: 'beta',   negative: NEGATIVE_ANATOMY },
      { label: 'dpmpp-kitchen-sink', steps: 10, cfg: 2.0, sampler: 'dpmpp_2m', scheduler: 'beta',   negative: NEGATIVE_KITCHEN_SINK },
    ],
  },
};

// ---------------------------------------------------------------------------
// Workflow builder
// ---------------------------------------------------------------------------

function buildWorkflow(prompt, seed, { steps, cfg, sampler, scheduler, negative }) {
  const workflow = {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux-2-klein-4b-Q8_0.gguf' } },
    '2': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: 'Qwen3-4B-Q8_0.gguf', type: 'flux2' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 } },
    '7': { class_type: 'BasicScheduler', inputs: { model: ['1', 0], scheduler, steps, denoise: 1.0 } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: sampler } },
    '9': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
  };

  // Negative conditioning: either CLIPTextEncode or ConditioningZeroOut
  if (negative) {
    workflow['5'] = { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: negative } };
  } else {
    workflow['5'] = { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } };
  }

  workflow['10'] = { class_type: 'CFGGuider', inputs: { model: ['1', 0], positive: ['4', 0], negative: ['5', 0], cfg } };
  workflow['11'] = {
    class_type: 'SamplerCustomAdvanced',
    inputs: { noise: ['9', 0], guider: ['10', 0], sampler: ['8', 0], sigmas: ['7', 0], latent_image: ['6', 0] },
  };
  workflow['12'] = { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } };
  workflow['13'] = { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'sweep/flux2' } };

  return workflow;
}

function formatPrompt(base) {
  return `${base}. 8K, ultra-high resolution, sharp details, correct anatomy.`;
}

// ---------------------------------------------------------------------------
// ComfyUI API helpers
// ---------------------------------------------------------------------------

async function queuePrompt(workflow) {
  const body = JSON.stringify({ prompt: workflow, client_id: 'sweep-flux2' });
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
    const wsUrl = COMFYUI_URL.replace(/^http/, 'ws') + '/ws?clientId=sweep-flux2';
    const ws = new WebSocket(wsUrl);
    let timeout;

    const cleanup = () => { clearTimeout(timeout); ws.close(); };

    timeout = setTimeout(() => { cleanup(); reject(new Error('Timeout waiting for ComfyUI')); }, 600_000);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'executed' && msg.data?.prompt_id === promptId) { cleanup(); resolve(msg.data); }
        if (msg.type === 'execution_error' && msg.data?.prompt_id === promptId) {
          cleanup(); reject(new Error(`ComfyUI execution error: ${JSON.stringify(msg.data)}`));
        }
        if (msg.type === 'progress' && msg.data?.prompt_id === promptId) {
          const { value, max } = msg.data;
          process.stdout.write(`\r      Sampling ${value}/${max}...`);
        }
      } catch { /* ignore non-JSON */ }
    });

    ws.on('error', (err) => { cleanup(); reject(err); });
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
// Run a single sweep
// ---------------------------------------------------------------------------

async function runSweep(sweepKey, dryRun) {
  const sweep = SWEEPS[sweepKey];
  if (!sweep) {
    console.error(`Unknown sweep: ${sweepKey}. Valid: ${Object.keys(SWEEPS).join(', ')}, all`);
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${sweep.name}`);
  console.log(`${sweep.description}`);
  console.log(`${sweep.variants.length} variants × ${TEST_PROMPTS.length} prompts = ${sweep.variants.length * TEST_PROMPTS.length} images`);
  console.log(`${'='.repeat(60)}\n`);

  const timings = {};

  for (const variant of sweep.variants) {
    const dirName = `flux2-${sweepKey}-${variant.label}`;
    const outputDir = join(__dirname, '..', 'assets', 'comparison', dirName);
    mkdirSync(outputDir, { recursive: true });

    console.log(`--- Variant: ${variant.label} (steps=${variant.steps}, cfg=${variant.cfg}, ${variant.sampler}+${variant.scheduler}, neg=${variant.negative ? 'yes' : 'none'}) ---`);
    timings[variant.label] = [];

    for (let i = 0; i < TEST_PROMPTS.length; i++) {
      const rawPrompt = TEST_PROMPTS[i];
      const formattedPrompt = formatPrompt(rawPrompt);
      const localName = `${String(i + 1).padStart(3, '0')}_seed${SEED}.png`;

      console.log(`  [${i + 1}/${TEST_PROMPTS.length}] ${rawPrompt.slice(0, 60)}...`);

      if (dryRun) {
        const workflow = buildWorkflow(formattedPrompt, SEED, variant);
        console.log(`    Workflow nodes: ${Object.keys(workflow).length}`);
        console.log(`    Output: ${dirName}/${localName}`);
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
        const saveNodeOutputs = Object.values(outputs).find((o) => o.images);
        if (!saveNodeOutputs?.images?.[0]) {
          console.log(`    WARNING: No image output found`);
          continue;
        }

        const img = saveNodeOutputs.images[0];
        const outPath = await downloadImage(img.filename, img.subfolder, outputDir, localName);
        const elapsed = (Date.now() - start) / 1000;
        timings[variant.label].push(elapsed);

        console.log(`    Done in ${elapsed.toFixed(1)}s → ${outPath}`);
      } catch (err) {
        console.error(`    ERROR: ${err.message}`);
      }
    }
  }

  // Print timing summary
  if (!dryRun) {
    console.log(`\n--- Timing Summary (${sweep.name}) ---`);
    for (const [label, times] of Object.entries(timings)) {
      if (times.length === 0) continue;
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  ${label}: avg ${avg.toFixed(1)}s/image (${times.length} images)`);
    }
  }

  console.log(`\nSweep "${sweepKey}" complete. Review images in assets/comparison/flux2-${sweepKey}-*/`);
  console.log(`Open scripts/classify.html to rate the results.\n`);
}

// ---------------------------------------------------------------------------
// CLI: update sweep defaults from previous winners
// ---------------------------------------------------------------------------

function applyWinners(args) {
  // Allow overriding defaults for subsequent sweeps:
  // --best-steps=12 --best-cfg=1.5 --best-sampler=dpmpp_2m --best-scheduler=beta
  const bestSteps = parseInt(args.find(a => a.startsWith('--best-steps='))?.split('=')[1] || '0', 10);
  const bestCfg = parseFloat(args.find(a => a.startsWith('--best-cfg='))?.split('=')[1] || '0');
  const bestSampler = args.find(a => a.startsWith('--best-sampler='))?.split('=')[1];
  const bestScheduler = args.find(a => a.startsWith('--best-scheduler='))?.split('=')[1];

  // Apply winners to subsequent sweeps
  if (bestSteps > 0) {
    for (const sweep of Object.values(SWEEPS)) {
      if (sweep === SWEEPS.steps) continue;
      for (const v of sweep.variants) v.steps = bestSteps;
    }
    console.log(`Applied best steps: ${bestSteps}`);
  }
  if (bestCfg > 0) {
    for (const sweep of Object.values(SWEEPS)) {
      if (sweep === SWEEPS.steps || sweep === SWEEPS.cfg) continue;
      for (const v of sweep.variants) v.cfg = bestCfg;
    }
    console.log(`Applied best cfg: ${bestCfg}`);
  }
  if (bestSampler) {
    for (const sweep of Object.values(SWEEPS)) {
      if (sweep === SWEEPS.steps || sweep === SWEEPS.cfg || sweep === SWEEPS.sampler) continue;
      for (const v of sweep.variants) v.sampler = bestSampler;
    }
    console.log(`Applied best sampler: ${bestSampler}`);
  }
  if (bestScheduler) {
    for (const sweep of Object.values(SWEEPS)) {
      if (sweep === SWEEPS.steps || sweep === SWEEPS.cfg || sweep === SWEEPS.sampler) continue;
      for (const v of sweep.variants) v.scheduler = bestScheduler;
    }
    console.log(`Applied best scheduler: ${bestScheduler}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const sweepArg = args.find(a => a.startsWith('--sweep='))?.split('=')[1];
  const dryRun = args.includes('--dry-run');

  if (!sweepArg) {
    console.error('Usage: node scripts/sweep-flux2.mjs --sweep=steps|cfg|sampler|negative|all [--dry-run]');
    console.error('');
    console.error('Optional: --best-steps=N --best-cfg=N --best-sampler=NAME --best-scheduler=NAME');
    console.error('  Apply winners from previous sweeps to subsequent sweep defaults.');
    process.exit(1);
  }

  applyWinners(args);

  if (sweepArg === 'all') {
    for (const key of Object.keys(SWEEPS)) {
      await runSweep(key, dryRun);
    }
  } else {
    await runSweep(sweepArg, dryRun);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
