import { AudioManager } from "./AudioManager.js";
import { BeatmapLoader } from "./BeatmapLoader.js";
import { CameraController } from "./CameraController.js";
import { DebugOverlay } from "./DebugOverlay.js";
import { EffectsSystem } from "./EffectsSystem.js";
import { InputManager } from "./InputManager.js";
import { LevelSelect } from "./LevelSelect.js";
import { Leaderboard } from "./Leaderboard.js";
import { PathRenderer } from "./PathRenderer.js";
import { PlayerOrbitController } from "./PlayerOrbitController.js";
import { ResultsScreen } from "./ResultsScreen.js";
import { ShaderController } from "./ShaderController.js";
import { Store } from "./Store.js";
import { TimingEngine } from "./TimingEngine.js";
import { VisualDirector } from "./VisualDirector.js";
import { LEVELS } from "./config.js";
import { clamp, formatPercent, formatTime, weightedAccuracy } from "./utils.js";

const EMPTY_STATS = {
  eperfect: 0,
  perfect: 0,
  lperfect: 0,
  early: 0,
  late: 0,
  spam: 0,
  miss: 0,
  overload: 0,
  safetyStrikes: 0,
  combo: 0,
  maxCombo: 0,
  checkpointsUsed: 0,
};

const SPAM_MODES = new Set(["spam", "spam-test", "spam-level"]);
const POWERUP_SECONDS = 9;

const QUALITY_META = {
  EPerfect: { stat: "eperfect", score: 0.99, kind: "perfect", color: "#baffee" },
  Perfect: { stat: "perfect", score: 1, kind: "perfect", color: "#90ffbd" },
  LPerfect: { stat: "lperfect", score: 0.99, kind: "perfect", color: "#d2f1ff" },
  Early: { stat: "early", score: 0.72, kind: "early", color: "#ffd166" },
  Late: { stat: "late", score: 0.72, kind: "late", color: "#ff9f4a" },
  Spam: { stat: "spam", score: 1, kind: "perfect", color: "#ff3d2f" },
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.store = new Store();
    this.settings = this.store.getSettings();
    this.audio = new AudioManager();
    this.loader = new BeatmapLoader();
    this.timing = new TimingEngine();
    this.effects = new EffectsSystem();
    this.shader = new ShaderController();
    this.camera = new CameraController();
    this.pathRenderer = new PathRenderer();
    this.visualDirector = new VisualDirector();
    this.player = new PlayerOrbitController(this.effects);
    this.input = new InputManager((event) => this.handleAnyKey(event));
    this.leaderboard = new Leaderboard();
    this.results = new ResultsScreen({
      kicker: document.getElementById("resultsKicker"),
      title: document.getElementById("resultsTitle"),
      grade: document.getElementById("resultsGrade"),
      stats: document.getElementById("resultsStats"),
    });
    this.debugOverlay = new DebugOverlay(
      document.getElementById("debugPanel"),
      document.getElementById("debugText"),
    );
    this.levelSelect = new LevelSelect(
      document.getElementById("levelCards"),
      this.store,
      (level) => this.loadLevel(level),
    );

    this.views = {
      menu: document.getElementById("menuView"),
      ready: document.getElementById("readyView"),
      pause: document.getElementById("pauseView"),
      results: document.getElementById("resultsView"),
      hud: document.getElementById("hudView"),
    };
    this.ui = this.#collectUi();
    this.currentLevel = null;
    this.variantParent = null;
    this.beatmap = null;
    this.state = "menu";
    this.stats = { ...EMPTY_STATS };
    this.lastFrame = performance.now();
    this.restartTimer = null;
    this.autoRetryTimer = null;
    this.lastSongTime = 0;
    this.audioLevel = 0;
    this.offsetGhosts = [];
    this.lastOffsetMs = 0;
    this.inputCount = 0;
    this.safetyStrikes = 0;
    this.overloadPressTimes = [];
    this.spamPressTimes = [];
    this.spamDangerSeconds = 0;
    this.spamFailureCount = 0;
    this.powerupUntil = 0;
    this.countdownToken = 0;
    this.freeplayHover = -1;
    // Node the player chose via FreePlay. While set (>= 0), deaths respawn
    // here instead of at the beginning/checkpoint; the Retry button clears it.
    this.freeplaySpawnIndex = -1;
  }

  #powerupActive() {
    return this.audio.getTime() < this.powerupUntil;
  }

  #allowedMisses() {
    const value = Number(this.settings.allowedMisses);
    return [0, 1, 2].includes(value) ? value : 2;
  }

  start() {
    this.#bindUi();
    window.__beatStarDebug = {
      getState: () => this.getDebugState(),
    };
    this.input.start();
    this.levelSelect.render(LEVELS);
    this.showMenu();
    this.#resize();
    window.addEventListener("resize", () => this.#resize());
    requestAnimationFrame((time) => this.#frame(time));
  }

  getDebugState() {
    const audioTime = this.audio.getTime();
    const spamMetrics = this.#spamMetrics(audioTime);
    const visualState = this.visualDirector.getDebugState();
    return {
      state: this.state,
      levelId: this.currentLevel?.id || null,
      parentLevelId: this.currentLevel?.parentId || null,
      beatmapId: this.beatmap?.id || null,
      mode: this.beatmap?.mode || this.currentLevel?.mode || null,
      audioTime,
      nodes: this.beatmap?.nodes?.length || 0,
      nextIndex: this.timing.nextIndex,
      combo: this.stats.combo,
      accuracy: weightedAccuracy(this.stats),
      inputCount: this.inputCount,
      safetyStrikes: this.safetyStrikes,
      spam: this.stats.spam,
      spamAverageCps: spamMetrics.averageCps,
      spamRollingCps: spamMetrics.rollingCps,
      spamTargetCps: spamMetrics.targetCps,
      spamDanger: spamMetrics.dangerRatio,
      spamFailures: this.spamFailureCount,
      cameraZoom: this.camera.zoom,
      cameraRotation: this.camera.rotation,
      powerupActive: this.#powerupActive(),
      powerupRemaining: Math.max(0, this.powerupUntil - audioTime),
      allowedMisses: this.#allowedMisses(),
      freeplayHover: this.freeplayHover,
      activeVisualEvents: visualState.active,
      scheduledVisualEvents: visualState.scheduled,
      skippedVisualEvents: visualState.skipped,
      dynamicVisualPhase: visualState.phase,
      continuousVisualLayers: visualState.continuousLayers,
      ambientVisualStars: visualState.ambientStars,
      ambientVisualLanes: visualState.ambientLanes,
      ambientVisualGlyphs: visualState.ambientGlyphs,
    };
  }

  async loadLevel(level) {
    if (level.variants?.length) {
      this.#showVariantPicker(level);
      return;
    }
    this.currentLevel = level;
    this.variantParent = null;
    this.state = "loading";
    this.#showOnly("ready");
    this.#setHudVisible(false);
    this.#setVariantPickerVisible(false);
    this.ui.readyKicker.textContent = "Loading level";
    this.ui.readyTitle.textContent = level.title;
    this.ui.readyMeta.textContent = "Decoding audio and beatmap...";
    this.ui.readyPrompt.textContent = "Loading";

    try {
      const beatmap = await this.loader.load(level.beatmapUrl);
      await this.audio.loadBeatmap(beatmap, ({ file, loaded, total }) => {
        this.ui.readyMeta.textContent = `Loading audio ${loaded}/${total}: ${file}`;
      });
      this.beatmap = beatmap;
      this.timing.loadBeatmap(beatmap);
      this.effects.reset();
      this.shader.reset();
      this.pathRenderer.loadBeatmap(beatmap);
      this.visualDirector.loadBeatmap(beatmap);
      this.player.loadBeatmap(beatmap);
      this.camera.loadBeatmap(beatmap);
      this.camera.setReduceMotion(this.settings.reduceCamera);
      this.visualDirector.setReduceMotion(this.settings.reduceCamera);
      this.camera.reset(beatmap.nodes[0]);
      this.freeplaySpawnIndex = -1;
      this.#resetRunState(0);
      this.state = "ready";
      this.ui.readyKicker.textContent = "Level ready";
      this.ui.readyTitle.textContent = `${level.title}`;
      this.ui.readyMeta.textContent = `${level.subtitle} | ${level.durationLabel || "2:30"} | ${level.difficulty}`;
      this.ui.readyPrompt.textContent = "Press any key to start";
      this.#updateDebug();
    } catch (error) {
      this.state = "ready";
      this.ui.readyKicker.textContent = "Load failed";
      this.ui.readyMeta.textContent = error.message;
      this.ui.readyPrompt.textContent = "Load failed";
      console.error(error);
    }
  }

  #showVariantPicker(level) {
    this.audio.stop();
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    if (this.autoRetryTimer) window.clearTimeout(this.autoRetryTimer);
    this.currentLevel = level;
    this.variantParent = level;
    this.beatmap = null;
    this.state = "variant";
    this.#showOnly("ready");
    this.#setHudVisible(false);
    this.#setVariantPickerVisible(true);
    this.ui.readyKicker.textContent = "BeatPress";
    this.ui.readyTitle.textContent = level.title;
    this.ui.readyMeta.textContent = "Choose a mode";
    this.ui.readyPrompt.textContent = "Test or Level";
  }

  async handleAnyKey(event) {
    this.inputCount += 1;
    if (this.state === "menu") {
      if (event?.key === "Enter" || event?.key === " ") {
        const selected = this.levelSelect.getSelectedLevel();
        if (selected) await this.loadLevel(selected);
      } else {
        const direction = event?.key === "ArrowLeft" || event?.key === "ArrowUp" ? -1 : 1;
        this.levelSelect.advanceSelection(direction);
      }
      return;
    }
    if (this.state === "ready" && this.beatmap) {
      await this.#startPlayback(0);
      return;
    }
    if (this.state !== "playing") return;
    const result = this.timing.judgePress(this.audio.getTime(), this.settings.calibrationMs);
    this.#handleJudgeResult(result);
  }

  showMenu() {
    this.audio.stop();
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    if (this.autoRetryTimer) window.clearTimeout(this.autoRetryTimer);
    this.state = "menu";
    this.currentLevel = null;
    this.variantParent = null;
    this.beatmap = null;
    this.#setVariantPickerVisible(false);
    this.levelSelect.render(LEVELS);
    this.#showOnly("menu");
    this.#setHudVisible(false);
  }

  pause() {
    if (this.state !== "playing") return;
    this.lastSongTime = this.audio.pause();
    this.state = "paused";
    this.ui.pauseTitle.textContent = this.currentLevel?.title || "BeatPress";
    this.#showOnly("pause");
    this.#setHudVisible(true);
  }

  async resume() {
    if (this.state !== "paused") return;
    await this.#startPlayback(this.lastSongTime, false);
  }

  async retry(fromBeginning = true) {
    if (!this.beatmap) return;
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    // Retry is the explicit "back to the very beginning" escape hatch: it
    // drops any FreePlay respawn anchor the player had chosen.
    if (fromBeginning) this.freeplaySpawnIndex = -1;
    const startNode = fromBeginning ? 0 : this.#checkpointForTime(this.audio.getTime()).nodeIndex;
    this.#resetRunState(startNode);
    await this.#startPlayback(this.beatmap.nodes[startNode].time, true);
  }

  // FreePlay: pause the run, show the whole map, click a tile to spawn there.
  toggleFreeplay() {
    if (this.state === "freeplay") {
      this.exitFreeplay();
      return;
    }
    if (!this.beatmap) return;
    const allowedStates = ["playing", "paused", "ready", "countdown", "crashing", "restarting", "auto-retry"];
    if (!allowedStates.includes(this.state)) return;
    this.countdownToken += 1;
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    if (this.autoRetryTimer) window.clearTimeout(this.autoRetryTimer);
    this.audio.pause();
    this.state = "freeplay";
    this.freeplayHover = -1;
    this.#showOnly(null);
    this.#setHudVisible(true);
    this.#setFeedback("FreePlay - click any tile to spawn", "ready");
  }

  exitFreeplay() {
    if (this.state !== "freeplay") return;
    this.freeplayHover = -1;
    this.canvas.style.cursor = "default";
    this.state = "paused";
    this.lastSongTime = this.beatmap?.nodes?.[this.player.anchorIndex]?.time ?? this.lastSongTime;
    this.ui.pauseTitle.textContent = this.currentLevel?.title || "BeatPress";
    this.#showOnly("pause");
    this.#setHudVisible(true);
  }

  #handleCanvasHover(event) {
    if (this.state !== "freeplay") return;
    const point = this.#canvasPoint(event);
    this.freeplayHover = this.#freeplayNodeAt(point.x, point.y);
    this.canvas.style.cursor = this.freeplayHover >= 0 ? "pointer" : "default";
  }

  async #handleCanvasClick(event) {
    if (this.state !== "freeplay") return;
    const point = this.#canvasPoint(event);
    const index = this.#freeplayNodeAt(point.x, point.y);
    if (index < 0) return;
    this.canvas.style.cursor = "default";
    this.freeplayHover = -1;
    // Remember this as the respawn anchor for the rest of the run.
    this.freeplaySpawnIndex = index;
    this.#resetRunState(index, true);
    await this.#startPlayback(this.beatmap.nodes[index].time, true);
  }

  #canvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * this.canvas.width,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * this.canvas.height,
    };
  }

  #freeplayNodeAt(px, py) {
    const transform = this.pathRenderer.getMapTransform(this.canvas);
    const nodes = this.beatmap?.nodes;
    if (!transform || !nodes?.length) return -1;
    const threshold = Math.max(15, 30 * transform.scale + 6);
    let best = -1;
    let bestDist = threshold;
    for (let i = 0; i < nodes.length; i += 1) {
      const sx = nodes[i].x * transform.scale + transform.ox;
      const sy = nodes[i].y * transform.scale + transform.oy;
      const dist = Math.hypot(sx - px, sy - py);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  #handleJudgeResult(result) {
    if (result.type === "absorbed" || result.type === "complete") return;
    if (result.type === "hit") {
      const meta = QUALITY_META[result.quality] || QUALITY_META.Perfect;
      this.stats[meta.stat] += 1;
      if (result.quality === "Spam") this.#recordSpamPress(this.audio.getTime());
      this.stats.combo = meta.score >= 0.7 ? this.stats.combo + 1 : 0;
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
      this.#recordOffset(result.delta, meta.color);
      this.player.advanceTo(result.index, result.quality);
      this.camera.hit(result.node.visualIntensity || 0.5);
      this.shader.hit(result.node, result.quality, this.stats.combo);
      this.#setFeedback(result.quality, meta.kind);
      this.#shatterBehind(result.index);
      if (result.node.powerup) {
        this.powerupUntil = this.audio.getTime() + POWERUP_SECONDS;
        this.effects.addPowerup(result.node);
        this.#setFeedback("3RD PLANET!", "perfect");
      }
      return;
    }
    if (result.type === "miss") {
      this.#miss(result);
    }
  }

  // Tiles a few steps behind the player crumble and blow apart.
  #shatterBehind(index) {
    const behind = index - 3;
    if (behind <= 0) return;
    const piece = this.pathRenderer.takeShatterTile(behind);
    if (piece) this.effects.addTileShatter(piece);
  }

  #miss(result) {
    if (this.state !== "playing") return;
    const audioTime = this.audio.getTime();

    // No Death mode: never crash. On a late/skipped tile the planet snaps
    // onto the correct tile and the run keeps flowing; early presses are
    // simply ignored. For sightseeing the level, not for the leaderboard.
    if (this.settings.noDeath) {
      this.stats.miss += 1;
      this.stats.combo = 0;
      this.#recordOffset(result.delta || 0.135, "#ff5f9f");
      this.effects.addMiss(result.node || this.player.getState(audioTime).anchor);
      this.#setFeedback("Miss - snapped on", "miss");
      if ((result.delta || 0) >= 0) {
        this.timing.consumeMiss(result.index);
        this.player.resetToNode(result.index);
      }
      return;
    }

    // The third planet absorbs one miss, then departs.
    if (this.#powerupActive()) {
      this.powerupUntil = 0;
      const shieldPoint = result.node || this.player.getState(audioTime).anchor;
      this.effects.addShield(shieldPoint);
      this.#setFeedback("Shielded!", "good");
      if ((result.delta || 0) >= 0) {
        this.timing.consumeMiss(result.index);
        this.player.resetToNode(result.index);
      }
      return;
    }

    this.stats.miss += 1;
    this.stats.combo = 0;
    this.#recordOffset(result.delta || 0.135, "#ff5f9f");
    this.effects.addMiss(result.node || this.player.getState(this.audio.getTime()).anchor);
    this.shader.miss();
    this.camera.miss();

    const overloaded = this.#trackOverload(result, audioTime);
    if (this.settings.missMode === "safety") {
      const allowed = this.#allowedMisses();
      if (!overloaded && this.safetyStrikes < allowed) {
        this.safetyStrikes += 1;
        this.stats.safetyStrikes = this.safetyStrikes;
        const remaining = allowed - this.safetyStrikes;
        this.#setFeedback(`${result.reason} - ${remaining} miss${remaining === 1 ? "" : "es"} left`, "miss");
        if ((result.delta || 0) >= 0) {
          this.timing.consumeMiss(result.index);
          this.player.resetToNode(result.index);
        }
        return;
      }

      this.#crashAfterRotation(result, overloaded ? "OVERLOAD!" : "Orbit Crash");
      return;
    }

    this.#setFeedback(result.reason, "miss");
    this.audio.pause();
    this.state = "restarting";

    if (this.settings.missMode === "fail") {
      this.restartTimer = window.setTimeout(() => this.#autoRetryAfterFail(this.#respawnNode(0), 200), 480);
      return;
    }

    const checkpoint = this.freeplaySpawnIndex >= 0
      ? { nodeIndex: this.freeplaySpawnIndex, time: this.beatmap.nodes[this.freeplaySpawnIndex].time }
      : this.settings.missMode === "beginning"
      ? { nodeIndex: 0, time: 0 }
      : this.#checkpointForTime(result.node.time);
    if (this.settings.missMode === "checkpoint" && checkpoint.nodeIndex > 0) this.stats.checkpointsUsed += 1;
    this.restartTimer = window.setTimeout(async () => {
      this.#resetRunState(checkpoint.nodeIndex, false);
      await this.#startPlayback(checkpoint.time, false);
    }, 480);
  }

  #trackOverload(result, audioTime) {
    const tooEarly = (result.delta || 0) < -this.timing.windows.good;
    if (!tooEarly) return false;
    this.overloadPressTimes.push(audioTime);
    this.overloadPressTimes = this.overloadPressTimes.filter((time) => audioTime - time <= 0.75);
    if (this.overloadPressTimes.length >= 3) {
      this.stats.overload += 1;
      return true;
    }
    return false;
  }

  #crashAfterRotation(result, label) {
    const audioTime = this.audio.getTime();
    const target = result.node || this.timing.getTarget();
    const duration = clamp((target?.interval || 0.62) * 1.65, 0.62, 1.18);
    this.#setFeedback(label, "miss");
    this.player.startCrashOrbit({
      songTime: audioTime,
      duration,
      spin: target?.spin || 1,
    });
    this.state = "crashing";
    this.restartTimer = window.setTimeout(() => {
      this.audio.pause();
      this.#autoRetryAfterFail(this.#respawnNode(0), 120);
    }, duration * 1000);
  }

  // After a FreePlay spawn, deaths respawn at the chosen tile; otherwise use
  // the supplied default (beginning). Retry clears the FreePlay anchor.
  #respawnNode(defaultIndex = 0) {
    return this.freeplaySpawnIndex >= 0 ? this.freeplaySpawnIndex : defaultIndex;
  }

  #autoRetryAfterFail(nodeIndex = 0, delayMs = 1000) {
    if (!this.beatmap) return;
    this.audio.pause();
    this.state = "auto-retry";
    this.#showOnly(null);
    this.#setHudVisible(true);
    this.#setFeedback("Restarting...", "miss");
    if (this.autoRetryTimer) window.clearTimeout(this.autoRetryTimer);
    this.autoRetryTimer = window.setTimeout(async () => {
      const startNode = Math.max(0, Math.min(nodeIndex, this.beatmap.nodes.length - 1));
      this.#resetRunState(startNode, true);
      await this.#startPlayback(this.beatmap.nodes[startNode].time, true);
    }, delayMs);
  }

  #resetRunState(nodeIndex, resetStats = true) {
    if (resetStats) this.stats = { ...EMPTY_STATS };
    if (resetStats) this.safetyStrikes = 0;
    this.powerupUntil = 0;
    this.overloadPressTimes = [];
    this.spamPressTimes = [];
    this.spamDangerSeconds = 0;
    this.effects.reset();
    this.shader.reset();
    this.visualDirector.reset();
    this.pathRenderer.clearShattered();
    this.offsetGhosts = [];
    this.lastOffsetMs = 0;
    this.player.resetToNode(nodeIndex);
    this.timing.resetToNode(nodeIndex);
    this.lastSongTime = this.beatmap?.nodes?.[nodeIndex]?.time || 0;
    this.#setFeedback("Ready", "ready");
  }

  async #startPlayback(startTime, resetHud = true) {
    if (!this.beatmap) return;
    if (resetHud) this.#setFeedback("Ready", "ready");
    // No Death runs skip the per-tile judgement words entirely.
    this.effects.setJudgementLabels(!this.settings.noDeath);
    this.#setVariantPickerVisible(false);
    const startNode = this.beatmap.nodes[this.player.anchorIndex] || this.beatmap.nodes[0];
    this.camera.reset(startNode);
    this.visualDirector.reset();
    this.#showOnly(null);
    this.#setHudVisible(true);
    const counted = await this.#runCountdown();
    if (!counted) return;
    this.state = "playing";
    await this.audio.start(startTime);
  }

  // ADOFAI-style count-in: 1.. 2.. 3.. ticked at the level's beat interval,
  // shown before every start, respawn, and FreePlay spawn.
  async #runCountdown() {
    this.countdownToken += 1;
    const token = this.countdownToken;
    this.state = "countdown";
    const segment = this.beatmap?.audio?.segments?.[0];
    const tick = clamp(Number(segment?.beatInterval) || 0.45, 0.3, 0.6);
    const overlay = this.ui.countdown;
    const number = this.ui.countdownNumber;
    if (!overlay || !number) return true;
    overlay.classList.remove("is-hidden");
    for (const count of [1, 2, 3]) {
      if (token !== this.countdownToken || this.state !== "countdown") {
        overlay.classList.add("is-hidden");
        return false;
      }
      number.textContent = String(count);
      number.classList.remove("tick");
      void number.offsetWidth;
      number.classList.add("tick");
      await new Promise((resolve) => window.setTimeout(resolve, tick * 1000));
    }
    overlay.classList.add("is-hidden");
    return token === this.countdownToken && this.state === "countdown";
  }

  #checkpointForTime(time) {
    const checkpoints = this.beatmap.checkpoints || [{ nodeIndex: 0, time: 0 }];
    let selected = checkpoints[0];
    for (const checkpoint of checkpoints) {
      if (checkpoint.time <= time + 0.001) selected = checkpoint;
      else break;
    }
    return selected;
  }

  #finish(completed) {
    this.audio.stop();
    if (!completed) {
      this.#autoRetryAfterFail(0, 1000);
      return;
    }
    const elapsed = completed ? this.beatmap.duration : this.lastSongTime || this.audio.getTime();
    const result = this.results.buildResult(this.currentLevel, this.stats, completed, elapsed);
    this.results.render(result);
    if (completed && this.currentLevel.mode !== "spam-test") {
      if (this.settings.noDeath) {
        // Casual No Death runs never touch personal bests or the global
        // leaderboard; the board is still shown read-only.
        const kicker = document.getElementById("resultsKicker");
        if (kicker) kicker.textContent = "No Death run - score not submitted";
        this.#syncLeaderboard(result, false);
      } else {
        this.store.saveResult(this.currentLevel.id, result);
        this.#syncLeaderboard(result);
      }
    }
    this.levelSelect.render(LEVELS);
    this.state = "results";
    this.#showOnly("results");
    this.#setHudVisible(false);
  }

  async #syncLeaderboard(result, submit = true) {
    try {
      if (submit) await this.leaderboard.submit(result);
      const rows = await this.leaderboard.top(result.levelId, 5);
      const statsEl = document.getElementById("resultsStats");
      if (!statsEl || this.state !== "results") return;
      const old = document.getElementById("leaderboardBlock");
      if (old) old.remove();
      const block = document.createElement("div");
      block.id = "leaderboardBlock";
      block.style.cssText = "grid-column:1/-1;margin-top:12px;text-align:left;font-size:0.85rem;opacity:0.9;";
      const title = document.createElement("strong");
      title.textContent = "Global Leaderboard";
      title.style.cssText = "display:block;margin-bottom:6px;letter-spacing:0.05em;";
      block.appendChild(title);
      if (!rows.length) {
        const p = document.createElement("div");
        p.textContent = "No scores yet — you're first!";
        block.appendChild(p);
      } else {
        rows.forEach((r, i) => {
          const line = document.createElement("div");
          line.style.cssText = "display:flex;justify-content:space-between;padding:2px 0;";
          const acc = typeof r.accuracy === "number" ? formatPercent(r.accuracy) : "—";
          line.innerHTML = `<span>${i + 1}. ${String(r.player_name).replace(/[<>]/g, "")}</span><span>${acc} · ${r.grade || ""}</span>`;
          block.appendChild(line);
        });
      }
      statsEl.appendChild(block);
    } catch (err) {
      console.warn("Leaderboard sync failed:", err);
    }
  }

  #frame(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.#update(dt);
    this.#draw();
    requestAnimationFrame((time) => this.#frame(time));
  }

  #update(dt) {
    const audioTime = this.audio.getTime();
    this.lastSongTime = audioTime;
    this.audioLevel = this.audio.getLevel();
    this.effects.update(dt);
    for (const ghost of this.offsetGhosts) ghost.life -= dt;
    this.offsetGhosts = this.offsetGhosts.filter((ghost) => ghost.life > 0);
    this.camera.setReduceMotion(this.settings.reduceCamera);
    this.visualDirector.setReduceMotion(this.settings.reduceCamera);
    this.visualDirector.update(dt, audioTime, this.player.anchorIndex, this.audioLevel);
    this.camera.update(dt, audioTime, this.audioLevel, this.player.anchorIndex, this.#previewNodes(this.player.anchorIndex, 6));
    this.shader.update(dt, this.stats.combo, this.audioLevel);

    if (this.state === "playing") {
      this.#updateSpamPressure(dt, audioTime);
      const late = this.timing.checkLateMiss(audioTime, this.settings.calibrationMs);
      if (late) this.#miss(late);
      if (audioTime >= (this.beatmap?.duration || 0) - 0.015) this.#finish(true);
    }
    this.#updateHud(audioTime);
    this.#updateDebug();
  }

  #previewNodes(activeIndex, count) {
    if (!this.beatmap?.nodes?.length) return [];
    const start = Math.max(0, activeIndex);
    return this.beatmap.nodes.slice(start, Math.min(this.beatmap.nodes.length, start + count));
  }

  #draw() {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const songTime = this.audio.getTime();

    if (this.state === "freeplay") {
      this.pathRenderer.drawBackground(ctx, canvas, this.camera, songTime, this.audioLevel);
      this.pathRenderer.drawFullMap(ctx, canvas, performance.now() / 1000, this.freeplayHover, this.player.anchorIndex);
      return;
    }

    this.pathRenderer.setHuePhase(songTime);
    this.pathRenderer.drawBackground(ctx, canvas, this.camera, songTime, this.audioLevel);
    this.visualDirector.drawBackground(ctx, canvas, this.camera);

    ctx.save();
    this.camera.apply(ctx, canvas);
    const target = this.timing.getTarget();
    this.visualDirector.drawWorld(ctx, this.camera);
    this.pathRenderer.drawWorld(
      ctx,
      this.camera,
      songTime,
      this.player.anchorIndex,
      target ? this.timing.nextIndex : -1,
      this.debugOverlay.enabled,
    );
    this.effects.drawWorld(ctx);
    this.player.draw(ctx, this.player.getState(songTime), songTime, this.#powerupActive());
    ctx.restore();

    this.visualDirector.drawForeground(ctx, canvas, this.camera);
    this.effects.drawScreen(ctx, canvas);
    if ((this.state === "playing" || this.state === "crashing") && !SPAM_MODES.has(this.beatmap?.mode)) {
      this.#drawCalibrationMeter(ctx, canvas);
    }
    this.shader.draw(ctx, canvas);
  }

  #updateHud(audioTime) {
    const duration = this.beatmap?.duration || 150;
    const mode = this.beatmap?.mode;
    const spamMetrics = this.#spamMetrics(audioTime);
    this.ui.hudLevel.textContent = this.currentLevel?.title || "BeatPress";
    this.ui.hudTimer.textContent = formatTime(audioTime);

    if (this.ui.hudPower) {
      const powerActive = this.state === "playing" && this.#powerupActive();
      this.ui.hudPower.classList.toggle("is-hidden", !powerActive);
      if (powerActive) {
        this.ui.hudPower.textContent = `3RD PLANET ${Math.max(0, this.powerupUntil - audioTime).toFixed(1)}s`;
      }
    }

    // Geometry Dash-style death counter, top-left, No Death mode only.
    const showDeaths = this.settings.noDeath && mode !== "spam-test";
    this.ui.hudDeaths.classList.toggle("is-hidden", !showDeaths);
    if (showDeaths) this.ui.hudDeaths.textContent = `Deaths: ${this.stats.miss}`;

    this.ui.hudCombo.classList.toggle("is-hidden", mode === "spam-test");
    this.ui.hudLives.classList.toggle("is-hidden", mode === "spam-test");
    this.ui.hudAccuracy.classList.toggle("is-hidden", mode === "spam-test");
    this.ui.progressShell.classList.toggle("is-hidden", mode === "spam-test");

    if (mode === "spam-test") {
      this.ui.hudFeedback.textContent = `Avg CPS ${spamMetrics.averageCps.toFixed(1)}`;
      this.ui.hudFeedback.dataset.kind = "perfect";
      this.ui.hudCombo.textContent = "";
      this.ui.hudLives.textContent = "";
      this.ui.hudAccuracy.textContent = "";
      return;
    }

    if (mode === "spam-level") {
      this.ui.hudFeedback.textContent = `CPS ${spamMetrics.rollingCps.toFixed(1)} / ${spamMetrics.targetCps.toFixed(1)}`;
      this.ui.hudFeedback.dataset.kind = spamMetrics.dangerRatio > 0.55 ? "miss" : "perfect";
      this.ui.hudCombo.textContent = `Avg ${spamMetrics.averageCps.toFixed(1)}`;
      this.ui.hudLives.textContent = `Danger ${Math.round(spamMetrics.dangerRatio * 100)}%`;
      this.ui.hudAccuracy.textContent = `Spam ${this.stats.spam}`;
    } else {
      const allowed = this.#allowedMisses();
      this.ui.hudCombo.textContent = `${this.stats.combo} combo`;
      this.ui.hudLives.textContent = this.settings.noDeath
        ? "No Death"
        : this.settings.missMode === "safety"
        ? `Misses ${Math.max(0, allowed - this.safetyStrikes)}/${allowed}`
        : this.settings.missMode;
      this.ui.hudAccuracy.textContent = formatPercent(weightedAccuracy(this.stats));
    }

    this.ui.progressBar.style.width = `${clamp((audioTime / duration) * 100, 0, 100).toFixed(2)}%`;
  }

  #recordSpamPress(audioTime) {
    this.spamPressTimes.push(audioTime);
    this.#trimSpamPressTimes(audioTime);
  }

  #trimSpamPressTimes(audioTime) {
    const windowSeconds = this.beatmap?.spamRules?.rollingWindowSeconds || 2;
    this.spamPressTimes = this.spamPressTimes.filter((time) => audioTime - time <= Math.max(10, windowSeconds * 3));
  }

  #spamMetrics(audioTime) {
    const mode = this.beatmap?.mode;
    if (!SPAM_MODES.has(mode)) {
      return {
        averageCps: 0,
        rollingCps: 0,
        targetCps: 0,
        dangerRatio: 0,
      };
    }
    const rules = this.beatmap?.spamRules || {};
    const elapsed = Math.max(0, Math.min(audioTime, this.beatmap?.duration || 0));
    const windowSeconds = rules.rollingWindowSeconds || 2;
    const recentCount = this.spamPressTimes.filter((time) => audioTime - time <= windowSeconds).length;
    const targetCps = this.#spamTargetCps(audioTime);
    const failDangerSeconds = rules.failDangerSeconds || 1.25;
    return {
      averageCps: elapsed > 0 ? this.stats.spam / elapsed : 0,
      rollingCps: recentCount / windowSeconds,
      targetCps,
      dangerRatio: clamp(this.spamDangerSeconds / failDangerSeconds, 0, 1),
    };
  }

  #spamTargetCps(audioTime) {
    if (this.beatmap?.mode !== "spam-level") return 0;
    const rules = this.beatmap.spamRules || {};
    const grace = rules.graceSeconds ?? 3;
    if (audioTime < grace) return 0;
    const start = rules.targetCpsStart ?? 9;
    const end = rules.targetCpsEnd ?? 12;
    const ramp = Math.max(0.001, rules.targetRampSeconds ?? 30);
    const t = clamp((audioTime - grace) / ramp, 0, 1);
    return start + (end - start) * t;
  }

  #updateSpamPressure(dt, audioTime) {
    if (this.beatmap?.mode !== "spam-level") return;
    // No Death mode: the CPS pressure meter never kills the run.
    if (this.settings.noDeath) {
      this.spamDangerSeconds = 0;
      return;
    }
    const rules = this.beatmap.spamRules || {};
    const grace = rules.graceSeconds ?? 3;
    const failDangerSeconds = rules.failDangerSeconds ?? 1.25;
    if (audioTime < grace) {
      this.spamDangerSeconds = 0;
      return;
    }

    const metrics = this.#spamMetrics(audioTime);
    if (metrics.rollingCps < metrics.targetCps) {
      this.spamDangerSeconds = clamp(this.spamDangerSeconds + dt, 0, failDangerSeconds);
    } else {
      this.spamDangerSeconds = clamp(this.spamDangerSeconds - dt * 1.5, 0, failDangerSeconds);
    }

    if (this.spamDangerSeconds >= failDangerSeconds) {
      this.#triggerSpamLevelFail(audioTime);
    }
  }

  #triggerSpamLevelFail(audioTime) {
    if (this.state !== "playing") return;
    this.spamFailureCount += 1;
    this.stats.miss += 1;
    this.stats.combo = 0;
    const target = this.timing.getTarget() || this.player.getState(audioTime).anchor;
    this.effects.addMiss(target);
    this.shader.miss();
    this.camera.miss();
    this.#setFeedback("SPAM FAIL", "miss");
    this.player.startCrashOrbit({
      songTime: audioTime,
      duration: 0.86,
      spin: target?.spin || 1,
    });
    this.state = "crashing";
    this.restartTimer = window.setTimeout(() => {
      this.audio.pause();
      this.#autoRetryAfterFail(0, 1000);
    }, 860);
  }

  #setFeedback(text, kind) {
    this.ui.hudFeedback.textContent = text;
    this.ui.hudFeedback.dataset.kind = kind;
  }

  #setVariantPickerVisible(value) {
    this.ui.variantActions.classList.toggle("is-hidden", !value);
    this.ui.readyActions.classList.toggle("is-hidden", value);
  }

  #recordOffset(deltaSeconds, color) {
    const maxMs = (this.timing.windows?.miss || 0.27) * 1000;
    const offsetMs = clamp(deltaSeconds * 1000, -maxMs, maxMs);
    this.lastOffsetMs = offsetMs;
    this.offsetGhosts.push({ offsetMs, color, life: 0.85, maxLife: 0.85 });
  }

  #drawCalibrationMeter(ctx, canvas) {
    const radius = Math.min(116, Math.max(76, canvas.width * 0.075));
    const cx = canvas.width / 2;
    const cy = canvas.height - Math.min(132, canvas.height * 0.16);
    const maxMs = (this.timing.windows?.miss || 0.27) * 1000;
    const toAngle = (ms) => Math.PI - ((clamp(ms, -maxMs, maxMs) + maxMs) / (maxMs * 2)) * Math.PI;
    const arc = (from, to, color, width = 11) => {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.shadowBlur = 0;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, toAngle(from), toAngle(to), true);
      ctx.stroke();
      ctx.restore();
    };
    const needle = (offsetMs, color, alpha, width) => {
      const angle = toAngle(offsetMs);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.shadowBlur = 0;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * (radius - 28), cy + Math.sin(angle) * (radius - 28));
      ctx.lineTo(cx + Math.cos(angle) * (radius + 12), cy + Math.sin(angle) * (radius + 12));
      ctx.stroke();
      ctx.restore();
    };

    const goodMs = (this.timing.windows?.good || 0.17) * 1000;
    const perfectMs = (this.timing.windows?.perfect || 0.09) * 1000;
    arc(-maxMs, -goodMs, "#4ea2ff");
    arc(-goodMs, -perfectMs, "#ffd166");
    arc(-perfectMs, perfectMs, "#90ffbd", 13);
    arc(perfectMs, goodMs, "#ff9f4a");
    arc(goodMs, maxMs, "#ff5f59");
    for (const ghost of this.offsetGhosts) needle(ghost.offsetMs, ghost.color, (ghost.life / ghost.maxLife) * 0.34, 2);
    needle(this.lastOffsetMs, "#ffffff", 0.95, 4);

    ctx.save();
    ctx.fillStyle = "rgba(244, 251, 255, 0.72)";
    ctx.font = "800 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("EARLY", cx - radius, cy + 28);
    ctx.fillText("PERFECT", cx, cy - radius - 14);
    ctx.fillText("LATE", cx + radius, cy + 28);
    ctx.restore();
  }

  #updateDebug() {
    this.debugOverlay.update({
      beatmap: this.beatmap,
      audioTime: this.audio.getTime(),
      target: this.timing.getTarget(),
      nextIndex: this.timing.nextIndex,
      settings: this.settings,
    });
  }

  #bindUi() {
    this.ui.calibration.value = String(this.settings.calibrationMs);
    this.ui.calibrationValue.textContent = `${this.settings.calibrationMs} ms`;
    this.ui.reduceCamera.checked = this.settings.reduceCamera;
    this.ui.noDeath.checked = this.settings.noDeath;
    this.ui.missMode.value = this.settings.missMode;

    // No Death grants infinite misses, so the Allowed Misses picker greys out.
    const syncNoDeathUi = () => {
      this.ui.allowedMissesGroup.classList.toggle("is-disabled", this.settings.noDeath);
      for (const button of this.ui.allowedMissButtons) button.disabled = this.settings.noDeath;
    };
    syncNoDeathUi();

    this.ui.calibration.addEventListener("input", () => {
      this.settings.calibrationMs = Number(this.ui.calibration.value);
      this.ui.calibrationValue.textContent = `${this.settings.calibrationMs} ms`;
      this.store.saveSettings(this.settings);
    });
    this.ui.reduceCamera.addEventListener("change", () => {
      this.settings.reduceCamera = this.ui.reduceCamera.checked;
      this.store.saveSettings(this.settings);
    });
    this.ui.noDeath.addEventListener("change", () => {
      this.settings.noDeath = this.ui.noDeath.checked;
      this.store.saveSettings(this.settings);
      syncNoDeathUi();
    });
    this.ui.missMode.addEventListener("change", () => {
      this.settings.missMode = this.ui.missMode.value;
      this.store.saveSettings(this.settings);
    });

    // Allowed Misses segmented control (0 / 1 / 2 chances per run).
    const syncMissButtons = () => {
      for (const button of this.ui.allowedMissButtons) {
        button.classList.toggle("is-active", Number(button.dataset.value) === this.#allowedMisses());
      }
    };
    syncMissButtons();
    for (const button of this.ui.allowedMissButtons) {
      button.addEventListener("click", () => {
        this.settings.allowedMisses = Number(button.dataset.value);
        this.store.saveSettings(this.settings);
        syncMissButtons();
      });
    }

    this.ui.freeplay.addEventListener("click", () => this.toggleFreeplay());
    this.canvas.addEventListener("pointermove", (event) => this.#handleCanvasHover(event));
    this.canvas.addEventListener("pointerdown", (event) => this.#handleCanvasClick(event));

    this.ui.readyBack.addEventListener("click", () => this.showMenu());
    this.ui.pause.addEventListener("click", () => this.pause());
    this.ui.restart.addEventListener("click", () => this.retry(true));
    this.ui.resume.addEventListener("click", () => this.resume());
    this.ui.pauseRestart.addEventListener("click", () => this.retry(true));
    this.ui.pauseMenu.addEventListener("click", () => this.showMenu());
    this.ui.resultsRetry.addEventListener("click", () => this.loadLevel(this.currentLevel));
    this.ui.resultsMenu.addEventListener("click", () => this.showMenu());
    this.ui.spamTest.addEventListener("click", () => {
      const variant = this.variantParent?.variants?.find((item) => item.variant === "test");
      if (variant) this.loadLevel(variant);
    });
    this.ui.spamLevel.addEventListener("click", () => {
      const variant = this.variantParent?.variants?.find((item) => item.variant === "level");
      if (variant) this.loadLevel(variant);
    });
    this.ui.debugReady.addEventListener("click", () => this.debugOverlay.toggle());
    this.ui.debugHud.addEventListener("click", () => this.debugOverlay.toggle());
    this.ui.debugClose.addEventListener("click", () => this.debugOverlay.setEnabled(false));
  }

  #showOnly(name) {
    for (const [key, view] of Object.entries(this.views)) {
      if (key === "hud") continue;
      view.classList.toggle("is-active", key === name);
    }
  }

  #setHudVisible(value) {
    this.views.hud.classList.toggle("is-active", Boolean(value));
  }

  #resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 1);
    const width = Math.floor(window.innerWidth * scale);
    const height = Math.floor(window.innerHeight * scale);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  #collectUi() {
    return {
      readyKicker: document.getElementById("readyKicker"),
      readyTitle: document.getElementById("readyTitle"),
      readyMeta: document.getElementById("readyMeta"),
      readyPrompt: document.getElementById("readyPrompt"),
      variantActions: document.getElementById("variantActions"),
      spamTest: document.getElementById("spamTestButton"),
      spamLevel: document.getElementById("spamLevelButton"),
      readyActions: document.querySelector(".ready-actions"),
      readyBack: document.getElementById("readyBackButton"),
      hudLevel: document.getElementById("hudLevel"),
      hudTimer: document.getElementById("hudTimer"),
      hudFeedback: document.getElementById("hudFeedback"),
      hudCombo: document.getElementById("hudCombo"),
      hudLives: document.getElementById("hudLives"),
      hudDeaths: document.getElementById("hudDeaths"),
      hudAccuracy: document.getElementById("hudAccuracy"),
      hudPower: document.getElementById("hudPower"),
      freeplay: document.getElementById("freeplayButton"),
      pause: document.getElementById("pauseButton"),
      restart: document.getElementById("restartButton"),
      debugHud: document.getElementById("debugToggleHud"),
      debugReady: document.getElementById("debugToggleReady"),
      debugClose: document.getElementById("debugCloseButton"),
      progressBar: document.getElementById("progressBar"),
      progressShell: document.querySelector(".progress-shell"),
      pauseTitle: document.getElementById("pauseTitle"),
      resume: document.getElementById("resumeButton"),
      pauseRestart: document.getElementById("pauseRestartButton"),
      pauseMenu: document.getElementById("pauseMenuButton"),
      resultsRetry: document.getElementById("resultsRetryButton"),
      resultsMenu: document.getElementById("resultsMenuButton"),
      countdown: document.getElementById("countdownOverlay"),
      countdownNumber: document.getElementById("countdownNumber"),
      calibration: document.getElementById("calibrationInput"),
      calibrationValue: document.getElementById("calibrationValue"),
      reduceCamera: document.getElementById("reduceCameraInput"),
      noDeath: document.getElementById("noDeathInput"),
      missMode: document.getElementById("missModeInput"),
      allowedMissesGroup: document.getElementById("allowedMissesGroup"),
      allowedMissButtons: Array.from(
        document.querySelectorAll("#allowedMissesGroup .segmented button"),
      ),
    };
  }
}
