# Architecture

`src/app.html` is a single self-contained HTML file. No build step, no bundler,
no dependencies except two Google Fonts. Open it in a browser and it runs.

That's deliberate. The tool has to be deployable by whoever inherits it,
including someone without a Node toolchain, and it has to survive being copied
onto an internal server by a facilities team.

---

## The idea in one paragraph

People vote on how the aircon feels where they're sitting, and the board turns
that into one of two outcomes.

When a spot **agrees**, it proposes a setpoint and facilities applies it in one
tap. That's the ordinary path, and most of the value by volume.

When a spot is **split** — a group saying freezing and a group saying roasting
in the same place at the same minute — it proposes nothing. Ordinary polling
would average those votes and report "about right", which is both false and
useless. Instead the app detects bimodal opinion, refuses to report a mean for
it, and escalates the spot to management as a *physical* fault: the zone
boundary is wrong, not the number. That's the half a thermostat can't reach, and
it's the reason this exists rather than a suggestion box.

---

## Layers

```
┌─────────────────────────────────────────────┐
│ Vote panel      five buttons, one per level │
├─────────────────────────────────────────────┤
│ Readout         dot plot + verdict + status │
├─────────────────────────────────────────────┤
│ Setpoint        proposed target + Apply     │  (spec)
├─────────────────────────────────────────────┤
│ Heat map        floor plan + heat + pins    │
├─────────────────────────────────────────────┤
│ Needs attention spots no number can fix     │  (spec)
├─────────────────────────────────────────────┤
│ Spot list       ranked by what needs a look │
└─────────────────────────────────────────────┘

Rows marked **(spec)** are designed and described in the video and docs, but are
not in `src/app.html` yet. See "Setpoint proposal and escalation" below.
          ▲
          │  claude.use("db") / ("user") / ("assets")
          ▼
   shared document store, per artifact
```

Everything renders from one `render()` pass triggered by user action, by a `db`
snapshot, or by a 60-second timer (which ages out expired votes).

---

## Data model

Three collections in the artifact's document store.

### `zones/<slug>`

One document per physical spot.

```jsonc
{
  "floor":    "Level 7",           // groups spots into map tabs
  "name":     "North window seats",
  "x":        50,                  // % across the floor plan, optional
  "y":        9,                   // % down the floor plan, optional
  "status":   "looking",           // "" | "looking" | "adjusted"
  "statusAt": 1758230400000
}
```

`x`/`y` are percentages of the plan, not metres, so they survive the plan image
being swapped for a different one of the same aspect ratio. A zone without
coordinates still renders — it gets a deterministic grid position and a dotted
pin, so nothing disappears just because nobody placed it yet.

### `votes/<viewerId>`

**One document per person**, not per vote. All of a person's votes live in a map
keyed by zone id.

```jsonc
{ "v": { "level-7-north-window-seats": { "n": -2, "t": 1758230400000 } } }
```

`n` is the five-point scale, −2 (freezing) to +2 (roasting). `t` is when it was
cast; anything older than two hours is ignored at read time.

Two reasons for this shape:

1. **It's what makes one-vote-per-person enforceable.** The db rules pin each
   viewer to their own document (below), so nobody can write a vote as someone
   else. Per-vote documents couldn't express that.
2. **Document count stays bounded by headcount**, not by activity. The store
   caps at 5,000 documents; a growing vote log would eventually hit it.

Votes are never deleted. They expire by being ignored, which means the history
is intact if you later want week-over-week reporting.

### `plans/<floorSlug>`

Optional uploaded floor plan, one per floor.

```jsonc
{ "assetId": "3f9c…", "w": 2400, "h": 1650 }
```

`w`/`h` are stored so the plate can take the image's aspect ratio *before* the
image loads. Without that, pins drift during load or sit inside letterboxing.

---

## Capabilities

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

**The two db rules are the security model.** The first makes all votes readable
by anyone who can open the board but writable only by editors. The second
carves out an exception: each viewer may write `votes/<their own id>`. Net
effect — everyone can see the tally, nobody can stuff the ballot. Ballot
stuffing is not a hypothetical in an office aircon dispute.

`user` supplies the viewer id used as that document key. `assets` is what allows
floor plan upload; it resolves `null` for non-editors, which is how the upload
button knows to stay hidden.

Note that declaring `db` makes the artifact organisation-internal. It cannot be
shared by public link, which is correct for this.

---

## Degradation

Every capability is resolved with `await claude.use(name)` and may return
`null`. The app is built to survive all of it:

| Missing | Behaviour |
|---|---|
| `db` | Runs local-only. Votes stay in the tab, banner explains why. |
| `user` id | Read-only. Vote buttons disable, banner explains. |
| `assets` | Upload button hidden, built-in sketch plan used. |
| `localStorage` | Wrapped in try/catch; you just lose the remembered spot. |

Write rejections are handled the same way: a `set()` that comes back
`invalid_argument` flips the board to read-only for the rest of the visit
rather than failing loudly.

---

## The split detection

This is the core logic. It lives in `tally()`; the same 3/2/1/2/3 demo data and
the same verdict language are reused in `src/slides.html` so the video
demonstrates the real rule, not an invented one.

```js
var cold = c[0] + c[1];          // freezing + chilly
var hot  = c[3] + c[4];          // warm + roasting
var mean = n ? sum/n : 0;

var split = n >= 4
         && Math.min(cold, hot)/n >= 0.25    // both camps are substantial
         && (cold + hot)/n >= 0.6;           // and most people are unhappy
```

The three conditions, and why each is there:

- `n >= 4` — below four votes, disagreement is noise, not a signal.
- `min(cold,hot)/n >= 0.25` — a single outlier shouldn't trigger it. A quarter
  of the room on the minority side is a real constituency.
- `(cold+hot)/n >= 0.6` — distinguishes *polarised* from *merely mixed*. If most
  people are comfortable and two disagree at the edges, that's not a split zone,
  that's two people with strong opinions.

When `split` is true, three things change: the verdict text refuses to give a
direction, the needle on the dot plot goes dashed (because a mean of a bimodal
distribution is a lie), and the heat map draws the zone as overlapping cold and
warm blobs instead of one blended colour.

**The demo data is tuned to make this vivid.** Eleven votes distributed
3/2/1/2/3 across the scale gives a mean of exactly 0.0 — "about right" — while
only one of eleven people is actually comfortable. That's the argument in one
frame, and it's worth preserving if you change the seed data.

---

## Setpoint proposal and escalation

**Status: specified, not yet implemented in `src/app.html`.** The slide video
and the docs describe this as product behaviour; the code does not do it yet.

This is the fork that follows from split detection. `tally()` already computes
everything it needs.

### Proposal (non-split spots)

```js
var STEP = 0.75;            // °C per scale point
var BAND = [21.0, 25.0];    // never propose outside this

// mean is -2 (freezing) .. +2 (roasting); cold means raise the number
var target = clamp(current - mean * STEP, BAND[0], BAND[1]);
```

Shown only when `n >= 4`, `!split`, and `|target - current| >= 0.5` — below
half a degree nobody perceives the change and the board shouldn't ask for a
truck roll's worth of attention over it.

### Guardrails

These are the product, not polish. Losing any of them makes the tool something a
facilities team would disconnect:

| Guardrail | Why |
|---|---|
| Never propose for a split spot | No single number satisfies both halves. This is the whole thesis. |
| Clamp to `BAND` | A runaway tally must not be able to ask for 16°C. |
| Apply is a human action | Nothing moves unattended, ever. |
| Editor-only | Apply writes the zone document, which existing rules already restrict to editors — verify before relying on it. |
| 30-minute cooldown | Air takes ~20 minutes to settle. Re-proposing before then reads votes cast against the *old* state. |
| Log who and when | `setpointBy` / `setpointAt`. Without an audit trail this is untrustworthy by construction. |

### Zone document additions

```jsonc
{
  "setpoint":    22.0,           // current applied target, °C
  "setpointAt":  1758230400000,
  "setpointBy":  "<viewerId>",
  "escalated":   true,
  "escalatedAt": 1758230400000,
  "diagnosis":   "hot window run sharing a damper with the cold core"
}
```

No new collection and no new db rule — it rides on `zones/<slug>`, which keeps
the write surface where it already is.

### Escalation (the "Needs attention" panel)

A spot lands in the panel when a setpoint demonstrably isn't the answer:

1. **`split` is true** — the direct case. No number satisfies both halves.
2. **Two or more applies in seven days and still uncomfortable** —
   `(cold + hot)/n >= 0.6`. The number keeps moving and the room keeps
   complaining, which means the problem isn't the number.
3. **Pinned at a band edge and still uncomfortable** — the proposal wants to go
   further than `BAND` allows. Capacity or airflow, not setpoint.

Each row carries the diagnosis, how long it has been that way, and the vote
history as evidence. That last part is what makes the panel usable in a budget
conversation rather than just a to-do list: "the north window run shares a
damper with the core, and here are six weeks of votes proving it" is an argument
management can act on. "People keep complaining" is not.

---

## The heat map

Three stacked layers inside `.plate`:

1. **Plan** — a built-in SVG sketch (`assets/floorplan.svg`), or an uploaded
   image if one exists for that floor.
2. **Heat** — absolutely positioned radial-gradient divs, `filter: blur(26px)`,
   `mix-blend-mode: multiply` in light theme and `screen` in dark.
3. **Pins** — knob, flag chip, label. Clickable to select a spot.

The blend mode is the detail that makes it read as a thermal overlay rather than
blobs on a picture: colour washes over the drawing while walls, desks and room
labels stay legible underneath. Plain opacity muddies the linework.

Blob size scales with vote count (confidence), alpha scales with distance from
comfortable (severity). A zone with no recent votes draws as a faint grey blob —
present but explicitly unknown, rather than implied to be fine.

Split zones get two blobs offset ±6% on the x axis, one from each end of the
ramp. The blur blends them into a mottled bruise. That's intentional: there is
no honest single colour for a zone whose occupants disagree, so the map shows
confusion as confusion.

---

## Things deliberately not built

Worth knowing so you don't think they were forgotten:

- **No anonymity claim.** Votes are keyed by viewer id, so an owner with store
  access could correlate. The UI never displays names and never claims
  anonymity. If anonymity is needed for adoption, that's a real design change
  (hash the id with a per-zone salt), not a copy change.
- **No direct BMS write.** Apply records an *intent* on the zone document; it
  does not speak to plant. Whoever integrates decides whether that intent is
  picked up by a BMS connector or read off a screen by a human, and the app is
  correct either way. Sensor data remains a useful second layer, not a
  replacement — the value is the human signal the BMS doesn't have.
- **No autonomous adjustment.** A human applies every setpoint change. See the
  guardrails below.
- **No notifications.** An unsolicited ping about aircon would get the tool
  muted in a week.
- **No historical reporting.** The votes are retained, so it's addable. See
  `docs/AGENT-HANDOFF.md` for where it would go.
