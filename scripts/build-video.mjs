#!/usr/bin/env node
// Builds build/thermocracy.mp4 from src/slides.html — the deck, narrated.
//
//   1. Screenshot every slide with headless Chromium (Playwright).
//   2. Narrate each slide with Kokoro, one sentence at a time.
//   3. Hold each slide for its narration, crossfading into the next.
//   4. Place the narration on a timeline, normalise it, and mux it on.
//   5. Write a sentence-level .srt alongside.
//
// There is deliberately no pan or zoom: these slides carry small type — dot
// plots, a heat map, a seven-item checklist — and resampling every frame to
// fake motion makes it swim.
//
// Kokoro runs locally in Docker and must be up first:
//   docker compose -f docker-compose.tts.yml up -d
//
// Usage: npm run build-video [-- --speed 0.9] [-- --voice af_heart]
//                            [-- --skip-render] [-- --skip-voice]
"use strict";

import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SLIDES_HTML = path.join(ROOT, "src", "slides.html");
const BUILD_DIR = path.join(ROOT, "build");
const FRAMES_DIR = path.join(BUILD_DIR, "frames");
const VO_DIR = path.join(BUILD_DIR, "vo");
const CLIPS_DIR = path.join(BUILD_DIR, "clips");
const SILENT_MP4 = path.join(BUILD_DIR, "silent.mp4");
const AUDIO_MIX = path.join(BUILD_DIR, "audio.m4a");
const OUTPUT_MP4 = path.join(BUILD_DIR, "thermocracy.mp4");
const OUTPUT_SRT = path.join(BUILD_DIR, "thermocracy.srt");

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
const XFADE = 0.5;               // seconds of dissolve between slides
const END_FADE = 0.8;            // fade from/to black at the start and end
const LEAD_IN = 0.5;             // silence before a slide's narration starts
const TAIL = 0.9;                // silence after it ends
const SENTENCE_GAP = 0.18;       // breath between sentences within a slide
const LINE_WIDTH = 42;           // characters per subtitle line

function log(msg) { console.log(`[video] ${msg}`); }
function fail(msg) { console.error(`[video] ERROR: ${msg}`); process.exit(1); }

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

// Duration by decoding — ffmpeg-static ships no ffprobe, and parsing container
// headers by hand has bitten this project once already.
async function duration(file) {
  const err = await ffmpeg(["-hide_banner", "-i", file, "-f", "null", "-"]);
  const times = err.match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g) || [];
  if (!times.length) return 0;
  const [, h, m, s] = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(times[times.length - 1]);
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/* ---------------- 1. slides ---------------- */

const framePath = (i, id) => path.join(FRAMES_DIR, `${String(i + 1).padStart(2, "0")}-${id}.png`);

async function readDeck() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto("file://" + SLIDES_HTML.replace(/\\/g, "/"));

  const slides = await page.evaluate(() => window.SLIDES?.map((s) => ({
    id: s.id, section: s.section, voiceover: s.voiceover, duration: s.duration
  })));
  if (!Array.isArray(slides) || !slides.length) {
    await browser.close();
    fail("Could not read window.SLIDES from src/slides.html");
  }
  for (const s of slides) {
    if (!s.voiceover) fail(`Slide "${s.id}" has no voiceover line`);
    if (!(s.duration > 0)) fail(`Slide "${s.id}" has no positive duration floor`);
  }

  if (SKIP_RENDER) {
    await browser.close();
    log(`skipping render, reusing frames in ${path.relative(ROOT, FRAMES_DIR)}`);
    return slides;
  }

  await fs.mkdir(FRAMES_DIR, { recursive: true });
  // Presenting mode drops the deck chrome and makes the stage fill the viewport
  // exactly, so a full-page shot at 1920x1080 is the slide and nothing else.
  await page.evaluate(() => document.body.classList.add("presenting"));
  for (let i = 0; i < slides.length; i++) {
    await page.evaluate((n) => window.__renderSlide(n), i);
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 15000 });
    await page.screenshot({ path: framePath(i, slides[i].id) });
    log(`[${i + 1}/${slides.length}] rendered ${slides[i].id}.png`);
  }
  await browser.close();
  return slides;
}

/* ---------------- 2. narration ---------------- */

function sentencesOf(text) {
  return (text.match(/[^.!?]+[.!?]*\s*/g) || [text]).map((s) => s.trim()).filter(Boolean);
}

function voPath(slideId, index, text) {
  const key = createHash("sha1").update(`${VOICE}|${SPEED}|${text}`).digest("hex").slice(0, 10);
  return path.join(VO_DIR, `${slideId}-${String(index).padStart(2, "0")}-${key}.wav`);
}

async function kokoroAlive() {
  try {
    const res = await fetch(`${HOST}/v1/audio/voices`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch { return false; }
}

const START_KOKORO = "  docker compose -f docker-compose.tts.yml up -d";

// One request per sentence rather than per slide. The container has a native
// heap bug that segfaults it on longer inputs, and short requests both avoid it
// and make a retry cheap. It also yields exact sentence timings for the .srt.
async function speak(text, out) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${HOST}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "kokoro", voice: VOICE, input: text, response_format: "wav", speed: SPEED
        }),
        signal: AbortSignal.timeout(120000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2000) throw new Error(`${buf.length} bytes — too small to be speech`);
      await fs.writeFile(out, buf);
      return;
    } catch (e) {
      const alive = await kokoroAlive();
      if (attempt === 3 || !alive) {
        fail(
          `Kokoro failed on "${text.slice(0, 60)}…" after ${attempt} attempt(s): ${e.message}\n` +
          (alive ? "  The server is still up, so this input is the problem."
                 : "  The container stopped answering — it most likely crashed.\n" +
                   "  Restart and re-run; cached sentences are kept, so it resumes:\n" + START_KOKORO)
        );
      }
      log(`retrying (${attempt}/3) after: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function narrate(slides) {
  if (!SKIP_VOICE && !(await kokoroAlive())) {
    fail(`No Kokoro server at ${HOST}\n${START_KOKORO}`);
  }
  await fs.mkdir(VO_DIR, { recursive: true });

  const clips = [];
  let made = 0, reused = 0;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const sentences = [];
    let offset = 0;

    for (const [j, text] of sentencesOf(slide.voiceover).entries()) {
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
    const words = slide.voiceover.split(/\s+/).filter(Boolean).length;
    clips.push({
      slide, sentences, secs, words,
      wpm: words / (secs / 60),
      hold: Math.max(slide.duration, secs + LEAD_IN + TAIL)
    });
    log(`[${i + 1}/${slides.length}] ${slide.id} — ${sentences.length} sentences, ${secs.toFixed(1)}s, ${Math.round(words / (secs / 60))} wpm`);
  }

  log(`narration: ${made} synthesized, ${reused} reused from cache`);
  return clips;
}

/* ---------------- 3. assemble ---------------- */

async function buildClip(clip, i) {
  const out = path.join(CLIPS_DIR, `${String(i + 1).padStart(2, "0")}-${clip.slide.id}.mp4`);
  const png = framePath(i, clip.slide.id);
  if (!existsSync(png)) fail(`Missing frame ${path.relative(ROOT, png)} — run without --skip-render`);
  await ffmpeg([
    "-y", "-loop", "1", "-i", png,
    "-t", clip.hold.toFixed(3),
    "-vf", `scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-an", out
  ]);
  return out;
}

async function crossfade(clipPaths, holds) {
  const inputs = clipPaths.flatMap((p) => ["-i", p]);
  const starts = [0];
  let filter = "", prev = "0:v", cursor = holds[0];

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
    "-filter_complex", filter, "-map", "[vout]",
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    SILENT_MP4
  ]);
  return { total, starts };
}

// Every sentence is placed individually at its own absolute offset, so no
// intermediate concatenation is needed and the .srt uses the same numbers.
async function buildAudio(clips, starts, total) {
  const inputs = [], parts = [], labels = [];
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
  // across this many clips would leave the voice inaudible. loudnorm then lifts
  // Kokoro's quiet output (about -28 dB mean) to the level players expect.
  parts.push(
    `${labels.map((l) => `[${l}]`).join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0[mixed]`,
    `[mixed]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
  );

  await ffmpeg([
    "-y", ...inputs,
    "-filter_complex", parts.join(";"), "-map", "[aout]",
    "-t", total.toFixed(3),
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
    AUDIO_MIX
  ]);
}

async function mux() {
  await ffmpeg([
    "-y", "-i", SILENT_MP4, "-i", AUDIO_MIX,
    "-map", "0:v", "-map", "1:a", "-shortest",
    "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart",
    OUTPUT_MP4
  ]);
}

/* ---------------- 4. captions ---------------- */

function srtTime(t) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:` +
    `${p(Math.floor(t % 60))},${p(Math.round((t - Math.floor(t)) * 1000), 3)}`;
}

// Budget is under two full lines so wrap() has slack to find a balanced break.
function splitForCues(text, max = LINE_WIDTH * 2 - 8) {
  if (text.length <= max) return [text];
  const chunks = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) { chunks.push(cur); cur = w; } else cur = next;
    if (cur.length >= max * 0.6 && /[,:;—]$/.test(cur)) { chunks.push(cur); cur = ""; }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function wrap(text, width = LINE_WIDTH) {
  if (text.length <= width) return text;
  const words = text.split(/\s+/);
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    if (a.length > width || b.length > width) continue;
    const score = Math.abs(a.length - b.length);
    if (!best || score < best.score) best = { score, text: `${a}\n${b}` };
  }
  if (best) return best.text;
  const lines = [""];
  for (const w of words) {
    const i = lines.length - 1;
    if (lines[i] && lines[i].length + w.length + 1 > width && lines.length < 2) lines.push(w);
    else lines[i] += (lines[i] ? " " : "") + w;
  }
  return lines.join("\n");
}

function buildSrt(clips, starts) {
  const cues = [];
  clips.forEach((clip, i) => {
    for (const s of clip.sentences) {
      const start = starts[i] + LEAD_IN + s.offset;
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
    `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${wrap(c.text)}\n`).join("\n");
}

/* ---------------- main ---------------- */

async function main() {
  await fs.mkdir(CLIPS_DIR, { recursive: true });
  log(`voice ${VOICE} at speed ${SPEED}`);

  const slides = await readDeck();
  const clips = await narrate(slides);
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
  const mm = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  console.log("\n   #  slide          hold     speech    wpm");
  console.log("  " + "─".repeat(48));
  clips.forEach((c, i) => {
    console.log("  " + String(i + 1).padStart(2) + "  " + c.slide.id.padEnd(14) +
      (c.hold.toFixed(1) + "s").padStart(6) + (c.secs.toFixed(1) + "s").padStart(10) +
      String(Math.round(c.wpm)).padStart(7));
  });
  console.log(`\n  ${words} words · ${mm(speech)} of speech · ${Math.round(words / (speech / 60))} wpm overall`);
  console.log(`  finished runtime ${mm(total)}`);
  console.log(`\nwrote ${path.relative(ROOT, OUTPUT_MP4)}`);
  console.log(`wrote ${path.relative(ROOT, OUTPUT_SRT)}`);
}

main().catch((e) => fail(e.stack || e.message));
