#!/usr/bin/env node
// Renders voice samples of the presentation narration with Kokoro, so a voice can
// be chosen before any video pipeline is timed against one.
//
// Kokoro runs in Docker via remsky/Kokoro-FastAPI, which exposes an
// OpenAI-compatible HTTP API with the model weights baked into the image:
//
//   docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
//   docker run            -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
//
// Two passes, so nobody has to audition forty clips:
//   1. triage   — every English voice reads the short passage
//   2. shortlist — a spread of accents/genders reads the long one
//
// Usage: node scripts/kokoro-samples.mjs [--voices a,b,c] [--list] [--host URL]
"use strict";

import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, "build", "vo-samples");

const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const HOST = argOf("--host") || process.env.KOKORO_HOST || "http://localhost:8880";
const ONLY_LIST = argv.includes("--list");
const VOICE_FILTER = argOf("--voices");

// Both passages are copied verbatim from scripts/presentation-content.mjs, so the
// samples are the real script rather than lorem. They cover the two registers the
// deck needs, and every voice reads the same text so comparison is fair.
const PASSAGES = [
  {
    id: "scene",
    slide: "Slide 4 — Daniel",
    note: "Narrative and human. Listen to how it handles the em dashes and the pause after “In July.”",
    text:
      "Forty metres away, at the core desks, Daniel keeps a blanket under the desk. In July. " +
      "Same floor, same minute, one setpoint — twenty-two degrees — serving both of them. " +
      "Move that number in either direction and you simply choose which of these two people to upset."
  },
  {
    id: "explainer",
    slide: "Slide 8 — the split rule",
    note: "The longest and densest line in the deck. Listen for whether the clauses stay clear and the pace holds.",
    text:
      "Because when at least four people have voted, at least a quarter fall on each side, and most of " +
      "the room is uncomfortable, the board declares that spot split — and then refuses to summarise it. " +
      "The verdict won't pick a direction. The needle goes dashed, because the average of two camps is a lie. " +
      "And it tells Priya and Daniel what it actually means: this is not a temperature problem. This is one " +
      "spot pretending to be two, and turning the thermostat would just move the complaint to the other group. " +
      "This is the part we are proudest of."
  }
];

// The server reports 46 English voices, which is far too many to audition. These
// are the ones worth skipping: `v0*` are superseded copies of voices that also
// exist under their plain name, `*_inno` are experimental, and am_santa is a
// novelty. Pass --voices to sample anything excluded here anyway.
const SKIP = /_v0|^[ab][fm]_v0$|_inno$|santa/;

// Triage samples this many voices per accent/gender group, so the set spans the
// space instead of being ten variations of the same thing.
const TRIAGE_PER_GROUP = 3;

// Pass 2 reads the long passage with this many of them.
const SHORTLIST_SIZE = 6;

function log(msg) { console.log(`[kokoro] ${msg}`); }
function fail(msg) { console.error(`[kokoro] ERROR: ${msg}`); process.exit(1); }

async function waitForServer() {
  const deadline = Date.now() + 180000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${HOST}/v1/audio/voices`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return res.json();
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  fail(
    `No Kokoro server at ${HOST} after 3 minutes (last: ${lastErr}).\n` +
    "  Start one with:\n" +
    "    docker compose -f docker-compose.tts.yml up -d\n" +
    "  or:\n" +
    "    docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest"
  );
}

// The server is the authority on what voices exist — never hardcode ids.
function parseVoices(payload) {
  const list = Array.isArray(payload) ? payload
    : Array.isArray(payload?.voices) ? payload.voices
      : Array.isArray(payload?.data) ? payload.data
        : null;
  if (!list) fail(`Could not read a voice list from ${HOST}/v1/audio/voices: ${JSON.stringify(payload).slice(0, 300)}`);
  return list.map((v) => (typeof v === "string" ? v : v.id || v.name)).filter(Boolean);
}

// Kokoro ids are <lang><gender>_<name>: a=American, b=British; f=female, m=male.
function describe(id) {
  const m = /^([ab])([fm])_/.exec(id);
  if (!m) return { accent: "other", gender: "?", label: id };
  const accent = m[1] === "a" ? "American" : "British";
  const gender = m[2] === "f" ? "female" : "male";
  return { accent, gender, label: `${id}  (${accent} ${gender})` };
}

function isEnglish(id) { return /^[ab][fm]_/.test(id); }

function groupBy(voices) {
  const groups = new Map();
  for (const v of voices) {
    const { accent, gender } = describe(v);
    const key = `${accent} ${gender}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  return groups;
}

// Take the first `perGroup` of each accent/gender group.
function spread(voices, perGroup) {
  return [...groupBy(voices).values()].flatMap((list) => list.slice(0, perGroup));
}

// One voice per group, round-robin, so the shortlist is a spread rather than
// several variations of the same thing.
function shortlist(voices, size) {
  const groups = [...groupBy(voices).values()];
  const picked = [];
  for (let round = 0; picked.length < size; round++) {
    let added = false;
    for (const list of groups) {
      if (list[round]) { picked.push(list[round]); added = true; }
      if (picked.length >= size) break;
    }
    if (!added) break;
  }
  return picked;
}

async function synthesize(voice, text, outPath) {
  const res = await fetch(`${HOST}/v1/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "kokoro", voice, input: text, response_format: "mp3" }),
    signal: AbortSignal.timeout(180000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`suspiciously small response (${buf.length} bytes)`);
  await fs.writeFile(outPath, buf);
  return buf.length;
}

// Duration by decoding with ffmpeg. An earlier version parsed the MP3 frame
// headers by hand and read exactly half the true length — Kokoro returns 24 kHz
// MPEG-2 audio, which uses a different bitrate table from MPEG-1, so every
// frame length came out double and half the frames were stepped over. Not worth
// re-deriving when ffmpeg is already a dependency.
function duration(file) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-i", file, "-f", "null", "-"]);
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      const times = err.match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g) || [];
      const last = times[times.length - 1];
      if (!last) return resolve(0);
      const [, h, m, s] = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(last);
      resolve(Number(h) * 3600 + Number(m) * 60 + Number(s));
    });
  });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function indexPage(results) {
  const sections = PASSAGES.map((p) => {
    const rows = results.filter((r) => r.passage === p.id);
    if (!rows.length) return "";
    return `<section>
  <h2>${esc(p.slide)}</h2>
  <p class="note">${esc(p.note)}</p>
  <blockquote>${esc(p.text)}</blockquote>
  <table>
    <tr><th>Voice</th><th></th><th>Listen</th><th>Length</th><th>Pace</th></tr>
    ${rows.map((r) => `<tr>
      <td class="v">${esc(r.voice)}</td>
      <td class="d">${esc(r.accent)} ${esc(r.gender)}</td>
      <td><audio controls preload="none" src="${esc(r.file)}"></audio></td>
      <td class="n">${r.seconds.toFixed(1)}s</td>
      <td class="n ${r.wpm < 135 || r.wpm > 175 ? "warn" : ""}">${Math.round(r.wpm)} wpm</td>
    </tr>`).join("\n    ")}
  </table>
</section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<meta charset="utf-8">
<title>Kokoro voice samples — Thermocracy</title>
<style>
  :root{--ink:#14242C;--muted:#5F737D;--line:#CDD9DF;--paper:#E7EDF0;--surface:#fff}
  body{margin:0;padding:32px;background:var(--paper);color:var(--ink);
    font:16px/1.5 Calibri,system-ui,sans-serif;max-width:1000px}
  h1{font-size:28px;margin:0 0 4px}
  .lede{color:var(--muted);margin:0 0 28px}
  section{background:var(--surface);border:1px solid var(--line);border-radius:12px;
    padding:20px 22px;margin-bottom:22px}
  h2{font-size:19px;margin:0 0 4px}
  .note{color:var(--muted);font-size:14px;margin:0 0 12px}
  blockquote{margin:0 0 18px;padding:12px 16px;background:var(--paper);
    border-radius:8px;font-size:14.5px;color:var(--ink)}
  table{border-collapse:collapse;width:100%}
  th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;
    color:var(--muted);font-weight:600;padding:0 10px 8px 0}
  td{padding:7px 10px 7px 0;border-top:1px solid var(--line);vertical-align:middle}
  .v{font-weight:600;white-space:nowrap}
  .d{color:var(--muted);font-size:13px;white-space:nowrap}
  .n{text-align:right;color:var(--muted);font-size:13px;white-space:nowrap}
  .warn{color:#C64C2C;font-weight:600}
  audio{height:32px;width:100%;min-width:260px;display:block}
</style>
<h1>Kokoro voice samples</h1>
<p class="lede">Both passages are the deck's real narration, word for word. Every voice reads
the same text. Pace is flagged when it falls outside 135&ndash;175&nbsp;wpm &mdash; the slide timings
assume an unhurried read.</p>
${sections}
`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  log(`asking ${HOST} for its voice list…`);
  const voices = parseVoices(await waitForServer());
  const english = voices.filter(isEnglish);
  const candidates = english.filter((v) => !SKIP.test(v));

  console.log(`\nvoices reported: ${voices.length} (${english.length} English)`);
  for (const v of english) console.log("  " + describe(v).label + (SKIP.test(v) ? "   [skipped]" : ""));
  const other = voices.filter((v) => !isEnglish(v));
  if (other.length) console.log(`  (+${other.length} non-English, skipped)`);
  console.log("");

  if (ONLY_LIST) return;
  if (!candidates.length) fail("The server reported no English voices to sample.");

  const triage = VOICE_FILTER
    ? VOICE_FILTER.split(",").map((s) => s.trim())
    : spread(candidates, TRIAGE_PER_GROUP);
  const deep = VOICE_FILTER ? triage : shortlist(triage, SHORTLIST_SIZE);
  log(`sampling ${triage.length} voices (of ${candidates.length} candidates); ${deep.length} also read the long passage`);

  const jobs = [
    ...triage.map((v) => ({ voice: v, passage: "scene" })),
    ...deep.map((v) => ({ voice: v, passage: "explainer" }))
  ];

  const results = [];
  for (let i = 0; i < jobs.length; i++) {
    const { voice, passage } = jobs[i];
    const p = PASSAGES.find((x) => x.id === passage);
    const file = `${passage}-${voice}.mp3`;
    const outPath = path.join(OUT_DIR, file);
    try {
      await synthesize(voice, p.text, outPath);
      const seconds = await duration(outPath);
      const words = p.text.split(/\s+/).length;
      const { accent, gender } = describe(voice);
      results.push({ voice, passage, file, seconds, wpm: seconds ? words / (seconds / 60) : 0, accent, gender });
      log(`[${i + 1}/${jobs.length}] ${passage} · ${voice} — ${seconds.toFixed(1)}s`);
    } catch (e) {
      console.error(`[kokoro] [${i + 1}/${jobs.length}] ${passage} · ${voice} FAILED: ${e.message}`);
    }
  }

  if (!results.length) fail("Every synthesis request failed — nothing to listen to.");

  await fs.writeFile(path.join(OUT_DIR, "index.html"), indexPage(results), "utf8");

  console.log("\n  passage    voice                 accent            length    pace");
  console.log("  " + "─".repeat(66));
  for (const r of results) {
    console.log(
      "  " + r.passage.padEnd(11) + r.voice.padEnd(22) +
      `${r.accent} ${r.gender}`.padEnd(18) +
      (r.seconds.toFixed(1) + "s").padStart(7) +
      (Math.round(r.wpm) + " wpm").padStart(9) +
      (r.wpm < 135 || r.wpm > 175 ? "  ← off-pace" : "")
    );
  }
  console.log(`\nwrote ${results.length} clips + index.html to ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((e) => fail(e.stack || e.message));
