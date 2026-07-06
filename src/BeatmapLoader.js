const APPROVED_EVENT_COLORS = new Set(["#FF4FCB", "#4FFFEF", "#FFDD00", "#A855F7", "#FF6B35", "#39FF14"]);
const VISUAL_EVENT_TYPES = new Set([
  "shipFlyby", "laserSweep", "starfall", "nebulaPulse", "backgroundBurst",
  "rocket", "ufo", "firework", "hueBloom", "speedLines",
]);
const SUPPORTED_GENERATORS = new Set(["2.1", "3.0", "4.0"]);
const CAMERA_CUES = new Set(["zoomOutDrop", "zoomInHit", "rollLeft", "rollRight", "twistHeavy", "twistLight"]);
const DEFAULT_THEME = {
  name: "BeatPress Default",
  backgroundMode: "deepSpace",
  primaryColor: "#4FFFEF",
  secondaryColor: "#FF4FCB",
  accentColor: "#FFDD00",
  particleStyle: "sparks",
  shipStyle: "angular",
  cameraIntensity: 0.65,
  backgroundIntensity: 0.55,
};

export class BeatmapLoader {
  async load(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load beatmap ${url}: ${response.status}`);
    }
    const beatmap = await response.json();
    this.#validate(beatmap, url);
    this.#normalizeVisualMetadata(beatmap);
    return beatmap;
  }

  #validate(beatmap, url) {
    if (!beatmap || typeof beatmap !== "object") {
      throw new Error(`Beatmap ${url} is not a JSON object.`);
    }
    if (beatmap.generatorVersion && !SUPPORTED_GENERATORS.has(beatmap.generatorVersion)) {
      throw new Error(`Beatmap ${url} was generated with unsupported version ${beatmap.generatorVersion}.`);
    }
    const expectedDuration = beatmap.mode === "spam-test" ? 60 : 150;
    if (Math.abs(Number(beatmap.duration) - expectedDuration) > 0.001) {
      throw new Error(`Beatmap ${url} must be exactly ${expectedDuration} seconds.`);
    }
    if (!Array.isArray(beatmap.audio?.segments) || beatmap.audio.segments.length < 1) {
      throw new Error(`Beatmap ${url} must contain audio segments.`);
    }
    if (["spam", "spam-test", "spam-level"].includes(beatmap.mode) && beatmap.audio.segments.length !== 10) {
      throw new Error(`Spam beatmap ${url} must contain ten background audio segments.`);
    }
    if (!["spam", "spam-test", "spam-level"].includes(beatmap.mode) && beatmap.audio.segments.length !== 5) {
      throw new Error(`Beatmap ${url} must contain exactly five audio segments.`);
    }
    if (!Array.isArray(beatmap.nodes) || beatmap.nodes.length < 120) {
      throw new Error(`Beatmap ${url} does not have enough beat nodes for a 2:30 level.`);
    }
    const times = beatmap.nodes.map((node) => Number(node.time));
    for (let i = 1; i < times.length; i += 1) {
      if (times[i] <= times[i - 1]) {
        throw new Error(`Beatmap ${url} has non-increasing node times at index ${i}.`);
      }
      const cue = beatmap.nodes[i].cameraCue;
      if (cue && typeof cue !== "string" && typeof cue !== "object") {
        throw new Error(`Beatmap ${url} has invalid camera cue at index ${i}.`);
      }
    }
  }

  #normalizeVisualMetadata(beatmap) {
    beatmap.levelTheme = { ...DEFAULT_THEME, ...(beatmap.levelTheme || {}) };
    beatmap.levelTheme.primaryColor = this.#safeColor(beatmap.levelTheme.primaryColor);
    beatmap.levelTheme.secondaryColor = this.#safeColor(beatmap.levelTheme.secondaryColor);
    beatmap.levelTheme.accentColor = this.#safeColor(beatmap.levelTheme.accentColor);

    beatmap.visualEvents = Array.isArray(beatmap.visualEvents)
      ? beatmap.visualEvents
          .filter((event) => VISUAL_EVENT_TYPES.has(event?.type))
          .map((event) => ({
            time: Number(event.time) || 0,
            type: event.type,
            duration: Math.max(0.08, Math.min(Number(event.duration) || 0.4, 3.4)),
            intensity: Math.max(0.2, Math.min(Number(event.intensity) || 0.5, 1)),
            color: this.#safeColor(event.color),
            lane: Number.isFinite(Number(event.lane)) ? Number(event.lane) : 0,
          }))
          .sort((a, b) => a.time - b.time)
      : this.#deriveVisualEvents(beatmap);

    for (const node of beatmap.nodes) {
      if (typeof node.cameraCue === "string" && !CAMERA_CUES.has(node.cameraCue)) node.cameraCue = null;
      if (node.cameraCue && typeof node.cameraCue === "object") {
        const cue = node.cameraCue.cue || node.cameraCue.type || null;
        node.cameraCue = CAMERA_CUES.has(cue) ? cue : null;
      }
    }
  }

  #deriveVisualEvents(beatmap) {
    return beatmap.nodes
      .filter((node) => (node.checkpoint || node.accent) && node.time > 0)
      .slice(0, 28)
      .map((node, index) => ({
        time: node.time,
        type: node.checkpoint ? "backgroundBurst" : index % 2 ? "starfall" : "laserSweep",
        duration: node.checkpoint ? 0.62 : 0.42,
        intensity: node.visualIntensity || 0.5,
        color: this.#safeColor(index % 3 === 0 ? beatmap.levelTheme.accentColor : beatmap.levelTheme.primaryColor),
        lane: index % 4,
      }));
  }

  #safeColor(color) {
    const normalized = String(color || "").toUpperCase();
    return APPROVED_EVENT_COLORS.has(normalized) ? normalized : "#4FFFEF";
  }
}
