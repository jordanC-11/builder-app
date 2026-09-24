#!/usr/bin/env node
// Builds the Thermocracy storyboard presentation from scripts/presentation-content.mjs:
//   1. Lay every slide out as a flat list of drawing ops (rect / ellipse / line / text).
//   2. Emit those ops twice — once as a .pptx via pptxgenjs, once as an HTML page.
//   3. Write docs/presentation/STORYBOARD.md from the same content.
//
// The HTML page is the visual QA: it draws the identical ops at the identical
// coordinates, so it shows collisions and overflow that arithmetic alone misses.
// Neither PowerPoint nor LibreOffice is installed on the dev machine here, so the
// deck itself cannot be rendered locally — the preview is how it gets looked at.
//
// Usage: npm run build-presentation [-- --preview]
"use strict";

import PptxGenJS from "pptxgenjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

import { SLIDES, DECK, CAST } from "./presentation-content.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, "docs", "presentation");
const PPTX_PATH = path.join(OUT_DIR, "thermocracy.pptx");
const STORYBOARD_PATH = path.join(OUT_DIR, "STORYBOARD.md");
const PREVIEW_PATH = path.join(ROOT, "build", "presentation-preview.html");

const WANT_PREVIEW = process.argv.includes("--preview");

// ---- canvas -----------------------------------------------------------
const W = 13.333, H = 7.5;        // LAYOUT_WIDE, inches
const M = 0.62;                   // side margin
const CW = W - M * 2;             // content width
const BOTTOM = 6.85;              // nothing below this except the slide number

// ---- palette ----------------------------------------------------------
// Lifted from src/app.html:11-51 so the deck and the app are the same object.
const THEMES = {
  light: {
    paper: "E7EDF0", surface: "FFFFFF", surface2: "F3F7F9",
    ink: "14242C", muted: "5F737D", line: "CDD9DF", lineSoft: "E1E9ED",
    ramp: ["2A6DB5", "5FA3C4", "3B9B78", "DE9036", "C64C2C"],
    onAccent: "FFFFFF", shadow: true
  },
  dark: {
    paper: "101A1F", surface: "17242B", surface2: "1D2D35",
    ink: "E6EEF1", muted: "93A6AF", line: "2C3F49", lineSoft: "223139",
    ramp: ["5D9EE0", "78BBD8", "56BC93", "E8A757", "E07152"],
    onAccent: "101A1F", shadow: false
  }
};

// The heat map's own interpolation stops (src/app.html:702).
const HEAT = [[42, 109, 181], [95, 163, 196], [59, 155, 120], [222, 144, 54], [198, 76, 44]];
const SCALE_LABELS = ["Freezing", "Chilly", "Just nice", "Warm", "Roasting"];
const SCALE_FACES = ["\u{1F976}", "\u{1F9E5}", "\u{1F60C}", "\u{1FAE0}", "\u{1F975}"];

// Calibri ships with every Office install and renders at the same widths
// everywhere, so the overflow guard below can be trusted.
const FONT = "Calibri";
const EMOJI = "Segoe UI Emoji";

// ---- op constructors --------------------------------------------------
const ops = [];
let guardErrors = [];

function hex(c) { return String(c).replace("#", "").toUpperCase(); }

function push(op) {
  check(op);
  ops.push(op);
  return op;
}

// pptxgenjs writes off-canvas coordinates rather than clamping them, so a shape
// placed past the edge simply vanishes from the deck with no error. Catch it here.
function check(op) {
  const { x, y, w, h } = op;
  for (const [k, v] of Object.entries({ x, y, w, h })) {
    if (typeof v !== "number" || !isFinite(v)) {
      guardErrors.push(`${op.k} "${op.tag || ""}": ${k} is ${v}`);
      return;
    }
  }
  // A line may run up or left, so its extent is a range rather than a size.
  if (op.k !== "line" && (w < 0 || h < 0)) {
    guardErrors.push(`${op.k} "${op.tag || ""}": negative size ${w}x${h}`);
  }
  const x0 = Math.min(x, x + w), x1 = Math.max(x, x + w);
  const y0 = Math.min(y, y + h), y1 = Math.max(y, y + h);
  if (x0 < 0.25 || y0 < 0.2 || x1 > W - 0.25 || y1 > H - 0.15) {
    guardErrors.push(
      `${op.k} "${op.tag || ""}" out of bounds: ${x0.toFixed(2)},${y0.toFixed(2)} ` +
      `to ${x1.toFixed(2)},${y1.toFixed(2)}`
    );
  }
  if (op.k === "text") checkTextFit(op);
}

// Coarse net for text that cannot possibly fit its box. Calibri averages a hair
// under half its point size per character; 1.22 line height matches PowerPoint's
// single spacing. Tolerance is generous — the HTML preview is the real check.
function checkTextFit(op) {
  const runs = op.runs || [{ text: op.text || "", size: op.size }];
  const size = op.size || 14;
  let lines = 1, lineChars = 0;
  const perLine = Math.max(4, Math.floor((op.w - (op.margin === 0 ? 0 : 0.14)) * 72 / (size * 0.47)));
  for (const r of runs) {
    for (const chunk of String(r.text).split("\n")) {
      lineChars += chunk.length;
      while (lineChars > perLine) { lines++; lineChars -= perLine; }
    }
    if (r.breakLine) { lines++; lineChars = 0; }
  }
  const needed = lines * size * 1.22 / 72;
  if (needed > op.h * 1.15) {
    guardErrors.push(
      `text "${(op.tag || String(runs[0].text)).slice(0, 44)}" overflows: needs ` +
      `~${needed.toFixed(2)}" in ${op.h.toFixed(2)}" (${lines} lines at ${size}pt in ${op.w.toFixed(2)}")`
    );
  }
}

function rect(o) { return push({ k: "rect", ...o }); }
function ellipse(o) { return push({ k: "ellipse", ...o }); }
function line(o) { return push({ k: "line", ...o }); }
function text(o) { return push({ k: "text", size: 14, align: "left", valign: "top", face: FONT, ...o }); }

// ---- reusable pieces --------------------------------------------------

function card(t, x, y, w, h, opt = {}) {
  rect({
    x, y, w, h, tag: opt.tag || "card",
    fill: opt.fill || t.surface,
    transparency: opt.transparency,
    line: { color: opt.border || t.lineSoft, width: opt.borderWidth || 1, dash: opt.dash },
    radius: 0.06, shadow: opt.shadow !== false && t.shadow
  });
}

// The app's freezing-to-roasting gradient, approximated in 40 steps. Segments
// overlap so neither renderer leaves hairline seams between them.
function rampBar(t, x, y, w, h) {
  const steps = 40, sw = w / steps;
  for (let i = 0; i < steps; i++) {
    const p = (i / (steps - 1)) * 4;
    const a = Math.min(3, Math.floor(p)), f = p - a;
    const over = i < steps - 1 ? 0.022 : 0;
    rect({
      x: x + i * sw, y, w: sw + over, h, tag: "ramp",
      fill: mixHex(t.ramp[a], t.ramp[a + 1], f), line: null
    });
  }
}

// The pale second stop of the ramp (#5FA3C4) is too light to carry white text or
// to read as a numeral on white, so accents skip it.
function accent(t, i) { return t.ramp[[0, 2, 3, 4][i % 4]]; }

function mixHex(a, b, f) {
  const pa = [0, 2, 4].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [0, 2, 4].map(i => parseInt(b.slice(i, i + 2), 16));
  return pa.map((v, i) => Math.round(v + (pb[i] - v) * f).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function heatHex(mean) {
  const p = Math.max(-2, Math.min(2, mean)) + 2;
  const i = Math.min(3, Math.floor(p)), f = p - i;
  const c = [0, 1, 2].map(k => Math.round(HEAT[i][k] + (HEAT[i + 1][k] - HEAT[i][k]) * f));
  return c.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function tallyOf(counts) {
  const n = counts.reduce((a, b) => a + b, 0);
  const sum = counts.reduce((a, c, i) => a + c * (i - 2), 0);
  const cold = counts[0] + counts[1], hot = counts[3] + counts[4];
  const split = n >= 4 && Math.min(cold, hot) / n >= 0.25 && (cold + hot) / n >= 0.6;
  return { n, mean: n ? sum / n : 0, cold, hot, nice: counts[2], split };
}

// The dot plot from src/app.html:553 — one dot per vote, ramp axis, mean needle.
function dotPlot(t, x, y, w, h, counts, opt = {}) {
  const tl = tallyOf(counts);
  const gap = 0.05, bw = (w - gap * 4) / 5;
  const d = opt.dot || 0.155;
  for (let i = 0; i < 5; i++) {
    const bx = x + i * (bw + gap);
    rect({ x: bx, y, w: bw, h, tag: "band", fill: t.ramp[i], transparency: 90, line: null });
    const shown = Math.min(counts[i], 6);
    for (let k = 0; k < shown; k++) {
      ellipse({
        x: bx + bw / 2 - d / 2, y: y + h - 0.05 - (k + 1) * (d + 0.035),
        w: d, h: d, tag: "dot", fill: t.ramp[i], line: null
      });
    }
    if (counts[i] > 6) {
      text({
        x: bx, y: y + h - 0.05 - 7 * (d + 0.035), w: bw, h: 0.18, tag: "+n",
        text: "+" + (counts[i] - 6), size: 9, bold: true, color: t.ramp[i], align: "center", margin: 0
      });
    }
  }
  const ay = y + h + 0.045;
  rampBar(t, x, ay, w, 0.075);
  if (tl.n > 0) {
    const pct = Math.max(1.5, Math.min(98.5, ((tl.mean + 2) / 4) * 100)) / 100;
    line({
      x: x + w * pct, y: ay + 0.075, w: 0, h: 0.17, tag: "needle",
      color: t.ink, width: 2.25, dash: (tl.split && !opt.solidNeedle) ? "dash" : undefined
    });
  }
  if (opt.ticks !== false) {
    for (let i = 0; i < 5; i++) {
      text({
        x: x + i * (bw + gap), y: ay + 0.33, w: bw, h: 0.22, tag: "tick",
        text: SCALE_LABELS[i], size: 9.5, color: t.muted, align: "center", margin: 0
      });
    }
  }
  return ay + (opt.ticks === false ? 0.3 : 0.59);
}

// The cold / comfortable / warm bar from src/app.html:582.
function balanceBar(t, x, y, w, counts, opt = {}) {
  const tl = tallyOf(counts);
  if (!tl.n) return y;
  const h = opt.h || 0.16, gap = 0.025;
  const parts = [
    { n: tl.cold, c: t.ramp[0], lab: "cold" },
    { n: tl.nice, c: t.ramp[2], lab: "comfortable" },
    { n: tl.hot, c: t.ramp[4], lab: "warm" }
  ];
  const live = parts.filter(p => p.n > 0);
  const usable = w - gap * Math.max(0, live.length - 1);
  let cx = x;
  rect({ x, y, w, h, tag: "baltrack", fill: t.lineSoft, line: null, radius: 0.5 });
  for (const p of live) {
    const pw = usable * (p.n / tl.n);
    rect({ x: cx, y, w: pw, h, tag: "balseg", fill: p.c, line: null, radius: 0.5 });
    cx += pw + gap;
  }
  const runs = [];
  parts.forEach((p, i) => {
    runs.push({ text: String(p.n), bold: true, color: p.n ? p.c : t.muted, size: (opt.size || 13) + 3 });
    runs.push({ text: " " + p.lab + (i < 2 ? "   " : ""), color: t.muted, size: opt.size || 13 });
  });
  text({ x, y: y + h + 0.08, w, h: 0.3, tag: "balkey", runs, size: opt.size || 13, margin: 0 });
  return y + h + 0.42;
}

// The five vote buttons from src/app.html:837.
function voteButtons(t, x, y, w, pressed) {
  const gap = 0.08, bw = (w - gap * 4) / 5, bh = 1.02;
  for (let i = 0; i < 5; i++) {
    const bx = x + i * (bw + gap), on = i === pressed;
    rect({
      x: bx, y, w: bw, h: bh, tag: "vote " + SCALE_LABELS[i],
      fill: on ? t.ramp[i] : t.surface2, transparency: on ? 84 : undefined,
      line: { color: on ? t.ramp[i] : t.line, width: on ? 2 : 1.25 }, radius: 0.16, shadow: false
    });
    text({
      x: bx, y: y + 0.13, w: bw, h: 0.4, tag: "face",
      text: SCALE_FACES[i], size: 19, align: "center", face: EMOJI, margin: 0
    });
    text({
      x: bx, y: y + 0.58, w: bw, h: 0.3, tag: "votelab",
      text: SCALE_LABELS[i], size: 10.5, bold: on, color: on ? t.ramp[i] : t.ink,
      align: "center", margin: 0
    });
  }
  return y + bh;
}

// A rounded pill of text, sized to its content.
function pill(t, x, y, str, opt = {}) {
  const size = opt.size || 12;
  const w = opt.w || Math.max(0.5, str.length * size * 0.0083 + 0.3);
  const h = opt.h || size * 0.031;
  rect({
    x, y, w, h, tag: "pill " + str,
    fill: opt.fill || t.surface2, line: opt.line === null ? null : { color: opt.border || t.line, width: 1.25 },
    radius: 0.5, shadow: false
  });
  text({
    x, y: y + 0.01, w, h: h - 0.02, tag: "pilltext",
    text: str, size, bold: opt.bold !== false, color: opt.color || t.ink,
    align: "center", valign: "middle", margin: 0
  });
  return w;
}

// A numbered disc — the deck's one repeated motif.
function disc(t, x, y, d, label, opt = {}) {
  ellipse({
    x, y, w: d, h: d, tag: "disc " + label,
    fill: opt.fill || t.ink, line: null
  });
  text({
    x, y: y + 0.012, w: d, h: d - 0.02, tag: "disclabel",
    text: label, size: opt.size || d * 26, bold: true,
    color: opt.color || t.paper, align: "center", valign: "middle", margin: 0
  });
}

// The floor plate from src/app.html:625 — plan art, heat, pins. The plan is the
// app's own 160x110 sketch, scaled into place.
function plate(t, x, y, w, h, pins) {
  rect({ x, y, w, h, tag: "plate", fill: t.surface2, line: { color: t.line, width: 1 }, radius: 0.05 });
  const sx = w / 160, sy = h / 110;
  const X = u => x + u * sx, Y = v => y + v * sy;
  const rm = (a, b, c, d, tag) => rect({
    x: X(a), y: Y(b), w: c * sx, h: d * sy, tag,
    fill: t.ink, transparency: 94, line: { color: t.line, width: 0.75 }
  });
  const lab = (a, b, s) => text({
    x: X(a), y: Y(b) - 0.09, w: 1.2, h: 0.18, tag: "planlabel",
    text: s, size: 7, color: t.muted, margin: 0
  });

  rect({ x: X(4), y: Y(4), w: 152 * sx, h: 102 * sy, tag: "shell", fill: null, line: { color: t.muted, width: 1.1 } });
  rm(58, 38, 44, 34, "core");
  lab(61.5, 47, "Lifts"); lab(74, 47, "WC"); lab(88.8, 47, "Stair");
  rm(120, 8, 34, 22, "meet"); rm(120, 34, 34, 20, "meet"); rm(120, 58, 34, 20, "meet");
  lab(122.5, 12, "Meeting 7-1"); lab(122.5, 38, "Meeting 7-2"); lab(122.5, 62, "Meeting 7-3");
  rm(6, 78, 36, 26, "pantry"); lab(8.5, 82, "Pantry");
  const deskRow = (v, us) => us.forEach(u => {
    rect({ x: X(u), y: Y(v), w: 9 * sx, h: 5 * sy, tag: "desk", fill: null, line: { color: t.line, width: 0.6 } });
    rect({ x: X(u), y: Y(v + 5), w: 9 * sx, h: 5 * sy, tag: "desk", fill: null, line: { color: t.line, width: 0.6 } });
  });
  deskRow(12, [10, 21, 32, 47, 58, 69, 84, 95, 106]);
  deskRow(26, [10, 21, 32, 47, 58, 69, 84, 95, 106]);
  deskRow(82, [48, 59, 70, 85, 96, 107]);
  deskRow(44, [10, 21, 32]);
  deskRow(58, [10, 21, 32]);

  // Heat. CSS blur has no pptx equivalent, so each patch is five concentric
  // ellipses fading outward — the same soft-edged read.
  const blob = (px, py, size, color, strength) => {
    const rings = [1, 0.8, 0.62, 0.45, 0.28];
    rings.forEach((r, i) => {
      const d = size * r;
      ellipse({
        x: x + (px / 100) * w - d / 2, y: y + (py / 100) * h - d / 2, w: d, h: d, tag: "blob",
        fill: color, line: null,
        transparency: Math.round(100 - strength * (14 + i * 11))
      });
    });
  };
  for (const p of pins) {
    if (p.none) blob(p.x, p.y, w * 0.17, "8795A0", 0.5);
    else if (p.split) {
      blob(p.x - 5.5, p.y, w * 0.17, heatHex(-2), 0.95);
      blob(p.x + 5.5, p.y, w * 0.17, heatHex(2), 0.95);
    } else {
      blob(p.x, p.y, w * (0.15 + Math.min(p.n, 10) * 0.009), heatHex(p.mean),
        0.5 + Math.min(Math.abs(p.mean) / 2, 1) * 0.5);
    }
  }

  // The app clips the heat layer with overflow:hidden. PowerPoint has no clip,
  // so a patch near an edge would bleed onto the slide — cover the spill instead.
  const mask = (a, b, c, d) => rect({
    x: Math.max(0.26, a), y: Math.max(0.21, b),
    w: Math.min(W - 0.26, a + c) - Math.max(0.26, a),
    h: Math.min(H - 0.16, b + d) - Math.max(0.21, b),
    tag: "mask", fill: t.paper, line: null
  });
  const bleed = 1.2;
  mask(x - bleed, y - bleed, w + bleed * 2, bleed);
  mask(x - bleed, y + h, w + bleed * 2, bleed);
  mask(x - bleed, y, bleed, h);
  mask(x + w, y, bleed, h);
  rect({
    x, y, w, h, tag: "plateedge", fill: null,
    line: { color: t.line, width: 1 }, radius: 0.05
  });
  for (const p of pins) {
    const cx = x + (p.x / 100) * w, cy = y + (p.y / 100) * h;
    ellipse({
      x: cx - 0.055, y: cy - 0.055, w: 0.11, h: 0.11, tag: "knob",
      fill: t.surface, line: { color: t.ink, width: 1.75, dash: p.unplaced ? "dash" : undefined }
    });
    let ly = cy + 0.09;
    if (p.flag) {
      const fw = p.flag.length * 0.075 + 0.14;
      rect({ x: cx - fw / 2, y: ly, w: fw, h: 0.19, tag: "flag", fill: t.ink, line: null, radius: 0.25, shadow: false });
      text({
        x: cx - fw / 2, y: ly + 0.008, w: fw, h: 0.175, tag: "flagtext",
        text: p.flag, size: 8, bold: true, color: t.paper, align: "center", valign: "middle", margin: 0
      });
      ly += 0.23;
    }
    const lw = Math.max(0.6, p.label.length * 0.073 + 0.16);
    rect({ x: cx - lw / 2, y: ly, w: lw, h: 0.22, tag: "plab", fill: t.surface, transparency: 12, line: null, radius: 0.25, shadow: false });
    text({
      x: cx - lw / 2, y: ly + 0.01, w: lw, h: 0.2, tag: "plabtext",
      text: p.label, size: 9, bold: true, color: t.ink, align: "center", valign: "middle", margin: 0
    });
  }
}

// Slide chrome: eyebrow, title, and the slide number.
function header(t, s, opt = {}) {
  let y = 0.52;
  if (s.data.eyebrow) {
    text({
      x: M, y, w: CW, h: 0.26, tag: "eyebrow",
      text: s.data.eyebrow.toUpperCase(), size: 10.5, bold: true, color: t.ramp[2],
      charSpacing: 1.4, margin: 0
    });
    y += 0.3;
  }
  text({
    x: M, y, w: opt.titleW || CW, h: 0.78, tag: "title",
    text: s.data.title, size: opt.size || 34, bold: true, color: t.ink,
    charSpacing: -0.5, margin: 0
  });
  if (s.data.badge) {
    pill(t, M + measure(s.data.title, opt.size || 34) + 0.22, y + 0.2, s.data.badge,
      { size: 11, fill: t.ramp[3], border: t.ramp[3], color: t.onAccent });
  }
  return y + 0.86;
}

// Rough advance width of a bold Calibri string, for placing things after text.
function measure(str, size) { return str.length * size * 0.0069; }

// How many lines a string wraps to in a box of this width — used to size cards
// to their content rather than guessing a height and hoping.
function lines(str, size, w) {
  return Math.max(1, Math.ceil(str.length / Math.floor(w * 72 / (size * 0.47))));
}

function slideNumber(t, i) {
  text({
    x: W - M - 0.6, y: 7.02, w: 0.6, h: 0.26, tag: "pageno",
    text: String(i + 1), size: 9.5, color: t.muted, align: "right", margin: 0
  });
}

// ---- layouts ----------------------------------------------------------

const LAYOUTS = {
  title(t, s) {
    const d = s.data;
    text({
      x: M, y: 2.24, w: CW, h: 1.35, tag: "hero",
      text: d.title, size: 70, bold: true, color: t.ink, charSpacing: -2, margin: 0
    });
    text({
      x: M, y: 3.68, w: CW, h: 0.6, tag: "tagline",
      text: d.tagline, size: 27, color: t.ramp[1], margin: 0
    });
    rampBar(t, M, 4.94, CW, 0.17);
    text({ x: M, y: 5.2, w: 3, h: 0.26, tag: "rampL", text: "freezing", size: 11, color: t.muted, margin: 0 });
    text({
      x: W - M - 3, y: 5.2, w: 3, h: 0.26, tag: "rampR",
      text: "roasting", size: 11, color: t.muted, align: "right", margin: 0
    });
    text({
      x: M, y: 5.84, w: 9.4, h: 0.5, tag: "kicker",
      text: d.kicker, size: 15.5, color: d.note ? t.ink : t.muted, margin: 0
    });
    if (d.note) {
      text({
        x: M, y: 6.34, w: 9.4, h: 0.4, tag: "note",
        text: d.note, size: 13, color: t.muted, margin: 0
      });
    }
  },

  "three-cards"(t, s) {
    const d = s.data;
    let y = header(t, s);
    if (d.lead) {
      text({ x: M, y: y - 0.06, w: 11.1, h: 0.62, tag: "lead", text: d.lead, size: 17, color: t.muted, margin: 0 });
      y += 0.72;
    }
    const gap = 0.38, cw = (CW - gap * 2) / 3;
    // Titles and bodies line up across the three cards, so both are sized by
    // whichever card needs the most lines.
    const titleLines = Math.max(...d.cards.map(c => lines(c.title, 19, cw - 0.68)));
    const bodyLines = Math.max(...d.cards.map(c => lines(c.body, 13.5, cw - 0.68)));
    const bodyY = 0.96 + titleLines * 0.34 + 0.22;
    const ch = bodyY + bodyLines * 0.26 + 0.34;
    const bottom = d.footer ? BOTTOM - 0.8 : BOTTOM;
    y = y + Math.max(0, (bottom - y - ch) / 2);   // optically centre the row
    d.cards.forEach((c, i) => {
      const x = M + i * (cw + gap);
      card(t, x, y, cw, ch, {
        tag: "card" + i,
        fill: c.accent ? t.ramp[2] : t.surface,
        transparency: c.accent ? 88 : undefined,
        border: c.accent ? t.ramp[2] : t.lineSoft,
        borderWidth: c.accent ? 1.75 : 1
      });
      disc(t, x + 0.34, y + 0.34, 0.46, c.tick, {
        fill: c.accent ? t.ramp[2] : t.ink,
        color: c.accent ? t.onAccent : t.paper,
        size: c.tick.length > 1 ? 12 : 15
      });
      text({
        x: x + 0.34, y: y + 0.96, w: cw - 0.68, h: titleLines * 0.34 + 0.06, tag: "cardtitle",
        text: c.title, size: 19, bold: true, color: t.ink, charSpacing: -0.2, margin: 0
      });
      text({
        x: x + 0.34, y: y + bodyY, w: cw - 0.68, h: ch - bodyY - 0.18, tag: "cardbody",
        text: c.body, size: 13.5, color: t.muted, lineSpacing: 18, margin: 0
      });
    });
    if (d.footer) {
      text({
        x: M, y: y + ch + 0.5, w: CW, h: 0.46, tag: "footer",
        text: d.footer, size: 15.5, italic: true, color: t.ramp[1], margin: 0
      });
    }
  },

  bigstat(t, s) {
    const d = s.data;
    header(t, s);
    d.stats.forEach((st, i) => {
      const y = 1.78 + i * 1.92;
      text({
        x: M, y, w: 4.5, h: 0.92, tag: "statval",
        text: st.value, size: 54, bold: true, color: i ? t.ramp[4] : t.ink, charSpacing: -1.6, margin: 0
      });
      text({
        x: M, y: y + 0.96, w: 4.5, h: 0.32, tag: "statlab",
        text: st.label, size: 14, bold: true, color: t.ink, margin: 0
      });
      text({
        x: M, y: y + 1.3, w: 4.5, h: 0.5, tag: "statsub",
        text: st.sub, size: 12, color: t.muted, margin: 0
      });
    });
    const px = 5.72, pw = W - M - px;
    // Solid needle: this slide is showing what an average does with these votes,
    // not what Thermocracy does with them. The dashed needle arrives on slide 9.
    const after = dotPlot(t, px, 2.28, pw, 1.05, d.counts, { dot: 0.2, solidNeedle: true });
    text({
      x: px, y: after + 0.3, w: pw, h: 0.5, tag: "verdict",
      text: d.verdict, size: 26, bold: true, color: t.ramp[2], charSpacing: -0.4, margin: 0
    });
    text({
      x: px, y: after + 0.88, w: pw, h: 0.4, tag: "verdictsub",
      text: d.verdictSub, size: 12, color: t.muted, margin: 0
    });
    text({
      x: M, y: 6.06, w: CW, h: 0.62, tag: "caption",
      text: d.caption, size: 15, color: t.ramp[1], margin: 0
    });
  },

  rows(t, s) {
    const d = s.data;
    let y = header(t, s);
    if (d.lead) {
      text({ x: M, y: y - 0.08, w: 10.6, h: 0.42, tag: "lead", text: d.lead, size: 16.5, color: t.muted, margin: 0 });
      y += 0.5;
    }
    const rh = 1.24, gap = 0.16;
    const block = d.rows.length * rh + (d.rows.length - 1) * gap;
    y += Math.max(0, (BOTTOM - y - block) / 2);
    d.rows.forEach((r, i) => {
      const ry = y + i * (rh + gap);
      disc(t, M, ry + 0.06, 0.5, r.tick, { fill: accent(t, i), color: t.onAccent, size: 16 });
      text({
        x: M + 0.74, y: ry, w: CW - 0.74, h: 0.38, tag: "rowtitle",
        text: r.title, size: 18.5, bold: true, color: t.ink, charSpacing: -0.2, margin: 0
      });
      text({
        x: M + 0.74, y: ry + 0.42, w: 10.6, h: 0.72, tag: "rowbody",
        text: r.body, size: 14, color: t.muted, lineSpacing: 19, margin: 0
      });
    });
  },

  vote(t, s) {
    const d = s.data;
    header(t, s);
    const x = M, y = 1.78, w = 6.72;
    card(t, x, y, w, 3.5, { tag: "votepanel" });
    text({
      x: x + 0.34, y: y + 0.3, w: 0.7, h: 0.3, tag: "imat",
      text: "I'm at", size: 12.5, color: t.muted, valign: "middle", margin: 0
    });
    rect({
      x: x + 1.06, y: y + 0.26, w: w - 1.4, h: 0.42, tag: "spotsel",
      fill: t.surface2, line: { color: t.line, width: 1.25 }, radius: 0.12, shadow: false
    });
    text({
      x: x + 1.2, y: y + 0.26, w: w - 1.7, h: 0.42, tag: "spottext",
      text: d.spot, size: 13.5, color: t.ink, valign: "middle", margin: 0
    });
    voteButtons(t, x + 0.34, y + 0.94, w - 0.68, d.pressed);
    text({
      x: x + 0.34, y: y + 2.2, w: w - 0.68, h: 0.36, tag: "castline",
      text: d.castline, size: 13, color: t.muted, margin: 0
    });
    text({
      x: x + 0.34, y: y + 2.66, w: w - 0.68, h: 0.52, tag: "castnote",
      text: "Two hours after that tap, the vote expires on its own.", size: 12, italic: true, color: t.ramp[2], margin: 0
    });
    const rx = x + w + 0.5, rw = W - M - rx;
    d.points.forEach((p, i) => {
      const py = 1.92 + i * 1.02;
      rect({ x: rx, y: py + 0.07, w: 0.1, h: 0.1, tag: "tick", fill: t.ramp[2], line: null, radius: 0.5 });
      text({
        x: rx + 0.26, y: py, w: rw - 0.26, h: 0.86, tag: "point",
        text: p, size: 14, color: t.ink, lineSpacing: 19, margin: 0
      });
    });
  },

  split(t, s) {
    const d = s.data;
    header(t, s);
    const x = M, w = 5.95, y = 1.82;
    card(t, x, y, w, 2.98, {
      tag: "rulecard", fill: t.ramp[2], transparency: 92, border: t.ramp[2], borderWidth: 1.75
    });
    text({
      x: x + 0.34, y: y + 0.26, w: w - 0.68, h: 0.3, tag: "rulelab",
      text: "WHEN ALL THREE ARE TRUE", size: 10.5, bold: true, color: t.ramp[2], charSpacing: 1.4, margin: 0
    });
    d.conditions.forEach((c, i) => {
      const cy = y + 0.66 + i * 0.76;
      text({
        x: x + 0.34, y: cy, w: w - 0.68, h: 0.3, tag: "rule",
        text: c.rule, size: 15.5, bold: true, color: t.ink, charSpacing: -0.2, margin: 0
      });
      text({
        x: x + 0.34, y: cy + 0.32, w: w - 0.68, h: 0.34, tag: "why",
        text: c.why, size: 12.5, color: t.muted, margin: 0
      });
    });
    text({
      x, y: 4.94, w, h: 0.5, tag: "splitverdict",
      text: d.verdict, size: 25, bold: true, color: t.ink, charSpacing: -0.4, margin: 0
    });
    pill(t, x + measure(d.verdict, 25) + 0.2, 5.02, "Split", { size: 12, fill: t.ink, border: t.ink, color: t.paper });
    text({
      x, y: 5.5, w, h: 0.34, tag: "splitverdictsub",
      text: "— instead of a direction it cannot honestly give", size: 12.5, italic: true, color: t.muted, margin: 0
    });
    // The same eleven votes as a balance bar: five cold, one comfortable, five
    // warm. It is the split in one glance.
    if (d.counts) balanceBar(t, x, 5.94, w, d.counts);

    const rx = x + w + 0.5, rw = W - M - rx;
    text({
      x: rx, y: y, w: rw, h: 0.3, tag: "effectlab",
      text: "WHAT CHANGES THE MOMENT IT FIRES", size: 10.5, bold: true, color: t.muted, charSpacing: 1.4, margin: 0
    });
    d.effects.forEach((e, i) => {
      const ey = y + 0.44 + i * 0.44;
      rect({ x: rx + 0.02, y: ey + 0.1, w: 0.1, h: 0.1, tag: "tick", fill: t.ramp[2], line: null, radius: 0.5 });
      text({
        x: rx + 0.28, y: ey, w: rw - 0.28, h: 0.38, tag: "effect",
        text: e, size: 13.5, color: t.ink, margin: 0
      });
    });
    card(t, rx, 5.06, rw, 1.2, { tag: "quotecard", fill: t.surface2, shadow: false });
    text({
      x: rx + 0.28, y: 5.19, w: rw - 0.56, h: 0.96, tag: "quote",
      text: d.quote, size: 12.5, italic: true, color: t.muted, lineSpacing: 16, margin: 0
    });
  },

  heatmap(t, s) {
    const d = s.data;
    // Drawn before the header: plate() lays masks around itself to clip the heat,
    // and those masks must sit under the title rather than over it.
    const x = M, y = 1.78, w = 6.7, h = w / 1.4545;
    plate(t, x, y, w, h, d.pins);
    const ly = y + h + 0.16;
    rampBar(t, x, ly + 0.05, 1.1, 0.1);
    text({
      x: x + 1.22, y: ly, w: 2.1, h: 0.26, tag: "legend1",
      text: "freezing to roasting", size: 11, color: t.muted, valign: "middle", margin: 0
    });
    for (let i = 0; i < 4; i++) {
      rect({
        x: x + 3.38 + i * 0.09, y: ly + 0.05, w: 0.09, h: 0.1, tag: "swatch",
        fill: i % 2 ? t.ramp[4] : t.ramp[0], line: null
      });
    }
    text({
      x: x + 3.84, y: ly, w: 1.2, h: 0.26, tag: "legend2",
      text: "split", size: 11, color: t.muted, valign: "middle", margin: 0
    });
    text({
      x: x + w - 1.3, y: ly, w: 1.3, h: 0.26, tag: "legend3",
      text: "Level 7", size: 11, bold: true, color: t.ink, align: "right", valign: "middle", margin: 0
    });

    const rx = x + w + 0.5, rw = W - M - rx;
    const lead = d.lead || "Blue is cold, red is warm, mottled means the spot is arguing with itself.";
    text({
      x: rx, y: 1.82, w: rw, h: 0.76, tag: "hmlead",
      text: lead, size: 15, color: t.ink, lineSpacing: 20, margin: 0
    });
    d.reading.forEach((r, i) => {
      const ry = 2.78 + i * 0.86;
      text({
        x: rx, y: ry, w: rw, h: 0.74, tag: "read" + i,
        runs: [
          { text: r.k + " — ", bold: true, color: t.ink, size: 13.5 },
          { text: r.v, color: t.muted, size: 13.5 }
        ],
        size: 13.5, lineSpacing: 18, margin: 0
      });
    });
    card(t, rx, 6.2, rw, 0.62, { tag: "notecard", fill: t.surface2, shadow: false, dash: "dash", border: t.line });
    text({
      x: rx + 0.22, y: 6.2, w: rw - 0.44, h: 0.62, tag: "hmnote",
      text: d.note, size: 11.5, color: t.muted, valign: "middle", margin: 0
    });
    if (d.closing) {
      text({
        x: rx, y: 5.42, w: rw, h: 0.66, tag: "hmclosing",
        text: d.closing, size: 14, italic: true, color: t.ramp[2], lineSpacing: 19, margin: 0
      });
    }
    header(t, s);
  },

  grid(t, s) {
    const d = s.data;
    const gx = 0.4, gy = 0.36, cw = (CW - gx) / 2;
    const bodyLines = Math.max(...d.cells.map(c => lines(c.body, 14, cw - 0.72)));
    const ch = 0.82 + bodyLines * 0.27 + 0.36;
    const top = header(t, s);
    const y0 = top + Math.max(0, (BOTTOM - top - ch * 2 - gy) / 2);
    d.cells.forEach((c, i) => {
      const x = M + (i % 2) * (cw + gx), y = y0 + Math.floor(i / 2) * (ch + gy);
      card(t, x, y, cw, ch, {
        tag: "cell" + i,
        fill: c.accent ? t.ramp[2] : t.surface,
        transparency: c.accent ? 88 : undefined,
        border: c.accent ? t.ramp[2] : t.lineSoft,
        borderWidth: c.accent ? 1.75 : 1
      });
      text({
        x: x + 0.36, y: y + 0.3, w: cw - 0.72, h: 0.42, tag: "celltitle",
        text: c.title, size: 19, bold: true, color: t.ink, charSpacing: -0.3, margin: 0
      });
      text({
        x: x + 0.36, y: y + 0.82, w: cw - 0.72, h: ch - 1.1, tag: "cellbody",
        text: c.body, size: 14, color: t.muted, lineSpacing: 19, margin: 0
      });
    });
  },

  triage(t, s) {
    const d = s.data;
    header(t, s);
    const x = M, w = 7.05;
    d.rows.forEach((r, i) => {
      const y = 1.8 + i * 1.0;
      rect({
        x, y, w, h: 0.88, tag: "zrow" + i,
        fill: i === 0 ? t.surface2 : t.surface, line: { color: t.lineSoft, width: 1 }, radius: 0.08, shadow: false
      });
      const fw = pill(t, x + 0.22, y + 0.16, r.floor, { size: 9.5, fill: t.surface, border: t.line, color: t.muted });
      text({
        x: x + 0.3 + fw, y: y + 0.14, w: 3.3, h: 0.32, tag: "zname",
        text: r.name, size: 14.5, bold: true, color: t.ink, valign: "middle", margin: 0
      });
      text({
        x: x + 0.22, y: y + 0.5, w: 4.5, h: 0.3, tag: "zmeta",
        text: r.meta, size: 11.5, color: t.muted, margin: 0
      });
      if (r.flag) {
        pill(t, x + 4.42, y + 0.16, r.flag, { size: 9.5, fill: t.ink, border: t.ink, color: t.paper });
      }
      if (tallyOf(r.counts).n) {
        dotPlot(t, x + w - 1.85, y + 0.12, 1.6, 0.44, r.counts, { ticks: false, dot: 0.075 });
      } else {
        text({
          x: x + w - 1.85, y: y + 0.3, w: 1.6, h: 0.3, tag: "zquiet",
          text: "no votes", size: 10.5, italic: true, color: t.muted, align: "center", margin: 0
        });
      }
    });

    const rx = x + w + 0.44, rw = W - M - rx;
    text({
      x: rx, y: 1.8, w: rw, h: 0.28, tag: "ranklab",
      text: "HOW THE ORDER IS DECIDED", size: 10.5, bold: true, color: t.muted, charSpacing: 1.4, margin: 0
    });
    d.explain.forEach((e, i) => {
      const ey = 2.16 + i * 0.84;
      text({
        x: rx, y: ey, w: rw, h: 0.76, tag: "explain" + i,
        runs: [
          { text: e.k + " — ", bold: true, color: t.ink, size: 13 },
          { text: e.v, color: t.muted, size: 13 }
        ],
        size: 13, lineSpacing: 17, margin: 0
      });
    });
    card(t, rx, 4.78, rw, 1.92, { tag: "statuscard", fill: t.surface2, shadow: false });
    text({
      x: rx + 0.26, y: 4.96, w: rw - 0.52, h: 0.28, tag: "statuslab",
      text: d.status.label, size: 11.5, color: t.muted, margin: 0
    });
    rect({
      x: rx + 0.26, y: 5.28, w: rw - 0.52, h: 0.42, tag: "statussel",
      fill: t.surface, line: { color: t.line, width: 1.25 }, radius: 0.12, shadow: false
    });
    text({
      x: rx + 0.4, y: 5.28, w: rw - 0.8, h: 0.42, tag: "statusval",
      text: d.status.options[1], size: 12.5, bold: true, color: t.ink, valign: "middle", margin: 0
    });
    text({
      x: rx + 0.26, y: 5.76, w: rw - 0.52, h: 0.3, tag: "statusopts",
      text: d.status.options.join(" · "), size: 10, color: t.muted, margin: 0
    });
    let bx = rx + 0.26;
    d.status.badges.forEach(b => {
      bx += pill(t, bx, 6.1, b, { size: 9.5, fill: t.ink, border: t.ink, color: t.paper }) + 0.12;
    });
    text({
      x: bx + 0.04, y: 6.1, w: rw - (bx - rx) - 0.3, h: 0.52, tag: "statusbody",
      text: "← and it shows on the map", size: 11, italic: true, color: t.muted, valign: "middle", margin: 0
    });
  },

  // One person, one line. Used twice in a row to set the scenario up, so the
  // two slides have to read as a matched pair.
  person(t, s) {
    const d = s.data;
    const who = CAST[d.person];
    const tone = who.tone === "warm" ? t.ramp[4] : who.tone === "cold" ? t.ramp[0] : t.ink;
    text({
      x: M, y: 0.62, w: CW, h: 0.3, tag: "eyebrow",
      text: d.eyebrow.toUpperCase(), size: 11, bold: true, color: t.muted, charSpacing: 1.4, margin: 0
    });

    const dy = 1.78;
    disc(t, M, dy, 1.15, who.initial, { fill: tone, color: t.paper, size: 40 });
    text({
      x: M + 1.45, y: dy + 0.12, w: 6.5, h: 0.46, tag: "name",
      text: who.name, size: 27, bold: true, color: t.ink, charSpacing: -0.5, margin: 0
    });
    text({
      x: M + 1.45, y: dy + 0.64, w: 6.5, h: 0.36, tag: "role",
      text: who.role, size: 14.5, color: t.muted, margin: 0
    });

    const qy = 3.66;
    text({
      x: M, y: qy, w: CW - 0.4, h: 1.7, tag: "quote",
      text: d.quote, size: 33, color: tone, lineSpacing: 46, charSpacing: -0.5, margin: 0
    });

    if (d.setpoint) {
      const sw = 2.5;
      card(t, W - M - sw, dy, sw, 1.15, { tag: "setpointcard", fill: t.surface2, shadow: false });
      text({
        x: W - M - sw, y: dy + 0.16, w: sw, h: 0.56, tag: "setpointval",
        text: d.setpoint, size: 32, bold: true, color: t.ink, align: "center", charSpacing: -1, margin: 0
      });
      text({
        x: W - M - sw, y: dy + 0.74, w: sw, h: 0.3, tag: "setpointlab",
        text: "the whole floor", size: 11.5, color: t.muted, align: "center", margin: 0
      });
    }
    if (d.footer) {
      text({
        x: M, y: 5.92, w: CW, h: 0.6, tag: "personfooter",
        text: d.footer, size: 19, bold: true, color: t.ink, charSpacing: -0.3, margin: 0
      });
    }
  },

  // The feature recap: two columns of ticked items, checkable against the brief.
  checklist(t, s) {
    const d = s.data;
    let y = header(t, s);
    text({
      x: M, y: y - 0.08, w: 11.2, h: 0.4, tag: "lead",
      text: d.lead, size: 16.5, color: t.muted, margin: 0
    });
    y += 0.56;

    // Label and description are separate boxes: a "\n" inside a run breaks in
    // PowerPoint but not in the HTML preview, which would make the two disagree.
    const gx = 0.5, cw = (CW - gx) / 2;
    const rows = Math.ceil(d.items.length / 2);
    const rh = 0.82;
    y += Math.max(0, (BOTTOM - y - rows * rh) / 2);
    d.items.forEach((it, i) => {
      const col = i < rows ? 0 : 1;
      const x = M + col * (cw + gx);
      const ry = y + (i - col * rows) * rh;
      ellipse({ x, y: ry + 0.04, w: 0.24, h: 0.24, tag: "tickdisc", fill: t.ramp[2], line: null });
      text({
        x, y: ry + 0.05, w: 0.24, h: 0.22, tag: "tickmark",
        text: "✓", size: 11, bold: true, color: t.onAccent, align: "center", valign: "middle", margin: 0
      });
      text({
        x: x + 0.38, y: ry, w: cw - 0.38, h: 0.3, tag: "itemk" + i,
        text: it.k, size: 15.5, bold: true, color: t.ink, charSpacing: -0.2, margin: 0
      });
      text({
        x: x + 0.38, y: ry + 0.32, w: cw - 0.38, h: 0.34, tag: "itemv" + i,
        text: it.v, size: 12.5, color: t.muted, margin: 0
      });
    });
  },

};

// ---- emit -------------------------------------------------------------

function buildSlideOps(s, i) {
  ops.length = 0;
  const t = THEMES[s.theme];
  LAYOUTS[s.layout](t, s);
  slideNumber(t, i);
  return { theme: t, list: ops.slice() };
}

function toPptx(pptx, s, built) {
  const slide = pptx.addSlide();
  slide.background = { color: built.theme.paper };
  for (const op of built.list) {
    if (op.k === "text") {
      const base = {
        x: op.x, y: op.y, w: op.w, h: op.h,
        align: op.align, valign: op.valign, isTextBox: true,
        margin: op.margin === 0 ? 0 : undefined,
        fontFace: op.face, fontSize: op.size, bold: op.bold, italic: op.italic,
        color: hex(op.color || built.theme.ink),
        charSpacing: op.charSpacing, lineSpacing: op.lineSpacing, wrap: true
      };
      const body = op.runs
        ? op.runs.map(r => ({
          text: r.text,
          options: {
            bold: r.bold, italic: r.italic, color: hex(r.color || op.color || built.theme.ink),
            fontSize: r.size || op.size, fontFace: r.face || op.face
          }
        }))
        : op.text;
      slide.addText(body, base);
      continue;
    }
    if (op.k === "line") {
      slide.addShape(pptx.ShapeType.line, {
        x: op.x, y: op.y, w: op.w, h: op.h,
        line: {
          color: hex(op.color), width: op.width || 1,
          dashType: op.dash, endArrowType: op.arrow ? "triangle" : undefined
        }
      });
      continue;
    }
    const shape = op.k === "ellipse"
      ? pptx.ShapeType.ellipse
      : (op.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect);
    const cfg = { x: op.x, y: op.y, w: op.w, h: op.h };
    cfg.fill = op.fill ? { color: hex(op.fill), transparency: op.transparency } : { type: "none" };
    cfg.line = op.line
      ? { color: hex(op.line.color), width: op.line.width || 1, dashType: op.line.dash }
      : { type: "none" };
    if (op.radius && op.k !== "ellipse") cfg.rectRadius = op.radius;
    if (op.shadow) {
      cfg.shadow = { type: "outer", color: "14242C", opacity: 0.12, blur: 10, offset: 3, angle: 90 };
    }
    slide.addShape(shape, cfg);
  }
  slide.addNotes(notesFor(s));
}

// The deck is shown to an audience being sold a product, by a team. Neither
// implementation detail nor a singular "I" belongs anywhere an audience reads,
// so both are checked rather than trusted. `source` is exempt — it is
// traceability for whoever maintains this, and it never reaches a slide.
const BANNED = [
  { re: /src\/app\.html|\bsrc\/|\.html\b|\bnpm\b|node_modules/i, why: "implementation path or command" },
  { re: /single file|no build|bundler|dependenc|localStorage|\bAPI\b|codebase|repository/i, why: "engineering detail" },
  // Characters in the scenario speak for themselves, so quoted speech is exempt
  // from this one — "I keep a blanket under my desk" is Daniel, not the team.
  { re: /\bI\b|\bmy\b|\bmine\b/, why: "first-person singular — this is a team effort", outsideQuotes: true }
];

// Interface text quoted verbatim from the app (src/app.html:389).
const UI_LABELS = ["I'm at"];

function checkLanguage(s, i) {
  const fields = [
    ["narration", s.narration],
    ...s.onScreen.map((l, k) => ["onScreen[" + k + "]", l]),
    ...Object.entries(flatten(s.data)).map(([k, v]) => ["data." + k, v])
  ];
  for (const [where, value] of fields) {
    for (const rule of BANNED) {
      // Quoted speech belongs to a character, and UI_LABELS are the product's
      // own words — neither is the team talking about itself.
      const subject = rule.outsideQuotes
        ? UI_LABELS.reduce((acc, l) => acc.split(l).join(""), String(value).replace(/“[^”]*”/g, ""))
        : String(value);
      const hit = subject.match(rule.re);
      if (hit) {
        guardErrors.push(
          `slide ${i + 1} (${s.id}) ${where}: ${rule.why} — "${hit[0]}" in "${String(value).slice(0, 70)}…"`
        );
      }
    }
  }
}

// Every string reachable from a slide's data, for the language check.
function flatten(v, prefix = "", out = {}) {
  if (typeof v === "string") out[prefix || "value"] = v;
  else if (Array.isArray(v)) v.forEach((x, i) => flatten(x, prefix + "[" + i + "]", out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? prefix + "." + k : k, out);
  }
  return out;
}

// The notes pane is what a presenter reads, sometimes on a shared screen, so it
// carries the script and nothing else. Source citations live in the storyboard's
// appendix instead.
function notesFor(s) {
  return [
    `NARRATION (~${s.seconds}s)`,
    s.narration,
    "",
    "FRAME",
    s.frame,
    s.cuttable ? "\nCUTTABLE: this slide can be dropped for the short version." : ""
  ].filter(Boolean).join("\n");
}

// ---- HTML preview -----------------------------------------------------
// The same ops, same coordinates, at 96px per inch. This is the visual QA.

const PX = 96;
function px(v) { return (v * PX).toFixed(2) + "px"; }

function toHtml(s, built, i) {
  const t = built.theme;
  let body = "";
  for (const op of built.list) {
    const pos = `left:${px(op.x)};top:${px(op.y)};width:${px(op.w)};height:${px(op.h)}`;
    if (op.k === "text") {
      const runs = op.runs
        ? op.runs.map(r => `<span style="font-weight:${r.bold ? 700 : 400};font-style:${r.italic ? "italic" : "normal"};` +
          `color:#${hex(r.color || op.color || t.ink)};font-size:${((r.size || op.size) * PX / 72).toFixed(2)}px">${esc(r.text)}</span>`).join("")
        : esc(op.text);
      const pad = op.margin === 0 ? 0 : 0.05 * PX;
      body += `<div class="tx" style="${pos};padding:0 ${pad}px;` +
        `font-family:'${op.face}',sans-serif;font-size:${(op.size * PX / 72).toFixed(2)}px;` +
        `font-weight:${op.bold ? 700 : 400};font-style:${op.italic ? "italic" : "normal"};` +
        `color:#${hex(op.color || t.ink)};text-align:${op.align};` +
        `letter-spacing:${((op.charSpacing || 0) * PX / 72).toFixed(2)}px;` +
        `line-height:${op.lineSpacing ? (op.lineSpacing * PX / 72).toFixed(2) + "px" : 1.22};` +
        `justify-content:${op.valign === "middle" ? "center" : op.valign === "bottom" ? "flex-end" : "flex-start"}">` +
        `<div>${runs}</div></div>`;
      continue;
    }
    if (op.k === "line") {
      const len = Math.hypot(op.w, op.h), ang = Math.atan2(op.h, op.w) * 180 / Math.PI;
      body += `<div style="position:absolute;left:${px(op.x)};top:${px(op.y)};width:${px(len)};` +
        `height:0;border-top:${(op.width || 1) * 1.33}px ${op.dash ? "dashed" : "solid"} #${hex(op.color)};` +
        `transform-origin:0 0;transform:rotate(${ang.toFixed(2)}deg)"></div>`;
      continue;
    }
    const fill = op.fill
      ? `background:#${hex(op.fill)};opacity:${op.transparency ? (1 - op.transparency / 100).toFixed(3) : 1}`
      : "background:none";
    const border = op.line ? `border:${(op.line.width || 1) * 1.05}px ${op.line.dash ? "dashed" : "solid"} #${hex(op.line.color)}` : "border:none";
    const radius = op.k === "ellipse" ? "50%" : (op.radius ? `${(Math.min(op.w, op.h) * op.radius * PX).toFixed(1)}px` : "0");
    const shadow = op.shadow ? "box-shadow:0 3px 10px rgba(20,36,44,.12)" : "";
    body += `<div style="position:absolute;box-sizing:border-box;${pos};${fill};${border};border-radius:${radius};${shadow}"></div>`;
  }
  return `<section class="slide" style="background:#${hex(t.paper)}">
<div class="tagline">${i + 1}. ${esc(s.section)} — ${esc(titleOf(s))} · ${s.layout} · ~${s.seconds}s</div>
${body}
</section>`;
}

function esc(v) {
  return String(v).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// ---- storyboard -------------------------------------------------------

function storyboard() {
  const total = SLIDES.reduce((a, s) => a + s.seconds, 0);
  const cut = SLIDES.filter(s => s.cuttable).reduce((a, s) => a + s.seconds, 0);
  const L = [];
  L.push("# Thermocracy — presentation storyboard");
  L.push("");
  L.push("Generated by `npm run build-presentation` from `scripts/presentation-content.mjs`.");
  L.push("Edit the content module, not this file — it is overwritten on every build.");
  L.push("");
  const nCut = SLIDES.filter(s => s.cuttable).length;
  L.push(`**${SLIDES.length} slides · ~${mmss(total)} at a steady read.** ` +
    `Dropping the ${nCut === 1 ? "slide" : nCut + " slides"} marked *cuttable* ` +
    `brings it to ~${mmss(total - cut)}.`);
  L.push("");
  L.push("Deck: [`thermocracy.pptx`](thermocracy.pptx) — each slide carries its narration in the " +
    "speaker-notes pane, so this document and the deck say the same thing.");
  L.push("");
  L.push("The middle of the deck is one continuous scenario — a Tuesday afternoon on Level 7, " +
    "followed from two opposite complaints through to a rebalanced damper. Features are shown " +
    "doing their work in that story rather than toured separately; slide 13 recaps them as a " +
    "checklist for anyone marking against a brief.");
  L.push("");
  L.push("## At a glance");
  L.push("");
  L.push("| # | Section | Slide | Answers | ~sec |");
  L.push("|---|---|---|---|---|");
  const answers = {
    title: "—",
    what: "What did you build?",
    priya: "What problem?",
    daniel: "What problem?",
    why: "Why did you build it?",
    vote: "How does it address it? · Key features",
    average: "What problem?",
    split: "How does it address it? · What's different",
    heatmap: "Key features",
    triage: "Key features",
    diagnosis: "Key features",
    resolved: "How does it address it?",
    recap: "Key features",
    different: "What makes it different",
    close: "—"
  };
  SLIDES.forEach((s, i) => {
    L.push(`| ${i + 1} | ${s.section} | ${titleOf(s)}${s.cuttable ? " *(cuttable)*" : ""} | ${answers[s.id] || "—"} | ${s.seconds} |`);
  });
  L.push("");
  L.push("---");
  L.push("");
  SLIDES.forEach((s, i) => {
    L.push(`## ${i + 1}. ${titleOf(s)}`);
    L.push("");
    L.push(`*${s.section} · ${s.theme} slide · ~${s.seconds}s${s.cuttable ? " · cuttable" : ""}*`);
    L.push("");
    L.push("**Frame.** " + s.frame);
    L.push("");
    L.push("**On screen.**");
    L.push("");
    s.onScreen.forEach(l => L.push("- " + l));
    L.push("");
    L.push("**Narration.**");
    L.push("");
    L.push("> " + s.narration);
    L.push("");
    L.push("---");
    L.push("");
  });

  L.push("## The cast");
  L.push("");
  L.push("Invented, and consistent across every slide they appear on. Each is drawn as a disc in " +
    "their own temperature colour rather than a face.");
  L.push("");
  L.push("| | Who | Where | Appears on |");
  L.push("|---|---|---|---|");
  const appears = {
    priya: "3, 6, 8, 12", daniel: "4, 8, 12", marcus: "10, 11"
  };
  for (const [k, c] of Object.entries(CAST)) {
    L.push(`| **${c.initial}** | ${c.name} | ${c.role} | ${appears[k] || "—"} |`);
  }
  L.push("");
  L.push("## Reading it aloud");
  L.push("");
  L.push("The narration is written to be spoken, not read off the slide — no line of it appears " +
    "verbatim on the slide it belongs to. At an unhurried pace it runs ~" + mmss(total) + ".");
  L.push("");
  const cuts = SLIDES.map((s, i) => [s, i]).filter(([s]) => s.cuttable);
  L.push("Cuttable: " + cuts.map(([s, i]) => `**${i + 1}** (${s.data.title})`).join(" and ") +
    ". Dropping both keeps the story intact — the diagnosis is implied by the resolution — and " +
    "brings it to ~" + mmss(total - cut) + ".");
  L.push("");
  L.push("## Where each claim comes from");
  L.push("");
  L.push("Traceability for whoever maintains this deck; none of it appears on a slide. Line " +
    "numbers refer to the application source.");
  L.push("");
  L.push("| # | Slide | Source |");
  L.push("|---|---|---|");
  SLIDES.forEach((s, i) => {
    L.push(`| ${i + 1} | ${titleOf(s)} | ${s.source} |`);
  });
  L.push("");
  return L.join("\n");
}

// How a slide is named in the storyboard. Person slides carry no on-slide
// title, so they name themselves with `label`.
function titleOf(s) {
  return s.label || s.data.title || s.data.tagline || s.data.eyebrow || s.id;
}

function mmss(sec) {
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}

// ---- main -------------------------------------------------------------

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = DECK.author;
  pptx.title = DECK.title;
  pptx.subject = DECK.subject;

  const previews = [];
  SLIDES.forEach((s, i) => {
    guardErrors = [];
    checkLanguage(s, i);
    const built = buildSlideOps(s, i);
    if (guardErrors.length) {
      console.error(`\nSlide ${i + 1} (${s.id}):`);
      guardErrors.forEach(e => console.error("  " + e));
      throw new Error(`layout guard failed on slide ${i + 1} (${s.id})`);
    }
    toPptx(pptx, s, built);
    previews.push(toHtml(s, built, i));
    console.log(`  slide ${String(i + 1).padStart(2)} — ${s.id} (${built.list.length} shapes)`);
  });

  await pptx.writeFile({ fileName: PPTX_PATH });
  console.log(`\nwrote ${path.relative(ROOT, PPTX_PATH)}`);

  await fs.writeFile(STORYBOARD_PATH, storyboard(), "utf8");
  console.log(`wrote ${path.relative(ROOT, STORYBOARD_PATH)}`);

  if (WANT_PREVIEW) {
    await fs.mkdir(path.dirname(PREVIEW_PATH), { recursive: true });
    await fs.writeFile(PREVIEW_PATH, previewPage(previews), "utf8");
    console.log(`wrote ${path.relative(ROOT, PREVIEW_PATH)}`);
  }
}

function previewPage(sections) {
  return `<!DOCTYPE html>
<meta charset="utf-8">
<title>Thermocracy deck preview</title>
<style>
  body{margin:0;padding:18px;background:#8a949a;font-family:Calibri,sans-serif}
  /* zoom (not transform) so the slide is laid out at this size and one fits a screen */
  .slide{zoom:.9;position:relative;width:${W * PX}px;height:${H * PX}px;margin:0 auto 26px;overflow:hidden;
    box-shadow:0 6px 24px rgba(0,0,0,.35)}
  .tx{position:absolute;display:flex;flex-direction:column;box-sizing:border-box;overflow:visible}
  .tagline{position:absolute;left:0;top:-19px;font-size:12px;color:#fff;opacity:.9;white-space:nowrap}
</style>
${sections.join("\n")}
`;
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
