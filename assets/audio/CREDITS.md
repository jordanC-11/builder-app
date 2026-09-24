# Soundtrack credit

`soundtrack.mp3` is **"Kings Trailer"**, from the [FreePD](https://freepd.com/) library
(mirrored at [github.com/0lhi/FreePD](https://github.com/0lhi/FreePD), `Epic/` folder — the
FreePD site itself closed in 2025 after 17 years; the GitHub mirror is the surviving source).

- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — public
  domain. Free for any purpose, commercial included, no attribution required.
- Source: https://github.com/0lhi/FreePD/blob/stream/Epic/Kings%20Trailer.mp3
- Why this one: it has a genuine dynamic build rather than a static loop — measured mean
  loudness rises steadily from about −15.4 dB at the start to about −14.1 dB by the two-minute
  mark (`ffmpeg -af volumedetect` over consecutive slices) — and at ~2:43 it's longer than the
  finished video, so the build plays through once, start to reveal, without ever looping back to
  its quiet opening. Its trailer-grade drama is also the joke: this is a thermostat-voting app
  scored like a blockbuster, on purpose (see video.md's parody direction).

To swap the soundtrack, replace `soundtrack.mp3` with another track (any format ffmpeg reads)
and update this file. See `docs/VIDEO-GUIDE.md` for how the build pipeline loops/fades/ducks it
under the video.
