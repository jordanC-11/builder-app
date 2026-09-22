#!/usr/bin/env node
// Builds build/thermocracy-slides.mp4 from src/slides.html:
//   1. Render every slide to a (supersampled) PNG with headless Chromium (Playwright).
//   2. Turn each PNG into a silent Ken Burns clip, held for its authored `duration`.
//   3. Crossfade all clips together into one video (no hard cuts).
//   4. Mix in the looping music bed (assets/audio/soundtrack.mp3) with fades.
//
// Usage: npm run build-video [-- --skip-render]
"use strict";

import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SLIDES_HTML = path.join(ROOT, "src", "slides.html");
const BUILD_DIR = path.join(ROOT, "build");
const SLIDES_DIR = path.join(BUILD_DIR, "slides");
const CLIPS_DIR = path.join(BUILD_DIR, "clips");
const SILENT_MP4 = path.join(BUILD_DIR, "thermocracy-silent.mp4");
const OUTPUT_MP4 = path.join(BUILD_DIR, "thermocracy-slides.mp4");
const MUSIC_PATH = path.join(ROOT, "assets", "audio", "soundtrack.mp3");

const WIDTH = 1920, HEIGHT = 1080, FPS = 30;
const RENDER_SCALE = 2;              // supersample screenshots for clean digital zoom headroom
const XFADE_DURATION = 0.6;          // seconds of overlap between consecutive slides
const END_FADE = 0.8;                // fade-from/to-black at the very start/end of the video
const MUSIC_FADE = 1.5;              // seconds of music fade in/out
const ZOOM_AMOUNT = 0.14;            // max digital zoom over a slide's hold (e.g. 1.0 -> 1.14)

const args = process.argv.slice(2);
const SKIP_RENDER = args.includes("--skip-render");

function log(msg) { console.log(`[build-video] ${msg}`); }
function fail(msg) { console.error(`[build-video] ERROR: ${msg}`); process.exit(1); }

async function ensureDirs() {
  for (const d of [BUILD_DIR, SLIDES_DIR, CLIPS_DIR]) {
    await fs.mkdir(d, { recursive: true });
  }
}

async function extractSlides(page) {
  await page.goto("file://" + SLIDES_HTML.replace(/\\/g, "/"));
  const slides = await page.evaluate(() => window.SLIDES);
  if (!Array.isArray(slides) || slides.length === 0) {
    fail("Could not read window.SLIDES from src/slides.html");
  }
  for (const s of slides) {
    if (typeof s.duration !== "number" || s.duration <= 0) {
      fail(`Slide "${s.id}" is missing a positive numeric duration`);
    }
  }
  return slides;
}

async function renderSlides(page, slides) {
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.evaluate(() => document.body.classList.add("presenting"));
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    await page.evaluate((idx) => window.__renderSlide(idx), i);
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 10000 });
    const outPath = path.join(SLIDES_DIR, `${slide.id}.png`);
    await page.screenshot({ path: outPath });
    log(`[${i + 1}/${slides.length}] rendered ${slide.id}.png`);
  }
}

function runFfmpeg(ffArgs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ffArgs);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

// One silent Ken Burns clip per slide: a slow digital zoom over the slide's held
// duration, alternating zoom-in/zoom-out so consecutive slides don't feel identical.
async function buildClip(slide, index) {
  const png = path.join(SLIDES_DIR, `${slide.id}.png`);
  const out = path.join(CLIPS_DIR, `${slide.id}.mp4`);
  if (!existsSync(png)) fail(`Missing rendered slide image: ${png} (run without --skip-render)`);

  const frames = Math.round(slide.duration * FPS);
  const zoomIn = index % 2 === 0;
  const zMax = 1 + ZOOM_AMOUNT;
  // Expressed directly from the output frame index `on` (not the stateful `zoom`
  // accumulator) so both directions are exact and don't drift with rounding.
  const zExpr = zoomIn
    ? `'min(1+(on/${frames})*${ZOOM_AMOUNT},${zMax.toFixed(4)})'`
    : `'max(${zMax.toFixed(4)}-(on/${frames})*${ZOOM_AMOUNT},1)'`;
  // Keep the zoom centered — zoompan's default x/y=0 anchors the crop to the
  // top-left corner, which would drift the frame as it zooms.
  const xExpr = "'iw/2-(iw/zoom/2)'";
  const yExpr = "'ih/2-(ih/zoom/2)'";

  await runFfmpeg([
    "-y",
    "-loop", "1", "-i", png,
    "-t", slide.duration.toFixed(3),
    "-vf", [
      `scale=${WIDTH * RENDER_SCALE}:${HEIGHT * RENDER_SCALE}`,
      `zoompan=z=${zExpr}:x=${xExpr}:y=${yExpr}:d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
      "format=yuv420p"
    ].join(","),
    "-r", String(FPS),
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-an",
    out
  ]);
  return out;
}

// Chain ffmpeg's xfade filter across every clip so slides crossfade into each
// other instead of hard-cutting, then fade the whole thing from/to black.
async function crossfadeClips(clipPaths, durations) {
  const inputs = clipPaths.flatMap((p) => ["-i", p]);

  let filter = "";
  let prevLabel = "0:v";
  let cursor = durations[0];
  for (let i = 1; i < clipPaths.length; i++) {
    const outLabel = i === clipPaths.length - 1 ? "vfade" : `x${i}`;
    const offset = Math.max(0, cursor - XFADE_DURATION);
    filter += `[${prevLabel}][${i}:v]xfade=transition=fade:duration=${XFADE_DURATION}:offset=${offset.toFixed(3)}[${outLabel}];`;
    prevLabel = outLabel;
    cursor = offset + durations[i];
  }
  const total = cursor;

  filter += `[${prevLabel}]fade=t=in:st=0:d=${END_FADE},fade=t=out:st=${(total - END_FADE).toFixed(3)}:d=${END_FADE}[vout]`;

  await runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-r", String(FPS),
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    SILENT_MP4
  ]);
  return total;
}

async function muxMusic(totalDuration) {
  if (!existsSync(MUSIC_PATH)) {
    fail(`Missing music track at ${MUSIC_PATH}\n` +
      "  See assets/audio/CREDITS.md for where to get / how to swap the soundtrack.");
  }
  const fadeOutStart = Math.max(0, totalDuration - MUSIC_FADE);
  await runFfmpeg([
    "-y",
    "-i", SILENT_MP4,
    "-stream_loop", "-1", "-i", MUSIC_PATH,
    "-filter_complex",
    `[1:a]afade=t=in:st=0:d=${MUSIC_FADE},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${MUSIC_FADE}[a]`,
    "-map", "0:v", "-map", "[a]",
    "-shortest",
    "-c:v", "copy",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    OUTPUT_MP4
  ]);
}

async function main() {
  await ensureDirs();

  let browser, slides;
  if (SKIP_RENDER) {
    browser = await chromium.launch();
    const page = await browser.newPage();
    slides = await extractSlides(page);
    await browser.close();
    log("Skipping render stage (--skip-render).");
  } else {
    browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: RENDER_SCALE });
    slides = await extractSlides(page);
    await renderSlides(page, slides);
    await browser.close();
  }

  log("Building per-slide Ken Burns clips...");
  const clips = [];
  for (let i = 0; i < slides.length; i++) {
    const out = await buildClip(slides[i], i);
    clips.push(out);
    log(`[${i + 1}/${slides.length}] clip built (${slides[i].duration.toFixed(1)}s) ${path.basename(out)}`);
  }

  log("Crossfading clips into one silent video...");
  const durations = slides.map((s) => s.duration);
  const totalDuration = await crossfadeClips(clips, durations);

  log("Mixing in the music bed...");
  await muxMusic(totalDuration);

  const stat = await fs.stat(OUTPUT_MP4);
  const mins = Math.floor(totalDuration / 60), secs = Math.round(totalDuration % 60);
  log(`Done. ${slides.length} slides, ~${mins}:${String(secs).padStart(2, "0")} runtime, ` +
    `${(stat.size / 1e6).toFixed(1)} MB -> ${OUTPUT_MP4}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
