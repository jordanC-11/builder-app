# Thermocracy

**Is it you, or is it the room?**

A shared board for how the office actually feels — not what the thermostat is
set to. People tap one of five buttons for where they're sitting; the board
shows the result on the floor plan as a heat map.

What makes it different: when half a zone says freezing and half says roasting,
Thermocracy **refuses to average them**. It reports the disagreement instead of
a comfortable-sounding mean, because no single setpoint can satisfy both halves
— the fault is the zone boundary, not the number.

## Run it

Open `src/app.html` in a browser. No build, no install, no server — it starts in
local-only mode with an empty board, and you add a spot to begin.

## The deck and the video

`src/slides.html` is a 15-slide presentation of the same story; open it and hit
**Present**. `npm run build-video` narrates it with a local Kokoro voice and
renders `build/thermocracy.mp4`.

## More

**[CLAUDE.md](CLAUDE.md)** — how the app works, the split-detection rule, the
data model, and how to generate the slides, the voiceover and the video.
