import { formatPercent, formatTime, gradeFromAccuracy, weightedAccuracy } from "./utils.js";

export class ResultsScreen {
  constructor({ kicker, title, grade, stats }) {
    this.kicker = kicker;
    this.title = title;
    this.grade = grade;
    this.stats = stats;
  }

  buildResult(level, rawStats, completed, elapsed) {
    if (level.mode === "spam-test") {
      return {
        type: "spam-test",
        levelId: level.id,
        levelTitle: level.title,
        completed,
        elapsed,
        spamHits: rawStats.spam || 0,
        averageCps: elapsed > 0 ? (rawStats.spam || 0) / elapsed : 0,
      };
    }
    const accuracy = weightedAccuracy(rawStats);
    const grade = completed ? gradeFromAccuracy(accuracy, rawStats.miss) : "F";
    return {
      levelId: level.id,
      levelTitle: level.title,
      completed,
      elapsed,
      accuracy,
      grade,
      perfectCount: rawStats.eperfect + rawStats.perfect + rawStats.lperfect,
      goodCount: rawStats.early + rawStats.late,
      spamHits: rawStats.spam || 0,
      missCount: rawStats.miss,
      overload: rawStats.overload || 0,
      safetyStrikes: rawStats.safetyStrikes || 0,
      eperfect: rawStats.eperfect,
      perfect: rawStats.perfect,
      lperfect: rawStats.lperfect,
      early: rawStats.early,
      late: rawStats.late,
      miss: rawStats.miss,
      maxCombo: rawStats.maxCombo,
      checkpointsUsed: rawStats.checkpointsUsed || 0,
    };
  }

  render(result) {
    if (result.type === "spam-test") {
      this.kicker.textContent = "Test Complete";
      this.title.textContent = result.levelTitle;
      this.grade.classList.add("is-hidden");
      this.stats.replaceChildren(
        this.#createStat("Average CPS", result.averageCps.toFixed(1)),
        this.#createStat("Time", formatTime(result.elapsed)),
      );
      return;
    }

    this.grade.classList.remove("is-hidden");
    this.kicker.textContent = result.completed ? "Level Complete" : "Run Failed";
    this.title.textContent = result.levelTitle;
    this.grade.textContent = result.grade;
    const rows = [
      ["Accuracy", formatPercent(result.accuracy)],
      ["Perfect", result.perfectCount],
      ["Good", result.goodCount],
      ["Miss", result.missCount],
      ["Safety strikes", result.safetyStrikes],
      ["Overload", result.overload],
      ["Max combo", result.maxCombo],
      ["Checkpoints", result.checkpointsUsed],
      ["Time", formatTime(result.elapsed)],
    ];
    if (result.spamHits > 0) rows.splice(1, 0, ["Spam hits", result.spamHits]);
    this.stats.replaceChildren(...rows.map(([label, value]) => this.#createStat(label, value)));
  }

  #createStat(label, value) {
    const item = document.createElement("div");
    item.className = "results-stat";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    return item;
  }
}
