# BeatPress 🌌

**A free, browser-based one-button rhythm game inspired by [A Dance of Fire and Ice](https://store.steampowered.com/app/977950/A_Dance_of_Fire_and_Ice/) (ADOFAI).**

BeatPress is an open, no-cost, install-free take on the "press in time with the beat" rhythm genre. Two smokey jungle-green planets orbit each other along a winding tile track, and every key press locks the moving planet onto the next tile in time with the music. Thirteen handcrafted levels climb from a relaxed ~2 clicks-per-second groove all the way to a ~22 CPS black-hole dive that demands three-finger mashing.

If you enjoy ADOFAI-style precision rhythm but want something free, open-source, and playable straight from a browser, BeatPress is built for you.

> ⚠️ **Not affiliated with 7th Beat Games.** *A Dance of Fire and Ice* is a trademark of its respective owners. BeatPress is an independent, fan-made homage — it shares no code, music, art, or assets with ADOFAI. It is simply *inspired by* the genre ADOFAI helped popularize.

---

## ▶️ Play Now (no install)

**Live version:** **https://beatpress.vercel.app**

Just open the link and play — nothing to download.

> ⚠️ **Heads-up on the live link:** The hosted version uses a **free-tier Supabase** backend for the global leaderboard. Free-tier projects have limited capacity and are paused automatically after inactivity, so the leaderboard (or occasionally the whole page) **may be slow or temporarily unavailable if the backend is clogged up or asleep**. If the live link misbehaves, run it locally using the steps below — the game itself works fully offline; only the online leaderboard depends on Supabase.

---

## 🤖 A Note on How This Was Built

**BeatPress was built with the help of AI.** The code, level choreography, visuals, and this documentation were generated and assembled with AI assistance. As a result, **some mistakes, bugs, or rough edges may be present.** It is shared in good faith as a free, hackable project — not as commercial-grade software. Contributions, bug reports, and fixes are very welcome (see [Contributing](#-contributing)).

---

## 🚀 Quick Start (run it locally)

You only need [Node.js](https://nodejs.org) (any recent LTS) to run a tiny static file server. The game itself is plain ES-module JavaScript + Canvas 2D — **no build step, no framework, no dependencies to install.**

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/BeatPress.git

# 2. Enter the folder
cd BeatPress

# 3. Start the local server (any free port; 4174 shown here)
node scripts/serve.mjs 4174
```

Then open **http://127.0.0.1:4174** in any modern browser (Chrome, Edge, or Firefox). That's it.

> Prefer not to install Node? Any static file server works — e.g. `python -m http.server 4174` — since BeatPress is just static files.

---

## 🎮 How to Play

1. On the level-select screen, click a level card (or use the arrow keys + Enter).
2. Wait for the level to load, then press **any key** to start.
3. Every non-repeat keyboard press is a rhythm input — land it as the moving planet lines up with the next tile.
4. On the high-speed "spam" levels, mash **three or more keys** — early presses on spam tiles are absorbed, not punished. Rolling your fingers across `A S D` (or any keys) is the intended technique.

On-screen buttons handle pause, retry, debug, and level select, so the whole keyboard stays free for rhythm input.

---

## ✨ Features

BeatPress ships with a full set of accessibility and play-style options so players of every skill level can enjoy it.

### 🛡️ No-Death & On-Miss Modes
Not every player wants a single mistake to end a two-and-a-half-minute run. The **On Miss** setting lets you choose exactly what happens when you miss a tile:

- **Allowed-miss safety (No-Death-friendly)** — misses are absorbed by your safety pool instead of ending the run, so you can play the whole level through and enjoy the ride.
- **Restart at checkpoint** — respawn at the last checkpoint and keep going.
- **Restart from beginning** — the run resets to the start of the level.
- **End run** — classic hardcore: one fatal miss and the run is over.

Combine the safety mode with generous allowed misses for a true **no-pressure, no-death experience**.

### 🎯 Allowed Deaths / Allowed Misses
Directly tune your difficulty with the **Allowed Misses** control (**0 / 1 / 2**). This sets how many misses are absorbed before an orbit crash. Set it to 2 for a forgiving learning run, or 0 for a strict, every-tile-counts challenge.

### 🕹️ Free Play Mode
The gold **FreePlay** button on the in-game HUD pauses your run and opens the **full level map**. Hover any tile to see its timestamp, then click any tile to **spawn and start playing from that exact point**. Perfect for practicing a hard section, exploring a level's choreography, or just messing around without grinding from the start every time.

### 🏆 Global Leaderboard (online)
Completed runs on the hosted version submit your accuracy and grade to a **global leaderboard** (powered by Supabase), and the results screen shows the top scores for that level. *(See the free-tier disclaimer above — the leaderboard depends on the online backend.)*

### 🌠 More Features
- **A unique visual world per level** — every stage has its own dedicated scene renderer (black holes, volcanoes, warp tunnels, gardens, storm clouds...) and a themed sky-event menu. No two levels share a sky.
- **Third-Planet power-up** — green star tiles summon a temporary third planet that shields one miss for 9 seconds.
- **Timing calibration (Offset)** — nudge input judging earlier/later in milliseconds to match your display/audio latency. Saved to local storage.
- **Reduce camera movement** — calms zooms/rolls and dims heavy visuals for comfort or accessibility.
- **Checkpoints & beat-timed count-in** — every start and respawn begins with a synced 1..2..3.
- **Debug Overlay** — live audio time, next node, timing delta, section, and power-up state.
- **Shatter effects & camera choreography** — tiles shatter into shards as you pass; per-level camera cues (zooms, rolls, twists) are baked into the beatmaps.

---

## 🗺️ Levels

Thirteen handcrafted 2:30 routes, each with its own music set, path choreography, and a unique visual world:

| # | Level | Difficulty | Peak speed | World |
| --- | --- | --- | --- | --- |
| 1 | Neon Drift | Medium | ~3 CPS | Ringed gas giant, moons, asteroid belt |
| 2 | Nebula Run | Advanced | ~5 CPS | Thunderheads, forked lightning, rain |
| 3 | Crystal Orbit | Hard | ~7 CPS | Floating faceted crystals, refraction beams |
| 4 | Solar Flare | Expert | ~8 CPS | A sun cresting the horizon, prominence loops |
| 5 | Void Walker | Extreme | ~9.5 CPS | Black hole with glitch tears |
| 6 | Bloom Garden | Scenic | ~8 CPS | Rotating mandala flower, falling petals, vines |
| 7 | Helix Tower | Scenic+ | ~9.5 CPS | Climbing DNA rails and tower rings |
| 8 | Hyper Bloom | Ultra Spam | ~14.7 CPS | Meteor shower + firework mandalas |
| 9 | Comet Coil | Ultra Spam | ~16.4 CPS | Living circuit board with data pulses |
| 10 | Star Cascade | Ultra Spam | ~17.9 CPS | Prisms splitting light into rainbow fans |
| 11 | Inferno Core | Mega Spam | ~18.5 CPS | Lava sea, lava falls, rising embers |
| 12 | Warp Tunnel | Giga Spam | ~20.4 CPS | Full-screen 3D hyperspace tube |
| 13 | Singularity | Omega Spam | ~22.2 CPS | Accretion disk around an event horizon |

Paths are built from ADOFAI-style geometric patterns — straights, staircases, zigzags, square waves, spirals, hex loops, switchbacks, flowers, coils, vines, sunbursts, orbit rings, and helixes.

---

## ⏱️ Timing Windows

| Judgement | Window |
| --- | --- |
| Perfect | ±90 ms |
| Good | ±170 ms |
| Miss | ±270 ms |

Spam-flagged tiles judge leniently on early presses so high-CPS mashing flows instead of instantly crashing.

---

## 🛠️ Project Structure

```
index.html              Entry page (all views + HUD)
src/
  Game.js               Core loop, input judging, state machine
  Leaderboard.js        Supabase client for the global leaderboard
  PathRenderer.js       Track tiles, base sky gradient, full-map view
  VisualDirector.js     Per-level background scenes + scheduled sky events
  PlayerOrbitController.js  The two planets, orbit math, smoke aura
  CameraController.js   Cue-driven zoom/roll/twist
  EffectsSystem.js      Hit rings, trails, shards
  AudioManager.js       Music segment scheduling per level
  TimingEngine.js       Hit windows and judgement
  config.js             Level list & default settings
beatmaps/dist/          Generated level data (level1..13 JSON)
scripts/
  serve.mjs             Zero-dependency static server
  build-levels.mjs      Offline level generator
  audit-beatmaps.mjs    Validates every generated beatmap
```

---

## 🔧 Modding & Level Editing

Rebuild all thirteen levels offline (no browser needed):

```bash
node scripts/build-levels.mjs
node scripts/audit-beatmaps.mjs   # sanity-check the output
```

To hand-tune a level, open its JSON in `beatmaps/dist/` and edit node timing, angles, power-ups, camera cues, and visual events. To add a whole new level, append an entry to `LEVELS` in `scripts/build-levels.mjs`, rebuild, then register it in `src/config.js`.

---

## 🤝 Contributing

Issues and PRs are welcome — new level choreographies, new background scenes, bug fixes, and performance tweaks are all great contributions. Because this project was AI-assisted, fixes for any bugs you find are especially appreciated. Please run `node scripts/audit-beatmaps.mjs` before opening a PR that touches level generation.

---

## 📜 Credits & License

All code, level design, and visuals are original and AI-assisted. The bundled music tracks are original compositions created for this project. *A Dance of Fire and Ice* is a trademark of 7th Beat Games — BeatPress is an unaffiliated, fan-made homage inspired by the genre, and copies none of its assets.

Released as a free, open project. Play it, fork it, learn from it, improve it.
