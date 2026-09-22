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
> `docs/ARCHITECTURE.md`. The explainer video already describes them.

---

## Quick start

No build step, no server, no dependencies.

```
git clone https://github.com/jordanC-11/builder-app.git
cd builder-app
```

- **Run the app:** open `src/app.html` in a browser. It starts in local-only mode
  (votes stay in your tab) with an empty board — add a spot to begin.
- **Watch the video:** open `src/explainer.html`, press **Present** (or `F`).
  It's a self-playing 2:30 page; screen-record it if you need an MP4.
- **Generate the slide video:** `npm install && npm run build-video` renders
  `src/slides.html` into a music-scored, Apple-keynote-style motion reel —
  `build/thermocracy-slides.mp4` (~1:30, 1920×1080), Ken Burns motion and
  crossfades, no voiceover, no screen recording needed. See
  "[The slide video](#the-slide-video)" below.

Both `src/app.html` and `src/explainer.html` load two Google Fonts, so they
look best online but still work offline with fallback fonts. They have no
other dependencies and no build step; only the slide-video pipeline above uses
npm.

---

## Contents

```
src/app.html          the application — single file, no build step
src/explainer.html    the 2:30 video, as a self-playing page you screen-record
src/slides.html       the same story as a static slide deck, for build-video
scripts/              the build-video pipeline (render, motion, crossfade, score)
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

## The video

Open `src/explainer.html`, press **Present** (or `F`), and screen-record it.
2:30, two points of view — an employee reporting, a contractor resolving —
with the narration script and timings in the collapsible panel under the player.
Full instructions in `docs/VIDEO-GUIDE.md`.

The animated scenes deliberately demo the *hard* case (a split spot that no
setpoint can fix); the ordinary apply-the-number case is asserted in narration
rather than animated, because it's believable without a demo and the hard case
isn't.

## The slide video

The same story as `src/explainer.html`, expanded into a ~20-slide deck
(`src/slides.html`) and rendered to an **Apple-keynote-style motion reel** —
`build/thermocracy-slides.mp4`, ~1:30, 1920×1080: dark cinematic slides, a
slow Ken Burns pan/zoom on every slide, crossfades instead of hard cuts, and a
CC0 instrumental soundtrack (`assets/audio/soundtrack.mp3`) — no voiceover, no
screen recording, no paid API. This is a separate, Node/npm-only pipeline
(`scripts/`); it doesn't touch `src/app.html` or `src/explainer.html`, which
stay plain, dependency-free files.

```
npm install          # also downloads Playwright's Chromium (postinstall)
npm run build-video
```

Output: `build/thermocracy-slides.mp4`. Re-run with `--skip-render` (e.g.
`node scripts/build-video-pipeline.mjs --skip-render`) to only re-assemble the
video — useful when tuning per-slide `duration` values without re-rendering
screenshots. Full details, the `SLIDES` data format, and how to swap the
soundtrack: `docs/VIDEO-GUIDE.md` section 10.

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
