#!/usr/bin/env node
// Builds build/thermocracy-slides.mp4 from src/slides.html:
//   1. Render every slide to a (supersampled) PNG with headless Chromium (Playwright).
//   2. Synthesize an offline voiceover clip per slide with a `voiceover` line (Piper).
//   3. Turn each PNG into a silent Ken Burns clip, held for its voiceover-derived
//      (or authored, if silent) duration.
//   4. Crossfade all clips together into one video (no hard cuts).
//   5. Build the full audio mix — looped/faded music bed, placed voiceover clips,
//      and a few synthesized UI sound cues — and mux it onto the video.
//
// Usage: npm run build-video [-- --skip-render] [-- --skip-voice]
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
const CLIPS_DIR = path.join(BUILD_DIR, "clips");
const AUDIO_DIR = path.join(BUILD_DIR, "audio");
const SILENT_MP4 = path.join(BUILD_DIR, "thermocracy-silent.mp4");
const AUDIO_MIX = path.join(BUILD_DIR, "audio-mix.m4a");
const OUTPUT_MP4 = path.join(BUILD_DIR, "thermocracy-slides.mp4");
const MUSIC_PATH = path.join(ROOT, "assets", "audio", "soundtrack.mp3");

const PIPER_EXE = path.join(ROOT, "tools", "piper", "piper.exe");
const PIPER_VOICE = process.env.PIPER_VOICE ||
  path.join(ROOT, "tools", "piper", "voices", "en_US-amy-medium.onnx");

// Delivery tuning proven in an earlier version of this pipeline — livelier than
// Piper's flat defaults, leaned further here toward a deliberate, over-dramatic
// keynote cadence (see the parody voiceover script in src/slides.html).
const PIPER_LENGTH_SCALE = 1.04;     // >1.0 speaks slightly slower — more "reverent"
const PIPER_NOISE_SCALE = 0.78;
const PIPER_NOISE_W = 0.9;
const PIPER_SENTENCE_SILENCE = 0.35; // longer pause — dramatic beats between lines

const WIDTH = 1920, HEIGHT = 1080, FPS = 30;
const RENDER_SCALE = 2;              // supersample screenshots for clean digital zoom headroom
const XFADE_DURATION = 0.6;          // seconds of overlap between consecutive slides
const END_FADE = 0.8;                // fade-from/to-black at the very start/end of the video
const ZOOM_AMOUNT = 0.14;            // max digital zoom over a slide's hold (e.g. 1.0 -> 1.14)

const VOICE_PADDING = 1.0;           // extra hold after a slide's voiceover clip ends
const MIN_DURATION = 2.0;            // floor, in case a voiceover clip is very short

const MUSIC_FADE = 1.5;              // seconds of music fade in/out
const MUSIC_BED_VOLUME = 0.32;       // music sits under the voiceover, not on top of it
const NARRATION_VOLUME = 1.15;       // slight boost so narration reads clearly over music

// Lightweight, synthesized (not sourced) UI sound cues — one per named slide id,
// played at that slide's start. Each is a plain sine tone shaped with a short
// fade envelope, so no binary SFX assets need to be sourced or licensed.
const SFX_CUES = { "vote-tapped": "click", "truth-split": "notify", "final-reveal": "chime" };
const SFX_SOURCES = {
  click: { lavfi: "sine=frequency=1400:duration=0.07:sample_rate=44100",
    post: "afade=t=in:st=0:d=0.005,afade=t=out:st=0.02:d=0.05", volume: 0.25 },
  notify: { lavfi: "sine=frequency=880:duration=0.22:sample_rate=44100",
    post: "afade=t=in:st=0:d=0.01,afade=t=out:st=0.12:d=0.1", volume: 0.3 },
  chime: { lavfi: "sine=frequency=660:duration=0.9:sample_rate=44100",
    post: "afade=t=in:st=0:d=0.05,afade=t=out:st=0.4:d=0.5", volume: 0.22 }
};

const args = process.argv.slice(2);
const SKIP_RENDER = args.includes("--skip-render");
const SKIP_VOICE = args.includes("--skip-voice");

function log(msg) { console.log(`[build-video] ${msg}`); }
function fail(msg) { console.error(`[build-video] ERROR: ${msg}`); process.exit(1); }

async function ensureDirs() {
  for (const d of [BUILD_DIR, SLIDES_DIR, CLIPS_DIR, AUDIO_DIR]) {
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

function checkPiper() {
  if (!existsSync(PIPER_EXE)) {
    fail(
      `Piper binary not found at ${PIPER_EXE}\n` +
      "  Download it (one-time, manual): https://github.com/rhasspy/piper/releases\n" +
      "  Unzip the Windows release so tools/piper/piper.exe exists, and place a voice\n" +
      "  model (e.g. en_US-amy-medium.onnx + .onnx.json) under tools/piper/voices/.\n" +
      "  See docs/VIDEO-GUIDE.md for details, or re-run with --skip-voice."
    );
  }
  if (!existsSync(PIPER_VOICE)) {
    fail(
      `Piper voice model not found at ${PIPER_VOICE}\n` +
      "  Place both the .onnx and .onnx.json files under tools/piper/voices/, or set\n" +
      "  the PIPER_VOICE env var to point at a different .onnx file."
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

// Synthesizes build/audio/<id>.wav for every slide with a `voiceover` line, and
// returns each such slide's clip duration (seconds) keyed by slide id.
async function synthesizeVoiceover(slides) {
  const voiced = slides.filter((s) => s.voiceover);
  if (voiced.length === 0) return new Map();
  checkPiper();

  const durations = new Map();
  for (let i = 0; i < voiced.length; i++) {
    const slide = voiced[i];
    const outPath = path.join(AUDIO_DIR, `${slide.id}.wav`);
    await runPiper(slide.voiceover, outPath);
    const meta = await parseFile(outPath);
    durations.set(slide.id, meta.format.duration || MIN_DURATION);
    log(`[${i + 1}/${voiced.length}] voiced ${slide.id}.wav (${(meta.format.duration || 0).toFixed(2)}s)`);
  }
  return durations;
}

// A slide's on-screen hold time: driven by its voiceover clip when it has one
// (clip length + a small tail pad, never below the authored floor), otherwise
// just the authored `duration`.
function effectiveDuration(slide, voiceDurations) {
  const clipDur = voiceDurations.get(slide.id);
  if (clipDur == null) return slide.duration;
  return Math.max(slide.duration, clipDur + VOICE_PADDING, MIN_DURATION);
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
async function buildClip(slide, index, duration) {
  const png = path.join(SLIDES_DIR, `${slide.id}.png`);
  const out = path.join(CLIPS_DIR, `${slide.id}.mp4`);
  if (!existsSync(png)) fail(`Missing rendered slide image: ${png} (run without --skip-render)`);

  const frames = Math.round(duration * FPS);
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
    "-t", duration.toFixed(3),
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
// Also returns each slide's approximate start offset in the assembled timeline,
// used to place voiceover clips and SFX cues in the audio mix.
async function crossfadeClips(clipPaths, durations) {
  const inputs = clipPaths.flatMap((p) => ["-i", p]);
  const starts = [0];

  let filter = "";
  let prevLabel = "0:v";
  let cursor = durations[0];
  for (let i = 1; i < clipPaths.length; i++) {
    const outLabel = i === clipPaths.length - 1 ? "vfade" : `x${i}`;
    const offset = Math.max(0, cursor - XFADE_DURATION);
    starts.push(offset);
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
  return { total, starts };
}

// Builds the complete audio mix — looped/faded music bed under the placed
// voiceover clips, plus a few synthesized UI sound cues — as a standalone file,
// muxed onto the silent video in a separate step.
async function buildAudioMix(slides, starts, totalDuration) {
  if (!existsSync(MUSIC_PATH)) {
    fail(`Missing music track at ${MUSIC_PATH}\n` +
      "  See assets/audio/CREDITS.md for where to get / how to swap the soundtrack.");
  }

  const inputs = ["-stream_loop", "-1", "-i", MUSIC_PATH];
  let inputIndex = 1;
  const filterParts = [];
  const narrationLabels = [];
  const sfxLabels = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    if (!slide.voiceover) continue;
    const wav = path.join(AUDIO_DIR, `${slide.id}.wav`);
    if (!existsSync(wav)) fail(`Missing voiceover clip: ${wav} (run without --skip-voice)`);
    inputs.push("-i", wav);
    const ms = Math.round(starts[i] * 1000);
    const label = `nv${inputIndex}`;
    filterParts.push(`[${inputIndex}:a]adelay=${ms}|${ms}[${label}]`);
    narrationLabels.push(label);
    inputIndex++;
  }

  for (const [slideId, cue] of Object.entries(SFX_CUES)) {
    const i = slides.findIndex((s) => s.id === slideId);
    if (i === -1) continue;
    const spec = SFX_SOURCES[cue];
    inputs.push("-f", "lavfi", "-i", spec.lavfi);
    const ms = Math.round(starts[i] * 1000);
    const label = `sfx${inputIndex}`;
    filterParts.push(`[${inputIndex}:a]${spec.post},volume=${spec.volume},adelay=${ms}|${ms}[${label}]`);
    sfxLabels.push(label);
    inputIndex++;
  }

  const fadeOutStart = Math.max(0, totalDuration - MUSIC_FADE);
  filterParts.push(
    `[0:a]afade=t=in:st=0:d=${MUSIC_FADE},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${MUSIC_FADE},` +
    `volume=${MUSIC_BED_VOLUME}[musicbed]`
  );

  const mixLabels = ["musicbed", ...narrationLabels, ...sfxLabels];
  const mixWeights = mixLabels.map((l) =>
    narrationLabels.includes(l) ? NARRATION_VOLUME : l === "musicbed" ? 1 : 1
  );
  // normalize=0 is required here: amix's default auto-normalize divides every
  // input by the total input count (up to ~25, once every voiceover clip and
  // SFX cue is counted), which would drown the mix regardless of `weights` —
  // weights alone only balance the inputs relative to each other.
  filterParts.push(
    `${mixLabels.map((l) => `[${l}]`).join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0:weights=${mixWeights.join(" ")}[mixed]`,
    `[mixed]alimiter=limit=0.95[aout]`
  );

  await runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex", filterParts.join(";"),
    "-map", "[aout]",
    "-t", totalDuration.toFixed(3),
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
    AUDIO_MIX
  ]);
}

async function mux() {
  await runFfmpeg([
    "-y",
    "-i", SILENT_MP4,
    "-i", AUDIO_MIX,
    "-map", "0:v", "-map", "1:a",
    "-shortest",
    "-c:v", "copy",
    "-c:a", "copy",
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

  let voiceDurations = new Map();
  if (SKIP_VOICE) {
    log("Skipping voiceover stage (--skip-voice) — using authored durations only.");
  } else {
    log("Synthesizing voiceover...");
    voiceDurations = await synthesizeVoiceover(slides);
  }

  log("Building per-slide Ken Burns clips...");
  const clips = [];
  const durations = [];
  for (let i = 0; i < slides.length; i++) {
    const duration = effectiveDuration(slides[i], voiceDurations);
    const out = await buildClip(slides[i], i, duration);
    clips.push(out);
    durations.push(duration);
    log(`[${i + 1}/${slides.length}] clip built (${duration.toFixed(1)}s) ${path.basename(out)}`);
  }

  log("Crossfading clips into one silent video...");
  const { total: totalDuration, starts } = await crossfadeClips(clips, durations);

  if (SKIP_VOICE) {
    log("Mixing in the music bed (no voiceover)...");
  } else {
    log("Building the full audio mix (music + voiceover + UI cues)...");
  }
  await buildAudioMix(slides, starts, totalDuration);

  log("Muxing final video...");
  await mux();

  const stat = await fs.stat(OUTPUT_MP4);
  const mins = Math.floor(totalDuration / 60), secs = Math.round(totalDuration % 60);
  log(`Done. ${slides.length} slides, ~${mins}:${String(secs).padStart(2, "0")} runtime, ` +
    `${(stat.size / 1e6).toFixed(1)} MB -> ${OUTPUT_MP4}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
