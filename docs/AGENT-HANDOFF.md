# Handoff brief

You're picking up Thermocracy. This tells you what's load-bearing, what's
decoration, and what to build next.

Read `docs/ARCHITECTURE.md` before changing `src/app.html`, and
`docs/VIDEO-GUIDE.md` before changing `src/explainer.html`. This file is the
orientation on top of those.

---

## The one thing not to break

The product is not "a poll for office temperature". It's **the refusal to
average a split room**.

The board does two things with a tally, and which one it does is decided by that
refusal:

- **The room agrees.** It proposes a setpoint, and facilities applies it in one
  tap. Ordinary, frequent, and most of the value by volume.
- **The room is split.** It proposes *nothing*, because no single number
  satisfies both halves, and escalates the spot to management as a physical
  fault — a damper, a diffuser, a window run sharing a branch with a cold core.

Every design decision follows from that fork: the dot plot instead of a bar, the
dashed needle, the mottled heat blob, splitting the zone rather than guessing at
a number, the two-POV video. If a change would make the app report a single
comfortable-sounding number for a room where half the people are freezing — or
worse, *apply* one — the change is wrong regardless of how much cleaner it looks.

The thresholds in `tally()` are tuned (see ARCHITECTURE). Adjust them if real
usage says so — but adjust them deliberately, with a note, not incidentally.

---

## Ground rules for the code

- **`src/app.html` stays a single file.** No build step. It has to be
  deployable by a facilities team onto an internal server.
- **No `px` inside `.stage` in the explainer.** Container query units only, or
  the video breaks at other recording resolutions.
- **`paint()` in the explainer must stay a pure function of `t`.** No timers, no
  accumulation. This is what makes scrubbing and chapter jumps work.
- **Every `claude.use()` result may be `null`.** There's an existing degradation
  path for each; extend it, don't assume the capability.
- **One write at a time per document.** Writes go through the `writeChain`
  promise chain. Keep using it.
- **Republishing with a non-empty `capabilities` object is a full-set
  declaration.** Restate `db` rules, `user` and `assets` together or you'll
  silently revoke one. Omit the field entirely to carry the stored set forward.

---

## Deploying

Published as a Claude Artifact (see `docs/DEPLOY.md` for the exact call and the
seed batch). The db rules in that call are the security model — don't publish
without them.

To host it anywhere else instead, the capability calls all resolve `null` and
the app falls back to local-only mode. For real multi-user operation off-platform
you'd need to replace the three `db` collections with your own backend; the
read/write surface is small and isolated in the last ~60 lines of the script.

---

## Known rough edges

| Issue | Notes |
|---|---|
| Vote expiry is client-side | Old documents accumulate. Fine to ~5,000 people; prune if it grows. |
| No anonymity guarantee | See ARCHITECTURE. Deliberate, and the UI doesn't claim otherwise. |
| Floor plan is one sketch for all floors | Upload replaces it per floor. Most buildings need per-floor plans. |
| Spot placement is click-only | Drag would be better. Positions are %, so it's a small change. |
| `statusAt` uses client clock | Good enough for "updated 20 min ago"; don't build reporting on it. |
| Emoji vary by OS | The five faces and two avatars are system emoji. Check before recording video on an unusual platform. |

---

## What to build next, in order

> **Status note.** Items 1 and 2 are specified but **not yet built in
> `src/app.html`**. `src/explainer.html` and these docs already describe them as
> product behaviour. Closing that gap is the current job — don't demo the video
> to a customer as a description of shipped software until it is.

**1. Setpoint proposal and one-tap apply.** The consensus half of the product.
For any non-split spot with enough recent votes, derive a target from the mean
and show it against the current setpoint, with an Apply control for editors
only. Apply writes an intent record — it does not talk to a BMS directly; see
ARCHITECTURE for the shape and the guardrails (clamp to a safe band, cooldown
between applies, never auto-apply a split spot). A human stays in the loop on
every change; that is the design, not a limitation to remove later.

**2. "Needs attention" panel.** The escalation half, and what makes management
the audience rather than just facilities. A panel listing spots a setpoint
can't fix — spots flagged split, and spots still uncomfortable after an apply —
each with the diagnosis, how long it's been that way, and the vote evidence
attached. This is what turns "people are complaining" into "the north window run
shares a damper with the core, here are six weeks of votes proving it".

**3. Facilities digest.** Votes are already retained, so a weekly rollup is a
read over existing data: which spots were flagged, how often, how long they
stayed flagged, which applies correlated with votes going green. Needs (1) and
(2) first, since the interesting columns are their output.

**4. Per-floor plans as the default path.** Right now the sketch is the default
and upload is the exception. In a real building it's the reverse. Make the
upload prominent during setup, and consider a simple plan-alignment step
(drag/scale) rather than requiring a pre-cropped image.

**5. Anonymity, if adoption stalls.** Watch for it. If people hesitate to vote
against a colleague's comfort preference, hash the viewer id per zone so even
the owner can't correlate. This changes the db shape, so decide before you have
a lot of history.

**6. Sensor overlay.** If the building has a BMS, a second layer showing actual
sensor readings next to perceived comfort is genuinely valuable — the gap
between them is the interesting quantity. Second layer, not a replacement: the
whole point is that sensors already exist and didn't solve this.

**7. Seasonal memory.** A spot that's split every summer afternoon and fine every
winter morning is a solar gain problem, not a damper problem. Time-of-day and
season bucketing would name that. Needs (3) first.

---

## What not to build

- **Notifications or nudges.** An unsolicited ping about aircon gets the tool
  muted within a week. Voting has to stay something people do because it takes
  two seconds, not because they were prompted.
- **Gamification.** Points for voting will produce votes, not accurate votes.
- **A comment field.** It will fill with jokes and grievances, and then someone
  has to moderate it. The five-point scale is the whole interface on purpose.
- **Unattended thermostat control.** The app proposes a setpoint and a human
  applies it. It must never move a number on its own, never move one outside the
  configured safe band, and never propose one at all for a split spot. A
  facilities team that finds the tool has been adjusting plant unsupervised will
  disconnect it that day, and they'd be right to.

---

## If you're asked for another video

Read `docs/VIDEO-GUIDE.md`. The short version: `src/explainer.html` is a
template. Keep the clock, `paint()`, the `ease`/`lerp` helpers, the `data-cue`
mechanism, Present mode and the `cqw` sizing. Replace `SCENES`, `MARKS`, `CAPS`,
the scene markup, and the scene-specific animation.

Keep the two-POV structure. A single-POV video shows features; two POVs show the
handoff from the person who reports a problem to the person who fixes it, which
is the thing an internal tool has to prove it can do.

And keep the closing line honest. "Most of it is just a number — Thermocracy
moves that one, and names the vent behind the rest" claims the half the tool
genuinely closes and is specific about the half it hands off. A facilities
audience has been sold end-to-end fixes before; the split claim is the one
they'll believe.
