#!/usr/bin/env node
/**
 * capture-demo.mjs — regenerate the demo animation in demo/ from the test page.
 *
 *   npm run build && node scripts/capture-demo.mjs
 *
 * Drives the card through every state and into a dance, records it, and encodes
 * the result. Run it after any visual change so the README shows what the card
 * actually does now.
 *
 * Three things decide how smooth the result is, and all three had to be dealt
 * with — the slowest one sets the ceiling:
 *
 *   1. Rendering. Playwright's default headless shell rasterises WebGL in
 *      software, managing about 11 fps on this scene. The full chromium channel
 *      reaches the GPU and holds the card's 60 fps cap. See launchBest.
 *   2. Capture. Element screenshots cost seconds each, and Playwright's video
 *      recorder is fixed at 25 fps. CDP screencast manages ~50 fps and, unlike
 *      grabbing the canvas with captureStream, records the composited page — so
 *      the status readout naming each state is still in frame.
 *   3. Encoding. GIF frame delays are whole centiseconds, so the format cannot
 *      go above 50 fps, and at that rate it is several times the size of an
 *      animated WebP. WebP is the default; set DEMO_FORMAT=gif if you need one.
 *
 * Env: DEMO_FPS (default 50), DEMO_FORMAT (webp|gif), DEMO_WIDTH (default 460).
 * Needs ffmpeg on PATH.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = 3210;
const FORMAT = process.env.DEMO_FORMAT === 'gif' ? 'gif' : 'webp';
const OUT = `demo/demo.${FORMAT}`;
/** Encoded width. The card renders at 520; smaller keeps it README-sized. */
const WIDTH = Number(process.env.DEMO_WIDTH || 460);
const FPS = Number(process.env.DEMO_FPS || 50);
const VIEWPORT = { width: 760, height: 720 };
/** GIF only: fewer colours shrink the file, at the cost of banding on the eye. */
const COLOURS = 96;

/** Each step clicks something, then holds for its duration. */
const TIMELINE = [
  { button: 'Listening', ms: 2200 },
  { button: 'Processing', ms: 2000 },
  { button: 'Responding', ms: 2600 },
  { button: 'Idle', ms: 1200 },
  { music: true, ms: 4400 },
];

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-800)}`))
    );
  });

/** Prefer a real GPU; fall back quietly so a machine without one still works. */
async function launchBest() {
  const gpu = {
    channel: 'chromium',
    args: ['--use-gl=angle', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  };
  try {
    const browser = await chromium.launch(gpu);
    const probe = await browser.newPage();
    const renderer = await probe.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    });
    await probe.close();
    if (!/swiftshader/i.test(renderer)) {
      console.log(`GPU: ${renderer.slice(0, 70)}`);
      return browser;
    }
    await browser.close();
  } catch {
    /* no chromium channel installed */
  }
  console.log('GPU: none — falling back to software rendering, expect a choppy result');
  return chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
}

const server = spawn('node', ['test/server.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'glados-demo-'));

try {
  await new Promise((r) => setTimeout(r, 800));

  const browser = await launchBest();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/test`, { waitUntil: 'networkidle' });

  // The FPS counter is a dev aid painted over the card, inside the crop below.
  await page.evaluate(() => {
    const fps = document.getElementById('fps');
    if (fps) fps.style.display = 'none';
  });

  // Wait for the model, not just the canvas: recording early yields empty frames.
  await page.waitForFunction(
    () => (document.querySelector('glados-3d-card')?.renderedFrames ?? 0) > 30,
    null,
    { timeout: 60000 }
  );

  const box = await page.locator('glados-3d-card').boundingBox();
  if (!box) throw new Error('could not measure the card');

  const cdp = await page.context().newCDPSession(page);
  const writes = [];
  let count = 0;
  cdp.on('Page.screencastFrame', (frame) => {
    const file = path.join(tmp, `f${String(count++).padStart(5, '0')}.jpg`);
    writes.push(fs.writeFile(file, Buffer.from(frame.data, 'base64')));
    // Chromium stops sending frames until each one is acknowledged.
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });

  const started = Date.now();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  for (const step of TIMELINE) {
    if (step.music) await page.click('#music');
    else await page.click(`#states button:has-text("${step.button}")`);
    await page.waitForTimeout(step.ms);
  }
  await cdp.send('Page.stopScreencast');
  const seconds = (Date.now() - started) / 1000;
  await Promise.all(writes);
  await browser.close();

  const captured = count / seconds;
  console.log(`captured ${count} frames in ${seconds.toFixed(1)}s — ${captured.toFixed(1)} fps`);

  const crop = [box.width, box.height, box.x, box.y].map(Math.round).join(':');
  const scale = `crop=${crop},fps=${FPS},scale=${WIDTH}:-1:flags=lanczos`;

  await fs.mkdir('demo', { recursive: true });
  const input = ['-framerate', captured.toFixed(3), '-i', path.join(tmp, 'f%05d.jpg')];

  if (FORMAT === 'webp') {
    await run('ffmpeg', [...['-y'], ...input, '-vf', scale,
      '-c:v', 'libwebp_anim', '-q:v', '72', '-loop', '0', OUT]);
  } else {
    await run('ffmpeg', [...['-y'], ...input, '-filter_complex',
      `${scale},split[a][b];[a]palettegen=max_colors=${COLOURS}:stats_mode=diff[p];` +
        `[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop', '0', OUT]);
  }

  const { size } = await fs.stat(OUT);
  console.log(`wrote ${OUT} — ${(size / 1024 / 1024).toFixed(2)} MB at ${FPS} fps`);
} finally {
  server.kill();
  await fs.rm(tmp, { recursive: true, force: true });
}
