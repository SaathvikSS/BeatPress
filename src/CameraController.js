import { clamp, distance, lerp } from "./utils.js";

const DEG = Math.PI / 180;
const INTRO_CUE_TIMES = [0.42, 0.82, 1.18, 1.78, 2.36];

function easeOutQuart(t) {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 4);
}

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const v = clamp(t, 0, 1) - 1;
  return 1 + c3 * v * v * v + c1 * v * v;
}

function impulse(t) {
  return Math.sin(clamp(t, 0, 1) * Math.PI);
}

function introPulse(songTime) {
  let pulse = 0;
  for (const time of INTRO_CUE_TIMES) {
    const age = songTime - time;
    if (age >= 0 && age <= 0.48) pulse = Math.max(pulse, impulse(age / 0.48));
  }
  return pulse;
}

export class CameraController {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.rotation = 0;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakePhase = 0;
    this.hitBump = 0;
    this.cueTime = 0;
    this.lastCueKey = "";
    this.reduceMotion = false;
    this.segments = null;
    this.cameraIntensity = 0.65;
  }

  loadBeatmap(beatmap) {
    this.segments = Array.isArray(beatmap?.audio?.segments) ? beatmap.audio.segments : null;
    this.cameraIntensity = clamp(beatmap?.levelTheme?.cameraIntensity ?? 0.65, 0.3, 1);
  }

  // Exponential pulse locked to the current music segment's beat grid.
  #beatPulse(songTime) {
    if (!this.segments?.length) return 0;
    const index = clamp(Math.floor(songTime / 30), 0, this.segments.length - 1);
    const segment = this.segments[index];
    const interval = Number(segment.beatInterval);
    if (!Number.isFinite(interval) || interval <= 0) return 0;
    const local = songTime - index * 30 - (Number(segment.firstBeatPhase) || 0);
    if (local < 0) return 0;
    const beatT = (local % interval) / interval;
    return Math.exp(-beatT * 6.5);
  }

  reset(point = { x: 0, y: 0 }) {
    this.x = point.x;
    this.y = point.y;
    this.zoom = 1;
    this.rotation = 0;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.hitBump = 0;
    this.cueTime = 0;
    this.lastCueKey = "";
  }

  setReduceMotion(value) {
    this.reduceMotion = Boolean(value);
  }

  hit(intensity = 0.5) {
    const motionScale = this.reduceMotion ? 0.2 : 1;
    this.hitBump = Math.max(this.hitBump, (0.025 + intensity * 0.028) * motionScale);
    this.shake = Math.max(this.shake, (2.4 + intensity * 4.8) * motionScale);
  }

  miss() {
    this.shake = this.reduceMotion ? 2.4 : 8;
    this.hitBump = Math.max(this.hitBump, this.reduceMotion ? 0.01 : 0.035);
  }

  update(dt, songTime, audioLevel, activeIndex, previewNodes) {
    const nodes = Array.isArray(previewNodes) && previewNodes.length ? previewNodes : [{ x: this.x, y: this.y }];
    const active = nodes[0];
    const next = nodes[1] || active;
    const upcoming = nodes.slice(1, 4);
    const avgSpacing = upcoming.length
      ? upcoming.reduce((sum, node, index) => sum + distance(nodes[index] || active, node), 0) / upcoming.length
      : 999;
    const dense = avgSpacing < 72 || active?.spam || next?.spam;
    const motionScale = this.reduceMotion ? 0.28 : 1;
    const lookaheadCount = dense ? 1 : 3;
    const lookahead = nodes.slice(1, 1 + lookaheadCount);
    const lookaheadTarget = lookahead.length
      ? {
          x: lookahead.reduce((sum, node) => sum + node.x, 0) / lookahead.length,
          y: lookahead.reduce((sum, node) => sum + node.y, 0) / lookahead.length,
        }
      : active;

    const maxLead = dense ? 76 : 170;
    const dx = lookaheadTarget.x - active.x;
    const dy = lookaheadTarget.y - active.y;
    const leadLength = Math.hypot(dx, dy);
    const leadScale = leadLength > maxLead ? maxLead / leadLength : 1;
    const desiredX = active.x + dx * leadScale;
    const desiredY = active.y + dy * leadScale;

    const cue = next?.cameraCue || active?.cameraCue || null;
    const cueKey = `${activeIndex}:${cue || "none"}`;
    if (cue && cueKey !== this.lastCueKey) {
      this.lastCueKey = cueKey;
      this.cueTime = 0;
    } else {
      this.cueTime += dt;
    }
    const cueT = clamp(this.cueTime / 0.78, 0, 1);
    const cueAmount = cue?.startsWith("roll") || cue?.startsWith("twist")
      ? impulse(cueT) * (0.86 + easeOutBack(Math.min(cueT * 1.7, 1)) * 0.14)
      : impulse(cueT);

    let cueZoom = 1;
    let cueRotation = 0;
    if (cue === "zoomOutDrop") cueZoom = 1 - 0.26 * cueAmount;
    else if (cue === "zoomInHit") cueZoom = 1 + 0.16 * cueAmount;
    else if (cue === "twistHeavy") cueRotation = (activeIndex % 2 ? -10 : 10) * DEG * cueAmount;
    else if (cue === "twistLight") cueRotation = (activeIndex % 2 ? -6 : 6) * DEG * cueAmount;
    else if (cue === "rollLeft") cueRotation = -6 * DEG * cueAmount;
    else if (cue === "rollRight") cueRotation = 6 * DEG * cueAmount;

    if (dense) {
      cueRotation *= 0.35;
      cueZoom = lerp(cueZoom, 1, 0.62);
    } else if (songTime < 3) {
      const introAmount = introPulse(songTime);
      cueZoom -= introAmount * 0.07 * motionScale;
      cueRotation += (activeIndex % 2 ? -1 : 1) * introAmount * 2.4 * DEG * motionScale;
    }

    // Density framing: pull wide for fast bursts, drift close on slow glides.
    const upcomingSpan = nodes.length > 3 ? (nodes[3].time - nodes[0].time) / 3 : 0.45;
    if (Number.isFinite(upcomingSpan) && upcomingSpan > 0) {
      if (upcomingSpan < 0.2) cueZoom -= 0.07 * motionScale;
      else if (upcomingSpan > 0.62) cueZoom += 0.05 * motionScale;
    }

    // Beat-locked pulse plus a slow cinematic sway.
    const beatPulse = this.#beatPulse(songTime);
    const pulseZoom = beatPulse * (dense ? 0.007 : 0.015) * this.cameraIntensity * motionScale;
    const sway = Math.sin(songTime * 0.21) * 0.55 * DEG * this.cameraIntensity * motionScale;

    const desiredZoom = clamp(
      cueZoom + pulseZoom + this.hitBump + audioLevel * 0.035 * motionScale,
      0.72,
      1.35,
    );
    const desiredRotation = clamp(cueRotation * motionScale + sway, -10 * DEG, 10 * DEG);
    const follow = dense ? 7.2 : 5.4;
    this.x = lerp(this.x, desiredX, clamp(dt * follow, 0, 1));
    this.y = lerp(this.y, desiredY, clamp(dt * follow, 0, 1));
    this.zoom = lerp(this.zoom, desiredZoom, clamp(dt * (dense ? 4.2 : 2.8), 0, 1));
    this.rotation = lerp(this.rotation, desiredRotation, clamp(dt * (dense ? 3.5 : 2.1), 0, 1));
    this.hitBump = Math.max(0, this.hitBump - dt * 2.8);
    this.shake = Math.max(0, this.shake - dt * 72);
    this.shakePhase += dt * 47;
    this.shakeX = Math.cos(this.shakePhase) * this.shake;
    this.shakeY = Math.sin(this.shakePhase * 1.31) * this.shake;
  }

  apply(ctx, canvas) {
    ctx.translate(canvas.width / 2 + this.shakeX, canvas.height / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.rotate(this.rotation);
    ctx.translate(-this.x, -this.y);
  }
}
