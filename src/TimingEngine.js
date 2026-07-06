import { TIMING_WINDOWS } from "./config.js";

const SPAM_MODES = new Set(["spam", "spam-test", "spam-level"]);

export class TimingEngine {
  constructor() {
    this.beatmap = null;
    this.nextIndex = 1;
    this.windows = { ...TIMING_WINDOWS };
  }

  loadBeatmap(beatmap) {
    this.beatmap = beatmap;
    this.nextIndex = Math.max(1, beatmap.startNodeIndex || 1);
    this.windows = { ...TIMING_WINDOWS, ...(beatmap.timing?.windows || {}) };
  }

  resetToNode(nodeIndex) {
    this.nextIndex = Math.min(Math.max(nodeIndex + 1, 1), this.beatmap.nodes.length - 1);
  }

  consumeMiss(index) {
    this.nextIndex = Math.min(Math.max(index + 1, this.nextIndex), this.beatmap.nodes.length - 1);
  }

  judgePress(rawSongTime, calibrationMs) {
    if (SPAM_MODES.has(this.beatmap.mode)) {
      const target = this.beatmap.nodes[this.nextIndex] || this.beatmap.nodes[this.beatmap.nodes.length - 1];
      const index = Math.min(this.nextIndex, this.beatmap.nodes.length - 1);
      if (this.nextIndex < this.beatmap.nodes.length - 1) this.nextIndex += 1;
      return {
        type: "hit",
        quality: "Spam",
        direction: "Spam",
        delta: 0,
        node: target,
        index,
      };
    }
    const target = this.beatmap.nodes[this.nextIndex];
    if (!target) return { type: "complete" };
    const songTime = rawSongTime + calibrationMs / 1000;
    const delta = songTime - target.time;
    const abs = Math.abs(delta);
    const direction = delta < 0 ? "Early" : "Late";

    if (abs <= 0.012) {
      const result = { type: "hit", quality: "Perfect", direction: "Center", delta, node: target, index: this.nextIndex };
      this.nextIndex += 1;
      return result;
    }

    if (abs <= this.windows.perfect) {
      const quality = delta < 0 ? "EPerfect" : "LPerfect";
      const result = { type: "hit", quality, direction, delta, node: target, index: this.nextIndex };
      this.nextIndex += 1;
      return result;
    }

    if (abs <= this.windows.good) {
      const quality = delta < 0 ? "Early" : "Late";
      const result = { type: "hit", quality, direction, delta, node: target, index: this.nextIndex };
      this.nextIndex += 1;
      return result;
    }

    // Spam corridors: presses that arrive before the window opens are simply
    // absorbed instead of punished, so mashing three keys never overloads.
    if (target.spam && delta < 0) {
      return { type: "absorbed", delta, node: target, index: this.nextIndex };
    }

    return {
      type: "miss",
      reason: `${direction} Miss`,
      delta,
      node: target,
      index: this.nextIndex,
    };
  }

  checkLateMiss(rawSongTime, calibrationMs) {
    if (SPAM_MODES.has(this.beatmap?.mode)) return null;
    const target = this.beatmap?.nodes[this.nextIndex];
    if (!target) return null;
    const songTime = rawSongTime + calibrationMs / 1000;
    if (songTime - target.time > this.windows.miss) {
      return {
        type: "miss",
        reason: "Late Miss",
        delta: songTime - target.time,
        node: target,
        index: this.nextIndex,
      };
    }
    return null;
  }

  getTarget() {
    return this.beatmap?.nodes[this.nextIndex] || null;
  }
}
