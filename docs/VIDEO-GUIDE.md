# Making the video presentations

This repo has no video files in it. `src/explainer.html` **is** the video: a
self-playing HTML page with a timeline, which you screen-record to get an MP4.

That sounds like a workaround. It isn't — it's the better tool for this job, and
the reasons matter if you're deciding whether to keep the approach:

- A revision is a one-line code edit, not a re-render. Changing a number in the
  narration takes ten seconds.
- Text stays vector-crisp at any resolution, and the same file plays at 720p on
  a laptop or 4K on a lobby screen.
- It inherits light/dark theme, so it doesn't clash with wherever it's embedded.
- The demo animation is driven by the *real* logic (the same split-detection
  maths the app uses), so the video can't drift out of sync with the product.
- Captions are burned in, so it works silently — which is how most people will
  actually watch it.

---

## 1. The architecture, and the one rule that matters

Everything is a pure function of a single scalar: `t`, the playhead in seconds.

```js
var t = 0, playing = false, last = null;

function loop(now){
  if(!playing) return;
  if(last === null) last = now;
  t += (now - last)/1000; last = now;
  if(t >= DUR){ t = DUR; playing = false; }
  paint();                       // <- everything happens here
  if(playing) requestAnimationFrame(loop);
}
```

**The rule: `paint()` must be able to render any `t` correctly without having
seen any previous frame.** No accumulated state, no counters that only increment,
no `setTimeout`, no `animation-delay` carrying timeline meaning.

Break that rule and scrubbing silently breaks with it — which you won't notice
until you're recording and need to redo a section. It also means you can jump
straight to 1:47 to check one caption instead of watching two minutes.

Concretely, this is why the dot plot does:

```js
// derive the target count, then make the DOM match it
while(have < counts[i]){ band.appendChild(newDot()); have++; }
while(have > counts[i]){ band.removeChild(band.lastChild); have--; }
```

instead of `band.appendChild(dot)` on a timer. Scrub backwards and dots come off.

### The division of labour

| Layer | Owns | Example |
|---|---|---|
| JS | *What state we're in at time `t`* | `el.classList.toggle("in", t >= cue)` |
| CSS | *How it looks getting there* | `transition: opacity .55s ease` |

JS never animates. It flips a boolean; CSS tweens it. Keeps the timeline code
readable and gives you free easing.

The one exception is CSS `@keyframes` on element *creation* (the dot `drop`
animation). That's fine — it's triggered by the element appearing, not by the
clock, so it replays correctly on scrub.

---

## 2. The four data structures

Everything in the video is declared in four places near the top of the script.
Editing the video means editing these, not the render code.

```js
var DUR = 150;                                  // total seconds

var SCENES = [                                  // which section is on screen
  {el:"s1", a:0,   b:6},
  {el:"s2", a:6,   b:28},
  {el:"s3", a:28,  b:70},                       // employee POV
  {el:"s4", a:70,  b:120},                      // contractor POV
  {el:"s5", a:120, b:142},
  {el:"s6", a:142, b:150}
];

var MARKS = [["Title",0],["What it is",6],       // chapter buttons under the player
             ["Sarah, employee",28],["Ravi, contractor",70],
             ["The problem",120],["Close",142]];

var CAPS = [                                     // [second, caption text]
  [1.8,  "Thermocracy — a small board for a very old office argument."],
  [6.5,  "It's a shared read on how the office feels, and what the aircon should do about it."],
  // ...
];
```

Plus **cues in the markup** — the lightest-weight mechanism, and the one you'll
use most:

```html
<p class="line" data-cue="13">Not the number on the thermostat…</p>
```

```js
cues.forEach(function(el){
  el.classList.toggle("in", t >= parseFloat(el.dataset.cue));
});
```

Any element with `data-cue` gets `.in` at that second. Give it a transition and
you have a timed reveal, no JS.

---

## 3. Animating values over time

For anything continuous (a needle sliding, a heat blob cooling), use the two
helpers rather than hand-rolling:

```js
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function ease(u){ u = clamp(u,0,1); return u*u*(3-2*u); }   // smoothstep
function lerp(a,b,u){ return a + (b-a)*clamp(u,0,1); }
```

The pattern is always the same — normalise elapsed time into 0..1, ease it,
interpolate:

```js
var fix = ease((t - 106) / 9);              // 9-second transition starting at 106s
mean = lerp(1.9, 0.2, fix);                 // window run cooling after the fix
```

`clamp` inside `ease` means this is automatically correct before the start
(returns the `from` value) and after the end (returns `to`). No branching.

Cross-fading two elements — used when the split zone becomes two zones — is the
same trick run twice:

```js
if(t < 89.8) push({ ...oldPin, a: appear * (t < 88 ? 1 : 1 - ease((t-88)/1.5)) });
if(t >= 88)  push({ ...newPin, a: ease((t-88.2)/1.5) });
```

Overlap the windows by a second or so. Hard cuts between related states read as
a glitch; a 1.5s dissolve reads as a transformation.

---

## 4. Sizing: why everything is in `cqw`

The stage is a container query context:

```css
.stage{ aspect-ratio:16/9; container-type:inline-size; }
h2.big{ font-size:5cqw; }          /* 5% of stage width */
```

`1cqw` = 1% of the stage's width. Every size in the video — type, padding, dot
diameter, stroke width — is in `cqw`. Consequence: the composition is identical
whether the stage is 600px or 1920px wide, so you can record at any window size
and the framing is the same. **Never use `px` inside the stage.** One `px` value
and the layout breaks at a different recording resolution.

---

## 5. Writing the script

The narration lives in `CAPS` and is also dumped into the `<details>` panel under
the player, so whoever records the voiceover can read it off the same page.

**Pacing.** Comfortable narration is ~150 words/minute ≈ 2.5 words/second. So:

| Runtime | Word budget |
|---|---|
| 60s | ~150 words |
| 2:00 | ~300 words |
| 2:30 | ~375 words |

The current script is ~300 words over 2:30 (120 wpm — deliberately under the
150 wpm ceiling, because the subject is dry and the captions carry detail). If
you add a scene, take words out
somewhere else or extend `DUR` — cramming is the most common failure and it's
immediately audible.

**Caption timing.** One caption every 6–8 seconds. Shorter and the reader is
chasing text; longer and the screen feels stalled. Each caption should be one
sentence that can be read aloud in a single breath.

**Structure that's been tested here.** Question-order (*what / how / problem*)
is what was asked for, but the arc that actually lands is:

1. **Title** (6s) — name and one-line hook.
2. **What it is** (20s) — plain definition, no selling.
3. **POV 1: the person with the problem** (40s) — one named human, one action.
4. **POV 2: the person who fixes it** (50s) — same event, other side, resolution.
5. **The problem** (20s) — now name the general case. It lands harder *after*
   the story than before it.
6. **Close** (8s) — one honest line. Ours is "Most of it is just a number.
   Thermocracy moves that one, and names the vent behind the rest." It claims
   the easy half outright and is specific about the hard half instead of
   claiming it too. That split is the whole pitch, and a facilities audience
   who've been sold end-to-end fixes before will believe the specific version.

**Two POVs is the format to keep.** A single-POV product video shows features.
Two POVs show a *handoff* — someone reports, someone resolves — which is the
thing an internal tool actually has to prove it can do. Give both people a name
and a role caption; it costs four seconds and makes the whole thing concrete.

**Show the hard case, claim the easy one.** The animation in scenes 3 and 4 is
entirely the *split* spot — the case a setpoint can't fix. The ordinary case,
where the votes agree and facilities applies the proposed number in one tap, is
asserted in words in scene 2 and referenced in Ravi's first line ("most spots
already took their setpoint"). That's on purpose: the easy path is believable
without a demo, the hard path isn't. If you re-cut this, don't spend animation
seconds proving the easy path — spend them on the thing nobody else does.

---

## 6. Adding a scene — worked example

Say you're adding a 20-second "Rollout" scene between the problem and the close.

1. **Budget the time.** Bump `DUR` from 150 to 170 and push everything after the
   insertion point forward by 20: the close moves from 142 → 162.

2. **Shift the later cues.** Every `data-cue` and `CAPS` entry after 142 needs
   +20. Do it with a script, not by hand:
   ```bash
   # bump every data-cue >= 142 by 20 seconds
   python3 - <<'EOF'
   import re
   p='src/explainer.html'; h=open(p).read()
   def bump(m):
       v=float(m.group(1)); return 'data-cue="%g"' % (v+20 if v>=142 else v)
   open(p,'w').write(re.sub(r'data-cue="([\d.]+)"', bump, h))
   EOF
   ```

3. **Add the scene markup** with a new id, matching the existing pattern:
   ```html
   <section class="scene" id="s7">
     <p class="eyebrow">Rollout</p>
     <h2 class="big">One floor, two weeks.</h2>
     <p class="line" data-cue="146">Start where the complaints already are.</p>
   </section>
   ```

4. **Register it** in `SCENES` (`{el:"s7", a:142, b:162}`) and `MARKS`, and
   update the `<input type="range" max>` and the static `2:30` label.

5. **Add captions** to `CAPS`, respecting the ~2.5 words/sec budget.

6. **Scrub through the seam** at 140–165 and check nothing pops.

---

## 7. Recording it

The page has a **Present** mode built for this. Click Present (or press `F`) and
all the chrome disappears — the stage goes full-bleed, letterboxed to 16:9, and
playback starts from zero.

Keyboard while presenting: `space` play/pause, `←`/`→` seek 5s, `R` restart,
`Esc` exit.

**Recommended capture:**

| Platform | Tool |
|---|---|
| macOS | `Cmd+Shift+5` → Record Selected Portion, or QuickTime |
| Windows | `Win+Alt+R` (Game Bar) |
| Any | OBS Studio — use this if you want a fixed 1920×1080 canvas |

**Procedure:**

1. Size the browser window so the stage is at least 1280px wide. Browser zoom at
   100%.
2. Decide the theme *before* recording — the page follows your OS setting. Dark
   projects better; light embeds better in slide decks. To force one, add
   `data-theme="dark"` (or `"light"`) to the `<html>` tag.
3. Press `F`, then immediately start the recorder. Playback auto-starts, so
   record a couple of seconds of lead-in and trim after.
4. Let it run the full 2:30 without touching the mouse — a cursor drifting
   across the frame is the most common retake.
5. Trim head and tail. Done.

**Audio.** Two options:
- Read the script live over the recording. Use the `<details>` panel; the
  timestamps line up with the playhead shown in the controls.
- Generate TTS from the script and lay it under the video in any editor. The
  caption timings in `CAPS` are your cue sheet.

Either way the video still works muted, because the captions are burned in.

---

## 8. Pitfalls

- **Don't use `setTimeout` or `animation-delay` for timeline events.** Breaks
  scrubbing, breaks Present mode's jump-to-zero, breaks chapter buttons.
- **Don't accumulate.** Anything shaped like `count++` inside `paint()` is a bug.
- **Don't use `px` inside `.stage`.** Use `cqw`.
- **Don't let a caption run past its scene.** `CAPS` is independent of `SCENES`,
  so a caption can outlive the visual it describes. Check the boundaries.
- **Check the last frame.** `t` clamps to `DUR`, so whatever is on screen at
  `DUR` is your freeze-frame and your thumbnail. Make it the closing line.
- **Emoji render differently per OS.** The avatars and faces are system emoji.
  If you're recording on Linux for a Windows audience, check they're not tofu.
- **Fonts load from Google Fonts.** If the recording machine is offline or
  behind a proxy that blocks it, you'll record the fallback stack. Load the page
  once and confirm the headings look right before hitting record.

---

## 9. Reusing this for a different app

`src/explainer.html` is a template. To retarget it:

- Keep: the clock, `paint()`, `ease`/`lerp`/`clamp`, the cue mechanism, Present
  mode, `cqw` sizing, the caption bar, the six-scene arc.
- Replace: `SCENES`, `MARKS`, `CAPS`, the `<section class="scene">` blocks, and
  the scene-specific animation (here `DOTS` and `mapAt()`).

The part worth copying most deliberately is `mapAt(t)` — a function that returns
the *entire* visual state of a complex animated element for any `t`. If your new
video has a complex moving piece, model it that way rather than as a sequence of
transitions, and scrubbing keeps working for free.
