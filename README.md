# Thermocracy

A shared board for how the office actually feels — not what the thermostat is
set to — that turns the answer into an adjustment.

People tap one of five buttons for where they're sitting. The board shows the
result on a floor plan as a heat map, and then does one of two things:

- **The spot agrees** → it reports a direction, and facilities adjust. Ordinary,
  frequent, and most of the value by volume.
- **The spot is split** → it reports nothing, because no single number satisfies
  both halves, and raises the spot as a physical fault with the vote history
  attached.

That second behaviour is the distinguishing one. Thermocracy **refuses to
average a split room**: when half a zone says freezing and half says roasting,
it reports the disagreement instead of a comfortable-sounding mean, and names
the vent rather than guessing at a number.

```
src/app.html        the application — single file, no build step
src/slides.html     the deck and the narration script — the source for the video
scripts/            build-video.mjs, the only pipeline
docker-compose.tts.yml   Kokoro text-to-speech, for the voiceover
assets/floorplan.svg     the built-in sketch floor plan, standalone
seed/zones.json          starting spots
```

---

## The app

Open `src/app.html` in a browser. It works immediately in local-only mode —
votes stay in your tab. It loads two Google Fonts, so it looks best online but
still works offline with fallbacks. Nothing else: no build, no bundler, no
server. That's deliberate — it has to be deployable by whoever inherits it, and
survive being copied onto an internal server by a facilities team.

### Two views

The board is two screens behind one toggle in the header (`I'm voting` /
`Facilities`, remembered in `localStorage` as `tc.view`):

- **Voting** — the floor plan, plain, with the spots marked. Tap anywhere and it
  snaps to the nearest spot; the five buttons come alive; below them, the
  readout for *that spot only*. No heat map, no building-wide list. A level
  whose areas aren't all on the board yet offers to add one where you tapped.
- **Facilities** — every spot in the building, sorted by what needs looking at,
  with a one-line triage count and a floor filter. Picking one loads its detail
  (dot plot, verdict, counts, the split explanation, the status control) and
  highlights it on the heat map. Uploading a plan and moving pins live here; the
  add form does not — see the catalogue below.

Two pieces of state, deliberately separate: `myZone` is where the voter sits and
persists (`tc.spot`); `selZone` is what facilities is looking at and does not.
Switching views never moves the other one. Vote buttons exist only in the voting
view — facilities staff who want to vote switch across.

Which view you land on is **not** gated on the viewer: anyone can flip the
toggle. Gating it on `user.canEdit()` (the `admin` level the db rules already
reserve) is a later change — hide `#viewsw` and force `view = "vote"`, nothing
else.

### The catalogue

Spots are **picked from a list, never typed**. `CATALOG` near the top of the
script is the building:

```js
var CATALOG = [
  {floor:"L1", areas:["Canteen","Concierge","Lounge"]},
  {floor:"L2", areas:["Front office","Back office"]},
  … L3, L4, L5
];
```

The one place a spot gets added is the voter's inline "add an area here", built
by `fillPicker()`: a pair of dropdowns giving the level, then the areas of that
level *the board hasn't got yet*. A level with nothing left to add says so and
disables the button. That's the point of the list: two people typing "L3 back
office" and "L3 Back-office" would split one room's votes across two spots, and
a vote that lands on the wrong spot is worse than no vote.

Facilities has **no add form**. Its view is triage — the list, the detail, the
heat map, the status, the plan — and the board is already the whole building, so
there is nothing there to set up. Moving pins and uploading a plan stay.

`seedCatalog()` puts the whole building on the board at startup, so the app is
usable the moment it opens rather than starting empty. When a shared `db` is
present its `zones` snapshot replaces that seed wholesale — the store is the
truth there, and `seed/zones.json` holds the same eleven spots to write into it.
`AREA_XY` gives each *kind* of area its usual place on the sketch plan, so a
freshly added spot has a sensible pin before anyone drags it.

Levels come from `floorsOf()`, which is the catalogue plus any extra level the
board happens to carry. A level with no spots yet still gets a tab — otherwise
there'd be no way to reach it and add one.

### How it works

Votes are a five-point scale from freezing (−2) to roasting (+2), one per person
per spot, expiring after two hours. Rather than a bar chart, each vote is drawn
as a dot on a temperature axis, so you can see the *shape* of opinion, not just
its centre.

A zone is flagged **split** when at least four people have voted, at least a
quarter fall on each side, and at least 60% are uncomfortable:

```js
var split = n >= 4
         && Math.min(cold, hot)/n >= 0.25    // both camps are substantial
         && (cold + hot)/n >= 0.6;           // and most people are unhappy
```

Each condition earns its place. Below four votes, disagreement is noise. A
single outlier shouldn't trigger it — a quarter of the room is a real
constituency. And the last one distinguishes *polarised* from *merely mixed*: if
most people are comfortable and two disagree at the edges, that's two people
with strong opinions, not a split zone.

When `split` is true, three things change: the verdict refuses to give a
direction, the needle on the dot plot goes dashed (the mean of a bimodal
distribution is a lie), and the heat map draws the zone as overlapping cold and
warm blobs — because there is no honest single colour for a place whose
occupants disagree.

The one action offered on a split spot is facilities' own — *Mark it as being
looked at*, which sets `status`. It is deliberately not "add a narrower spot":
with a fixed catalogue the answer to a split area is someone walking the floor,
not the board inventing a location nobody can find.

The demo data makes the point: eleven votes distributed 3/2/1/2/3 average to
exactly 0.0, which reads as "about right", while only one of eleven people is
actually comfortable. Worth preserving if you change the seed data.

### Data model

Three collections in the artifact's document store.

`zones/<slug>` — one document per physical spot: `floor`, `name`, optional `x`/`y`
as **percentages** of the floor plan (so they survive the plan image being
swapped), `status` (`""` | `"looking"` | `"adjusted"`), `statusAt`. A zone
without coordinates still renders: it gets a deterministic grid position and a
dotted pin, so nothing disappears just because nobody placed it.

`votes/<viewerId>` — **one document per person**, not per vote:
`{ "v": { "<zoneId>": { "n": -2, "t": 1758230400000 } } }`. Two reasons for this
shape. It's what makes one-vote-per-person enforceable — the db rules pin each
viewer to their own document, so nobody can write a vote as someone else; and
document count stays bounded by headcount rather than activity. Votes are never
deleted, only ignored once older than two hours, so the history stays intact.

`plans/<floorSlug>` — optional uploaded floor plan: `assetId`, `w`, `h`. The
dimensions are stored so the plate can take the image's aspect ratio *before*
the image loads; without that, pins drift during load.

### Capabilities and degradation

Declared at publish time:

```jsonc
{
  "db": { "rules": [
    { "path": "votes",        "read": "view", "write": "admin" },
    { "path": "votes/{self}", "write": "interact" }
  ]},
  "user":   {},
  "assets": {}
}
```

**The two db rules are the security model.** All votes are readable by anyone who
can open the board, writable only by editors — except each viewer may write
`votes/<their own id>`. Everyone sees the tally, nobody can stuff the ballot.
That is not hypothetical in an office aircon dispute.

Every capability is resolved with `await claude.use(name)` and may return `null`.
The app survives all of it: no `db` → local-only, with a banner saying so; no
`user` id → read-only, vote buttons disabled; no `assets` → upload button hidden,
built-in sketch plan used; no `localStorage` → you just lose the remembered spot.
A write rejected as `invalid_argument` flips the board to read-only for the rest
of the visit rather than failing loudly.

Note that declaring `db` makes the artifact organisation-internal — it cannot be
shared by public link, which is correct for this.

### Deliberately not built

So you don't think they were forgotten: no anonymity claim (votes are keyed by
viewer id, so an owner with store access could correlate — the UI never claims
otherwise); no direct BMS write (the app records intent, it does not speak to
plant); no autonomous adjustment; no notifications (an unsolicited ping about
aircon would get this muted in a week); no historical reporting, though the votes
are retained so it's addable.

---

## The slides

`src/slides.html` **is** the deck, and the script. Open it in a browser: arrow
keys or the buttons to move, **Present** for full-bleed. It's the single source
for the video — there is no separate content file and no PowerPoint export.

Fifteen slides, themed per slide (dark opens, carries the problem and closes;
light runs the walkthrough), laid out in container-query units so everything
scales with the stage rather than the window. The middle is one continuous
scenario — a Tuesday afternoon on Level 7 followed from two opposite complaints
through split detection to a rebalanced damper — so features are shown doing
their work rather than toured.

### Editing it

Everything lives in the `SLIDES` array near the bottom of the file. Each entry:

```js
{ id:"split", section:"One Tuesday on Level 7", theme:"light",
  layout:"split", duration:7,
  voiceover:"Because when at least four people have voted, …",
  data:{ /* whatever that layout renders */ } }
```

- `voiceover` is the narration, and the only thing the video's audio comes from.
- `duration` is a **floor** in seconds, not the actual hold — the real hold comes
  from the narration's measured length. It only matters for slides whose
  narration is very short.
- `theme` is `"light"` or `"dark"`, applied as `data-theme` on the stage. It is
  never taken from `prefers-color-scheme`: a render must not depend on the OS of
  whoever screenshotted it.
- `layout` picks a renderer from `RENDER`. Available: `title`, `cards`, `person`,
  `rows`, `vote`, `bigstat`, `split`, `heatmap`, `grid`, `triage`, `checklist`.

Shared pieces you can reuse in a new layout: `dotPlot(counts, opts)`,
`balanceBar(counts)`, `voteButtons(pressedIndex)`, `plate(pins)` and
`planSvg()` — the last two draw the same floor plan as the app.

**After editing, check nothing overflows.** Slides are sized to fit exactly; the
quickest check is to page through in Present mode. A slide whose content is a
few pixels too tall used to paint over its own title — `.body` now uses
`justify-content: safe center`, which degrades to top-alignment instead, but
content that doesn't fit still looks wrong.

---

## The voiceover

Kokoro (Apache-2.0) runs locally in Docker via
[remsky/Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI), which wraps it
in an OpenAI-compatible API with the model weights baked into the image. Nothing
to install, no API key, and the script text never leaves the machine.

```
docker compose -f docker-compose.tts.yml up -d        # GPU
docker compose -f docker-compose.tts.yml --profile cpu up -d kokoro-cpu
```

The CPU image is about 5 GB and plenty fast for a five-minute script; the GPU
image is much larger and only worth it if you're re-rendering constantly. Check
it's up with `curl http://localhost:8880/v1/audio/voices` — that endpoint only
answers once the model is loaded, which is why the compose healthcheck uses it.

The default voice is **`af_heart`** at **speed 0.9**, which lands around 167
words per minute. Kokoro reads fast at 1.0 — most voices come in at 180–210 wpm,
against the 140–170 an unhurried presentation wants — so the speed is turned
down deliberately. `/v1/audio/voices` lists the rest; `--voice` and `--speed`
override.

Two things to know about the container:

- **It can segfault on long inputs** (`double free or corruption`). Narration is
  therefore synthesized **one sentence at a time**, which avoids the crash,
  makes a retry cheap, and gives exact per-sentence timings for the subtitles.
- **Its output is quiet**, about −28 dB mean, so the pipeline runs `loudnorm` to
  bring the finished mix to −16 LUFS.

---

## The video

```
npm install                                     # once; also fetches Chromium
docker compose -f docker-compose.tts.yml --profile cpu up -d kokoro-cpu
npm run build-video
```

Produces `build/thermocracy.mp4` — 1920×1080, 30 fps, about 5:13 — and
`build/thermocracy.srt`. Both are gitignored.

What it does: screenshots every slide from `src/slides.html` in Present mode at
1920×1080; narrates each one with Kokoro; holds each slide for its narration
plus a beat either side; crossfades between slides over half a second; places
every sentence on the timeline at its own offset; normalises; muxes.

**There is deliberately no pan or zoom.** These slides carry small type — dot
plots, a heat map, a seven-item checklist — and resampling every frame to fake
motion makes it swim.

Narration is cached by a hash of voice, speed and sentence text, so editing one
line re-synthesizes that line and nothing else. Useful flags:

| Flag | Effect |
|---|---|
| `--skip-render` | reuse `build/frames/`, when only the audio or timing changed |
| `--skip-voice` | use only cached narration; fails if any is missing |
| `--speed 0.85` | slower read (re-synthesizes everything — speed is in the cache key) |
| `--voice bm_george` | any voice `/v1/audio/voices` reports |

Subtitles are one cue per sentence, timed from that sentence's own measured
audio, split to two lines of at most 42 characters.

### If it fails

- *"No Kokoro server at …"* — the container isn't up, or is still loading.
- *"The container stopped answering"* — it crashed mid-run. Restart it and re-run;
  cached sentences are kept, so it resumes where it left off.
- *"Missing frame …"* — you passed `--skip-render` without having rendered first.
- *"Could not read window.SLIDES"* — a syntax error in `src/slides.html`. Open it
  in a browser; the console will say where.
