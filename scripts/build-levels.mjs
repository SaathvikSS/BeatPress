// Offline pattern-based level builder.
//
// Generates the thirteen BeatStar levels with ADOFAI-style geometric path
// patterns (straights, stairs, zigzags, square waves, spirals, switchbacks,
// flowers, coiling staircases, sunbursts, orbit rings) and a per-section
// click-density choreography from slow half-time sections (~1 press/sec) up
// to ultra-spam sprints (~17 CPS on levels 8-10, ~18-22 CPS on levels 11-13).
//
// All levels run 1.5x faster than the v2 build (subdivisions >= 1 are scaled
// by SPEED_MULT); slow half-time blocks keep their original pace.
//
// Beat timing is derived from the per-track audio analysis (BPM, beat interval,
// first-beat phase) captured in the original browser-based generator run, so
// every node stays locked to the actual music. No browser is required.
//
// Usage: node scripts/build-levels.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const GENERATOR_VERSION = "4.0";
const SEGMENT_SECONDS = 30;
const LEVEL_SECONDS = 150;
const SPEED_MULT = 1.5; // global density boost for on-beat and faster blocks
const DEFAULT_MIN_INTERVAL = 0.105; // ~9.5 clicks/sec ceiling on levels 1-7
const SPAM_INTERVAL = 0.165; // nodes at/below this are spam-flagged (lenient early input)

const root = resolve(process.cwd());
const distDir = join(root, "beatmaps", "dist");

// ---------------------------------------------------------------------------
// Per-track beat metadata comes from scripts/analyze-tracks.mjs, which runs the
// real audio through the Web Audio API to detect tempo, beat phase, and note
// onsets. It is stored in beatmaps/track-meta.json (all songs). Falls back to
// harvesting the older dist beatmaps if that file is missing.
// ---------------------------------------------------------------------------

const trackMetaPath = join(root, "beatmaps", "track-meta.json");

function harvestTrackMeta() {
  const meta = new Map();
  try {
    const parsed = JSON.parse(readFileSync(trackMetaPath, "utf8"));
    for (const [file, m] of Object.entries(parsed)) {
      if (!Number.isFinite(m.beatInterval)) continue;
      meta.set(file, {
        file,
        detectedBpm: m.detectedBpm,
        beatInterval: m.beatInterval,
        firstBeatPhase: m.firstBeatPhase,
        onsetCount: m.onsetCount || (m.onsets ? m.onsets.length : 0),
        onsets: Array.isArray(m.onsets) ? m.onsets : [],
      });
    }
    if (meta.size) return meta;
  } catch {
    // Fall back to the legacy harvest below.
  }
  for (const file of ["level1.beatstar.json", "level2.beatstar.json", "level3.beatstar.json"]) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(distDir, file), "utf8"));
    } catch {
      continue;
    }
    for (const segment of parsed.audio?.segments || []) {
      if (!meta.has(segment.file) && Number.isFinite(segment.beatInterval)) {
        meta.set(segment.file, {
          file: segment.file,
          detectedBpm: segment.detectedBpm,
          beatInterval: segment.beatInterval,
          firstBeatPhase: segment.firstBeatPhase,
          onsetCount: segment.onsetCount || 0,
          onsets: [],
        });
      }
    }
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG so rebuilds are reproducible.
// ---------------------------------------------------------------------------

function hashSeed(text) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Path patterns. Each returns the turn (degrees, relative) for step index i.
// ---------------------------------------------------------------------------

const PATTERNS = {
  straight: () => 0,
  stairs: (i) => (i % 2 === 0 ? 90 : -90),
  zigzag: (i) => (i % 2 === 0 ? 60 : -60),
  squareWave: (i) => [90, -90, -90, 90][i % 4],
  lTurns: (i) => [0, 0, 90, 0, 0, -90][i % 6],
  wave: (i) => [30, 30, -30, -30, -30, -30, 30, 30][i % 8],
  spiral: () => 45,
  hexLoop: () => 60,
  switchback: (i) => (i % 2 === 0 ? 150 : -150),
  // Aesthetic patterns: rosette petals (7x45 loop + reverse kick lands the
  // next petal 120 degrees around), coiling staircases, vines, sunburst rays,
  // full orbit rings, and S-arc helixes.
  flower: (i) => (i % 8 === 7 ? -75 : 45),
  coil: (i) => (i % 2 === 0 ? 90 : -78),
  vine: (i) => [22, 22, 22, 22, -22, -22, -22, -22][i % 8],
  sunburst: (i) => (i % 6 === 5 ? 165 : i % 6 === 0 ? -15 : 0),
  orbitRing: () => 30,
  helix: (i) => (Math.floor(i / 5) % 2 === 0 ? 36 : -36),
};

// Spacing keyed by the *scaled* subdivision (block.s x SPEED_MULT for s >= 1).
function spacingFor(sub) {
  if (sub <= 0.5) return 112;
  if (sub <= 1) return 96;
  if (sub <= 1.75) return 86;
  if (sub <= 3) return 74;
  if (sub <= 4.5) return 64;
  return 58;
}

function blockSpin(pattern, mirror, previousSpin) {
  // Short orbital sweeps happen when spin opposes the turn sign.
  const first = PATTERNS[pattern](0) * (mirror ? -1 : 1);
  if (first === 0) return previousSpin || 1;
  return first > 0 ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Musical sections (shared across levels, matches HUD/debug expectations).
// ---------------------------------------------------------------------------

const SECTIONS = [
  { label: "intro groove setup", start: 0, end: 20 },
  { label: "first complexity increase", start: 20, end: 48 },
  { label: "call-and-response pattern", start: 48, end: 78 },
  { label: "visual highlight section", start: 78, end: 108 },
  { label: "final challenge phrase", start: 108, end: 140 },
  { label: "ending resolution", start: 140, end: 150 },
];

function sectionFor(time) {
  for (const section of SECTIONS) {
    if (time < section.end) return section.label;
  }
  return SECTIONS[SECTIONS.length - 1].label;
}

function sectionIntensity(time) {
  if (time < 20) return 0.34;
  if (time < 48) return 0.48;
  if (time < 78) return 0.62;
  if (time < 108) return 0.76;
  if (time < 140) return 0.9;
  return 0.56;
}

// ---------------------------------------------------------------------------
// Level definitions: music sets, themes, and section choreography.
// Choreography block: { p: pattern, s: subdivision, n: steps, pow?, cue? }
//   s = 0.5 -> every 2 beats (slow)   s = 1 -> every beat
//   s = 2 -> eighth notes             s = 3 / 4 -> fast bursts (CPS-capped)
// ---------------------------------------------------------------------------

const TRACKS = {
  breakneck: "Breakneck_Descent.mp3",
  clockwork: "Clockwork_Sprint.mp3",
  concrete: "Concrete_Lung.mp3",
  gravLock: "Gravity_Lock.mp3",
  gravLocked: "Gravity_Locked.mp3",
  ironLung: "Iron_Lung.mp3",
  ironTeeth: "Iron_Teeth_Glass_Keys.mp3",
  overclocked: "Overclocked_Nerve.mp3",
  sunLogic: "Sun_Drenched_Logic.mp3",
  syncGlide: "Synchronized_Glide.mp3",
  // Ten new AI-generated tracks.
  violentGrace: "A_Violent_Grace.mp3",
  coldGeometry: "Cold_Geometry.mp3",
  gameOverNoon: "Game_Over_at_Noon.mp3",
  gearsGrind: "Gears_Grind_Teeth.mp3",
  highAltitude: "High_Altitude_Glide.mp3",
  middayHighway: "Midday_Highway.mp3",
  pendulumError: "Pendulum_Error.mp3",
  sugarRush: "Sugar_Rush_Mode.mp3",
  feltRain: "The_Felt_Against_the_Rain.mp3",
  ironMandate: "The_Iron_Mandate.mp3",
};
const ALL_TRACKS = Object.values(TRACKS);

// Reusable choreography for the "impossible" tier (levels 14-23). A huge fixed
// subdivision means the per-level `minInterval` alone governs speed: every spam
// block runs flat-out at minInterval, broken by brief wave breathers. Pass the
// four patterns to cycle for visual variety.
const SPAM_S = 240;
// One long continuous spam block per section (a short wave breather leads each
// so there is a readable slow beat) so the section fills solid at minInterval
// rather than short bursts separated by beat-snap gaps. `FILL` is a step count
// large enough to run until the section ends at any speed.
const FILL = 40000;
function spamChoreo(patterns) {
  const P = (i) => patterns[i % patterns.length];
  const s = SPAM_S;
  return [
    [
      { p: "wave", s: 1, n: 6 },
      { p: P(0), s, n: FILL, cue: "zoomOutDrop" },
    ],
    [
      { p: "wave", s: 0.5, n: 3 },
      { p: P(1), s, n: FILL, cue: "rollRight" },
    ],
    [
      { p: "wave", s: 0.5, n: 3 },
      { p: P(2), s, n: FILL, pow: true, cue: "twistHeavy" },
    ],
    [
      { p: "wave", s: 0.5, n: 3 },
      { p: P(3), s, n: FILL, cue: "zoomOutDrop" },
    ],
    [
      { p: "wave", s: 0.5, n: 3 },
      { p: P(0), s, n: FILL, pow: true, cue: "rollLeft" },
    ],
    [
      { p: "wave", s: 1, n: 6, cue: "zoomInHit" },
      { p: "straight", s: 0.5, n: 4 },
    ],
  ];
}

const LEVELS = [
  {
    id: "level1",
    title: "Neon Drift",
    subtitle: "Deep-space starter route",
    difficulty: "Medium",
    files: [TRACKS.breakneck, TRACKS.clockwork, TRACKS.concrete, TRACKS.gravLock, TRACKS.gravLocked],
    startHeading: -18,
    theme: {
      name: "Neon Drift",
      backgroundMode: "deepSpace",
      primaryColor: "#4FFFEF",
      secondaryColor: "#FF4FCB",
      accentColor: "#FFDD00",
      particleStyle: "sparks",
      shipStyle: "angular",
      cameraIntensity: 0.58,
      backgroundIntensity: 0.52,
    },
    designNotes: {
      mainRhythmMotif: "long L-turn corridors and gentle stairs with occasional eighth-note runs",
      denseSections: ["final challenge phrase"],
      visualTheme: "open deep-space lanes with cyan and magenta orbit energy",
      cameraPersonality: "gentle beat pulses and restrained phrase zooms",
      readabilityRisks: ["keep intro glow subtle so early tiles stay readable"],
    },
    choreo: [
      [
        { p: "lTurns", s: 1, n: 12, cue: "zoomInHit" },
        { p: "wave", s: 0.5, n: 6 },
        { p: "stairs", s: 1, n: 10 },
      ],
      [
        { p: "stairs", s: 1, n: 12 },
        { p: "straight", s: 2, n: 6, cue: "zoomOutDrop" },
        { p: "wave", s: 1, n: 8 },
        { p: "squareWave", s: 1, n: 12 },
      ],
      [
        { p: "zigzag", s: 1, n: 12 },
        { p: "straight", s: 2, n: 8, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 4 },
        { p: "stairs", s: 1, n: 12 },
      ],
      [
        { p: "spiral", s: 1, n: 8, cue: "twistLight" },
        { p: "lTurns", s: 1, n: 12 },
        { p: "stairs", s: 2, n: 8, cue: "zoomOutDrop" },
        { p: "wave", s: 1, n: 8 },
      ],
      [
        { p: "lTurns", s: 1, n: 10 },
        { p: "straight", s: 2, n: 10, cue: "zoomOutDrop" },
        { p: "switchback", s: 1, n: 6, cue: "rollRight" },
        { p: "straight", s: 3, n: 6, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 4, cue: "zoomInHit" },
      ],
      [
        { p: "straight", s: 0.5, n: 4, cue: "zoomInHit" },
        { p: "wave", s: 1, n: 10 },
      ],
    ],
  },
  {
    id: "level2",
    title: "Nebula Run",
    subtitle: "Storm-lit syncopation",
    difficulty: "Advanced",
    files: [TRACKS.ironLung, TRACKS.ironTeeth, TRACKS.overclocked, TRACKS.sunLogic, TRACKS.syncGlide],
    startHeading: -144,
    theme: {
      name: "Nebula Run",
      backgroundMode: "nebulaStorm",
      primaryColor: "#A855F7",
      secondaryColor: "#4FFFEF",
      accentColor: "#FF4FCB",
      particleStyle: "comets",
      shipStyle: "crescent",
      cameraIntensity: 0.72,
      backgroundIntensity: 0.7,
    },
    designNotes: {
      mainRhythmMotif: "square-wave crenellations and eighth-note stairs with triplet burst answers",
      denseSections: ["call-and-response pattern", "final challenge phrase"],
      visualTheme: "violet nebula pressure with fast cyan route flashes",
      cameraPersonality: "stronger accent bumps and controlled section rolls",
      readabilityRisks: ["ship flybys must stay behind the path during syncopation"],
    },
    choreo: [
      [
        { p: "stairs", s: 1, n: 12 },
        { p: "wave", s: 0.5, n: 4 },
        { p: "zigzag", s: 1, n: 10 },
      ],
      [
        { p: "squareWave", s: 1, n: 12 },
        { p: "straight", s: 2, n: 8, cue: "zoomOutDrop" },
        { p: "stairs", s: 2, n: 8 },
        { p: "wave", s: 1, n: 6 },
      ],
      [
        { p: "zigzag", s: 2, n: 8, cue: "zoomOutDrop" },
        { p: "lTurns", s: 1, n: 10 },
        { p: "straight", s: 3, n: 8, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 4, cue: "zoomInHit" },
      ],
      [
        { p: "spiral", s: 1, n: 8, cue: "twistHeavy" },
        { p: "stairs", s: 2, n: 10 },
        { p: "switchback", s: 1, n: 8, cue: "rollLeft" },
        { p: "straight", s: 2, n: 10 },
      ],
      [
        { p: "squareWave", s: 2, n: 12, cue: "zoomOutDrop" },
        { p: "wave", s: 1, n: 6 },
        { p: "straight", s: 3, n: 8, pow: true, cue: "zoomOutDrop" },
        { p: "hexLoop", s: 1, n: 6, cue: "twistLight" },
        { p: "stairs", s: 2, n: 10 },
      ],
      [
        { p: "wave", s: 0.5, n: 4, cue: "zoomInHit" },
        { p: "lTurns", s: 1, n: 10 },
      ],
    ],
  },
  {
    id: "level3",
    title: "Crystal Orbit",
    subtitle: "Angular hard route",
    difficulty: "Hard",
    files: [TRACKS.clockwork, TRACKS.gravLock, TRACKS.ironLung, TRACKS.overclocked, TRACKS.syncGlide],
    startHeading: -72,
    theme: {
      name: "Crystal Orbit",
      backgroundMode: "crystalOrbit",
      primaryColor: "#4FFFEF",
      secondaryColor: "#A855F7",
      accentColor: "#FFDD00",
      particleStyle: "rings",
      shipStyle: "droneSwarm",
      cameraIntensity: 0.86,
      backgroundIntensity: 0.76,
    },
    designNotes: {
      mainRhythmMotif: "hex loops and eighth-note staples cut by triplet crystal runs",
      denseSections: ["call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "cyan crystal route cuts through violet digital space",
      cameraPersonality: "bold twist cues on loops and wider drop framing",
      readabilityRisks: ["laser sweeps must stay thin during dense burst sections"],
    },
    choreo: [
      [
        { p: "lTurns", s: 1, n: 10 },
        { p: "stairs", s: 2, n: 8 },
        { p: "wave", s: 0.5, n: 4 },
      ],
      [
        { p: "zigzag", s: 2, n: 10, cue: "zoomOutDrop" },
        { p: "squareWave", s: 1, n: 8 },
        { p: "straight", s: 3, n: 8, cue: "zoomOutDrop" },
        { p: "wave", s: 1, n: 6 },
      ],
      [
        { p: "hexLoop", s: 1, n: 6, cue: "twistHeavy" },
        { p: "stairs", s: 2, n: 12 },
        { p: "straight", s: 3, n: 10, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 4, cue: "zoomInHit" },
      ],
      [
        { p: "spiral", s: 2, n: 8, cue: "twistHeavy" },
        { p: "switchback", s: 1, n: 8, cue: "rollRight" },
        { p: "straight", s: 2, n: 12 },
        { p: "zigzag", s: 2, n: 8 },
      ],
      [
        { p: "straight", s: 3, n: 10, pow: true, cue: "zoomOutDrop" },
        { p: "stairs", s: 2, n: 12 },
        { p: "switchback", s: 2, n: 8, cue: "rollLeft" },
        { p: "wave", s: 1, n: 6 },
        { p: "straight", s: 3, n: 10, cue: "zoomOutDrop" },
      ],
      [
        { p: "wave", s: 1, n: 8, cue: "zoomInHit" },
        { p: "straight", s: 0.5, n: 4 },
      ],
    ],
  },
  {
    id: "level4",
    title: "Solar Flare",
    subtitle: "Burning orbit gauntlet",
    difficulty: "Expert",
    files: [TRACKS.breakneck, TRACKS.concrete, TRACKS.gravLocked, TRACKS.ironTeeth, TRACKS.sunLogic],
    startHeading: 24,
    theme: {
      name: "Solar Flare",
      backgroundMode: "solarFlare",
      primaryColor: "#FF6B35",
      secondaryColor: "#FFDD00",
      accentColor: "#FF4FCB",
      particleStyle: "embers",
      shipStyle: "angular",
      cameraIntensity: 0.92,
      backgroundIntensity: 0.82,
    },
    designNotes: {
      mainRhythmMotif: "relentless eighth-note geometry with sixteenth sprint corridors",
      denseSections: ["first complexity increase", "visual highlight section", "final challenge phrase"],
      visualTheme: "blazing solar surface with corona flares and molten streams",
      cameraPersonality: "zoom punches on sprint entries, rolling switchback sweeps",
      readabilityRisks: ["ember particles must not obscure tiles during sprints"],
    },
    choreo: [
      [
        { p: "stairs", s: 1, n: 8 },
        { p: "zigzag", s: 2, n: 8 },
        { p: "wave", s: 1, n: 6 },
      ],
      [
        { p: "squareWave", s: 2, n: 12, cue: "zoomOutDrop" },
        { p: "straight", s: 3, n: 10, cue: "zoomOutDrop" },
        { p: "stairs", s: 1, n: 6 },
        { p: "zigzag", s: 2, n: 10 },
      ],
      [
        { p: "spiral", s: 2, n: 8, cue: "twistHeavy" },
        { p: "straight", s: 4, n: 8, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 4, cue: "zoomInHit" },
        { p: "stairs", s: 2, n: 12 },
      ],
      [
        { p: "switchback", s: 2, n: 8, cue: "rollRight" },
        { p: "straight", s: 3, n: 12, cue: "zoomOutDrop" },
        { p: "hexLoop", s: 2, n: 6, cue: "twistLight" },
        { p: "wave", s: 1, n: 6 },
      ],
      [
        { p: "straight", s: 4, n: 10, pow: true, cue: "zoomOutDrop" },
        { p: "stairs", s: 2, n: 10 },
        { p: "switchback", s: 2, n: 10, cue: "rollLeft" },
        { p: "straight", s: 3, n: 12, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 4, cue: "zoomInHit" },
      ],
      [
        { p: "lTurns", s: 1, n: 8, cue: "zoomInHit" },
        { p: "wave", s: 1, n: 6 },
      ],
    ],
  },
  {
    id: "level5",
    title: "Void Walker",
    subtitle: "Into the abyss",
    difficulty: "Extreme",
    files: [TRACKS.sunLogic, TRACKS.overclocked, TRACKS.ironTeeth, TRACKS.gravLock, TRACKS.breakneck],
    startHeading: 156,
    theme: {
      name: "Void Walker",
      backgroundMode: "voidWalker",
      primaryColor: "#A855F7",
      secondaryColor: "#FF4FCB",
      accentColor: "#4FFFEF",
      particleStyle: "pixelDust",
      shipStyle: "crescent",
      cameraIntensity: 0.96,
      backgroundIntensity: 0.72,
    },
    designNotes: {
      mainRhythmMotif: "triplet stairs and sixteenth void sprints broken by half-time breathers",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "deep void darkness with violet glitch tears and cyan fractures",
      cameraPersonality: "heavy twist cues, dramatic sprint zooms, sudden calm pull-ins",
      readabilityRisks: ["dark background must maintain tile contrast"],
    },
    choreo: [
      [
        { p: "lTurns", s: 1, n: 8 },
        { p: "stairs", s: 2, n: 10 },
        { p: "zigzag", s: 2, n: 8 },
      ],
      [
        { p: "straight", s: 3, n: 12, cue: "zoomOutDrop" },
        { p: "squareWave", s: 2, n: 12 },
        { p: "straight", s: 4, n: 8, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 4, cue: "zoomInHit" },
      ],
      [
        { p: "spiral", s: 2, n: 8, cue: "twistHeavy" },
        { p: "switchback", s: 2, n: 10, cue: "rollRight" },
        { p: "straight", s: 4, n: 10, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 1, n: 4 },
      ],
      [
        { p: "stairs", s: 3, n: 12, cue: "zoomOutDrop" },
        { p: "hexLoop", s: 2, n: 6, cue: "twistHeavy" },
        { p: "straight", s: 3, n: 14 },
        { p: "wave", s: 0.5, n: 4, cue: "zoomInHit" },
      ],
      [
        { p: "straight", s: 4, n: 14, pow: true, cue: "zoomOutDrop" },
        { p: "switchback", s: 2, n: 10, cue: "rollLeft" },
        { p: "stairs", s: 3, n: 12 },
        { p: "straight", s: 4, n: 8, cue: "zoomOutDrop" },
        { p: "zigzag", s: 2, n: 8 },
      ],
      [
        { p: "straight", s: 2, n: 8 },
        { p: "wave", s: 1, n: 6, cue: "zoomInHit" },
      ],
    ],
  },
  {
    id: "level6",
    title: "Bloom Garden",
    subtitle: "Rosette artwork route",
    difficulty: "Scenic",
    files: [TRACKS.syncGlide, TRACKS.sunLogic, TRACKS.gravLocked, TRACKS.concrete, TRACKS.ironLung],
    startHeading: -90,
    theme: {
      name: "Bloom Garden",
      backgroundMode: "bloomGarden",
      primaryColor: "#FF4FCB",
      secondaryColor: "#39FF14",
      accentColor: "#FFDD00",
      particleStyle: "rings",
      shipStyle: "crescent",
      cameraIntensity: 0.7,
      backgroundIntensity: 0.86,
    },
    designNotes: {
      mainRhythmMotif: "rosette flower petals, winding vines, and full orbit rings drawn as living artwork",
      denseSections: ["visual highlight section", "final challenge phrase"],
      visualTheme: "pink-and-green garden nebula where the track itself blossoms into flowers",
      cameraPersonality: "slow twisting blooms and wide petal reveals",
      readabilityRisks: ["petal crossings must draw nearest tiles on top"],
    },
    choreo: [
      [
        { p: "flower", s: 1, n: 16, cue: "twistLight" },
        { p: "vine", s: 0.5, n: 4 },
        { p: "orbitRing", s: 1, n: 12 },
      ],
      [
        { p: "flower", s: 2, n: 16, cue: "zoomOutDrop" },
        { p: "vine", s: 1, n: 8 },
        { p: "coil", s: 1, n: 12, cue: "rollRight" },
        { p: "wave", s: 0.5, n: 4 },
      ],
      [
        { p: "sunburst", s: 2, n: 12, cue: "zoomOutDrop" },
        { p: "flower", s: 1, n: 16, cue: "twistLight" },
        { p: "straight", s: 2, n: 8, pow: true },
        { p: "vine", s: 0.5, n: 4 },
      ],
      [
        { p: "orbitRing", s: 2, n: 12, cue: "twistHeavy" },
        { p: "helix", s: 1, n: 10 },
        { p: "flower", s: 2, n: 16, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 4 },
      ],
      [
        { p: "coil", s: 2, n: 12, cue: "rollLeft" },
        { p: "flower", s: 2, n: 16, cue: "zoomOutDrop" },
        { p: "sunburst", s: 2, n: 12, pow: true },
        { p: "vine", s: 1, n: 6 },
      ],
      [
        { p: "flower", s: 1, n: 8, cue: "zoomInHit" },
        { p: "vine", s: 0.5, n: 4 },
      ],
    ],
  },
  {
    id: "level7",
    title: "Helix Tower",
    subtitle: "Coiling staircase climb",
    difficulty: "Scenic+",
    files: [TRACKS.overclocked, TRACKS.breakneck, TRACKS.ironTeeth, TRACKS.syncGlide, TRACKS.gravLock],
    startHeading: -30,
    theme: {
      name: "Helix Tower",
      backgroundMode: "helixTower",
      primaryColor: "#A855F7",
      secondaryColor: "#4FFFEF",
      accentColor: "#FF6B35",
      particleStyle: "comets",
      shipStyle: "droneSwarm",
      cameraIntensity: 0.82,
      backgroundIntensity: 0.84,
    },
    designNotes: {
      mainRhythmMotif: "coiling staircases and DNA helix arcs that wrap the screen like a spiral tower",
      denseSections: ["call-and-response pattern", "final challenge phrase"],
      visualTheme: "violet tower of light with cyan helix rails and orange flare landings",
      cameraPersonality: "continuous rolling climbs with heavy twist reveals",
      readabilityRisks: ["coil wrap-arounds must keep upcoming tiles bright"],
    },
    choreo: [
      [
        { p: "coil", s: 1, n: 14, cue: "rollRight" },
        { p: "vine", s: 0.5, n: 4 },
        { p: "helix", s: 1, n: 10 },
      ],
      [
        { p: "coil", s: 2, n: 16, cue: "rollRight" },
        { p: "spiral", s: 1, n: 8, cue: "twistLight" },
        { p: "stairs", s: 2, n: 10 },
        { p: "wave", s: 0.5, n: 4 },
      ],
      [
        { p: "helix", s: 2, n: 12, cue: "zoomOutDrop" },
        { p: "coil", s: 2, n: 14, cue: "rollLeft" },
        { p: "straight", s: 3, n: 8, pow: true, cue: "zoomOutDrop" },
        { p: "vine", s: 0.5, n: 4 },
      ],
      [
        { p: "spiral", s: 2, n: 8, cue: "twistHeavy" },
        { p: "coil", s: 2, n: 16, cue: "rollRight" },
        { p: "orbitRing", s: 2, n: 12 },
        { p: "wave", s: 0.5, n: 4 },
      ],
      [
        { p: "coil", s: 3, n: 14, cue: "rollLeft" },
        { p: "helix", s: 2, n: 12, cue: "zoomOutDrop" },
        { p: "straight", s: 3, n: 10, pow: true, cue: "zoomOutDrop" },
        { p: "switchback", s: 1, n: 6, cue: "rollRight" },
        { p: "wave", s: 0.5, n: 4 },
      ],
      [
        { p: "coil", s: 1, n: 10, cue: "zoomInHit" },
        { p: "vine", s: 0.5, n: 4 },
      ],
    ],
  },
  {
    id: "level8",
    title: "Hyper Bloom",
    subtitle: "Ultra spam mandala",
    difficulty: "Ultra Spam",
    ultra: true,
    minInterval: 0.068,
    files: [TRACKS.breakneck, TRACKS.overclocked, TRACKS.clockwork, TRACKS.ironTeeth, TRACKS.sunLogic],
    startHeading: 0,
    theme: {
      name: "Hyper Bloom",
      backgroundMode: "starfallRush",
      primaryColor: "#FF4FCB",
      secondaryColor: "#FFDD00",
      accentColor: "#39FF14",
      particleStyle: "sparks",
      shipStyle: "angular",
      cameraIntensity: 0.95,
      backgroundIntensity: 0.92,
    },
    designNotes: {
      mainRhythmMotif: "pure-spam flower mandalas: mash three keys and watch the petals paint themselves",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "a firework garden that blooms as fast as you can press",
      cameraPersonality: "wide mandala framing with beat-strobed zoom",
      readabilityRisks: ["spam corridors rely on leniency, not per-tile reading"],
    },
    choreo: [
      [
        { p: "vine", s: 1, n: 6 },
        { p: "flower", s: 7, n: 32, cue: "twistLight" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "flower", s: 7, n: 32 },
      ],
      [
        { p: "orbitRing", s: 7, n: 32, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "flower", s: 7, n: 32, cue: "twistLight" },
        { p: "sunburst", s: 7, n: 24 },
      ],
      [
        { p: "flower", s: 7, n: 44, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "orbitRing", s: 7, n: 32, cue: "twistHeavy" },
      ],
      [
        { p: "sunburst", s: 7, n: 32, cue: "zoomOutDrop" },
        { p: "flower", s: 7, n: 44, cue: "twistLight" },
        { p: "wave", s: 0.5, n: 3 },
      ],
      [
        { p: "flower", s: 7, n: 44, pow: true, cue: "zoomOutDrop" },
        { p: "orbitRing", s: 7, n: 32, cue: "twistHeavy" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "flower", s: 7, n: 32 },
      ],
      [
        { p: "vine", s: 1, n: 6, cue: "zoomInHit" },
        { p: "wave", s: 0.5, n: 4 },
      ],
    ],
  },
  {
    id: "level9",
    title: "Comet Coil",
    subtitle: "Ultra spam helix dive",
    difficulty: "Ultra Spam",
    ultra: true,
    minInterval: 0.062,
    files: [TRACKS.clockwork, TRACKS.ironLung, TRACKS.gravLocked, TRACKS.overclocked, TRACKS.breakneck],
    startHeading: 45,
    theme: {
      name: "Comet Coil",
      backgroundMode: "neonCircuit",
      primaryColor: "#39FF14",
      secondaryColor: "#4FFFEF",
      accentColor: "#FF4FCB",
      particleStyle: "comets",
      shipStyle: "angular",
      cameraIntensity: 0.98,
      backgroundIntensity: 0.9,
    },
    designNotes: {
      mainRhythmMotif: "endless coiling comet staircases at mash speed with sudden half-time gulps of air",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "a green comet drilling through a neon circuit board",
      cameraPersonality: "spiral-locked rolls that never quite stop",
      readabilityRisks: ["coil density is decorative; survival is press rate"],
    },
    choreo: [
      [
        { p: "helix", s: 1, n: 6 },
        { p: "coil", s: 7, n: 38, cue: "rollRight" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "spiral", s: 7, n: 18, cue: "twistLight" },
      ],
      [
        { p: "coil", s: 7, n: 38, cue: "rollLeft" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "helix", s: 7, n: 32, cue: "zoomOutDrop" },
        { p: "orbitRing", s: 7, n: 28 },
      ],
      [
        { p: "coil", s: 7, n: 44, pow: true, cue: "rollRight" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "spiral", s: 7, n: 20, cue: "twistHeavy" },
      ],
      [
        { p: "helix", s: 7, n: 38, cue: "zoomOutDrop" },
        { p: "coil", s: 7, n: 38, cue: "rollLeft" },
        { p: "wave", s: 0.5, n: 3 },
      ],
      [
        { p: "coil", s: 7, n: 44, pow: true, cue: "rollRight" },
        { p: "helix", s: 7, n: 32, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "coil", s: 7, n: 32 },
      ],
      [
        { p: "helix", s: 1, n: 6, cue: "zoomInHit" },
        { p: "wave", s: 0.5, n: 4 },
      ],
    ],
  },
  {
    id: "level10",
    title: "Star Cascade",
    subtitle: "Maximum spam meteor rail",
    difficulty: "Ultra Spam",
    ultra: true,
    minInterval: 0.057,
    files: [TRACKS.ironTeeth, TRACKS.gravLocked, TRACKS.breakneck, TRACKS.clockwork, TRACKS.overclocked],
    startHeading: -12,
    theme: {
      name: "Star Cascade",
      backgroundMode: "prismCascade",
      primaryColor: "#FFDD00",
      secondaryColor: "#FF4FCB",
      accentColor: "#4FFFEF",
      particleStyle: "pixelDust",
      shipStyle: "droneSwarm",
      cameraIntensity: 1,
      backgroundIntensity: 0.95,
    },
    designNotes: {
      mainRhythmMotif: "the fastest rail in the game: straight meteor corridors and sunburst spokes at pure mash speed",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "golden meteor cascade tearing across a prism sky",
      cameraPersonality: "long wide sprint framing with strobe pulses",
      readabilityRisks: ["this level is a spectacle; the HUD carries the survival info"],
    },
    choreo: [
      [
        { p: "wave", s: 1, n: 6 },
        { p: "straight", s: 8, n: 44, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "sunburst", s: 8, n: 32, cue: "twistLight" },
      ],
      [
        { p: "straight", s: 8, n: 48, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "orbitRing", s: 8, n: 32, cue: "twistHeavy" },
        { p: "zigzag", s: 8, n: 28 },
      ],
      [
        { p: "sunburst", s: 8, n: 40, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "straight", s: 8, n: 48, cue: "zoomOutDrop" },
      ],
      [
        { p: "orbitRing", s: 8, n: 38, cue: "twistHeavy" },
        { p: "straight", s: 8, n: 48, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
      ],
      [
        { p: "straight", s: 8, n: 54, pow: true, cue: "zoomOutDrop" },
        { p: "sunburst", s: 8, n: 40, cue: "twistLight" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "straight", s: 8, n: 38 },
      ],
      [
        { p: "wave", s: 1, n: 6, cue: "zoomInHit" },
        { p: "straight", s: 0.5, n: 4 },
      ],
    ],
  },
  {
    id: "level11",
    title: "Inferno Core",
    subtitle: "Mega spam magma dive",
    difficulty: "Mega Spam",
    ultra: true,
    minInterval: 0.055,
    files: [TRACKS.breakneck, TRACKS.ironLung, TRACKS.overclocked, TRACKS.gravLock, TRACKS.concrete],
    startHeading: 30,
    theme: {
      name: "Inferno Core",
      backgroundMode: "magmaCore",
      primaryColor: "#FF6B35",
      secondaryColor: "#FFDD00",
      accentColor: "#FF4FCB",
      particleStyle: "embers",
      shipStyle: "angular",
      cameraIntensity: 1,
      backgroundIntensity: 0.95,
    },
    designNotes: {
      mainRhythmMotif: "molten switchback rivers and sunburst eruptions at ~18 presses per second",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "a volcanic core of rising embers, lava falls, and cracked obsidian silhouettes",
      cameraPersonality: "heat-shimmer zooms and eruption shakes",
      readabilityRisks: ["pure spam level; ember columns stay behind the rail"],
    },
    choreo: [
      [
        { p: "wave", s: 1, n: 6 },
        { p: "zigzag", s: 8, n: 40, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "sunburst", s: 8, n: 32, cue: "twistLight" },
      ],
      [
        { p: "switchback", s: 8, n: 36, cue: "rollRight" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "straight", s: 8, n: 48, cue: "zoomOutDrop" },
        { p: "stairs", s: 8, n: 32 },
      ],
      [
        { p: "sunburst", s: 8, n: 40, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "zigzag", s: 8, n: 44, cue: "zoomOutDrop" },
      ],
      [
        { p: "coil", s: 8, n: 38, cue: "rollLeft" },
        { p: "straight", s: 8, n: 48, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
      ],
      [
        { p: "straight", s: 8, n: 54, pow: true, cue: "zoomOutDrop" },
        { p: "switchback", s: 8, n: 36, cue: "rollRight" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "sunburst", s: 8, n: 36 },
      ],
      [
        { p: "wave", s: 1, n: 6, cue: "zoomInHit" },
        { p: "straight", s: 0.5, n: 4 },
      ],
    ],
  },
  {
    id: "level12",
    title: "Warp Tunnel",
    subtitle: "Giga spam hyperdrive",
    difficulty: "Giga Spam",
    ultra: true,
    minInterval: 0.05,
    files: [TRACKS.clockwork, TRACKS.syncGlide, TRACKS.breakneck, TRACKS.overclocked, TRACKS.ironTeeth],
    startHeading: 0,
    theme: {
      name: "Warp Tunnel",
      backgroundMode: "hyperTunnel",
      primaryColor: "#4FFFEF",
      secondaryColor: "#A855F7",
      accentColor: "#FFDD00",
      particleStyle: "pixelDust",
      shipStyle: "droneSwarm",
      cameraIntensity: 1,
      backgroundIntensity: 0.95,
    },
    designNotes: {
      mainRhythmMotif: "20 presses per second through a collapsing hyperspace tube of straight rails and helix weaves",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "a 3D warp tunnel of concentric light rings racing past at lightspeed",
      cameraPersonality: "locked forward sprint with strobing ring pulses",
      readabilityRisks: ["pure spam level; the tunnel is the spectacle"],
    },
    choreo: [
      [
        { p: "wave", s: 1, n: 6 },
        { p: "straight", s: 9, n: 48, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "helix", s: 9, n: 36, cue: "twistLight" },
      ],
      [
        { p: "straight", s: 9, n: 52, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "zigzag", s: 9, n: 40, cue: "twistHeavy" },
        { p: "orbitRing", s: 9, n: 32 },
      ],
      [
        { p: "straight", s: 9, n: 56, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "helix", s: 9, n: 40, cue: "zoomOutDrop" },
      ],
      [
        { p: "orbitRing", s: 9, n: 40, cue: "twistHeavy" },
        { p: "straight", s: 9, n: 52, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
      ],
      [
        { p: "straight", s: 9, n: 60, pow: true, cue: "zoomOutDrop" },
        { p: "helix", s: 9, n: 40, cue: "twistLight" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "straight", s: 9, n: 44 },
      ],
      [
        { p: "wave", s: 1, n: 6, cue: "zoomInHit" },
        { p: "straight", s: 0.5, n: 4 },
      ],
    ],
  },
  {
    id: "level13",
    title: "Singularity",
    subtitle: "Omega spam event horizon",
    difficulty: "Omega Spam",
    ultra: true,
    minInterval: 0.046,
    files: [TRACKS.overclocked, TRACKS.breakneck, TRACKS.ironTeeth, TRACKS.clockwork, TRACKS.concrete],
    startHeading: -60,
    theme: {
      name: "Singularity",
      backgroundMode: "singularity",
      primaryColor: "#A855F7",
      secondaryColor: "#FF4FCB",
      accentColor: "#4FFFEF",
      particleStyle: "pixelDust",
      shipStyle: "crescent",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "~22 presses per second spiraling into a black hole; the fastest rail that exists",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "an accretion disk bending light around a collapsing star",
      cameraPersonality: "gravity-well rolls and lensing zooms",
      readabilityRisks: ["pure spam level; survival is press rate alone"],
    },
    choreo: [
      [
        { p: "wave", s: 1, n: 6 },
        { p: "spiral", s: 10, n: 24, cue: "twistHeavy" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "straight", s: 10, n: 52, cue: "zoomOutDrop" },
      ],
      [
        { p: "coil", s: 10, n: 44, cue: "rollRight" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "straight", s: 10, n: 56, cue: "zoomOutDrop" },
        { p: "orbitRing", s: 10, n: 36 },
      ],
      [
        { p: "straight", s: 10, n: 60, pow: true, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "spiral", s: 10, n: 26, cue: "twistHeavy" },
      ],
      [
        { p: "orbitRing", s: 10, n: 44, cue: "twistHeavy" },
        { p: "straight", s: 10, n: 56, cue: "zoomOutDrop" },
        { p: "wave", s: 0.5, n: 3 },
      ],
      [
        { p: "straight", s: 10, n: 64, pow: true, cue: "zoomOutDrop" },
        { p: "coil", s: 10, n: 44, cue: "rollLeft" },
        { p: "wave", s: 0.5, n: 3 },
        { p: "straight", s: 10, n: 48 },
      ],
      [
        { p: "wave", s: 1, n: 6, cue: "zoomInHit" },
        { p: "straight", s: 0.5, n: 4 },
      ],
    ],
  },
  // ---- Impossible tier: levels 14-23, ramping ~5x -> ~20x past level 13 ----
  {
    id: "level14",
    title: "Meltdown",
    subtitle: "Hyper spam reactor breach",
    difficulty: "Hyper Spam",
    ultra: true,
    minInterval: 0.0092,
    files: [TRACKS.syncGlide, TRACKS.clockwork, TRACKS.overclocked, TRACKS.breakneck, TRACKS.ironLung],
    startHeading: -20,
    theme: {
      name: "Meltdown",
      backgroundMode: "crystalOrbit",
      primaryColor: "#4FFFEF",
      secondaryColor: "#A855F7",
      accentColor: "#FFDD00",
      particleStyle: "sparks",
      shipStyle: "angular",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "~5x past the old ceiling: a crystalline wall of tiles meant for No-Death sightseeing",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "shattering crystal lattice at reactor-breach speed",
      cameraPersonality: "hard strobing zooms",
      readabilityRisks: ["impossible tier; enable No Death and watch the show"],
    },
    choreo: spamChoreo(["zigzag", "sunburst", "switchback", "stairs"]),
  },
  {
    id: "level15",
    title: "Overdrive",
    subtitle: "Turbo spam solar sprint",
    difficulty: "Turbo Spam",
    ultra: true,
    minInterval: 0.0079,
    files: [TRACKS.gravLocked, TRACKS.sunLogic, TRACKS.concrete, TRACKS.ironTeeth, TRACKS.gravLock],
    startHeading: 40,
    theme: {
      name: "Overdrive",
      backgroundMode: "solarFlare",
      primaryColor: "#FF6B35",
      secondaryColor: "#FFDD00",
      accentColor: "#FF4FCB",
      particleStyle: "embers",
      shipStyle: "angular",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "solar corridors and spokes flooding by faster than the eye can track",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "a sun flaring at overdrive speed",
      cameraPersonality: "sweeping flare rolls",
      readabilityRisks: ["pure spectacle tier"],
    },
    choreo: spamChoreo(["straight", "spiral", "orbitRing", "zigzag"]),
  },
  {
    id: "level16",
    title: "Detonator",
    subtitle: "Nitro spam circuit overload",
    difficulty: "Nitro Spam",
    ultra: true,
    minInterval: 0.0068,
    files: [TRACKS.overclocked, TRACKS.ironTeeth, TRACKS.breakneck, TRACKS.gravLock, TRACKS.clockwork],
    startHeading: -70,
    theme: {
      name: "Detonator",
      backgroundMode: "neonCircuit",
      primaryColor: "#39FF14",
      secondaryColor: "#4FFFEF",
      accentColor: "#FF4FCB",
      particleStyle: "comets",
      shipStyle: "angular",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "coiling circuit traces detonating at nitro speed",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "a circuit board overloading to failure",
      cameraPersonality: "spiral-locked rolls",
      readabilityRisks: ["pure spectacle tier"],
    },
    choreo: spamChoreo(["coil", "helix", "straight", "spiral"]),
  },
  {
    id: "level17",
    title: "Cataclysm",
    subtitle: "Plasma spam void tear",
    difficulty: "Plasma Spam",
    ultra: true,
    minInterval: 0.0058,
    files: [TRACKS.ironLung, TRACKS.concrete, TRACKS.sunLogic, TRACKS.gravLocked, TRACKS.breakneck],
    startHeading: 120,
    theme: {
      name: "Cataclysm",
      backgroundMode: "voidWalker",
      primaryColor: "#A855F7",
      secondaryColor: "#FF4FCB",
      accentColor: "#4FFFEF",
      particleStyle: "pixelDust",
      shipStyle: "crescent",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "a void that swallows tiles faster than they can be read",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "glitch tears ripping the void apart",
      cameraPersonality: "heavy twist drops",
      readabilityRisks: ["pure spectacle tier"],
    },
    choreo: spamChoreo(["sunburst", "straight", "orbitRing", "zigzag"]),
  },
  {
    id: "level18",
    title: "Annihilator",
    subtitle: "Quantum spam meteor storm",
    difficulty: "Quantum Spam",
    ultra: true,
    minInterval: 0.005,
    files: [TRACKS.clockwork, TRACKS.overclocked, TRACKS.gravLock, TRACKS.ironTeeth, TRACKS.syncGlide],
    startHeading: -150,
    theme: {
      name: "Annihilator",
      backgroundMode: "starfallRush",
      primaryColor: "#FF4FCB",
      secondaryColor: "#FFDD00",
      accentColor: "#39FF14",
      particleStyle: "sparks",
      shipStyle: "droneSwarm",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "a meteor storm of tiles at quantum density",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "endless firework meteor bombardment",
      cameraPersonality: "beat-strobed zooms",
      readabilityRisks: ["pure spectacle tier"],
    },
    choreo: spamChoreo(["spiral", "coil", "helix", "straight"]),
  },
  {
    id: "level19",
    title: "Supernova",
    subtitle: "Nova spam prism blast",
    difficulty: "Nova Spam",
    ultra: true,
    minInterval: 0.0043,
    files: [TRACKS.breakneck, TRACKS.sunLogic, TRACKS.ironLung, TRACKS.concrete, TRACKS.overclocked],
    startHeading: 15,
    theme: {
      name: "Supernova",
      backgroundMode: "prismCascade",
      primaryColor: "#FFDD00",
      secondaryColor: "#FF4FCB",
      accentColor: "#4FFFEF",
      particleStyle: "pixelDust",
      shipStyle: "droneSwarm",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "a prism supernova scattering more tiles than pixels",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "light shattering into a rainbow supernova",
      cameraPersonality: "wide strobe sprints",
      readabilityRisks: ["pure spectacle tier"],
    },
    choreo: spamChoreo(["straight", "sunburst", "orbitRing", "switchback"]),
  },
  {
    id: "level20",
    title: "Event Horizon",
    subtitle: "Quasar spam helix tower",
    difficulty: "Quasar Spam",
    ultra: true,
    minInterval: 0.0037,
    files: [TRACKS.ironTeeth, TRACKS.gravLocked, TRACKS.clockwork, TRACKS.breakneck, TRACKS.gravLock],
    startHeading: -45,
    theme: {
      name: "Event Horizon",
      backgroundMode: "helixTower",
      primaryColor: "#A855F7",
      secondaryColor: "#4FFFEF",
      accentColor: "#FF6B35",
      particleStyle: "comets",
      shipStyle: "droneSwarm",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "a DNA tower spun so fast it becomes a solid ribbon of tiles",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "a helix tower blurring into a light column",
      cameraPersonality: "continuous rolling climb",
      readabilityRisks: ["pure spectacle tier"],
    },
    choreo: spamChoreo(["helix", "spiral", "coil", "orbitRing"]),
  },
  {
    id: "level21",
    title: "Oblivion",
    subtitle: "Pulsar spam hyperdrive",
    difficulty: "Pulsar Spam",
    ultra: true,
    minInterval: 0.0031,
    files: [TRACKS.overclocked, TRACKS.syncGlide, TRACKS.sunLogic, TRACKS.ironLung, TRACKS.clockwork],
    startHeading: 75,
    theme: {
      name: "Oblivion",
      backgroundMode: "hyperTunnel",
      primaryColor: "#4FFFEF",
      secondaryColor: "#A855F7",
      accentColor: "#FFDD00",
      particleStyle: "pixelDust",
      shipStyle: "droneSwarm",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "a hyperspace tube collapsing at pulsar speed",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "a warp tunnel at the edge of light",
      cameraPersonality: "locked forward strobe",
      readabilityRisks: ["pure spectacle tier"],
    },
    choreo: spamChoreo(["straight", "zigzag", "helix", "spiral"]),
  },
  {
    id: "level22",
    title: "Ragnarok",
    subtitle: "Cosmic spam magma dive",
    difficulty: "Cosmic Spam",
    ultra: true,
    minInterval: 0.0027,
    files: [TRACKS.gravLock, TRACKS.concrete, TRACKS.breakneck, TRACKS.ironTeeth, TRACKS.overclocked],
    startHeading: -100,
    theme: {
      name: "Ragnarok",
      backgroundMode: "magmaCore",
      primaryColor: "#FF6B35",
      secondaryColor: "#FFDD00",
      accentColor: "#FF4FCB",
      particleStyle: "embers",
      shipStyle: "angular",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "a magma core erupting a near-continuous stream of tiles",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "a volcanic core at cosmic overload",
      cameraPersonality: "eruption shakes",
      readabilityRisks: ["pure spectacle tier"],
    },
    choreo: spamChoreo(["switchback", "sunburst", "straight", "stairs"]),
  },
  {
    id: "level23",
    title: "Heat Death",
    subtitle: "The final ~20x singularity",
    difficulty: "Heat Death",
    ultra: true,
    minInterval: 0.0023,
    files: [TRACKS.breakneck, TRACKS.overclocked, TRACKS.ironTeeth, TRACKS.syncGlide, TRACKS.sunLogic],
    startHeading: -30,
    theme: {
      name: "Heat Death",
      backgroundMode: "singularity",
      primaryColor: "#A855F7",
      secondaryColor: "#FF4FCB",
      accentColor: "#4FFFEF",
      particleStyle: "pixelDust",
      shipStyle: "crescent",
      cameraIntensity: 1,
      backgroundIntensity: 1,
    },
    designNotes: {
      mainRhythmMotif: "~20x the old ceiling: the fastest rail that can exist, a solid wall of tiles into a black hole",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "the heat death of the universe around an event horizon",
      cameraPersonality: "gravity-well lensing",
      readabilityRisks: ["the ultimate No-Death spectacle"],
    },
    choreo: spamChoreo(["straight", "spiral", "coil", "orbitRing"]),
  },
];

// ---------------------------------------------------------------------------
// Beat clock over the five 30-second segments.
// ---------------------------------------------------------------------------

function makeBeatClock(segments) {
  function segmentAt(time) {
    const index = Math.min(segments.length - 1, Math.max(0, Math.floor(time / SEGMENT_SECONDS)));
    return { index, start: index * SEGMENT_SECONDS, ...segments[index] };
  }

  // Smallest beat-grid time >= t within the level.
  function snapBeat(t) {
    let time = t;
    for (let guard = 0; guard < 8; guard += 1) {
      const seg = segmentAt(time);
      const local = time - seg.start - seg.firstBeatPhase;
      const k = Math.max(0, Math.ceil(local / seg.beatInterval - 1e-6));
      const beat = seg.start + seg.firstBeatPhase + k * seg.beatInterval;
      if (beat < seg.start + SEGMENT_SECONDS - 0.1) return beat;
      time = seg.start + SEGMENT_SECONDS; // roll into the next segment
      if (time >= LEVEL_SECONDS - 0.4) return null;
    }
    return null;
  }

  return { segmentAt, snapBeat };
}

// ---------------------------------------------------------------------------
// Node generation.
// ---------------------------------------------------------------------------

// Is time `local` (seconds into a 30s segment) within `tol` of a detected note
// onset? Binary search over the sorted onset list. Returns the onset strength
// (0 if none) so tiles can accent proportionally to the music.
function onsetStrengthAt(onsets, local, tol = 0.05) {
  if (!onsets || !onsets.length) return 0;
  let lo = 0;
  let hi = onsets.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = onsets[mid][0];
    if (Math.abs(t - local) <= tol) {
      best = Math.max(best, onsets[mid][1] || 0.5);
      // Check immediate neighbours too (onsets can cluster).
      for (let k = mid - 1; k >= 0 && local - onsets[k][0] <= tol; k -= 1) best = Math.max(best, onsets[k][1] || 0.5);
      for (let k = mid + 1; k < onsets.length && onsets[k][0] - local <= tol; k += 1) best = Math.max(best, onsets[k][1] || 0.5);
      return best;
    }
    if (t < local) lo = mid + 1;
    else hi = mid - 1;
  }
  return 0;
}

function buildNodes(level, trackMeta) {
  const segments = level.files.map((file) => trackMeta.get(file));
  const clock = makeBeatClock(segments);
  const random = mulberry32(hashSeed(level.id));

  let heading = level.startHeading;
  let spin = 1;
  let x = 0;
  let y = 0;

  const nodes = [
    {
      id: 0,
      time: 0,
      x: 0,
      y: 0,
      angle: heading,
      turnDegrees: 0,
      spin: 1,
      interval: 0,
      accent: true,
      sourceBeat: true,
      sourceTime: 0,
      section: "intro groove setup",
      visualIntensity: 0.44,
      cameraCue: "zoomOutDrop",
      checkpoint: true,
      powerup: false,
    },
  ];

  const pushNode = (time, turn, extra = {}) => {
    const previous = nodes[nodes.length - 1];
    const interval = time - previous.time;
    heading += turn;
    const spacing = extra.spacing ?? spacingFor(extra.sub ?? 1);
    x += Math.cos((heading * Math.PI) / 180) * spacing;
    y += Math.sin((heading * Math.PI) / 180) * spacing;
    const seg = clock.segmentAt(time);
    const localBeat = (time - seg.start - seg.firstBeatPhase) / seg.beatInterval;
    const sourceBeat = Math.abs(localBeat - Math.round(localBeat)) < 0.02;
    // Match the actual music: tiles landing on a detected note onset get
    // accented (purely cosmetic/camera — never changes spacing or timing, so
    // the difficulty is untouched).
    const onset = onsetStrengthAt(seg.onsets, time - seg.start);
    const accent = Boolean(extra.accent) || onset > 0.55;
    const intensity = Math.min(
      1,
      sectionIntensity(time) + (accent ? 0.14 : 0) + onset * 0.1 + ((extra.sub || 1) >= 2 ? 0.1 : 0),
    );
    nodes.push({
      id: nodes.length,
      time: Number(time.toFixed(3)),
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      angle: Number((((heading % 360) + 360) % 360).toFixed(3)),
      turnDegrees: turn,
      spin,
      interval: Number(interval.toFixed(3)),
      accent,
      onBeat: sourceBeat,
      onNote: onset > 0.55,
      sourceBeat,
      sourceTime: Number((time - seg.start).toFixed(3)),
      section: sectionFor(time),
      visualIntensity: Number(intensity.toFixed(3)),
      cameraCue: extra.cue || null,
      checkpoint: false,
      powerup: Boolean(extra.powerup),
    });
  };

  // Light collision probe: rotate the block entry heading if it would plough
  // straight through path laid down more than a dozen steps ago.
  const chooseEntryTurn = () => {
    const options = [0, 45, -45, 90, -90, 135, -135];
    const preferred = [0, 45, -45, 90, -90][Math.floor(random() * 5)];
    const ordered = [preferred, ...options.filter((o) => o !== preferred)];
    // Only probe a recent window of prior nodes. Bounds build cost on the
    // huge impossible-tier levels (tens of thousands of nodes) and is
    // effectively identical for the smaller levels.
    const old = nodes.slice(Math.max(0, nodes.length - 600), Math.max(0, nodes.length - 12));
    for (const candidate of ordered) {
      const probeHeading = ((heading + candidate) * Math.PI) / 180;
      let clear = true;
      for (let step = 1; step <= 6 && clear; step += 1) {
        const px = x + Math.cos(probeHeading) * 96 * step;
        const py = y + Math.sin(probeHeading) * 96 * step;
        for (const node of old) {
          if (Math.hypot(px - node.x, py - node.y) < 85) {
            clear = false;
            break;
          }
        }
      }
      if (clear) return candidate;
    }
    return preferred;
  };

  let tCur = clock.snapBeat(0.8);

  for (let s = 0; s < SECTIONS.length; s += 1) {
    const section = SECTIONS[s];
    const blocks = level.choreo[s] || [{ p: "straight", s: 1, n: 8 }];
    let blockIndex = 0;
    let firstCycle = true;

    while (tCur !== null && tCur < section.end - 0.12 && tCur < LEVEL_SECONDS - 0.8) {
      const block = blocks[blockIndex % blocks.length];
      if (blockIndex > 0 && blockIndex % blocks.length === 0) firstCycle = false;
      blockIndex += 1;

      const pattern = PATTERNS[block.p] || PATTERNS.straight;
      const mirror = random() > 0.5;
      const entryTurn = chooseEntryTurn();
      spin = blockSpin(block.p, mirror, spin);

      // Snap the block entry to the beat grid.
      tCur = clock.snapBeat(tCur);
      if (tCur === null) break;

      let spiralScale = 0.85;
      for (let step = 0; step < block.n; step += 1) {
        if (tCur === null || tCur >= section.end - 0.05 || tCur >= LEVEL_SECONDS - 0.8) break;

        const seg = clock.segmentAt(tCur);
        // Global 1.5x speed-up: blocks at or above one press per beat get
        // denser; slow half-time blocks keep their original breathing pace.
        const requested = block.s >= 1 ? block.s * SPEED_MULT : block.s;
        const minInterval = level.minInterval ?? DEFAULT_MIN_INTERVAL;
        let dt;
        if (requested <= 1) {
          dt = seg.beatInterval / requested;
        } else {
          const effSub = Math.min(requested, Math.max(1, seg.beatInterval / minInterval));
          dt = seg.beatInterval / effSub;
        }

        let turn = pattern(step) * (mirror ? -1 : 1);
        if (step === 0) turn += entryTurn;

        let spacing = spacingFor(requested);
        if (block.p === "spiral") {
          spacing = Math.max(56, Math.min(150, spacing * spiralScale));
          spiralScale *= 1.11;
        }

        const accent = step === 0 || Math.abs(turn) >= 90 || (block.p === "straight" && step % 8 === 4);
        pushNode(tCur, turn, {
          sub: block.s,
          spacing,
          accent,
          cue: step === 0 ? block.cue || null : null,
          powerup: Boolean(block.pow && firstCycle && step === 0),
        });

        // Advance the clock; crossing a segment boundary re-snaps to the
        // incoming track's own beat grid.
        const nextT = tCur + dt;
        if (Math.floor(nextT / SEGMENT_SECONDS) !== seg.index) {
          tCur = clock.snapBeat((seg.index + 1) * SEGMENT_SECONDS);
        } else {
          tCur = nextT;
        }
      }
    }
  }

  // Final resolution node close to the end of the level.
  const last = nodes[nodes.length - 1];
  if (last.time < 148.6) {
    pushNode(Math.min(149.25, last.time + 1), 0, { sub: 0.5, accent: true });
  }

  // Spam flag: tiles inside (or leading directly into) mash-speed runs get
  // lenient early-input judging in the engine.
  for (let i = 0; i < nodes.length; i += 1) {
    const own = nodes[i].interval || 0;
    const next = nodes[i + 1]?.interval || 99;
    nodes[i].spam = (own > 0 && own <= SPAM_INTERVAL) || next <= SPAM_INTERVAL;
  }

  centerNodes(nodes);
  return nodes;
}

function centerNodes(nodes) {
  const minX = Math.min(...nodes.map((n) => n.x));
  const maxX = Math.max(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxY = Math.max(...nodes.map((n) => n.y));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const node of nodes) {
    node.x = Number((node.x - cx).toFixed(3));
    node.y = Number((node.y - cy).toFixed(3));
  }
}

function createCheckpoints(nodes) {
  const marks = [
    { time: 0, label: "Start" },
    { time: 20, label: "Groove" },
    { time: 48, label: "Complexity" },
    { time: 78, label: "Highlight" },
    { time: 108, label: "Final phrase" },
    { time: 140, label: "Resolution" },
  ];
  return marks.map((mark) => {
    let best = nodes[0];
    for (const node of nodes) {
      if (Math.abs(node.time - mark.time) < Math.abs(best.time - mark.time)) best = node;
    }
    return { label: mark.label, time: best.time, nodeIndex: best.id };
  });
}

// ---------------------------------------------------------------------------
// Visual events (full-level coverage, approved types and colors only).
// ---------------------------------------------------------------------------

const APPROVED_EVENT_COLORS = new Set(["#FF4FCB", "#4FFFEF", "#FFDD00", "#A855F7", "#FF6B35", "#39FF14"]);

function eventColor(theme, index) {
  const candidates = [theme.primaryColor, theme.secondaryColor, theme.accentColor]
    .filter((color) => APPROVED_EVENT_COLORS.has(String(color).toUpperCase()));
  return candidates[index % candidates.length] || "#4FFFEF";
}

function makeVisualEvent(time, type, duration, intensity, color, lane) {
  return {
    time: Number(time.toFixed(3)),
    type,
    duration: Number(duration.toFixed(3)),
    intensity: Number(Math.min(1, Math.max(0.2, intensity)).toFixed(3)),
    color,
    lane,
  };
}

// Every level gets its own ambient-event menu so no two routes share the same
// sky show (no more rockets-and-stars on every stage).
const EVENT_MENUS = {
  deepSpace: ["starfall", "shipFlyby", "nebulaPulse", "rocket"],
  nebulaStorm: ["nebulaPulse", "laserSweep", "starfall", "backgroundBurst"],
  crystalOrbit: ["laserSweep", "backgroundBurst", "nebulaPulse", "shipFlyby"],
  solarFlare: ["rocket", "backgroundBurst", "hueBloom", "starfall"],
  voidWalker: ["laserSweep", "nebulaPulse", "speedLines", "backgroundBurst"],
  bloomGarden: ["firework", "nebulaPulse", "hueBloom", "starfall"],
  helixTower: ["shipFlyby", "laserSweep", "hueBloom", "backgroundBurst"],
  starfallRush: ["firework", "starfall", "backgroundBurst", "hueBloom", "speedLines"],
  neonCircuit: ["laserSweep", "speedLines", "ufo", "backgroundBurst"],
  prismCascade: ["starfall", "hueBloom", "speedLines", "firework"],
  magmaCore: ["rocket", "backgroundBurst", "starfall", "speedLines"],
  hyperTunnel: ["speedLines", "laserSweep", "shipFlyby", "hueBloom"],
  singularity: ["nebulaPulse", "backgroundBurst", "hueBloom", "laserSweep"],
};

function buildVisualEvents(nodes, theme, levelIndex, ultra) {
  const types = EVENT_MENUS[theme.backgroundMode] || EVENT_MENUS.deepSpace;
  const events = [
    makeVisualEvent(0.42, "backgroundBurst", 0.7, 0.72, eventColor(theme, 2), 0),
    makeVisualEvent(0.82, types[1] || "laserSweep", 0.58, 0.7, eventColor(theme, 1), 1),
    makeVisualEvent(1.18, types[0] || "shipFlyby", 1.35, 0.76, eventColor(theme, 0), 2),
    makeVisualEvent(1.78, types[2] || "starfall", 0.9, 0.68, eventColor(theme, 1), 3),
    makeVisualEvent(2.36, "nebulaPulse", 1.25, 0.6, eventColor(theme, 0), 1),
  ];
  const durations = {
    shipFlyby: 1.1, nebulaPulse: 0.9, backgroundBurst: 0.55, starfall: 0.6, laserSweep: 0.38,
    rocket: 2.4, ufo: 2.8, firework: 1.7, hueBloom: 1.9, speedLines: 1.2,
  };
  const cadence = ultra ? 1.5 : 1.85;
  let index = 0;
  for (let time = 3.4; time < 148.5; time += cadence + (index % 3) * 0.22) {
    const type = types[index % types.length];
    const intensity = 0.28 + sectionIntensity(time) * 0.42 + levelIndex * 0.02;
    events.push(makeVisualEvent(time, type, durations[type], intensity, eventColor(theme, index), index % 5));
    index += 1;
  }

  // Section arrivals bloom: hue wash + a firework salvo.
  for (const section of SECTIONS.slice(1)) {
    events.push(makeVisualEvent(section.start, "hueBloom", 1.9, 0.72, eventColor(theme, section.start), 0));
    events.push(makeVisualEvent(section.start + 0.24, "firework", 1.7, 0.8, eventColor(theme, section.start + 1), 2));
    events.push(makeVisualEvent(section.start + 0.55, "firework", 1.7, 0.72, eventColor(theme, section.start + 2), 3));
  }

  // Entering a spam corridor kicks in radial speed lines.
  let lastSpeedLine = -99;
  let speedLineCount = 0;
  for (let i = 1; i < nodes.length && speedLineCount < 14; i += 1) {
    if (nodes[i].spam && !nodes[i - 1].spam && nodes[i].time - lastSpeedLine > 6) {
      events.push(makeVisualEvent(nodes[i].time, "speedLines", 1.3, 0.78, eventColor(theme, i), i % 5));
      lastSpeedLine = nodes[i].time;
      speedLineCount += 1;
    }
  }

  for (const node of nodes.filter((n) => n.checkpoint && n.time > 1)) {
    events.push(makeVisualEvent(node.time, "backgroundBurst", 0.6, 0.66, eventColor(theme, 2), node.id % 4));
    events.push(makeVisualEvent(Math.max(0, node.time - 0.22), "nebulaPulse", 1.05, 0.52, eventColor(theme, 0), (node.id + 1) % 4));
  }
  for (const node of nodes.filter((n) => n.powerup)) {
    events.push(makeVisualEvent(node.time, "starfall", 0.72, 0.62, "#39FF14", node.id % 5));
  }

  return events
    .filter((event) => event.time >= 0 && event.time <= 149.7)
    .sort((a, b) => a.time - b.time)
    .filter((event, i, sorted) => {
      const previous = sorted[i - 1];
      return !previous || event.type !== previous.type || event.time - previous.time > 0.16;
    });
}

// ---------------------------------------------------------------------------
// Assemble and write.
// ---------------------------------------------------------------------------

function buildBeatmap(level, levelIndex, trackMeta) {
  const nodes = buildNodes(level, trackMeta);
  const checkpoints = createCheckpoints(nodes);
  for (const checkpoint of checkpoints) {
    const node = nodes[checkpoint.nodeIndex];
    node.checkpoint = true;
    node.cameraCue = "zoomOutDrop";
    if (node.powerup) {
      // Keep checkpoints and powerups on separate tiles.
      node.powerup = false;
      const neighbor = nodes[checkpoint.nodeIndex + 1] || nodes[checkpoint.nodeIndex - 1];
      if (neighbor) neighbor.powerup = true;
    }
  }
  const visualEvents = buildVisualEvents(nodes, level.theme, levelIndex, Boolean(level.ultra));
  const segments = level.files.map((file, index) => {
    const meta = trackMeta.get(file);
    return {
      file,
      levelStart: index * SEGMENT_SECONDS,
      sourceStart: 0,
      duration: SEGMENT_SECONDS,
      detectedBpm: meta.detectedBpm,
      beatInterval: meta.beatInterval,
      firstBeatPhase: meta.firstBeatPhase,
      onsetCount: meta.onsetCount,
    };
  });

  const intervals = nodes.slice(1).map((n) => n.interval);
  return {
    schemaVersion: 2,
    generatorVersion: GENERATOR_VERSION,
    id: level.id,
    title: level.title,
    subtitle: level.subtitle,
    ultra: Boolean(level.ultra),
    levelTheme: level.theme,
    levelDesignNotes: level.designNotes,
    visualEvents,
    duration: LEVEL_SECONDS,
    difficulty: {
      label: level.difficulty,
      target: "one-button orbit timing with pattern-based click-density choreography",
      notes:
        "Slow half-time glides, per-beat corridors, eighth-note geometry, and capped burst sprints alternate across the six musical sections.",
    },
    audio: {
      strategy: "Five supplied clips scheduled as 30 second segments for an exact 2:30 level.",
      segments,
    },
    timing: {
      inputOffsetSeconds: 0,
      // "Area of eligibility" doubled: every hit window is 2x the v2 size.
      windows: { perfect: 0.09, good: 0.17, miss: 0.27 },
    },
    sections: SECTIONS.map((s) => ({ label: s.label, start: s.start, end: s.end })),
    checkpoints,
    cameraCues: nodes
      .filter((node) => node.cameraCue || node.checkpoint)
      .map((node) => ({
        time: node.time,
        nodeIndex: node.id,
        type: node.checkpoint ? "checkpoint" : "pattern cue",
        cue: node.cameraCue,
      })),
    nodes,
    debug: {
      generatedAt: new Date().toISOString(),
      generator: "scripts/build-levels.mjs",
      densityProfile: {
        nodeCount: nodes.length,
        minInterval: Number(Math.min(...intervals).toFixed(3)),
        maxInterval: Number(Math.max(...intervals).toFixed(3)),
        fastNodes: intervals.filter((v) => v < 0.2).length,
        slowNodes: intervals.filter((v) => v > 0.7).length,
        spamNodes: nodes.filter((n) => n.spam).length,
        powerups: nodes.filter((n) => n.powerup).length,
      },
    },
  };
}

// Assign a maximally-mixed set of 5 songs to every level, over all 20 tracks:
//  - no song repeats inside a level,
//  - every level's ordered sequence is unique (no repeated tune order),
//  - every level's unordered set is unique,
//  - usage is spread evenly across all 20 songs,
//  - consecutive levels overlap as little as possible,
//  - a gentle tempo gradient (slower songs early, faster later) so the
//    existing difficulty ramp is preserved / reinforced.
function assignSongs(levels, trackMeta) {
  const tracks = ALL_TRACKS.filter((f) => trackMeta.has(f));
  const bpm = (f) => trackMeta.get(f)?.detectedBpm || 120;
  const rng = mulberry32(hashSeed("beatpress-songmix-v2"));
  const usage = new Map(tracks.map((t) => [t, 0]));
  const usedTuples = new Set();
  const usedSets = new Set();
  let prev = new Set();

  for (let li = 0; li < levels.length; li += 1) {
    const frac = levels.length > 1 ? li / (levels.length - 1) : 0;
    // Center on the songs' faster range so even level 1 keeps a healthy tile
    // density; the gradient still trends up so difficulty ramps.
    const targetBpm = 128 + frac * 26; // ~128 BPM at level 1 -> ~154 at the end
    let chosen = null;
    for (let attempt = 0; attempt < 1500 && !chosen; attempt += 1) {
      const jitter = 0.4 + attempt * 0.02;
      const scored = tracks
        .map((t) => [
          t,
          usage.get(t) * 1.5 +
            (prev.has(t) ? 2.0 : 0) +
            Math.abs(bpm(t) - targetBpm) / 22 +
            rng() * jitter,
        ])
        .sort((a, b) => a[1] - b[1]);
      const pick = scored.slice(0, 5).map((x) => x[0]);
      for (let i = pick.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [pick[i], pick[j]] = [pick[j], pick[i]];
      }
      const tupleKey = pick.join("|");
      const setKey = [...pick].sort().join("|");
      if (usedTuples.has(tupleKey)) continue;
      if (usedSets.has(setKey) && attempt < 1200) continue; // only reuse a set if truly stuck
      chosen = { pick, tupleKey, setKey };
    }
    if (!chosen) {
      const pick = [...tracks].sort(() => rng() - 0.5).slice(0, 5);
      chosen = { pick, tupleKey: pick.join("|"), setKey: [...pick].sort().join("|") };
    }
    levels[li].files = chosen.pick;
    usedTuples.add(chosen.tupleKey);
    usedSets.add(chosen.setKey);
    chosen.pick.forEach((t) => usage.set(t, usage.get(t) + 1));
    prev = new Set(chosen.pick);
  }
  return usage;
}

function main() {
  const trackMeta = harvestTrackMeta();
  // Re-mix every level's songs across the full 20-track pool.
  assignSongs(LEVELS, trackMeta);

  const missing = [];
  for (const level of LEVELS) {
    for (const file of level.files) if (!trackMeta.has(file)) missing.push(file);
  }
  if (missing.length) {
    throw new Error(`Missing audio analysis metadata for: ${[...new Set(missing)].join(", ")}`);
  }

  mkdirSync(distDir, { recursive: true });
  LEVELS.forEach((level, index) => {
    const beatmap = buildBeatmap(level, index, trackMeta);
    const outPath = join(distDir, `${level.id}.beatstar.json`);
    // Minify the giant impossible-tier beatmaps to keep file sizes sane; keep
    // the smaller levels pretty-printed for readability.
    const pretty = beatmap.nodes.length <= 2500;
    writeFileSync(outPath, `${JSON.stringify(beatmap, null, pretty ? 2 : 0)}\n`, "utf8");
    const d = beatmap.debug.densityProfile;
    console.log(
      `${level.title} (${level.difficulty}): ${d.nodeCount} nodes, interval ${d.minInterval}-${d.maxInterval}s, ` +
        `${d.fastNodes} fast, ${d.slowNodes} slow, ${d.powerups} powerups`,
    );
  });
}

main();
