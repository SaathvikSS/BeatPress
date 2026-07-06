import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { TRACK_ORDER } from "../src/config.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const GENERATOR_VERSION = "2.1";
const APPROVED_EVENT_COLORS = ["#FF4FCB", "#4FFFEF", "#FFDD00", "#A855F7", "#FF6B35", "#39FF14"];
const SPACING = {
  fast: 81,
  normal: 88,
  slow: 104,
  accent: 5,
};
const chromeCandidates = [
  process.env.BEATSTAR_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

const root = resolve(process.cwd());
const beatmapDir = resolve(root, "beatmaps");
const sourceDir = resolve(beatmapDir, "source");
const outDir = resolve(beatmapDir, "dist");
const levels = [
  {
    id: "level1",
    title: "Neon Drift",
    subtitle: "Deep-space starter route",
    files: TRACK_ORDER.slice(0, 5),
    difficulty: "Medium",
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
      mainRhythmMotif: "clean right-angle orbit turns with readable four-beat phrases",
      denseSections: ["first complexity increase", "final challenge phrase"],
      visualTheme: "open deep-space lanes with cyan and magenta orbit energy",
      cameraPersonality: "gentle hit bumps and restrained phrase zooms",
      readabilityRisks: ["intro glow can hide early tiles if over-brightened"],
    },
  },
  {
    id: "level2",
    title: "Nebula Run",
    subtitle: "Storm-lit syncopation",
    files: TRACK_ORDER.slice(5, 10),
    difficulty: "Advanced",
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
      mainRhythmMotif: "call-and-response turns with sharper accent reversals",
      denseSections: ["call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "violet nebula pressure with fast cyan route flashes",
      cameraPersonality: "stronger accent bumps and controlled section rolls",
      readabilityRisks: ["ship flybys must stay behind the path during syncopation"],
    },
  },
];

levels.push(
  {
    id: "level3",
    title: "Crystal Orbit",
    subtitle: "Angular hard route",
    files: [TRACK_ORDER[1], TRACK_ORDER[3], TRACK_ORDER[5], TRACK_ORDER[7], TRACK_ORDER[9]],
    difficulty: "Hard",
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
      mainRhythmMotif: "angular crystal turns with short readable bursts and phrase-ending drops",
      denseSections: ["first complexity increase", "visual highlight section", "final challenge phrase"],
      visualTheme: "cyan crystal route cuts through violet digital space with drone flybys",
      cameraPersonality: "bold intro zoom, readable twist cues, and wider drop framing",
      readabilityRisks: ["laser sweeps must stay thin during dense burst sections"],
    },
  },
  {
    id: "level4",
    title: "Solar Flare",
    subtitle: "Burning orbit gauntlet",
    files: [TRACK_ORDER[0], TRACK_ORDER[2], TRACK_ORDER[4], TRACK_ORDER[6], TRACK_ORDER[8]],
    difficulty: "Expert",
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
      mainRhythmMotif: "aggressive sharp turns with rapid fire sequences and dramatic drops",
      denseSections: ["first complexity increase", "call-and-response pattern", "final challenge phrase"],
      visualTheme: "blazing solar surface with corona flares and molten particle streams",
      cameraPersonality: "bold zoom punches on accents with sweeping rotation on phrase boundaries",
      readabilityRisks: ["ember particles must not obscure tiles during rapid sections"],
    },
  },
  {
    id: "level5",
    title: "Void Walker",
    subtitle: "Into the abyss",
    files: [TRACK_ORDER[1], TRACK_ORDER[4], TRACK_ORDER[7], TRACK_ORDER[2], TRACK_ORDER[9]],
    difficulty: "Expert+",
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
      mainRhythmMotif: "unpredictable direction changes with tight syncopated bursts",
      denseSections: ["first complexity increase", "visual highlight section", "final challenge phrase"],
      visualTheme: "deep void darkness with violet digital glitch tears and cyan energy fractures",
      cameraPersonality: "dramatic twist cues and heavy zoom drops on section boundaries",
      readabilityRisks: ["dark background must maintain tile contrast"],
    },
  },
  {
    id: "level6",
    title: "Neon Circuit",
    subtitle: "Gridline velocity",
    files: [TRACK_ORDER[3], TRACK_ORDER[6], TRACK_ORDER[0], TRACK_ORDER[8], TRACK_ORDER[5]],
    difficulty: "Hard",
    theme: {
      name: "Neon Circuit",
      backgroundMode: "neonCircuit",
      primaryColor: "#39FF14",
      secondaryColor: "#4FFFEF",
      accentColor: "#FFDD00",
      particleStyle: "sparks",
      shipStyle: "angular",
      cameraIntensity: 0.74,
      backgroundIntensity: 0.68,
    },
    designNotes: {
      mainRhythmMotif: "clean geometric patterns with satisfying 90-degree locks and circuit-board routing",
      denseSections: ["call-and-response pattern", "final challenge phrase"],
      visualTheme: "neon green circuit board grid with digital pulse lines and data flow particles",
      cameraPersonality: "precise controlled movements with snappy grid-aligned rotations",
      readabilityRisks: ["green glow must not wash out tile outlines"],
    },
  },
  {
    id: "level7",
    title: "Starfall Rush",
    subtitle: "Cosmic cascade",
    files: [TRACK_ORDER[9], TRACK_ORDER[5], TRACK_ORDER[1], TRACK_ORDER[7], TRACK_ORDER[3]],
    difficulty: "Insane",
    theme: {
      name: "Starfall Rush",
      backgroundMode: "starfallRush",
      primaryColor: "#FFDD00",
      secondaryColor: "#4FFFEF",
      accentColor: "#FF4FCB",
      particleStyle: "comets",
      shipStyle: "droneSwarm",
      cameraIntensity: 0.98,
      backgroundIntensity: 0.86,
    },
    designNotes: {
      mainRhythmMotif: "relentless cascading patterns with spiral formations and speed ramps",
      denseSections: ["first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "gold and white star shower with rainbow prismatic accents and comet trails",
      cameraPersonality: "intense continuous motion with aggressive zoom and rotation",
      readabilityRisks: ["comet particles need low opacity during dense spiral sections"],
    },
  },
  {
    id: "level8",
    title: "Omega Drive",
    subtitle: "The final convergence",
    files: [TRACK_ORDER[0], TRACK_ORDER[3], TRACK_ORDER[6], TRACK_ORDER[9], TRACK_ORDER[5]],
    difficulty: "Extreme",
    theme: {
      name: "Omega Drive",
      backgroundMode: "omegaDrive",
      primaryColor: "#FF4FCB",
      secondaryColor: "#4FFFEF",
      accentColor: "#A855F7",
      particleStyle: "rings",
      shipStyle: "droneSwarm",
      cameraIntensity: 1.0,
      backgroundIntensity: 0.92,
    },
    designNotes: {
      mainRhythmMotif: "all-out technical patterns mixing every motif type with extreme direction changes",
      denseSections: ["intro groove setup", "first complexity increase", "call-and-response pattern", "visual highlight section", "final challenge phrase"],
      visualTheme: "shifting chromatic energy field with all visual elements combined at maximum intensity",
      cameraPersonality: "maximal dynamic camera with heavy twist, zoom, and roll on every accent",
      readabilityRisks: ["visual density must be managed through automatic readability scaling"],
    },
  },
);

const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
};

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const filePath = resolve(join(root, pathname));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(readFileSync(filePath));
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

async function analyzeAudioInBrowser(baseUrl, files) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto(baseUrl);
  const analyses = await page.evaluate(async (trackFiles) => {
    const context = new AudioContext();

    function percentile(values, p) {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
      return sorted[index];
    }

    function median(values) {
      return percentile(values, 0.5);
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function estimateTempo(peaks, duration) {
      const strong = peaks
        .filter((peak) => peak.time > 0.1 && peak.time < duration - 0.1)
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 42);
      let best = { bpm: 120, interval: 0.5, phase: 0.5, score: -Infinity };
      for (let bpm = 86; bpm <= 156; bpm += 1) {
        const interval = 60 / bpm;
        const phaseCandidates = strong.slice(0, 14).map((peak) => ((peak.time % interval) + interval) % interval);
        phaseCandidates.push(0);
        for (const phase of phaseCandidates) {
          let score = 0;
          for (const peak of strong) {
            const beat = phase + Math.round((peak.time - phase) / interval) * interval;
            const dist = Math.abs(peak.time - beat);
            if (dist < 0.095) score += peak.strength * (1 - dist / 0.095);
          }
          const beatCount = Math.floor((duration - phase) / interval);
          score += Math.max(0, Math.min(8, beatCount)) * 0.02;
          if (score > best.score) best = { bpm, interval, phase, score };
        }
      }
      while (best.phase < 0.34) best.phase += best.interval;
      return best;
    }

    async function analyze(file) {
      const response = await fetch(`/${encodeURIComponent(file)}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(arrayBuffer);
      const duration = audioBuffer.duration;
      const sampleRate = audioBuffer.sampleRate;
      const frame = 1024;
      const hop = 512;
      const usableSamples = Math.floor(Math.min(duration, 30) * sampleRate);
      const energies = [];
      const channels = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) channels.push(audioBuffer.getChannelData(c));

      for (let i = 0; i + frame < usableSamples; i += hop) {
        let sum = 0;
        let highMotion = 0;
        for (let j = 0; j < frame; j += 4) {
          let sample = 0;
          for (const channel of channels) sample += channel[i + j] || 0;
          sample /= channels.length;
          const prev = j >= 4 ? channels[0][i + j - 4] || 0 : sample;
          sum += sample * sample;
          highMotion += Math.abs(sample - prev);
        }
        const rms = Math.sqrt(sum / (frame / 4));
        energies.push(rms + highMotion * 0.018);
      }

      const flux = [];
      for (let i = 1; i < energies.length; i += 1) flux.push(Math.max(0, energies[i] - energies[i - 1]));
      const baseline = median(flux);
      const strongLine = percentile(flux, 0.86);
      const maxFlux = Math.max(...flux, 0.00001);
      const peaks = [];
      let lastPeakTime = -1;
      for (let i = 2; i < flux.length - 2; i += 1) {
        const time = (i * hop) / sampleRate;
        const local = flux.slice(Math.max(0, i - 16), Math.min(flux.length, i + 17));
        const threshold = Math.max(baseline * 1.45, percentile(local, 0.72), strongLine * 0.42);
        const isPeak = flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1];
        if (isPeak && time - lastPeakTime > 0.145) {
          peaks.push({
            time,
            strength: clamp(flux[i] / maxFlux, 0, 1),
            energy: energies[i],
          });
          lastPeakTime = time;
        }
      }
      const tempo = estimateTempo(peaks, Math.min(duration, 30));
      const half = Math.min(duration, 30) / 2;
      const firstHalf = estimateTempo(peaks.filter((peak) => peak.time <= half), half);
      const secondHalf = estimateTempo(
        peaks.filter((peak) => peak.time > half).map((peak) => ({ ...peak, time: peak.time - half })),
        half,
      );
      return {
        file,
        duration,
        bpm: tempo.bpm,
        beatInterval: tempo.interval,
        phase: tempo.phase,
        score: tempo.score,
        onsets: peaks,
        tempoChanges: [
          { time: 0, bpm: firstHalf.bpm, confidence: firstHalf.score },
          { time: half, bpm: secondHalf.bpm, confidence: secondHalf.score },
        ],
      };
    }

    return Promise.all(trackFiles.map((file) => analyze(file)));
  }, files);
  await browser.close();
  return analyses;
}

async function launchBrowser() {
  for (const executablePath of chromeCandidates) {
    try {
      return await chromium.launch({
        headless: true,
        executablePath,
        args: ["--autoplay-policy=no-user-gesture-required"],
      });
    } catch {
      // Try the next local browser candidate.
    }
  }
  return chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
}

function sectionFor(time) {
  if (time < 20) return "intro groove setup";
  if (time < 48) return "first complexity increase";
  if (time < 78) return "call-and-response pattern";
  if (time < 108) return "visual highlight section";
  if (time < 140) return "final challenge phrase";
  return "ending resolution";
}

function sectionIntensity(time) {
  if (time < 20) return 0.34;
  if (time < 48) return 0.48;
  if (time < 78) return 0.62;
  if (time < 108) return 0.76;
  if (time < 140) return 0.9;
  return 0.56;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function chooseTurn(index, node, previous, levelIndex) {
  const time = node.time;
  const interval = previous ? node.time - previous.time : 0.5;
  const phrase = Math.floor(time / 8) % 4;
  const intro = time < 20;
  const motifA = [90, -90, 120, -60, 90, 60, -120, 90];
  const motifB = [-90, -120, 60, 90, -60, 120, -90, 60];
  const motifC = [60, 60, 90, 120, -90, -60, -120, 90];
  const motifD = [120, -60, -90, 60, 90, -120, 60, 90];
  const motifE = [120, -90, 60, 150, -120, 90, -60, 120];
  const motifF = [-120, 90, -90, 60, 120, -150, 90, -60];
  const motifSets = [
    [motifA, motifC, motifB, motifD],
    [motifB, motifD, motifA, motifC],
    [motifE, motifC, motifF, motifD],
    [motifE, motifD, motifA, motifF],
    [motifF, motifE, motifB, motifC],
    [motifA, motifB, motifC, motifD],
    [motifE, motifF, motifE, motifA],
    [motifF, motifD, motifE, motifB],
  ];
  const motifs = motifSets[levelIndex] || motifSets[0];
  let turn = motifs[phrase][index % motifs[phrase].length];

  if (intro) {
    const introMotif = [90, -90, 90, 120, -90, 60, -120, 90];
    turn = introMotif[index % introMotif.length];
  }
  if (time > 48 && time < 78 && Math.floor(index / 8) % 2 === 1) turn *= -1;
  if (time > 78 && time < 108 && index % 5 === 0) turn = node.accent ? 120 : 60;
  if (time > 108 && time < 140 && interval < 0.34) turn = index % 2 === 0 ? 60 : -60;
  if (time > 140) turn = [90, -60, 60, -90, 120, -120][index % 6];
  if (levelIndex === 2 && time > 34 && time < 136) {
    if (index % 9 === 0) turn = turn > 0 ? 150 : -150;
    else if (index % 5 === 0) turn = turn > 0 ? 120 : -120;
  }
  if (node.accent && Math.abs(turn) < 90) turn = turn > 0 ? 120 : -120;
  return turn;
}

function placeNodeWithAvoidance(nodes, x, y, heading, preferredTurn, distance, index) {
  const sign = preferredTurn >= 0 ? 1 : -1;
  const candidates = [
    preferredTurn,
    preferredTurn + sign * 60,
    preferredTurn - sign * 60,
    sign * 90,
    -sign * 90,
    sign * 120,
    -sign * 120,
    sign * 60,
    -sign * 60,
  ];
  const uniqueTurns = [...new Set(candidates.map((turn) => Math.max(-150, Math.min(150, Math.round(turn / 30) * 30))))];
  let best = null;

  for (const turn of uniqueTurns) {
    if (Math.abs(turn) < 45) continue;
    const candidateHeading = heading + turn;
    const nx = x + Math.cos((candidateHeading * Math.PI) / 180) * distance;
    const ny = y + Math.sin((candidateHeading * Math.PI) / 180) * distance;
    let minDistance = Infinity;
    for (let i = 0; i < Math.max(0, nodes.length - 7); i += 1) {
      minDistance = Math.min(minDistance, Math.hypot(nx - nodes[i].x, ny - nodes[i].y));
    }
    const deviationPenalty = Math.abs(turn - preferredTurn) * 0.56;
    const overlapPenalty = minDistance < 58 ? 260 : minDistance < 76 ? 90 : 0;
    const expansionBonus = Math.min(90, Math.hypot(nx, ny) * 0.025);
    const phraseBias = index % 16 < 8 ? (turn === preferredTurn ? 14 : 0) : 0;
    const score = Math.min(minDistance, 260) - deviationPenalty - overlapPenalty + expansionBonus + phraseBias;
    if (!best || score > best.score) {
      best = { x: nx, y: ny, heading: candidateHeading, turn, score };
    }
  }

  return best || {
    x: x + Math.cos(((heading + preferredTurn) * Math.PI) / 180) * distance,
    y: y + Math.sin(((heading + preferredTurn) * Math.PI) / 180) * distance,
    heading: heading + preferredTurn,
    turn: preferredTurn,
  };
}

function addBeatTimesForSegment(analysis, segmentStart, globalTimes, levelIndex) {
  const duration = 30;
  const beatTimes = [];
  for (let t = analysis.phase; t < duration - 0.12; t += analysis.beatInterval) {
    if (segmentStart === 0 && t < 0.74) continue;
    beatTimes.push({
      time: segmentStart + t,
      sourceTime: t,
      strength: 0.48,
      accent: Math.round((t - analysis.phase) / analysis.beatInterval) % 4 === 0,
      beat: true,
    });
  }

  const existing = (time) => beatTimes.some((beat) => Math.abs(beat.sourceTime - time) < 0.1);
  for (const onset of analysis.onsets) {
    const globalTime = segmentStart + onset.time;
    if (globalTime < 18 || globalTime > 142) continue;
    if (existing(onset.time)) {
      const nearby = beatTimes.find((beat) => Math.abs(beat.sourceTime - onset.time) < 0.1);
      if (nearby) {
        nearby.strength = Math.max(nearby.strength, onset.strength);
        nearby.accent = nearby.accent || onset.strength > 0.64;
      }
      continue;
    }
    const complexity = sectionIntensity(globalTime);
    const levelTwoAccent = levelIndex === 1 && globalTime > 58 && globalTime < 136 && onset.strength > 0.6;
    const levelTwoSubdivision = levelIndex === 1 && globalTime > 88 && globalTime < 120 && onset.strength > 0.36;
    const levelThreeAccent = levelIndex === 2 && globalTime > 34 && globalTime < 142 && onset.strength > 0.52;
    const levelThreeSubdivision = levelIndex === 2 && globalTime > 62 && globalTime < 132 && onset.strength > 0.32;
    const allowed =
      onset.strength >
        0.48 + (1 - complexity) * 0.18 - (levelTwoAccent ? 0.1 : 0) - (levelThreeAccent ? 0.12 : 0) ||
      levelTwoSubdivision ||
      levelThreeSubdivision;
    const cadenceGate =
      globalTime < 48
        ? Math.floor(globalTime * 2) % 7 === 0
        : levelIndex === 2
        ? Math.floor(globalTime * 4) % 7 !== 0
        : Math.floor(globalTime * 3) % 5 !== 0;
    if (allowed && (cadenceGate || levelTwoAccent || levelTwoSubdivision || levelThreeAccent || levelThreeSubdivision)) {
      beatTimes.push({
        time: globalTime,
        sourceTime: onset.time,
        strength: onset.strength,
        accent: onset.strength > (levelIndex === 2 ? 0.58 : 0.68),
        beat: false,
      });
    }
  }

  beatTimes.sort((a, b) => a.time - b.time);
  for (const candidate of beatTimes) {
    const prev = globalTimes[globalTimes.length - 1];
    if (prev && candidate.time - prev.time < 0.225) {
      if (candidate.strength > prev.strength + 0.12 && !prev.accent) globalTimes[globalTimes.length - 1] = candidate;
      continue;
    }
    globalTimes.push(candidate);
  }
}

function cameraCueForNode({ sectionBoundary, raw, turn, interval, levelIndex, index }) {
  if (sectionBoundary) {
    if (levelIndex === 2 && Math.abs(turn) >= 120) return "twistHeavy";
    return turn >= 0 ? "rollRight" : "rollLeft";
  }
  if (raw.accent && interval > 0.62) return "zoomOutDrop";
  if (raw.accent) return levelIndex === 2 && index % 5 === 0 ? "twistLight" : "zoomInHit";
  if (levelIndex === 2 && Math.abs(turn) >= 120 && index % 7 === 0) return turn >= 0 ? "rollRight" : "rollLeft";
  return null;
}

function eventColor(theme, fallbackIndex = 0) {
  const candidates = [theme.primaryColor, theme.secondaryColor, theme.accentColor, APPROVED_EVENT_COLORS[fallbackIndex]];
  return candidates.find((color) => APPROVED_EVENT_COLORS.includes(String(color).toUpperCase())) || "#4FFFEF";
}

function makeVisualEvent(time, type, duration, intensity, color, lane) {
  return {
    time: Number(time.toFixed(3)),
    type,
    duration: Number(duration.toFixed(3)),
    intensity: Number(clampNumber(intensity, 0.2, 1).toFixed(3)),
    color,
    lane,
  };
}

function buildVisualEvents(nodes, theme, levelIndex) {
  const primary = eventColor(theme, 1);
  const secondary = eventColor(theme, 0);
  const accent = eventColor(theme, 2);
  const events = [
    makeVisualEvent(0.42, "backgroundBurst", 0.7, 0.72 + levelIndex * 0.08, accent, 0),
    makeVisualEvent(0.82, "laserSweep", 0.58, 0.72 + levelIndex * 0.06, secondary, 1),
    makeVisualEvent(1.18, "shipFlyby", 1.35, 0.78 + levelIndex * 0.04, primary, 2),
    makeVisualEvent(1.78, "starfall", 0.9, 0.7, secondary, 3),
    makeVisualEvent(2.36, "nebulaPulse", 1.25, 0.62, primary, 1),
  ];
  const checkpointNodes = nodes.filter((node) => node.checkpoint);
  const accentNodes = nodes.filter((node) => node.accent && node.time > 6 && node.time < 146);
  const timelineStep = levelIndex === 0 ? 2.35 : levelIndex === 1 ? 2.08 : 1.82;
  const timelineTypes =
    levelIndex === 0
      ? ["starfall", "nebulaPulse", "shipFlyby", "laserSweep"]
      : levelIndex === 1
      ? ["nebulaPulse", "starfall", "laserSweep", "shipFlyby", "backgroundBurst"]
      : ["laserSweep", "shipFlyby", "starfall", "nebulaPulse", "backgroundBurst"];

  for (let time = 3.4; time < 148.4; time += timelineStep) {
    const index = Math.floor((time - 3.4) / timelineStep);
    const type = timelineTypes[index % timelineTypes.length];
    const intensity = 0.26 + sectionIntensity(time) * 0.42 + (index % 4 === 0 ? 0.08 : 0) + levelIndex * 0.035;
    const duration =
      type === "shipFlyby" ? 1.08 : type === "nebulaPulse" ? 0.92 : type === "backgroundBurst" ? 0.5 : type === "starfall" ? 0.58 : 0.34;
    const color = index % 3 === 0 ? primary : index % 3 === 1 ? secondary : accent;
    events.push(makeVisualEvent(time + (index % 2 ? 0.07 : 0), type, duration, intensity, color, index % 5));
  }

  for (const node of checkpointNodes.slice(1)) {
    events.push(makeVisualEvent(node.time, "backgroundBurst", 0.62, 0.66 + levelIndex * 0.08, accent, node.id % 4));
    events.push(makeVisualEvent(Math.max(0, node.time - 0.24), "nebulaPulse", 1.08, 0.54, primary, (node.id + 1) % 4));
    if (node.time > 30) events.push(makeVisualEvent(node.time + 0.16, "laserSweep", 0.46, 0.55, secondary, node.id % 3));
  }

  accentNodes.forEach((node, index) => {
    if (index % (levelIndex === 2 ? 10 : 14) === 0) {
      events.push(makeVisualEvent(node.time - 0.08, "shipFlyby", 1.2, 0.45 + node.visualIntensity * 0.36, primary, index % 4));
    }
    if (index % (levelIndex === 2 ? 8 : 12) === 3) {
      events.push(makeVisualEvent(node.time, "starfall", 0.68, 0.38 + node.visualIntensity * 0.32, secondary, index % 5));
    }
    if (index % (levelIndex === 2 ? 13 : 18) === 7) {
      events.push(makeVisualEvent(node.time + 0.04, "laserSweep", 0.38, 0.36 + node.visualIntensity * 0.24, accent, index % 3));
    }
  });

  return events
    .filter((event) => event.time >= 0 && event.time <= 149.7)
    .sort((a, b) => a.time - b.time)
    .filter((event, index, sorted) => {
      const previous = sorted[index - 1];
      return !previous || event.type !== previous.type || event.time - previous.time > 0.16;
    });
}

function buildBeatmap(level, analyses, levelIndex) {
  const rawTimes = [{ time: 0, sourceTime: 0, strength: 0.8, accent: true, beat: true }];
  analyses.forEach((analysis, segmentIndex) => {
    addBeatTimesForSegment(analysis, segmentIndex * 30, rawTimes, levelIndex);
  });
  if (rawTimes[rawTimes.length - 1].time < 148.8) {
    rawTimes.push({ time: 149.25, sourceTime: 29.25, strength: 0.68, accent: true, beat: true });
  }
  rawTimes.sort((a, b) => a.time - b.time);

  let heading = levelIndex === 0 ? -18 : levelIndex === 1 ? -144 : -72;
  let x = 0;
  let y = 0;
  const nodes = [
    {
      id: 0,
      time: 0,
      x,
      y,
      angle: heading,
      turnDegrees: 0,
      spin: 1,
      interval: 0,
      accent: true,
      sourceBeat: true,
      section: "intro groove setup",
      visualIntensity: 0.44,
      cameraCue: "zoomOutDrop",
      checkpoint: true,
    },
  ];

  for (let i = 1; i < rawTimes.length; i += 1) {
    const raw = rawTimes[i];
    const previous = rawTimes[i - 1];
    const interval = raw.time - previous.time;
    const section = sectionFor(raw.time);
    const visualIntensity = Math.min(1, sectionIntensity(raw.time) + raw.strength * 0.24 + (raw.accent ? 0.12 : 0));
    const preferredTurn = chooseTurn(i, raw, previous, levelIndex);
    let distance = SPACING.normal;
    if (interval < 0.34) distance = SPACING.fast;
    else if (interval > 0.72) distance = SPACING.slow;
    if (raw.accent) distance += SPACING.accent + (levelIndex === 2 ? 3 : 0);
    const placed = placeNodeWithAvoidance(nodes, x, y, heading, preferredTurn, distance, i);
    heading = placed.heading;
    x = placed.x;
    y = placed.y;
    const turn = placed.turn;
    const sectionBoundary = [20, 48, 78, 108, 140].some((mark) => Math.abs(raw.time - mark) < interval * 0.7);
    const cameraCue = cameraCueForNode({ sectionBoundary, raw, turn, interval, levelIndex, index: i });
    nodes.push({
      id: nodes.length,
      time: Number(raw.time.toFixed(3)),
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      angle: Number((((heading % 360) + 360) % 360).toFixed(3)),
      turnDegrees: turn,
      spin: turn >= 0 ? 1 : -1,
      interval: Number(interval.toFixed(3)),
      accent: Boolean(raw.accent),
      sourceBeat: Boolean(raw.beat),
      sourceTime: Number(raw.sourceTime.toFixed(3)),
      section,
      visualIntensity: Number(visualIntensity.toFixed(3)),
      cameraCue,
      checkpoint: false,
    });
  }

  centerNodes(nodes);
  const checkpoints = createCheckpoints(nodes);
  for (const checkpoint of checkpoints) {
    nodes[checkpoint.nodeIndex].checkpoint = true;
    nodes[checkpoint.nodeIndex].cameraCue = "zoomOutDrop";
  }
  const visualEvents = buildVisualEvents(nodes, level.theme, levelIndex);

  return {
    schemaVersion: 2,
    generatorVersion: GENERATOR_VERSION,
    id: level.id,
    title: level.title,
    subtitle: level.subtitle,
    levelTheme: level.theme,
    levelDesignNotes: level.designNotes,
    visualEvents,
    duration: 150,
    difficulty: {
      label: level.difficulty,
      target: "strict but fair one-button orbit timing",
      notes:
        "First 20 seconds are mostly clear beat-grid inputs; later sections add measured syncopation, arcs, spirals, bursts, and call-response turns.",
    },
    audio: {
      strategy: "Five supplied clips scheduled as 30 second segments for an exact 2:30 level.",
      segments: analyses.map((analysis, index) => ({
        file: analysis.file,
        levelStart: index * 30,
        sourceStart: 0,
        duration: 30,
        detectedBpm: analysis.bpm,
        beatInterval: Number(analysis.beatInterval.toFixed(4)),
        firstBeatPhase: Number(analysis.phase.toFixed(4)),
        onsetCount: analysis.onsets.length,
      })),
    },
    timing: {
      inputOffsetSeconds: 0,
      windows: {
        perfect: 0.045,
        good: 0.085,
        miss: 0.135,
      },
    },
    sections: [
      { label: "intro groove setup", start: 0, end: 20 },
      { label: "first complexity increase", start: 20, end: 48 },
      { label: "call-and-response pattern", start: 48, end: 78 },
      { label: "visual highlight section", start: 78, end: 108 },
      { label: "final challenge phrase", start: 108, end: 140 },
      { label: "ending resolution", start: 140, end: 150 },
    ],
    checkpoints,
    cameraCues: nodes
      .filter((node) => node.cameraCue || node.checkpoint)
      .map((node) => ({
        time: node.time,
        nodeIndex: node.id,
        type: node.checkpoint ? "checkpoint" : "phrase accent",
        cue: node.cameraCue,
      })),
    nodes,
    debug: {
      generatedAt: new Date().toISOString(),
      generator: "scripts/generate-beatmaps.mjs",
      audioAnalysis: analyses.map((analysis) => ({
        file: analysis.file,
        decodedDuration: Number(analysis.duration.toFixed(3)),
        detectedBpm: analysis.bpm,
        tempoChanges: analysis.tempoChanges.map((change) => ({
          time: Number(change.time.toFixed(3)),
          bpm: change.bpm,
          confidence: Number(change.confidence.toFixed(3)),
        })),
        strongestOnsets: analysis.onsets
          .sort((a, b) => b.strength - a.strength)
          .slice(0, 24)
          .sort((a, b) => a.time - b.time)
          .map((onset) => ({
            time: Number(onset.time.toFixed(3)),
            strength: Number(onset.strength.toFixed(3)),
          })),
      })),
    },
  };
}

function centerNodes(nodes) {
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
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
    return {
      label: mark.label,
      time: best.time,
      nodeIndex: best.id,
    };
  });
}

function buildSpamBeatmap(level) {
  const spamInterval = 0.035;
  const nodes = [];
  let x = 0;
  let y = 0;
  let heading = -30;
  const totalSteps = Math.floor(level.duration / spamInterval);
  const turns = [90, -90, 60, -60, 120, -120, 90, -60, 60, 120, -90, -60];

  for (let i = 0; i <= totalSteps; i += 1) {
    const time = Number(Math.min(level.duration, i * spamInterval).toFixed(3));
    const turn = i === 0 ? 0 : turns[(i + Math.floor(time / 4)) % turns.length];
    const accent = i === 0 || i % 16 === 0 || i % 37 === 0;
    if (i > 0) {
      heading += turn;
      const distance = SPACING.spamBase + (accent ? SPACING.spamAccent : 0) + (i % 11 === 0 ? SPACING.spamPeriodic : 0);
      x += Math.cos((heading * Math.PI) / 180) * distance;
      y += Math.sin((heading * Math.PI) / 180) * distance;
    }
    nodes.push({
      id: i,
      time,
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      angle: Number((((heading % 360) + 360) % 360).toFixed(3)),
      turnDegrees: turn,
      spin: turn >= 0 ? 1 : -1,
      interval: i === 0 ? 0 : spamInterval,
      accent,
      sourceBeat: false,
      sourceTime: 0,
      section: time < level.duration * 0.5 ? "spam climb" : "spam overload",
      spam: true,
      visualIntensity: Number(clampNumber(0.52 + (time / level.duration) * 0.42 + (accent ? 0.16 : 0), 0.45, 1).toFixed(3)),
      cameraCue: accent ? { zoom: 0.04, rotation: i % 64 === 0 ? 0.035 : 0, shake: 0.24 } : null,
      checkpoint: i === 0,
    });
  }

  centerNodes(nodes);
  const checkpoints = TRACK_ORDER.map((file, index) => {
    const markTime = index * level.segmentDuration;
    let best = nodes[0];
    for (const node of nodes) {
      if (Math.abs(node.time - markTime) < Math.abs(best.time - markTime)) best = node;
    }
    best.checkpoint = true;
    return {
      label: index === 0 ? "Start" : `Clip ${index + 1}`,
      time: best.time,
      nodeIndex: best.id,
    };
  });

  return {
    schemaVersion: 1,
    id: level.id,
    title: level.title,
    subtitle: level.subtitle,
    mode: level.mode,
    variant: level.variant,
    duration: level.duration,
    spamRules: level.spamRules,
    difficulty: {
      label: level.difficultyLabel,
      target: level.mode === "spam-level" ? "extreme rolling CPS survival" : "one-minute no-fail CPS benchmark",
      notes: "Every accepted key press advances the orbit by one spam node. Audio timing is ignored for gameplay.",
    },
    audio: {
      strategy: `Ten supplied clips scheduled as ${level.segmentDuration} second background segments. Beat and tempo are ignored for gameplay.`,
      segments: TRACK_ORDER.map((file, index) => ({
        file,
        levelStart: index * level.segmentDuration,
        sourceStart: 0,
        duration: level.segmentDuration,
        ignoredForGameplay: true,
      })),
    },
    timing: {
      inputOffsetSeconds: 0,
      windows: { perfect: 0, good: 0, miss: 0 },
    },
    sections: [
      { label: "spam climb", start: 0, end: Number((level.duration * 0.5).toFixed(3)) },
      { label: "spam overload", start: Number((level.duration * 0.5).toFixed(3)), end: level.duration },
    ],
    checkpoints,
    cameraCues: nodes
      .filter((node) => node.checkpoint || node.id % 128 === 0)
      .map((node) => ({ time: node.time, nodeIndex: node.id, type: node.checkpoint ? "clip checkpoint" : "spam accent" })),
    nodes,
    debug: {
      generatedAt: new Date().toISOString(),
      generator: "scripts/generate-beatmaps.mjs",
      audioAnalysis: "ignored for rapid input gameplay",
      spamInterval,
      spamRules: level.spamRules,
    },
  };
}

async function main() {
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(beatmapDir).filter((name) => name.endsWith(".beatstar.json"))) {
    const rootPath = join(beatmapDir, file);
    const sourcePath = join(sourceDir, file);
    if (!existsSync(sourcePath) && statSync(rootPath).isFile()) copyFileSync(rootPath, sourcePath);
  }
  const server = await startServer();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/index.html`;
  try {
    const allAnalyses = await analyzeAudioInBrowser(baseUrl, TRACK_ORDER);
    for (let i = 0; i < levels.length; i += 1) {
      const level = levels[i];
      const analyses = allAnalyses.filter((analysis) => level.files.includes(analysis.file));
      const beatmap = buildBeatmap(level, analyses, i);
      const outputPath = join(outDir, `${level.id}.beatstar.json`);
      writeFileSync(outputPath, `${JSON.stringify(beatmap, null, 2)}\n`, "utf8");
      console.log(
        `${level.title}: ${beatmap.nodes.length} nodes, ${beatmap.checkpoints.length} checkpoints -> ${outputPath}`,
      );
    }
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
