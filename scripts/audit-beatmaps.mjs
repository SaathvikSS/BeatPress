import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const beatmapDir = join(root, "beatmaps", "dist");
const beatmapFiles = Array.from({ length: 13 }, (_, i) => `level${i + 1}.beatstar.json`);
const approvedColors = new Set(["#FF4FCB", "#4FFFEF", "#FFDD00", "#A855F7", "#FF6B35", "#39FF14"]);
const visualTypes = new Set([
  "shipFlyby", "laserSweep", "starfall", "nebulaPulse", "backgroundBurst",
  "rocket", "ufo", "firework", "hueBloom", "speedLines",
]);
const cameraCues = new Set(["zoomOutDrop", "zoomInHit", "rollLeft", "rollRight", "twistHeavy", "twistLight", null]);

function fail(message) {
  throw new Error(message);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
}

for (const file of beatmapFiles) auditBeatmap(file);

function auditBeatmap(file) {
  const fullPath = join(beatmapDir, file);
  if (!existsSync(fullPath)) fail(`${file}: missing generated beatmap.`);
  const beatmap = JSON.parse(readFileSync(fullPath, "utf8"));
  if (beatmap.generatorVersion !== "4.0") fail(`${file}: generatorVersion must be 4.0.`);
  if (beatmap.duration !== 150) fail(`${file}: duration must be 150 seconds.`);
  const windows = beatmap.timing?.windows || {};
  if (windows.perfect !== 0.09 || windows.good !== 0.17 || windows.miss !== 0.27) {
    fail(`${file}: timing windows must be the doubled set (0.09/0.17/0.27).`);
  }
  if (!beatmap.levelTheme?.name) fail(`${file}: missing levelTheme.`);
  if (!beatmap.levelDesignNotes?.mainRhythmMotif) fail(`${file}: missing levelDesignNotes.`);
  if (!Array.isArray(beatmap.visualEvents) || beatmap.visualEvents.length < 80) {
    fail(`${file}: expected dense full-level visual event coverage, saw ${beatmap.visualEvents?.length || 0}.`);
  }

  const visualTimes = beatmap.visualEvents.map((event) => Number(event.time)).sort((a, b) => a - b);
  if (visualTimes[0] > 0.5) fail(`${file}: first visual event starts too late.`);
  if (visualTimes[visualTimes.length - 1] < 146) fail(`${file}: final visual event ends too early.`);
  let maxVisualGap = 0;
  for (let i = 1; i < visualTimes.length; i += 1) maxVisualGap = Math.max(maxVisualGap, visualTimes[i] - visualTimes[i - 1]);
  if (maxVisualGap > 3) fail(`${file}: visual event gap ${maxVisualGap.toFixed(2)}s is too long.`);
  for (let start = 0; start < 150; start += 30) {
    const count = visualTimes.filter((time) => time >= start && time < start + 30).length;
    if (count < 8) fail(`${file}: section ${start}-${start + 30}s has only ${count} visual events.`);
  }

  // Each level runs its own themed event menu; require at least 4 distinct
  // recurring types rather than every type on every level.
  const typeCounts = new Map();
  for (const event of beatmap.visualEvents) {
    typeCounts.set(event.type, (typeCounts.get(event.type) || 0) + 1);
  }
  const recurringTypes = [...typeCounts.values()].filter((count) => count >= 3).length;
  if (recurringTypes < 4) fail(`${file}: expected at least 4 recurring themed event types, saw ${recurringTypes}.`);
  for (const event of beatmap.visualEvents) {
    if (!visualTypes.has(event.type)) fail(`${file}: invalid visual event type ${event.type}.`);
    if (!approvedColors.has(String(event.color).toUpperCase())) fail(`${file}: invalid visual event color ${event.color}.`);
    if (!Number.isFinite(event.time) || event.time < 0 || event.time > beatmap.duration) fail(`${file}: invalid visual event time ${event.time}.`);
    if (!Number.isFinite(event.duration) || event.duration <= 0 || event.duration > 3.4) {
      fail(`${file}: invalid visual event duration ${event.duration}.`);
    }
  }

  if (beatmap.audio?.segments?.length !== 5) fail(`${file}: expected five audio segments.`);
  if (!Array.isArray(beatmap.nodes) || beatmap.nodes.length < 170) fail(`${file}: expected at least 170 nodes.`);
  if (!Array.isArray(beatmap.checkpoints) || beatmap.checkpoints.length < 5) fail(`${file}: expected section checkpoints.`);

  const intervals = [];
  const distances = [];
  let fastNodes = 0;
  let slowNodes = 0;
  let accentCount = 0;
  const sections = new Set();
  for (let i = 1; i < beatmap.nodes.length; i += 1) {
    const prev = beatmap.nodes[i - 1];
    const node = beatmap.nodes[i];
    if (node.time <= prev.time) fail(`${file}: node ${i} time is not increasing.`);
    const interval = node.time - prev.time;
    const spacing = Math.hypot(node.x - prev.x, node.y - prev.y);
    intervals.push(interval);
    distances.push(spacing);
    if (interval < 0.044) fail(`${file}: node ${i} interval ${interval.toFixed(3)} is below the omega-spam floor.`);
    if (spacing < 52) fail(`${file}: node ${i} spacing ${spacing.toFixed(1)}px is too tight to read.`);
    if (interval < 0.2) fastNodes += 1;
    if (interval > 0.7) slowNodes += 1;
    if (node.accent) accentCount += 1;
    if (!cameraCues.has(node.cameraCue ?? null)) fail(`${file}: invalid camera cue ${node.cameraCue}.`);
    sections.add(node.section);
  }

  const medianSpacing = percentile(distances, 0.5);
  if (medianSpacing < 56 || medianSpacing > 110) fail(`${file}: median spacing ${medianSpacing.toFixed(1)}px is outside 56-110px.`);
  if (fastNodes < 8) fail(`${file}: expected fast burst sections (interval < 0.2s), saw ${fastNodes}.`);
  if (slowNodes < 4) fail(`${file}: expected slow readable sections (interval > 0.7s), saw ${slowNodes}.`);
  if (beatmap.ultra) {
    const spamNodes = beatmap.nodes.filter((node) => node.spam).length;
    if (spamNodes < beatmap.nodes.length * 0.6) {
      fail(`${file}: ultra-spam level should be mostly spam tiles, saw ${spamNodes}/${beatmap.nodes.length}.`);
    }
  }
  if (accentCount < 24) fail(`${file}: not enough accent metadata.`);
  if (sections.size < 6) fail(`${file}: missing required musical sections.`);

  const powerups = beatmap.nodes.filter((node) => node.powerup).length;
  if (powerups < 1 || powerups > 4) fail(`${file}: expected 1-4 powerup tiles, saw ${powerups}.`);

  console.log(
    `${file}: ok (${beatmap.title}, ${beatmap.nodes.length} nodes, median spacing ${medianSpacing.toFixed(1)}px, ` +
      `${fastNodes} fast / ${slowNodes} slow nodes, ${powerups} powerups, ${beatmap.visualEvents.length} visual events)`,
  );
}
