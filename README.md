# Thermocracy

A shared board for how the office actually feels — not what the thermostat is
set to — that turns the answer into an adjustment.

People tap one of five buttons for where they're sitting. The board shows the
result on a floor plan as a heat map, and then does one of two things:

- **The spot agrees** → it proposes a new setpoint, and facilities applies it in
  one tap. Ordinary, frequent, and most of the value by volume.
- **The spot is split** → it proposes nothing, because no single number
  satisfies both halves, and raises the spot to management as a physical fault
  with the vote history attached.

That second behaviour is the distinguishing one. Thermocracy **refuses to
average a split room**: when half a zone says freezing and half says roasting,
it reports the disagreement instead of a comfortable-sounding mean, and names
the vent rather than guessing at a number.

Built for an office where the same setpoint produces a baking window run and a
freezing core, and facilities gets two opposite tickets about one floor.

> **Implementation status.** The voting, split detection, heat map and spot list
> are built. The setpoint proposal, the Apply control and the "Needs attention"
> panel are **specified but not yet in `src/app.html`** — see
> `docs/ARCHITECTURE.md`. The slide video already describes them.

---

## Quick start

No build step, no server, no dependencies.

```
git clone https://github.com/jordanC-11/builder-app.git
cd builder-app
```

- **Run the app:** open `src/app.html` in a browser. It starts in local-only mode
  (votes stay in your tab) with an empty board — add a spot to begin.
- **Generate the video:** `npm install && npm run build-video` renders
  `src/slides.html` into a voiced, music-scored, Apple-keynote-parody motion
  reel — `build/thermocracy-slides.mp4` (~2:10, 1920×1080), with an offline
  Piper voiceover, Ken Burns motion and crossfades, a CC0 soundtrack, and a
  few synthesized UI sound cues. See "[The slide video](#the-slide-video)"
  below.

`src/app.html` loads two Google Fonts, so it looks best online but still
works offline with fallback fonts. It has no other dependencies and no build
step; only the video pipeline above uses npm.

---

## Contents

```
src/app.html          the application — single file, no build step
src/slides.html       the video's slide deck (content + voiceover script), for build-video
scripts/              the build-video pipeline, and the build-presentation generator
docs/presentation/    the storyboard deck: thermocracy.pptx + STORYBOARD.md
tools/piper/          local offline TTS binary + voice model, used by build-video (gitignored)
package.json          build-video's dependencies — not needed to run the app
assets/floorplan.svg  the built-in sketch floor plan, standalone
assets/audio/          the CC0 soundtrack used by build-video, and its credit
seed/zones.json       starting spots
docs/ARCHITECTURE.md  data model, capabilities, the split-detection logic
docs/VIDEO-GUIDE.md   how the video works and how to make another one
docs/DEPLOY.md        publishing, seeding, and running it off-platform
docs/AGENT-HANDOFF.md what's load-bearing, what to build next, what not to
```

## Running it

Open `src/app.html` in a browser. It works immediately in local-only mode —
votes stay in your tab.

For real multi-user operation it needs to be published as a Claude Artifact with
`db`, `user` and `assets` declared. See `docs/DEPLOY.md`.

## The slide video

A ~21-slide deck (`src/slides.html`) rendered to a **parody Apple-keynote /
big-tech-launch motion reel** — `build/thermocracy-slides.mp4`, ~2:10,
1920×1080: dark cinematic slides, an offline Piper voiceover delivered with
hushed, reverent keynote gravitas, a slow Ken Burns pan/zoom on every slide,
crossfades instead of hard cuts, a CC0 instrumental soundtrack with a real
dynamic build (`assets/audio/soundtrack.mp3`), and a few synthesized UI sound
cues. The joke is the mismatch between the production values and the product
(a five-button office thermostat vote) — the one scene played straight is the
split-zone detection, because that claim is actually true. This is a
separate, Node/npm-only pipeline (`scripts/`); it doesn't touch `src/app.html`,
which stays a plain, dependency-free file.

```
npm install          # also downloads Playwright's Chromium (postinstall)
npm run build-video
```

Output: `build/thermocracy-slides.mp4`. Useful flags:
`node scripts/build-video-pipeline.mjs --skip-render` (reuse existing slide
screenshots) and `--skip-voice` (skip Piper, fall back to each slide's
authored `duration`) — cheap ways to iterate on timing or motion without
re-rendering or re-synthesizing everything. Full details, the `SLIDES` data
format (including the `voiceover` field), and how to swap the soundtrack:
`docs/VIDEO-GUIDE.md`.

## The storyboard presentation

A separate, straight-faced pitch deck for explaining the app to an audience —
`docs/presentation/thermocracy.pptx`, 15 slides, ~5.5 minutes, in the app's own
palette with its UI redrawn as native PowerPoint shapes (no screenshots, so
every slide stays editable and crisp at projector size).

The middle of the deck is one continuous scenario: a Tuesday afternoon on Level
7, followed from two opposite complaints through split detection and a
rebalanced damper to a floor that has settled. Features are shown doing their
work inside that story rather than toured separately, and slide 13 recaps them
as a checklist. Between them the slides answer what it is, what problem it
solves, why it was built, how it addresses the problem, its key features, and
what makes it different.

Nothing in the deck is technical — no file names, no commands, no architecture
— and it speaks in the plural throughout. Both are enforced by checks in the
generator, so a careless edit fails the build rather than the rehearsal.

`docs/presentation/STORYBOARD.md` is the same deck as a storyboard — per slide:
the frame, the on-screen text, the narration to read aloud and the timing, plus
the cast and a closing table of where each claim comes from. Two slides are
marked *cuttable* for a ~4:45 version.

```
npm run build-presentation                 # writes the .pptx and STORYBOARD.md
npm run build-presentation -- --preview    # also writes build/presentation-preview.html
```

Both outputs are generated from `scripts/presentation-content.mjs` — edit the
words there and rebuild; don't hand-edit `STORYBOARD.md`. The `--preview` flag
renders every slide as HTML at the same coordinates, which is how the layout
gets checked without PowerPoint installed. This is unrelated to the slide video
above, and like it, it doesn't touch `src/app.html`.

### The narrated video

`npm run build-presentation-video` turns the same deck into
`build/thermocracy-presentation.mp4` — 1920×1080, ~5:13, every slide held for
its own narration with half-second dissolves between them, plus a sentence-level
`thermocracy-presentation.srt`. There is deliberately no pan or zoom: these
slides carry small type, and resampling every frame would make it swim.

The voice is Kokoro (`af_heart` at speed 0.9, ~167 wpm), which runs locally in
Docker — start it first:

```
docker compose -f docker-compose.tts.yml --profile cpu up -d kokoro-cpu
npm run build-presentation-video
```

Narration is synthesized one sentence at a time and cached by content hash, so
editing a single line re-renders only that sentence, and each sentence's
measured length is what times its subtitle. Useful flags: `--skip-render`
(reuse the slide images), `--speed`, `--voice`. `npm run build-presentation --
--preview` must have been run at least once, since the video is rendered from
that preview page.

To audition other voices before committing to one:
`node scripts/kokoro-samples.mjs`, then open `build/vo-samples/index.html`.

## How it works, briefly

Votes are a five-point scale from freezing (−2) to roasting (+2), one per person
per spot, expiring after two hours. Rather than a bar chart, each vote is drawn
as a dot on a temperature axis, so you can see the *shape* of opinion, not just
its centre.

A zone is flagged **split** when at least four people have voted, at least a
quarter fall on each side, and at least 60% are uncomfortable. For a split zone
the app suppresses the mean, dashes the needle, draws the heat map blob in two
colours at once — because there is no honest single colour for a place whose
occupants disagree — and proposes no setpoint at all, sending the spot to the
attention panel instead.

For everything else, the proposed target is the current setpoint moved against
the mean at 0.75°C per scale point, clamped to a safe band and surfaced only
when the change would exceed half a degree. A human always applies it.

The demo data makes the point: eleven votes distributed 3/2/1/2/3 average to
exactly 0.0, which reads as "about right", while only one of eleven people is
actually comfortable.

## Picking it up

If you're an agent or engineer taking this over, start with
`docs/AGENT-HANDOFF.md`. It covers the invariants, the known rough edges, and a
prioritised list of what to build next — the first two items being the setpoint
apply and the "Needs attention" panel, which are what turn this from a morale
app into something that changes a number and gets a damper adjusted.
