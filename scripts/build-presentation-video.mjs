#!/usr/bin/env node
// Builds build/thermocracy-presentation.mp4 — the 15-slide deck, narrated.
//
//   1. Screenshot every slide from build/presentation-preview.html (Playwright).
//   2. Synthesize each slide's narration with Kokoro (af_heart) over HTTP.
//   3. Hold each slide for its narration, crossfading between them.
//   4. Place the narration on a timeline and mux it on.
//   5. Write a sentence-level .srt alongside.
//
// The slides are dense — dot plots, heat maps, a seven-item checklist — so there
// is deliberately no Ken Burns motion here: every frame would be resampled and
// the small type would swim. That is the one substantive difference from
// scripts/build-video-pipeline.mjs, whose ffmpeg recipes this otherwise follows.
//
// Needs the Kokoro container up:
//   docker compose -f docker-compose.tts.yml --profile cpu up -d kokoro-cpu
//
// Usage: npm run build-presentation-video [-- --speed 0.9] [-- --skip-render]
"use strict";

import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";

import { SLIDES } from "./presentation-content.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PREVIEW_HTML = path.join(ROOT, "build", "presentation-preview.html");
const BUILD_DIR = path.join(ROOT, "build");
const FRAMES_DIR = path.join(BUILD_DIR, "presentation-frames");
const VO_DIR = path.join(BUILD_DIR, "vo");
const CLIPS_DIR = path.join(BUILD_DIR, "presentation-clips");
const SILENT_MP4 = path.join(BUILD_DIR, "presentation-silent.mp4");
const AUDIO_MIX = path.join(BUILD_DIR, "presentation-audio.m4a");
const OUTPUT_MP4 = path.join(BUILD_DIR, "thermocracy-presentation.mp4");
const OUTPUT_SRT = path.join(BUILD_DIR, "thermocracy-presentation.srt");

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SKIP_RENDER = argv.includes("--skip-render");
const SKIP_VOICE = argv.includes("--skip-voice");
const HOST = argOf("--host", process.env.KOKORO_HOST || "http://localhost:8880");
const VOICE = argOf("--voice", "af_heart");
const SPEED = Number(argOf("--speed", "0.9"));

const WIDTH = 1920, HEIGHT = 1080, FPS = 30;
const RENDER_SCALE = 2;          // supersample the screenshots, then downscale
const XFADE = 0.5;               // seconds of dissolve between slides
const END_FADE = 0.8;            // fade from/to black at the very start and end
const LEAD_IN = 0.5;             // silence before a slide's narration starts
const TAIL = 0.9;                // silence after it ends, before the next slide
const MIN_HOLD = 3.0;            // so the two short title cards don't flash past
const SENTENCE_GAP = 0.18;       // breath between sentences within a slide
const LINE_WIDTH = 42;           // characters per subtitle line
const NARRATION_GAIN = 1.0;

function log(msg) { console.log(`[video] ${msg}`); }
function fail(msg) { console.error(`[video] ERROR: ${msg}`); process.exit(1); }

async function ensureDirs() {
  for (const d of [FRAMES_DIR, VO_DIR, CLIPS_DIR]) await fs.mkdir(d, { recursive: true });
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${path.basename(bin)} exited ${code}:\n${stderr.slice(-1500)}`));
    });
  });
}

const ffmpeg = (args) => run(ffmpegPath, args);

// Duration by decoding. ffmpeg-static ships no ffprobe, and parsing container
// headers by hand has already bitten this project once.
async function duration(file) {
  const err = await ffmpeg(["-hide_banner", "-i", file, "-f", "null", "-"]);
  const times = err.match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g) || [];
  if (!times.length) return 0;
  const [, h, m, s] = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(times[times.length - 1]);
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/* ---------------- 1. render ---------------- */

async function renderFrames() {
  if (!existsSync(PREVIEW_HTML)) {
    fail(`Missing ${path.relative(ROOT, PREVIEW_HTML)}\n` +
      "  Generate it first: npm run build-presentation -- --preview");
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: RENDER_SCALE
  });
  await page.goto("file://" + PREVIEW_HTML.replace(/\\/g, "/"));

  // Undo the preview page's on-screen chrome. The generator lays slides out at
  // 13.333in x 96 = 1279.968px, which is a hair off 16:9, so pin it to 1280.
  await page.addStyleTag({
    content: `
      body{padding:0;margin:0;background:#000}
      .slide{zoom:1 !important;width:1280px !important;height:720px !important;
        margin:0 !important;box-shadow:none !important}
      .tagline{display:none !important}
    `
  });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));

  const count = await page.evaluate(() => document.querySelectorAll(".slide").length);
  if (count !== SLIDES.length) {
    await browser.close();
    fail(`Preview has ${count} slides but the content module has ${SLIDES.length}. ` +
      "Re-run: npm run build-presentation -- --preview");
  }

  for (let i = 0; i < SLIDES.length; i++) {
    const el = page.locator(".slide").nth(i);
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({ path: framePath(i) });
    log(`[${i + 1}/${SLIDES.length}] rendered ${SLIDES[i].id}.png`);
  }
  await browser.close();
}

const framePath = (i) => path.join(FRAMES_DIR, `${String(i + 1).padStart(2, "0")}-${SLIDES[i].id}.png`);

/* ---------------- 2. narration ---------------- */

function sentencesOf(text) {
  return (text.match(/[^.!?]+[.!?]*\s*/g) || [text]).map((s) => s.trim()).filter(Boolean);
}

// Cache key covers everything that changes the audio, so editing one sentence
// re-synthesizes that sentence and nothing else.
function voPath(slideId, index, text) {
  const key = createHash("sha1").update(`${VOICE}|${SPEED}|${text}`).digest("hex").slice(0, 10);
  return path.join(VO_DIR, `${slideId}-${String(index).padStart(2, "0")}-${key}.wav`);
}

async function containerAlive() {
  try {
    const res = await fetch(`${HOST}/v1/audio/voices`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch { return false; }
}

// One request per sentence rather than per slide. The CPU image has a native
// heap bug that segfaults the whole container on longer inputs ("double free or
// corruption"), and short requests both avoid it and make a retry cheap when it
// does happen. It also yields exact sentence timings, which the .srt uses
// instead of estimating them.
async function speak(text, out) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${HOST}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "kokoro", voice: VOICE, input: text,
          response_format: "wav", speed: SPEED
        }),
        signal: AbortSignal.timeout(120000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2000) throw new Error(`${buf.length} bytes — too small to be speech`);
      await fs.writeFile(out, buf);
      return;
    } catch (e) {
      const alive = await containerAlive();
      if (attempt === 3 || !alive) {
        fail(
          `Kokoro failed on "${text.slice(0, 60)}…" after ${attempt} attempt(s): ${e.message}\n` +
          (alive
            ? "  The server is still up, so this input is the problem."
            : "  The container is no longer answering — it most likely crashed.\n" +
              "  Restart it and re-run; cached sentences are kept, so it resumes:\n" +
              "    docker compose -f docker-compose.tts.yml --profile cpu up -d kokoro-cpu")
        );
      }
      log(`retrying (${attempt}/3) after: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function synthesize() {
  if (!SKIP_VOICE && !(await containerAlive())) {
    fail(
      `No Kokoro server at ${HOST}\n` +
      "  docker compose -f docker-compose.tts.yml --profile cpu up -d kokoro-cpu"
    );
  }

  const clips = [];
  let made = 0, reused = 0;

  for (let i = 0; i < SLIDES.length; i++) {
    const slide = SLIDES[i];
    const sentences = [];
    let offset = 0;

    const texts = sentencesOf(slide.narration);
    for (let j = 0; j < texts.length; j++) {
      const text = texts[j];
      const out = voPath(slide.id, j, text);
      if (existsSync(out)) reused++;
      else if (SKIP_VOICE) fail(`--skip-voice, but ${path.relative(ROOT, out)} is not cached`);
      else { await speak(text, out); made++; }

      const secs = await duration(out);
      if (!secs) fail(`Could not read a duration from ${path.relative(ROOT, out)}`);
      sentences.push({ text, file: out, secs, offset });
      offset += secs + SENTENCE_GAP;
    }

    const secs = offset - SENTENCE_GAP;
    const words = slide.narration.split(/\s+/).filter(Boolean).length;
    clips.push({ slide, sentences, secs, words, wpm: words / (secs / 60) });
    log(`[${i + 1}/${SLIDES.length}] ${slide.id} — ${texts.length} sentences, ${secs.toFixed(1)}s, ${Math.round(words / (secs / 60))} wpm`);
  }

  log(`narration: ${made} synthesized, ${reused} reused from cache`);
  return clips;
}

/* ---------------- 3. clips ---------------- */

// Each slide is held for its narration plus a beat either side. No motion: the
// still frame is simply stretched to the hold.
async function buildClip(clip, i) {
  const out = path.join(CLIPS_DIR, `${String(i + 1).padStart(2, "0")}-${clip.slide.id}.mp4`);
  await ffmpeg([
    "-y",
    "-loop", "1", "-i", framePath(i),
    "-t", clip.hold.toFixed(3),
    "-vf", `scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-an", out
  ]);
  return out;
}

async function crossfade(clipPaths, holds) {
  const inputs = clipPaths.flatMap((p) => ["-i", p]);
  const starts = [0];
  let filter = "";
  let prev = "0:v";
  let cursor = holds[0];

  for (let i = 1; i < clipPaths.length; i++) {
    const label = i === clipPaths.length - 1 ? "vfade" : `x${i}`;
    const offset = Math.max(0, cursor - XFADE);
    starts.push(offset);
    filter += `[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}[${label}];`;
    prev = label;
    cursor = offset + holds[i];
  }
  const total = cursor;
  filter += `[${prev}]fade=t=in:st=0:d=${END_FADE},fade=t=out:st=${(total - END_FADE).toFixed(3)}:d=${END_FADE}[vout]`;

  await ffmpeg([
    "-y", ...inputs,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    SILENT_MP4
  ]);
  return { total, starts };
}

/* ---------------- 4. audio ---------------- */

// Every sentence is placed individually on the timeline at its own absolute
// offset, so no intermediate concatenation step is needed and the .srt can use
// exactly the same numbers.
async function buildAudio(clips, starts, total) {
  const inputs = [];
  const parts = [];
  const labels = [];
  let n = 0;

  clips.forEach((clip, i) => {
    for (const s of clip.sentences) {
      inputs.push("-i", s.file);
      const ms = Math.round((starts[i] + LEAD_IN + s.offset) * 1000);
      parts.push(`[${n}:a]adelay=${ms}|${ms},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[n${n}]`);
      labels.push(`n${n}`);
      n++;
    }
  });

  // normalize=0: amix's default divides every input by the input count, which
  // across this many narration clips would leave the voice inaudible.
  // Kokoro's output sits around -28 dB mean, which is far too quiet to ship.
  // loudnorm brings the whole mix to the -16 LUFS / -1.5 dBTP that web and
  // podcast players expect, instead of leaving most of the headroom unused.
  parts.push(
    `${labels.map((l) => `[${l}]`).join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0[mixed]`,
    `[mixed]volume=${NARRATION_GAIN},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
  );

  await ffmpeg([
    "-y", ...inputs,
    "-filter_complex", parts.join(";"),
    "-map", "[aout]",
    "-t", total.toFixed(3),
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
    AUDIO_MIX
  ]);
}

async function mux() {
  await ffmpeg([
    "-y",
    "-i", SILENT_MP4, "-i", AUDIO_MIX,
    "-map", "0:v", "-map", "1:a",
    "-shortest",
    "-c:v", "copy", "-c:a", "copy",
    "-movflags", "+faststart",
    OUTPUT_MP4
  ]);
}

/* ---------------- 5. captions ---------------- */

function srtTime(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

// One cue per sentence, timed from that sentence's own measured audio rather
// than estimated from character counts — a side benefit of synthesizing each
// sentence separately.
function buildSrt(clips, starts) {
  const cues = [];
  clips.forEach((clip, i) => {
    for (const s of clip.sentences) {
      const start = starts[i] + LEAD_IN + s.offset;
      // A sentence too long for two readable lines becomes several cues,
      // sharing its measured span in proportion to their length.
      const chunks = splitForCues(s.text);
      const chars = chunks.reduce((a, c) => a + c.length, 0);
      let t = start;
      for (const chunk of chunks) {
        const span = s.secs * (chunk.length / chars);
        cues.push({ start: t, end: t + span, text: chunk });
        t += span;
      }
    }
  });
  return cues.map((c, i) =>
    `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${wrap(c.text)}\n`
  ).join("\n");
}

// Two lines of ~42 characters is the usual subtitle budget; break on clause
// boundaries where there is one, otherwise on a word.
// Budget is under two full lines so wrap() has slack to find a balanced break.
function splitForCues(text, max = LINE_WIDTH * 2 - 8) {
  if (text.length <= max) return [text];
  const words = text.split(/\s+/);
  const chunks = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) { chunks.push(cur); cur = w; }
    else cur = next;
    // Prefer to break just after a comma, colon or dash near the limit.
    if (cur.length >= max * 0.6 && /[,:;—]$/.test(cur)) { chunks.push(cur); cur = ""; }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Two lines max, balanced, the way subtitles are normally set. splitForCues has
// already guaranteed the text fits.
function wrap(text, width = LINE_WIDTH) {
  if (text.length <= width) return text;
  const words = text.split(/\s+/);
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (a.length > width || b.length > width) continue;
    const score = Math.abs(a.length - b.length);
    if (!best || score < best.score) best = { score, text: `${a}\n${b}` };
  }
  if (best) return best.text;
  // No split leaves both halves inside the width — fill the first line greedily
  // rather than emitting one very long line.
  const lines = [""];
  for (const w of words) {
    const line = lines.length - 1;
    if (lines[line] && lines[line].length + w.length + 1 > width && lines.length < 2) lines.push(w);
    else lines[line] += (lines[line] ? " " : "") + w;
  }
  return lines.join("\n");
}

/* ---------------- main ---------------- */

async function main() {
  await ensureDirs();
  log(`voice ${VOICE} at speed ${SPEED}`);

  if (SKIP_RENDER) log("skipping render, reusing existing frames");
  else await renderFrames();

  const clips = await synthesize();

  for (const c of clips) {
    c.hold = Math.max(MIN_HOLD, c.secs + LEAD_IN + TAIL);
  }
  const holds = clips.map((c) => c.hold);

  const clipPaths = [];
  for (let i = 0; i < clips.length; i++) {
    clipPaths.push(await buildClip(clips[i], i));
    log(`[${i + 1}/${clips.length}] clip ${clips[i].slide.id} (${clips[i].hold.toFixed(1)}s)`);
  }

  log("crossfading…");
  const { total, starts } = await crossfade(clipPaths, holds);
  log("mixing narration…");
  await buildAudio(clips, starts, total);
  log("muxing…");
  await mux();
  await fs.writeFile(OUTPUT_SRT, buildSrt(clips, starts), "utf8");

  const words = clips.reduce((a, c) => a + c.words, 0);
  const speech = clips.reduce((a, c) => a + c.secs, 0);
  console.log("\n   #  slide          hold     speech    wpm");
  console.log("  " + "─".repeat(48));
  clips.forEach((c, i) => {
    console.log(
      "  " + String(i + 1).padStart(2) + "  " + c.slide.id.padEnd(14) +
      (c.hold.toFixed(1) + "s").padStart(6) + (c.secs.toFixed(1) + "s").padStart(10) +
      String(Math.round(c.wpm)).padStart(7)
    );
  });
  const mm = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  console.log(`\n  ${words} words · ${mm(speech)} of speech · ${Math.round(words / (speech / 60))} wpm overall`);
  console.log(`  finished runtime ${mm(total)}`);
  console.log(`\nwrote ${path.relative(ROOT, OUTPUT_MP4)}`);
  console.log(`wrote ${path.relative(ROOT, OUTPUT_SRT)}`);
}

main().catch((e) => fail(e.stack || e.message));
