// Slide content for the Thermocracy storyboard presentation.
//
// This file is the single source of truth for both outputs of
// scripts/build-presentation.mjs: the .pptx deck and docs/presentation/STORYBOARD.md.
// Geometry lives in the builder; words live here.
//
// Three rules this content has to hold to, enforced by checks in the builder:
//   1. Nothing technical reaches a slide — no file names, no commands, no
//      architecture. The audience is being shown a product, not a repository.
//   2. Plural voice. This was a team effort; nothing says "I".
//   3. Every claim is traceable to src/app.html. The `source` field records
//      where, and the storyboard collects those into an appendix.
"use strict";

// The demo tally used throughout: 3 freezing, 2 chilly, 1 just nice, 2 warm,
// 3 roasting. Eleven votes, mean exactly 0.0, one comfortable person, and it
// trips every condition of the split rule in src/app.html:522.
export const SPLIT_COUNTS = [3, 2, 1, 2, 3];

// The three people the scenario follows. Each carries a temperature colour
// rather than a face — an invented person shouldn't be given a gendered avatar,
// and the colour ties them to where they sit.
export const CAST = {
  priya: { initial: "P", name: "Priya", role: "Level 7 — north window seats", tone: "warm" },
  daniel: { initial: "D", name: "Daniel", role: "Level 7 — core desks", tone: "cold" },
  marcus: { initial: "M", name: "Marcus", role: "Facilities", tone: "ink" }
};

// Level 7 as the heat map shows it, before and after the fix.
const MAP_BEFORE = [
  { x: 47, y: 14, label: "North window seats", mean: 1.9, n: 6, flag: "HOT" },
  { x: 17, y: 44, label: "Core desks", mean: -1.85, n: 5, flag: "COLD" },
  { x: 15, y: 78, label: "Pantry", mean: 0.15, n: 4 },
  { x: 70, y: 87, label: "South-east desks", none: true, unplaced: true },
  { x: 47, y: 33, label: "Open floor", split: true, n: 11, flag: "SPLIT" }
];

const MAP_AFTER = [
  { x: 47, y: 14, label: "Window run", mean: 0.2, n: 6, flag: "ADJUSTED" },
  { x: 17, y: 44, label: "Core desks", mean: -0.15, n: 5, flag: "ADJUSTED" },
  { x: 15, y: 78, label: "Pantry", mean: 0.15, n: 4 },
  { x: 70, y: 87, label: "South-east desks", none: true, unplaced: true }
];

export const DECK = {
  title: "Thermocracy — is it you, or is it the room?",
  subject: "A shared board for how the office actually feels",
  author: "Thermocracy"
};

export const SLIDES = [
  {
    id: "title",
    section: "Thermocracy",
    theme: "dark",
    layout: "title",
    seconds: 10,
    frame:
      "Dark title card. The product name at display size, the tagline beneath it, and the " +
      "freezing-to-roasting scale running under both, labelled at each end.",
    data: {
      title: "Thermocracy",
      tagline: "Is it you, or is it the room?",
      kicker: "A shared board for how the office actually feels — not what the thermostat is set to."
    },
    onScreen: [
      "Thermocracy",
      "Is it you, or is it the room?",
      "A shared board for how the office actually feels — not what the thermostat is set to.",
      "freezing → roasting"
    ],
    narration:
      "This is Thermocracy. It settles a question every office argues about and nobody can " +
      "actually answer: is it you, or is it the room?",
    source: "src/app.html:376 (logo + tagline), :73 (the scale)"
  },

  {
    id: "what",
    section: "What we built",
    theme: "light",
    layout: "three-cards",
    seconds: 20,
    frame:
      "Light slide. One-sentence answer across the top, then three equal cards — the vote, the " +
      "map, and the refusal to average. Card three is tinted to mark it as the unusual one.",
    data: {
      title: "What we built",
      lead:
        "A board where anyone on a floor taps how it feels where they are sitting — and the building answers back.",
      cards: [
        {
          tick: "1",
          title: "Five buttons",
          body: "Freezing to roasting. Pick your spot, tap once. Two seconds, no ticket, no login."
        },
        {
          tick: "2",
          title: "A live heat map",
          body: "Those votes land on your floor plan as the warm and cold patches they actually are."
        },
        {
          tick: "3",
          title: "A board that won't lie",
          body: "When one spot disagrees with itself, it reports the disagreement instead of averaging it away.",
          accent: true
        }
      ]
    },
    onScreen: [
      "What we built",
      "A board where anyone on a floor taps how it feels where they are sitting — and the building answers back.",
      "1 — Five buttons: freezing to roasting. Pick your spot, tap once. Two seconds, no ticket, no login.",
      "2 — A live heat map: those votes land on your floor plan as the warm and cold patches they actually are.",
      "3 — A board that won't lie: when one spot disagrees with itself, it reports the disagreement instead of averaging it away."
    ],
    narration:
      "We built a board where anyone on a floor picks their spot and taps one of five buttons — " +
      "freezing to roasting. Those votes become a live heat map of the floor, and a board that " +
      "refuses to average away a room that disagrees with itself. Let us show you what that " +
      "looks like on a real afternoon.",
    source: "src/app.html:384 (vote panel), :421 (heat map), :522 (split rule)"
  },

  {
    id: "priya",
    label: "2:40pm — Priya",          // person slides carry no on-slide title
    section: "One Tuesday on Level 7",
    theme: "dark",
    layout: "person",
    seconds: 18,
    frame:
      "Dark slide. A large warm-coloured disc with Priya's initial, their name and desk beside " +
      "it, a timestamp, and their complaint set large as a pull quote. Nothing else on the slide.",
    data: {
      eyebrow: "2:40pm — one Tuesday on Level 7",
      person: "priya",
      time: "2:40pm",
      quote: "“It's roasting by two every afternoon. We've stopped booking the window desks.”"
    },
    onScreen: [
      "2:40pm — one Tuesday on Level 7",
      "Priya — Level 7, north window seats",
      "“It's roasting by two every afternoon. We've stopped booking the window desks.”"
    ],
    narration:
      "So. One Tuesday, Level 7. At twenty to three, Priya is at the north window seats, and has " +
      "been quietly writing off half a row of desks every afternoon since the weather turned.",
    source: "Scenario framing. The app's answer to it begins at src/app.html:522"
  },

  {
    id: "daniel",
    label: "2:41pm — Daniel",
    section: "One Tuesday on Level 7",
    theme: "dark",
    layout: "person",
    seconds: 20,
    frame:
      "Same layout as the previous slide, cold disc this time, so the two read as a pair. The " +
      "setpoint fact lands underneath as a single line: one number is serving both of them.",
    data: {
      eyebrow: "2:41pm — forty metres away",
      person: "daniel",
      time: "2:41pm",
      quote: "“I keep a blanket under my desk. In July.”",
      footer: "Same floor. Same minute. One setpoint, serving both of them.",
      setpoint: "22.0°C"
    },
    onScreen: [
      "2:41pm — forty metres away",
      "Daniel — Level 7, core desks",
      "“I keep a blanket under my desk. In July.”",
      "22.0°C — the whole floor",
      "Same floor. Same minute. One setpoint, serving both of them."
    ],
    narration:
      "Forty metres away, at the core desks, Daniel keeps a blanket under the desk. In July. " +
      "Same floor, same minute, one setpoint — twenty-two degrees — serving both of them. Move " +
      "that number in either direction and you simply choose which of these two people to upset.",
    source: "Scenario framing; the fork it sets up is src/app.html:522"
  },

  {
    id: "why",
    section: "Why we built it",
    theme: "light",
    layout: "rows",
    seconds: 22,
    frame:
      "Light slide, the one step out of the story. Three stacked rows, each a coloured disc, a " +
      "bold role, and what that person is missing today.",
    data: {
      title: "Why we built it",
      lead: "This happens on every floor, every summer, and nobody in the chain can fix it alone.",
      rows: [
        {
          tick: "1",
          title: "The person sitting there",
          body: "Has no way to report comfort that isn't an awkward email about their own cardigan."
        },
        {
          tick: "2",
          title: "Facilities",
          body: "Get opinions one at a time, with no idea how many people agree, or whether it is still true an hour later."
        },
        {
          tick: "3",
          title: "Whoever signs off the fix",
          body: "Never sees evidence that the fault is physical, so the duct is never funded — someone just nudges the setpoint again."
        }
      ]
    },
    onScreen: [
      "Why we built it",
      "This happens on every floor, every summer, and nobody in the chain can fix it alone.",
      "1 — The person sitting there: has no way to report comfort that isn't an awkward email about their own cardigan.",
      "2 — Facilities: get opinions one at a time, with no idea how many people agree, or whether it is still true an hour later.",
      "3 — Whoever signs off the fix: never sees evidence that the fault is physical, so the duct is never funded."
    ],
    narration:
      "And this is why we built it. Three people lose here. The person sitting there has no way " +
      "to report comfort that isn't an awkward email. Facilities get opinions one at a time, " +
      "with no idea how many people agree. And whoever signs off the repair never sees evidence " +
      "that the fault is physical — so the duct never gets fixed, and someone just nudges the " +
      "setpoint again. Back to Tuesday.",
    source: "src/app.html:467 (“how it feels now, not this morning”), :956 (the diagnosis text)"
  },

  {
    id: "vote",
    section: "One Tuesday on Level 7",
    theme: "light",
    layout: "vote",
    seconds: 20,
    frame:
      "Light slide, two columns. Left: the vote panel at close to actual size — Priya's spot in " +
      "the picker, the five buttons with Roasting pressed, and the line the board says back. " +
      "Right: the three rules that govern a vote.",
    data: {
      title: "So Priya taps",
      eyebrow: "2:42pm",
      spot: "Level 7 — North window seats",
      pressed: 4,
      castline: "You said roasting, just now. Tap again to change it.",
      points: [
        "Five points, freezing to roasting — enough range to be useful, few enough to tap without thinking.",
        "One vote per person, per spot. Change it any time the room changes its mind.",
        "After two hours it expires on its own, so the board is always how the floor feels now."
      ]
    },
    onScreen: [
      "So Priya taps — 2:42pm",
      "I'm at: Level 7 — North window seats",
      "Freezing · Chilly · Just nice · Warm · Roasting",
      "You said roasting, just now. Tap again to change it.",
      "Five points, freezing to roasting · One vote per person, per spot · After two hours it expires on its own"
    ],
    narration:
      "So Priya taps. Pick the spot — it is remembered next time — and hit one of five buttons. " +
      "Two seconds, no ticket, no login. One vote per person per spot, changeable whenever the " +
      "room changes its mind, and after two hours it expires on its own. Daniel taps too. So do " +
      "nine other people on that floor.",
    source: "src/app.html:476 SCALE, :388 picker, :926 castline, :483 two-hour expiry, :860 cast()"
  },

  {
    id: "average",
    section: "One Tuesday on Level 7",
    theme: "dark",
    layout: "bigstat",
    seconds: 28,
    frame:
      "Dark slide, the hinge of the whole deck. Left: two large stat callouts — the mean, and " +
      "how many people are actually comfortable. Right: eleven votes as dots, needle dead centre, " +
      "with the verdict an average would reach.",
    data: {
      title: "Eleven votes. One average.",
      eyebrow: "2:55pm",
      stats: [
        { value: "0.0", label: "mean of 11 votes", sub: "which any average reports as “about right”" },
        { value: "1 of 11", label: "people actually comfortable", sub: "the other ten are at the ends of the scale" }
      ],
      counts: SPLIT_COUNTS,
      verdict: "About right",
      verdictSub: "what an average concludes — and what this board refuses to print",
      caption:
        "Three freezing, three roasting, one comfortable. Every survey, sensor and thermostat in the building calls this floor fine."
    },
    onScreen: [
      "Eleven votes. One average. — 2:55pm",
      "0.0 — mean of 11 votes, which any average reports as “about right”",
      "1 of 11 — people actually comfortable; the other ten are at the ends of the scale",
      "About right — what an average concludes, and what this board refuses to print",
      "Three freezing, three roasting, one comfortable. Every survey, sensor and thermostat in the building calls this floor fine."
    ],
    narration:
      "Eleven votes are in. Three freezing, three roasting, one person comfortable. And the " +
      "average lands on exactly zero — about right. Every survey, every sensor, every thermostat " +
      "in that building would report Level 7 as fine. Ten of those eleven people are not fine. " +
      "This is the moment a normal tool gets it wrong.",
    source: "src/app.html:510 tally() — 3/2/1/2/3 averages to exactly 0.0"
  },

  {
    id: "split",
    section: "One Tuesday on Level 7",
    theme: "light",
    layout: "split",
    seconds: 32,
    frame:
      "Light slide, the centrepiece. Left: the three conditions in a tinted card, each with the " +
      "reason it exists, and beneath them the verdict the board actually prints, with its Split " +
      "chip. Right: the six things that change the moment it fires, and the explanation the board " +
      "gives the floor.",
    data: {
      title: "The board refuses to say that",
      eyebrow: "2:55pm — the part we are proudest of",
      verdict: "The room can't agree",
      counts: SPLIT_COUNTS,
      conditions: [
        { rule: "At least 4 votes", why: "below that, disagreement is noise rather than signal" },
        { rule: "At least a quarter on each side", why: "one outlier in a cardigan is not a constituency" },
        { rule: "At least 60% uncomfortable", why: "separates a polarised room from a merely mixed one" }
      ],
      effects: [
        "The verdict refuses to pick a direction.",
        "A “Split” chip appears next to it.",
        "The needle goes dashed — the mean of two camps is a lie.",
        "The map draws that spot in two colours at once.",
        "It explains the likely cause in plain words.",
        "It offers to create the narrower spot for you."
      ],
      quote:
        "“That usually means this spot is really two spots — a window run and a shaded core, or one vent " +
        "doing all the work. Turning the thermostat will just move the complaint to the other group.”"
    },
    onScreen: [
      "The board refuses to say that",
      "At least 4 votes — below that, disagreement is noise rather than signal",
      "At least a quarter on each side — one outlier in a cardigan is not a constituency",
      "At least 60% uncomfortable — separates a polarised room from a merely mixed one",
      "The room can't agree  [Split]  — instead of a direction it cannot honestly give",
      "5 cold · 1 comfortable · 5 warm",
      "The verdict refuses to pick a direction · A “Split” chip appears · The needle goes dashed · The map draws it in two colours at once · It explains the likely cause · It offers to create the narrower spot",
      "“That usually means this spot is really two spots — a window run and a shaded core, or one vent doing all the work. Turning the thermostat will just move the complaint to the other group.”"
    ],
    narration:
      "Because when at least four people have voted, at least a quarter fall on each side, and " +
      "most of the room is uncomfortable, the board declares that spot split — and then refuses " +
      "to summarise it. The verdict won't pick a direction. The needle goes dashed, because the " +
      "average of two camps is a lie. And it tells Priya and Daniel what it actually means: this " +
      "is not a temperature problem. This is one spot pretending to be two, and turning the " +
      "thermostat would just move the complaint to the other group. This is the part we are " +
      "proudest of.",
    source: "src/app.html:522 the rule, :528 verdict text, :943 chip, :160 dashed needle, :956 the hint"
  },

  {
    id: "heatmap",
    section: "One Tuesday on Level 7",
    theme: "light",
    layout: "heatmap",
    seconds: 26,
    frame:
      "Light slide. Level 7's floor plan with the afternoon on it — a hot patch at the windows, " +
      "a cold one at the core, and the open floor rendered as overlapping cold and warm blobs. " +
      "Right column: the four rules for reading it.",
    data: {
      title: "And on the floor plan, two colours at once",
      eyebrow: "2:56pm",
      pins: MAP_BEFORE,
      note: "2 spots need a look. Dotted pins haven't been placed on the plan yet.",
      reading: [
        { k: "Size", v: "how many people voted — a big patch is a confident one." },
        { k: "Intensity", v: "how far from comfortable they are." },
        { k: "Grey", v: "nobody has voted there. Unknown, not fine." },
        { k: "Mottled", v: "the spot is arguing with itself — two colours, no blend." }
      ]
    },
    onScreen: [
      "And on the floor plan, two colours at once — 2:56pm",
      "Blue is cold, red is warm, mottled means the spot is arguing with itself.",
      "Size — how many people voted; a big patch is a confident one.",
      "Intensity — how far from comfortable they are.",
      "Grey — nobody has voted there. Unknown, not fine.",
      "Mottled — the spot is arguing with itself; two colours, no blend.",
      "2 spots need a look. Dotted pins haven't been placed on the plan yet."
    ],
    narration:
      "All of it lands on Level 7's actual floor plan. The size of a patch is how many people " +
      "voted — confidence. The intensity is how far from comfortable they are — severity. Grey " +
      "means nobody has voted there: unknown, not fine. And the open floor is drawn in two " +
      "colours at once, because there is no honest single colour for a place whose occupants " +
      "disagree.",
    source: "src/app.html:733 renderHeat(), :758-772 blob sizing, :423 the legend copy, :798 the note"
  },

  {
    id: "triage",
    section: "One Tuesday on Level 7",
    theme: "light",
    layout: "triage",
    seconds: 24,
    frame:
      "Light slide. Left: the ranked list, split spot pinned at the top, each row with its " +
      "verdict, turnout and a miniature dot strip. Right: how the order is decided, then the " +
      "status control Marcus uses and the badge it puts on the map.",
    data: {
      title: "It reaches Marcus first",
      eyebrow: "3:05pm",
      rows: [
        { floor: "Level 7", name: "Open floor", meta: "The room can't agree · 11 votes · 2 min ago", counts: SPLIT_COUNTS, flag: "SPLIT" },
        { floor: "Level 7", name: "North window seats", meta: "Too warm · 6 votes · 8 min ago", counts: [0, 0, 1, 2, 3] },
        { floor: "Level 7", name: "Pantry", meta: "About right · 4 votes · 21 min ago", counts: [0, 1, 2, 1, 0] },
        { floor: "B1", name: "Canteen", meta: "Quiet — no votes in the last two hours", counts: [0, 0, 0, 0, 0] }
      ],
      explain: [
        { k: "Split spots first", v: "no setpoint can help them, so they never sit below a merely warm room." },
        { k: "Then severity × turnout", v: "how far off it is, and how many people said so." },
        { k: "Quiet spots sink", v: "no votes in two hours means no claim on anyone's attention." }
      ],
      status: {
        label: "Facilities status",
        options: ["Nothing logged", "Someone's looking at it", "Recently adjusted"],
        badges: ["ON IT", "ADJUSTED"],
        body: "The badge shows up on the map, so the floor can see something is happening."
      }
    },
    onScreen: [
      "It reaches Marcus first — 3:05pm",
      "Level 7 — Open floor · The room can't agree · 11 votes [SPLIT]",
      "Level 7 — North window seats · Too warm · 6 votes",
      "Level 7 — Pantry · About right · 4 votes",
      "B1 — Canteen · Quiet, no votes in the last two hours",
      "Split spots first · then severity × turnout · quiet spots sink",
      "Facilities status: Nothing logged / Someone's looking at it / Recently adjusted → ON IT, ADJUSTED"
    ],
    narration:
      "Marcus, in facilities, opens the board to every spot in the building ranked by what needs " +
      "looking at. Split spots first, because no setpoint will help them. Then how far off it is " +
      "and how many people said so. Quiet spots sink. Marcus marks Level 7 as someone's looking " +
      "at it — and that badge appears on the map, so the floor can see something is happening " +
      "and stops filing the same ticket.",
    source: "src/app.html:536 urgency(), :980 the list, :409 status control, :776 the badges"
  },

  {
    id: "diagnosis",
    section: "One Tuesday on Level 7",
    theme: "light",
    layout: "grid",
    seconds: 22,
    cuttable: true,
    frame:
      "Light slide, two-by-two. The diagnosis Marcus reaches, and the three things the board " +
      "lets them do about it. The last card is tinted — it is the board proposing the fix.",
    data: {
      title: "One damper, two rooms",
      eyebrow: "3:20pm",
      cells: [
        {
          title: "What Marcus finds",
          body: "The window run and the shaded core share a single damper. One number was always going to fail one of them."
        },
        {
          title: "Split the spot in two",
          body: "The board offers it directly from the warning, because the fix is usually a narrower spot.",
          accent: true
        },
        {
          title: "Put them where they really are",
          body: "Drop each new spot onto the plan. Swap the plan for a better one later and the pins stay put."
        },
        {
          title: "Every floor, its own plan",
          body: "A tab appears per floor on its own, and facilities can upload the real plan for each one."
        }
      ]
    },
    onScreen: [
      "One damper, two rooms — 3:20pm",
      "What Marcus finds — the window run and the shaded core share a single damper.",
      "Split the spot in two — the board offers it directly from the warning.",
      "Put them where they really are — drop each spot onto the plan; swap the plan later and the pins stay put.",
      "Every floor, its own plan — a tab appears per floor, and facilities can upload the real plan."
    ],
    narration:
      "And the diagnosis is exactly what the board suggested. The window run and the shaded core " +
      "share one damper — one number was always going to fail one of them. So Marcus splits the " +
      "spot in two, straight from the warning, and drops each new spot where it really sits on " +
      "the plan.",
    source: "src/app.html:959 the prefill, :806 placing, :881 addSpot(), :717 floor tabs, :677 plan upload"
  },

  {
    id: "resolved",
    section: "One Tuesday on Level 7",
    theme: "light",
    layout: "heatmap",
    seconds: 22,
    frame:
      "The same floor plan as three slides ago, now calm: two separate spots where the split was, " +
      "both green, both badged ADJUSTED. Right column is short — the story is the picture.",
    data: {
      title: "4:10pm",
      eyebrow: "Ninety minutes later",
      pins: MAP_AFTER,
      lead: "The same floor plan. Nothing on it is arguing with itself any more.",
      note: "Nothing on this floor is far off.",
      reading: [
        { k: "One damper", v: "rebalanced — the only physical work anyone did." },
        { k: "Two spots", v: "where there used to be one that could never be right." },
        { k: "Both settled", v: "and both still being voted on, so it stays honest." }
      ],
      closing: "Priya and Daniel never spoke to each other. They just both tapped a button."
    },
    onScreen: [
      "4:10pm — ninety minutes later",
      "The same floor plan. Nothing on it is arguing with itself any more.",
      "One damper — rebalanced; the only physical work anyone did.",
      "Two spots — where there used to be one that could never be right.",
      "Both settled — and both still being voted on, so it stays honest.",
      "Priya and Daniel never spoke to each other. They just both tapped a button."
    ],
    narration:
      "Ninety minutes later. One damper rebalanced — the only physical work anybody did. Two " +
      "spots where there used to be one that could never be right, both settled, and both still " +
      "being voted on, so it stays honest. Priya and Daniel never spoke to each other. They both " +
      "just tapped a button.",
    source: "src/app.html:733 renderHeat(), :776 the ADJUSTED badge, :483 votes keep expiring"
  },

  {
    id: "recap",
    section: "What you just saw",
    theme: "light",
    layout: "checklist",
    seconds: 22,
    cuttable: true,
    frame:
      "Light slide, two columns of ticked items. Every feature the story used, named plainly, " +
      "with the beat it did its work in. The one slide an evaluator can check off against.",
    data: {
      title: "What you just saw",
      lead: "Seven features, and not one of them needed explaining to Priya, Daniel or Marcus.",
      items: [
        { k: "The five-point vote", v: "one tap, one vote per person, expires after two hours" },
        { k: "The spot picker", v: "remembers where you sit, so the next vote is one tap" },
        { k: "The dot plot", v: "every vote is a dot, so you see the shape, not a score" },
        { k: "Split detection", v: "the refusal to average a room that disagrees with itself" },
        { k: "The heat map", v: "your floor plan, with turnout as size and severity as colour" },
        { k: "The ranked list", v: "what needs a look, worst first, quiet spots last" },
        { k: "Facilities status", v: "ON IT and ADJUSTED, visible to the whole floor" }
      ]
    },
    onScreen: [
      "What you just saw",
      "Seven features, and not one of them needed explaining to Priya, Daniel or Marcus.",
      "The five-point vote — one tap, one vote per person, expires after two hours",
      "The spot picker — remembers where you sit",
      "The dot plot — every vote is a dot, so you see the shape, not a score",
      "Split detection — the refusal to average a room that disagrees with itself",
      "The heat map — your floor plan, turnout as size, severity as colour",
      "The ranked list — what needs a look, worst first",
      "Facilities status — ON IT and ADJUSTED, visible to the whole floor"
    ],
    narration:
      "That was seven features, and not one of them had to be explained to Priya, Daniel or " +
      "Marcus. The vote, the spot picker, the dot plot, split detection, the heat map, the " +
      "ranked list, and the status everyone on the floor can see.",
    source: "Recaps the features of the slides above; each has its own row in this table"
  },

  {
    id: "different",
    section: "What makes it different",
    theme: "dark",
    layout: "three-cards",
    seconds: 28,
    frame:
      "Dark slide. Three cards, each a claim with its supporting sentence, the first tinted " +
      "because it is the one nothing else does. One line underneath separates it from a sensor.",
    data: {
      title: "What makes it different",
      cards: [
        {
          tick: "01",
          title: "It refuses to average a split room",
          body: "Every polling tool reports a mean. This one detects when a mean would be a lie, and reports the disagreement instead.",
          accent: true
        },
        {
          tick: "02",
          title: "It shows shape, not score",
          body: "Dots, not a number. Three freezing and three roasting cannot hide behind a 0.0."
        },
        {
          tick: "03",
          title: "It expires",
          body: "Two hours and a vote is gone. The board is how the floor feels now — never a survey from March."
        }
      ],
      footer: "A sensor measures the air. This measures the people in it — and they are the ones filing the tickets."
    },
    onScreen: [
      "What makes it different",
      "01 It refuses to average a split room — every polling tool reports a mean; this one detects when a mean would be a lie.",
      "02 It shows shape, not score — dots, not a number. Three freezing and three roasting cannot hide behind a 0.0.",
      "03 It expires — two hours and a vote is gone. The board is how the floor feels now.",
      "A sensor measures the air. This measures the people in it — and they are the ones filing the tickets."
    ],
    narration:
      "Three things separate this from a survey or a sensor. One: it refuses to average a split " +
      "room — it detects when a mean would be a lie and reports the disagreement instead. Two: " +
      "it shows the shape of opinion rather than a score, so three freezing and three roasting " +
      "can't hide behind a zero. Three: it expires, so this is always a picture of now. A sensor " +
      "measures the air. This measures the people in it, and they are the ones filing the tickets.",
    source: "src/app.html:522 split, :553 dot plot, :483 expiry"
  },

  {
    id: "close",
    section: "Thermocracy",
    theme: "dark",
    layout: "title",
    seconds: 10,
    frame:
      "Dark close, mirroring the title card. The name, the question it opened with, the answer, " +
      "and the scenario's result as the last line on screen.",
    data: {
      title: "Thermocracy",
      tagline: "Is it you, or is it the room?",
      kicker: "Now the floor can answer.",
      note: "Level 7 settled its own argument in ninety minutes."
    },
    onScreen: [
      "Thermocracy",
      "Is it you, or is it the room?",
      "Now the floor can answer.",
      "Level 7 settled its own argument in ninety minutes."
    ],
    narration:
      "Thermocracy. Is it you, or is it the room? Now the floor can answer. Thank you.",
    source: "src/app.html:377 the tagline"
  }
];
