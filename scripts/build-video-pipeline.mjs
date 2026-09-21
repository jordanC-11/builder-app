#!/usr/bin/env node
// Builds build/thermocracy-slides.mp4 from src/slides.html:
//   1. Render every slide to a PNG with headless Chromium (Playwright).
//   2. Generate a local, offline voiceover clip per slide with Piper.
//   3. Assemble per-slide video clips with ffmpeg and concatenate them.
//
// Usage: npm run build-video [-- --skip-render] [-- --skip-audio] [-- --force]
"use strict";

import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { parseFile } from "music-metadata";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SLIDES_HTML = path.join(ROOT, "src", "slides.html");
const BUILD_DIR = path.join(ROOT, "build");
const SLIDES_DIR = path.join(BUILD_DIR, "slides");
const AUDIO_DIR = path.join(BUILD_DIR, "audio");
const CLIPS_DIR = path.join(BUILD_DIR, "clips");
const OUTPUT_MP4 = path.join(BUILD_DIR, "thermocracy-slides.mp4");

const PIPER_EXE = path.join(ROOT, "tools", "piper", "piper.exe");
const PIPER_VOICE = process.env.PIPER_VOICE ||
  path.join(ROOT, "tools", "piper", "voices", "en_US-amy-medium.onnx");

const WIDTH = 1920, HEIGHT = 1080, FPS = 30;
const TAIL_PADDING = 1.5;   // seconds of extra hold after each clip's audio ends
const MIN_DURATION = 2.0;   // floor, in case a narration clip is very short
const FADE = 0.6;           // seconds of fade in/out per slide

// Piper delivery tuning — livelier than Piper's flat defaults (length_scale 1.0,
// noise_scale 0.667, noise_w 0.8, sentence_silence 0.2s).
const PIPER_LENGTH_SCALE = 0.92;    // <1.0 speaks faster — reads as more energetic
const PIPER_NOISE_SCALE = 0.75;     // more natural variation, less flat
const PIPER_NOISE_W = 0.92;         // more pitch/phoneme-width variation, less monotone
const PIPER_SENTENCE_SILENCE = 0.15; // shorter inter-sentence pause, tighter pacing

const args = process.argv.slice(2);
const SKIP_RENDER = args.includes("--skip-render");
const SKIP_AUDIO = args.includes("--skip-audio");
const FORCE = args.includes("--force");

function log(msg) { console.log(`[build-video] ${msg}`); }
function fail(msg) { console.error(`[build-video] ERROR: ${msg}`); process.exit(1); }

async function ensureDirs() {
  for (const d of [BUILD_DIR, SLIDES_DIR, AUDIO_DIR, CLIPS_DIR]) {
    await fs.mkdir(d, { recursive: true });
  }
}

async function extractSlides(page) {
  await page.goto("file://" + SLIDES_HTML.replace(/\\/g, "/"));
  const slides = await page.evaluate(() => window.SLIDES);
  if (!Array.isArray(slides) || slides.length === 0) {
    fail("Could not read window.SLIDES from src/slides.html");
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

function checkPiper() {
  if (!existsSync(PIPER_EXE)) {
    fail(
      `Piper binary not found at ${PIPER_EXE}\n` +
      "  Download it (one-time, manual): https://github.com/rhasspy/piper/releases\n" +
      "  Unzip the Windows release so tools/piper/piper.exe exists, and place a voice\n" +
      "  model (e.g. en_US-amy-medium.onnx + .onnx.json) under tools/piper/voices/.\n" +
      "  See docs/VIDEO-GUIDE.md for details."
    );
  }
  if (!existsSync(PIPER_VOICE)) {
    fail(
      `Piper voice model not found at ${PIPER_VOICE}\n` +
      "  Download a voice from https://github.com/rhasspy/piper (VOICES.md) and place\n" +
      "  both the .onnx and .onnx.json files under tools/piper/voices/, or set the\n" +
      "  PIPER_VOICE env var to point at a different .onnx file."
    );
  }
}

function runPiper(text, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PIPER_EXE, [
      "--model", PIPER_VOICE, "--output_file", outPath,
      "--length_scale", String(PIPER_LENGTH_SCALE),
      "--noise_scale", String(PIPER_NOISE_SCALE),
      "--noise_w", String(PIPER_NOISE_W),
      "--sentence_silence", String(PIPER_SENTENCE_SILENCE)
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited with code ${code}: ${stderr}`));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

async function generateAudio(slides) {
  checkPiper();
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const outPath = path.join(AUDIO_DIR, `${slide.id}.wav`);
    if (!FORCE && existsSync(outPath)) {
      log(`[${i + 1}/${slides.length}] cached  ${slide.id}.wav`);
      continue;
    }
    await runPiper(slide.narration, outPath);
    log(`[${i + 1}/${slides.length}] voiced  ${slide.id}.wav`);
  }
}

async function clipDuration(wavPath) {
  const meta = await parseFile(wavPath);
  return meta.format.duration || MIN_DURATION;
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

async function buildClip(slide) {
  const png = path.join(SLIDES_DIR, `${slide.id}.png`);
  const wav = path.join(AUDIO_DIR, `${slide.id}.wav`);
  const out = path.join(CLIPS_DIR, `${slide.id}.mp4`);
  if (!existsSync(png)) fail(`Missing rendered slide image: ${png} (run without --skip-render)`);
  if (!existsSync(wav)) fail(`Missing audio clip: ${wav} (run without --skip-audio)`);

  const audioDur = await clipDuration(wav);
  const duration = Math.max(MIN_DURATION, audioDur + TAIL_PADDING);
  const fadeOutStart = Math.max(0, duration - FADE);

  await runFfmpeg([
    "-y",
    "-loop", "1", "-i", png,
    "-i", wav,
    "-t", duration.toFixed(2),
    "-r", String(FPS),
    "-vf", `fade=t=in:st=0:d=${FADE},fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${FADE}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    out
  ]);
  return { out, duration };
}

async function concatClips(clipPaths) {
  const listPath = path.join(BUILD_DIR, "clips.txt");
  const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, listContent, "utf8");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", OUTPUT_MP4]);
}

async function main() {
  await ensureDirs();

  let browser = null, slides;
  if (SKIP_RENDER) {
    // Still need slide data (narration, ids) even if we're not re-rendering images.
    browser = await chromium.launch();
    const page = await browser.newPage();
    slides = await extractSlides(page);
    await browser.close();
    log("Skipping render stage (--skip-render).");
  } else {
    browser = await chromium.launch();
    const page = await browser.newPage();
    slides = await extractSlides(page);
    await renderSlides(page, slides);
    await browser.close();
  }

  if (SKIP_AUDIO) {
    log("Skipping audio stage (--skip-audio).");
  } else {
    await generateAudio(slides);
  }

  log("Assembling per-slide clips...");
  const clips = [];
  let totalDuration = 0;
  for (let i = 0; i < slides.length; i++) {
    const { out, duration } = await buildClip(slides[i]);
    clips.push(out);
    totalDuration += duration;
    log(`[${i + 1}/${slides.length}] clip built (${duration.toFixed(1)}s) ${path.basename(out)}`);
  }

  log("Concatenating final video...");
  await concatClips(clips);

  const stat = await fs.stat(OUTPUT_MP4);
  const mins = Math.floor(totalDuration / 60), secs = Math.round(totalDuration % 60);
  log(`Done. ${slides.length} slides, ~${mins}:${String(secs).padStart(2, "0")} runtime, ` +
    `${(stat.size / 1e6).toFixed(1)} MB -> ${OUTPUT_MP4}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
