import { DEFAULT_SETTINGS } from "./config.js";

const SETTINGS_KEY = "beatstar.settings.v2";
const BESTS_KEY = "beatstar.bests.v1";

export class Store {
  constructor(storage = window.localStorage) {
    this.storage = storage;
  }

  getSettings() {
    const stored = this.#read(SETTINGS_KEY, {});
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      calibrationMs: Number(stored.calibrationMs ?? DEFAULT_SETTINGS.calibrationMs),
      reduceCamera: Boolean(stored.reduceCamera ?? DEFAULT_SETTINGS.reduceCamera),
      missMode: ["safety", "checkpoint", "beginning", "fail"].includes(stored.missMode)
        ? stored.missMode
        : DEFAULT_SETTINGS.missMode,
      allowedMisses: [0, 1, 2].includes(Number(stored.allowedMisses))
        ? Number(stored.allowedMisses)
        : DEFAULT_SETTINGS.allowedMisses,
      noDeath: Boolean(stored.noDeath ?? DEFAULT_SETTINGS.noDeath),
    };
  }

  saveSettings(settings) {
    this.storage.setItem(SETTINGS_KEY, JSON.stringify({ ...this.getSettings(), ...settings }));
  }

  getBest(levelId) {
    const bests = this.#read(BESTS_KEY, {});
    return bests[levelId] || null;
  }

  saveResult(levelId, result) {
    const bests = this.#read(BESTS_KEY, {});
    const previous = bests[levelId];
    const isBetter =
      !previous ||
      result.accuracy > previous.accuracy ||
      (result.accuracy === previous.accuracy && result.maxCombo > previous.maxCombo);
    if (isBetter) {
      bests[levelId] = {
        accuracy: result.accuracy,
        maxCombo: result.maxCombo,
        grade: result.grade,
        completedAt: new Date().toISOString(),
      };
      this.storage.setItem(BESTS_KEY, JSON.stringify(bests));
    }
  }

  #read(key, fallback) {
    try {
      const value = this.storage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }
}
