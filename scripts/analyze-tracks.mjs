// Standalone audio-beat analyzer.
//
// Runs every .mp3 in the project root through the Web Audio API in a headless
// browser to detect tempo (BPM), beat interval, first-beat phase, and note
// onsets — the exact analysis the game locks its tiles to — then writes the
// per-track metadata to beatmaps/track-meta.json for build-levels.mjs to use.
//
// Usage: node scripts/analyze-tracks.mjs
//
// Requires Playwright plus a local Chrome/Edge (already used by the original
// generate-beatmaps.mjs). No song is trusted to a hand-guessed BPM; every
// track here is measured from its actual audio.

import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = resolve(process.cwd());
const outDir = resolve(root, "beatmaps");
const outPath = resolve(outDir, "track-meta.json");

const chromeCandidates = [
  process.env.BEATSTAR_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

const contentTypes = { ".html": "text/html", ".mp3": "audio/mpeg" };

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = resolve(join(root, pathname));
    // Path-traversal guard that works on Windows (backslash) and POSIX.
    if (filePath !== root && !filePath.startsWith(root + sep)) {
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

async function launchBrowser() {
  const args = ["--autoplay-policy=no-user-gesture-required"];
  // Prefer installed Chrome/Edge (they ship the MP3 codec); Playwright's
  // bundled Chromium does not decode MP3 and may not be installed at all.
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ headless: true, channel, args });
    } catch {
      // Try the next channel / executable path.
    }
  }
  for (const executablePath of chromeCandidates) {
    try {
      return await chromium.launch({ headless: true, executablePath, args });
    } catch {
      // Try the next local browser candidate.
    }
  }
  return chromium.launch({ headless: true, args });
}

async function analyzeInBrowser(baseUrl, files) {
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
    const median = (values) => percentile(values, 0.5);
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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

    async function analyzeOne(file) {
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
          peaks.push({ time, strength: clamp(flux[i] / maxFlux, 0, 1) });
          lastPeakTime = time;
        }
      }
      const tempo = estimateTempo(peaks, Math.min(duration, 30));
      return {
        file,
        detectedBpm: tempo.bpm,
        beatInterval: tempo.interval,
        firstBeatPhase: tempo.phase,
        onsetCount: peaks.length,
        // Actual detected note hits within the first 30s (the segment length),
        // so the generator can accent tiles on the music's real onsets.
        onsets: peaks.map((peak) => [Number(peak.time.toFixed(3)), Number(peak.strength.toFixed(3))]),
        score: tempo.score,
      };
    }

    async function analyze(file) {
      try {
        return await analyzeOne(file);
      } catch (err) {
        return { file, error: String(err && err.message ? err.message : err) };
      }
    }

    return Promise.all(trackFiles.map((file) => analyze(file)));
  }, files);
  await browser.close();
  return analyses;
}

async function main() {
  const files = readdirSync(root).filter((name) => name.toLowerCase().endsWith(".mp3")).sort();
  if (!files.length) throw new Error("No .mp3 files found in the project root.");
  console.log(`Analyzing ${files.length} tracks...`);

  const server = await startServer();
  const { port } = server.address();
  try {
    const analyses = await analyzeInBrowser(`http://127.0.0.1:${port}/index.html`, files);
    const meta = {};
    const failed = [];
    for (const a of analyses) {
      if (a.error) {
        failed.push(a.file);
        console.warn(`  ! ${a.file}: FAILED to decode (${a.error})`);
        continue;
      }
      meta[a.file] = {
        file: a.file,
        detectedBpm: a.detectedBpm,
        beatInterval: Number(a.beatInterval.toFixed(5)),
        firstBeatPhase: Number(a.firstBeatPhase.toFixed(5)),
        onsetCount: a.onsetCount,
        onsets: a.onsets || [],
      };
      console.log(`  ${a.file}: ${a.detectedBpm} BPM, beat ${a.beatInterval.toFixed(3)}s, phase ${a.firstBeatPhase.toFixed(3)}s, ${a.onsetCount} onsets`);
    }
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    console.log(`Wrote ${Object.keys(meta).length} tracks -> ${outPath}`);
    if (failed.length) console.warn(`Could not decode: ${failed.join(", ")}`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
