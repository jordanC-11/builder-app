# Making the video

This repo has no video files checked in — `build/` is gitignored and fully
regenerated. The source of truth is `src/slides.html`: a data array
(`window.SLIDES`) of discrete slides, each with a `layout`, some `data`, an
authored `duration` floor, and (usually) a `voiceover` line. A small Node
pipeline under `scripts/` turns that into `build/thermocracy-slides.mp4`: a
dark, cinematic, Apple-keynote-parody motion reel with an offline voiceover,
music, and a few synthesized UI sound cues — no screen recording, no paid
API, no manual editing.

The current cut plays the whole thing as a parody of a premium tech-product
launch: reverent, breathy narration about a five-button office-thermostat
vote, staged with real keynote-grade restraint and pacing. The one scene
played straight is the split-zone detection (the `truth-*` slides) — that's
the product's actual distinguishing claim, and it stays true even inside the
joke. See `video.md` in the repo root for the full creative brief this cut
was built against.

---

## 1. The `SLIDES` data structure

```js
var SLIDES = [
  { id:"intro-title", section:"Meet Thermocracy", layout:"title", duration:5.5,
    voiceover:"Meet Thermocracy — a simpler way to know how your floor actually feels.",
    data:{ title:"Thermocracy", subtitle:"Is it you, or is it the room?" } },

  { id:"vote-tapped", section:"How it works", layout:"mockvote", duration:3.6,
    voiceover:"That's it. That's the whole interaction.",
    data:{ avatar:"🧑‍💻", name:"You", role:"Level 7 — open floor",
      spot:"Level 7 — Open floor", tappedIndex:0, counts:[1,0,0,0,0] } }
];
```

Fields:

- **`id`** — stable filename slug for the screenshot/clip/voiceover-wav.
- **`section`** — chapter grouping, shown in the nav marks in the (non-`Present`)
  editor view.
- **`layout`** — which render function in the `RENDER` map to use: `title`,
  `statement`, `person`, `mockvote`, `calloutcard`, `heatmap`, `twoup`, `close`.
- **`data`** — layout-specific content. The only copy source for on-screen text.
- **`duration`** — a **floor**, in seconds. If the slide has no `voiceover`,
  this is its hold time outright. If it does, the actual hold time is
  `max(duration, voiceoverClipLength + padding)` — see §3.
- **`voiceover`** (optional) — the line spoken over this slide. Not every
  slide needs one (a slide can be a silent beat), but in the current cut all
  21 do.

**Adding a slide**: insert an object into `SLIDES` (pick an existing `layout`
or add a new render function to the `RENDER` map), give it a `duration` floor
and optionally a `voiceover` line, and re-run `npm run build-video`.

---

## 2. Writing the voiceover script

Word budget, per `video.md` §5: **~220–260 words** for the whole video.
Check the current total any time:

```bash
node -e '
const fs = require("fs");
const html = fs.readFileSync("src/slides.html", "utf8");
const m = [...html.matchAll(/voiceover:"([^"]*)"/g)];
console.log("lines:", m.length, "words:",
  m.reduce((n, x) => n + x[1].trim().split(/\s+/).filter(Boolean).length, 0));
'
```

**Tone**, since this cut is a parody: hushed, reverent, breathy keynote
delivery narrating something deliberately mundane as a civilization-scale
breakthrough. The comedy is in the mismatch between the rhetoric and the
product, not in mocking any real brand — the on-screen product facts stay
accurate throughout; only the framing is exaggerated. Keep the split-zone
scene the least exaggerated one, since undercutting the joke with a true
claim is part of what makes it land.

---

## 3. The voiceover synthesis stage (Piper)

`tools/piper/` (gitignored — binary + `.onnx` voice model, not npm-managed)
holds a local, offline TTS toolchain: `piper.exe` plus the
`en_US-amy-medium` voice. No API key, no network call, no per-run cost.

`scripts/build-video-pipeline.mjs` spawns it once per slide with a
`voiceover` line, piping the text over stdin:

```js
spawn(PIPER_EXE, [
  "--model", PIPER_VOICE, "--output_file", outPath,
  "--length_scale", "1.04",   // >1.0 = slightly slower, more "reverent"
  "--noise_scale", "0.78",
  "--noise_w", "0.9",
  "--sentence_silence", "0.35" // long pause — dramatic beats between lines
]);
```

Output lands in `build/audio/<id>.wav`. The pipeline reads each clip's real
duration (via the `music-metadata` package) and uses
`max(slide.duration, clipLength + 1.0s)` as that slide's actual on-screen
hold time — the voiceover paces the video, not the other way around.

**Setup**: if `tools/piper/piper.exe` or the voice model aren't present,
download a Piper release from https://github.com/rhasspy/piper/releases,
unzip it so `tools/piper/piper.exe` exists, and place a voice model (e.g.
`en_US-amy-medium.onnx` + `.onnx.json`) under `tools/piper/voices/`. Point at
a different model with the `PIPER_VOICE` env var. To iterate on visual
timing without Piper installed (or without waiting on synthesis), run with
`--skip-voice` — every slide then just uses its authored `duration`.

---

## 4. Motion, crossfades, and the audio mix

1. **Render** — Playwright drives headless Chromium to `src/slides.html` at
   `deviceScaleFactor: 2` (supersampled, for clean digital zoom headroom),
   calls `window.__renderSlide(i)` for each entry in `window.SLIDES`, waits
   for the page's own `body.dataset.ready` flag, and screenshots the full
   1920×1080 viewport in `Present` mode (no chrome).
2. **Ken Burns** — each slide's PNG becomes a silent clip held for its
   (voiceover-aware) duration, with ffmpeg's `zoompan` filter applying a slow
   digital zoom (in on even-indexed slides, out on odd-indexed ones, centered
   so the frame doesn't drift).
3. **Crossfade** — all per-slide clips are chained with ffmpeg's `xfade`
   filter (a 0.6s overlapping fade at each cut, built as one `filter_complex`
   graph from the slides' durations) instead of a hard-cut concat, plus a
   fade from/to black at the very start/end. This stage also computes each
   slide's approximate start offset in the assembled timeline, used next.
4. **Audio mix** — a standalone mixdown, built independently of the video:
   - The soundtrack (`assets/audio/soundtrack.mp3`), looped, faded in/out,
     and held under the voiceover at a fixed lower volume.
   - Every voiceover clip, delayed (`adelay`) to its slide's start offset.
   - A few synthesized UI sound cues (see §5), also delayed to specific
     slide starts.
   - All of it combined with `amix` (with `normalize=0` — amix's default
     auto-normalize divides by the total input count, which would drown the
     mix regardless of manual weights) and a final `alimiter` so nothing
     clips.
5. **Mux** — the silent crossfaded video and the audio mix are combined into
   `build/thermocracy-slides.mp4`.

---

## 5. UI sound cues

No sourced/licensed SFX assets — three short tones, synthesized in-process
with ffmpeg's `sine` audio source and a fade envelope, so there's nothing to
download or credit:

```js
const SFX_SOURCES = {
  click:  { lavfi: "sine=frequency=1400:duration=0.07:...", ... },
  notify: { lavfi: "sine=frequency=880:duration=0.22:...", ... },
  chime:  { lavfi: "sine=frequency=660:duration=0.9:...", ... }
};
```

`SFX_CUES` in `scripts/build-video-pipeline.mjs` maps a slide id to a cue
name; the cue plays at that slide's start. Currently: a soft `click` on the
first vote tap, a `notify` chime when the split zone is revealed, and a
`chime` on the final wordmark reveal. Add more by adding entries to either
map — keep them short and quiet (see the `volume` field per cue); they're
meant to reinforce a beat, not be noticed on their own.

---

## 6. The soundtrack

`assets/audio/soundtrack.mp3` is a CC0 (public domain) instrumental track —
see `assets/audio/CREDITS.md` for its source, license, and why it was picked
(it has a genuine, measured dynamic build rather than being a static loop,
and is longer than the finished video so it never has to loop mid-play).
Because it's CC0 and small, it's committed directly — no per-clone setup
needed.

To swap it, replace `assets/audio/soundtrack.mp3` with another track (any
format ffmpeg reads) and update `CREDITS.md`. If you want a track with a real
build the way the current one has, don't just trust the title/mood tag —
measure it:

```bash
FFMPEG=node_modules/ffmpeg-static/ffmpeg.exe
"$FFMPEG" -i candidate.mp3 -ss 0  -t 15 -af volumedetect -f null - 2>&1 | grep mean_volume
"$FFMPEG" -i candidate.mp3 -ss 60 -t 15 -af volumedetect -f null - 2>&1 | grep mean_volume
```

A track that's genuinely building will show a higher `mean_volume` later in
the file than at the start.

The build loops and trims the track to the video's length automatically
(`-stream_loop -1` + `-t <duration>`), with a 1.5s fade in/out — you don't
need to match its length to the video by hand, though picking one at least
as long as the video (so it never loops back to its own quiet opening mid-way
through yours) makes for a better build.

---

## 7. Running it

```
npm install                 # also downloads Playwright's Chromium (postinstall)
npm run build-video         # renders slides, voices them, builds Ken Burns clips, crossfades, mixes, scores
```

Output: `build/thermocracy-slides.mp4` (1920×1080, H.264 + AAC). Intermediate
files land in `build/slides/` (supersampled PNG per slide), `build/clips/`
(per-slide silent Ken Burns MP4), and `build/audio/` (per-slide voiceover
WAV) — all gitignored.

Flags:
- `--skip-render` — reuse existing slide screenshots (`build/slides/*.png`).
  Cheap way to re-tune `duration`/motion/crossfade constants or re-run
  voiceover without re-rendering every screenshot.
- `--skip-voice` — skip Piper entirely; every slide uses its authored
  `duration` floor instead. Useful if Piper isn't installed, or you're only
  iterating on visuals.

---

## 8. Pitfalls

- **Don't use `px` inside `.stage`.** Every size in the deck is in `cqw` (1%
  of the stage's container-query width), so the composition is identical at
  any render resolution. One `px` value and the layout breaks if you ever
  render at a different size.
- **`amix` needs `normalize=0`.** Without it, ffmpeg silently divides the
  whole mix by the total input count (music + every voiceover clip + every
  SFX cue, even though most are silent at any given instant) and the output
  reads as near-silent. Sanity-check any audio change with
  `ffmpeg -i out.mp4 -af volumedetect -f null -` — `mean_volume` well below
  roughly −30 dB on the finished file usually means this got lost again.
- **A slide's `duration` is a floor, not a target, once it has a
  `voiceover`.** If you shorten the spoken line without shortening the
  `duration`, nothing breaks — the slide just holds a little longer than its
  audio. If you lengthen the line, the slide grows to fit; you don't need to
  hand-tune `duration` to match.
- **Emoji render differently per OS.** The avatar and face emoji are system
  emoji. If you're building on Linux for a Windows audience, check they're
  not tofu.
- **Fonts load from Google Fonts.** If the build machine is offline or
  behind a proxy that blocks it, screenshots will use the fallback stack.

---

## 9. Retargeting this for a different app

`src/slides.html` is a template. To retarget it:

- **Keep**: the `cqw` sizing, the `RENDER` map and its existing layouts
  (`title`, `statement`, `person`, `mockvote`, `calloutcard`, `heatmap`,
  `twoup`, `close`), the `window.SLIDES` / `window.__renderSlide` contract
  the build script depends on, and the whole pipeline in `scripts/`.
- **Replace**: the `SLIDES` array's content — every `id`, `data`, and
  `voiceover` line — and add a new entry to `RENDER` only for a shape of
  content none of the existing layouts cover.
- **Reconsider per app**: whether the parody-keynote tone is the right
  register at all. It works here because the mismatch between keynote-grade
  rhetoric and a five-button thermostat vote *is* the joke — for a product
  where the stakes are genuinely high, a straight cinematic read (still
  following `video.md`'s structure) will serve better than a parody of one.
