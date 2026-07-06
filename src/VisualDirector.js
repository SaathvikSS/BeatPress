import { clamp, distance } from "./utils.js";

const EVENT_TYPES = new Set([
  "shipFlyby", "laserSweep", "starfall", "nebulaPulse", "backgroundBurst",
  "rocket", "ufo", "firework", "hueBloom", "speedLines",
]);
const APPROVED_COLORS = new Set(["#FF4FCB", "#4FFFEF", "#FFDD00", "#A855F7", "#FF6B35", "#39FF14"]);
const MAX_ACTIVE_EVENTS = 6;
const EVENT_WINDOW = 0.08;
const TWO_PI = Math.PI * 2;

// Which shared depth layers each background mode keeps (star dust / warp
// grid / wireframe solids). Everything else in a mode's look comes from its
// dedicated scene renderer, so no two levels share a sky.
const MODE_LAYERS = {
  deepSpace: { stars: 1, grid: 0.7, solids: 0.8 },
  nebulaStorm: { stars: 0.5, grid: 0, solids: 0 },
  crystalOrbit: { stars: 0.4, grid: 0, solids: 1.5 },
  solarFlare: { stars: 0.25, grid: 0, solids: 0 },
  voidWalker: { stars: 0.35, grid: 0, solids: 0 },
  bloomGarden: { stars: 0.45, grid: 0, solids: 0 },
  helixTower: { stars: 0.4, grid: 0.9, solids: 0 },
  starfallRush: { stars: 0.9, grid: 0, solids: 0 },
  neonCircuit: { stars: 0.15, grid: 0, solids: 0 },
  prismCascade: { stars: 0.7, grid: 0, solids: 0.9 },
  magmaCore: { stars: 0.1, grid: 0, solids: 0 },
  hyperTunnel: { stars: 0, grid: 0, solids: 0 },
  singularity: { stars: 0.55, grid: 0, solids: 0 },
};

// Vertices/edges for the floating wireframe solids (GD-style 3D props).
const CUBE_VERTS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const OCTA_VERTS = [
  [0, -1.3, 0], [1.3, 0, 0], [0, 1.3, 0], [-1.3, 0, 0], [0, 0, -1.3], [0, 0, 1.3],
];
const OCTA_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [0, 4], [1, 4], [2, 4], [3, 4],
  [0, 5], [1, 5], [2, 5], [3, 5],
];

function hashSeed(text) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(1664525, value) + 1013904223;
    return ((value >>> 0) / 4294967296);
  };
}

export class VisualDirector {
  constructor() {
    this.beatmap = null;
    this.theme = null;
    this.schedule = [];
    this.active = [];
    this.ambientStars = [];
    this.ambientLanes = [];
    this.ambientGlyphs = [];
    this.pendingIndex = 0;
    this.activeIndex = 0;
    this.activePoint = null;
    this.nextPoint = null;
    this.audioLevel = 0;
    this.songTime = 0;
    this.reduceMotion = false;
    this.debugSkipped = 0;
  }

  loadBeatmap(beatmap) {
    this.beatmap = beatmap;
    this.theme = beatmap.levelTheme || {};
    this.schedule = this.#scheduleEvents(beatmap);
    this.#buildAmbientSet(beatmap);
    this.reset();
  }

  reset() {
    this.active = [];
    this.pendingIndex = 0;
    this.activeIndex = 0;
    this.activePoint = null;
    this.nextPoint = null;
    this.audioLevel = 0;
    this.songTime = 0;
    this.debugSkipped = 0;
  }

  setReduceMotion(value) {
    this.reduceMotion = Boolean(value);
  }

  update(dt, songTime, activeIndex, audioLevel) {
    if (!this.beatmap) return;
    const nodes = this.beatmap.nodes || [];
    this.songTime = songTime;
    this.activeIndex = activeIndex;
    this.activePoint = nodes[activeIndex] || nodes[0] || null;
    this.nextPoint = nodes[Math.min(nodes.length - 1, activeIndex + 1)] || this.activePoint;
    this.audioLevel = audioLevel;

    while (this.pendingIndex < this.schedule.length) {
      const event = this.schedule[this.pendingIndex];
      if (event.time > songTime + EVENT_WINDOW) break;
      this.pendingIndex += 1;
      if (songTime - event.time > EVENT_WINDOW) {
        this.debugSkipped += 1;
        continue;
      }
      if (this.active.length >= MAX_ACTIVE_EVENTS) continue;
      this.active.push({ ...event, age: Math.max(0, songTime - event.time) });
    }

    for (const event of this.active) event.age = Math.max(0, songTime - event.time);
    this.active = this.active.filter((event) => event.age <= event.duration);
  }

  drawBackground(ctx, canvas, camera) {
    this.#drawContinuousBackground(ctx, canvas, camera);
    for (const event of this.active) {
      if (event.type === "nebulaPulse") this.#drawNebulaPulse(ctx, canvas, event);
      else if (event.type === "backgroundBurst") this.#drawBackgroundBurst(ctx, canvas, event);
      else if (event.type === "hueBloom") this.#drawHueBloom(ctx, canvas, event);
      else if (event.type === "rocket") this.#drawRocket(ctx, canvas, event);
      else if (event.type === "ufo") this.#drawUfo(ctx, canvas, event);
      else if (event.type === "firework") this.#drawFirework(ctx, canvas, event);
    }
  }

  drawWorld(ctx, camera) {
    this.#drawContinuousWorld(ctx, camera);
    for (const event of this.active) {
      if (event.type === "shipFlyby") this.#drawShipFlyby(ctx, camera, event);
      else if (event.type === "laserSweep") this.#drawLaserSweep(ctx, camera, event);
    }
  }

  drawForeground(ctx, canvas) {
    this.#drawContinuousForeground(ctx, canvas);
    for (const event of this.active) {
      if (event.type === "starfall") this.#drawStarfall(ctx, canvas, event);
      else if (event.type === "speedLines") this.#drawSpeedLines(ctx, canvas, event);
    }
  }

  getDebugState() {
    return {
      active: this.active.length,
      scheduled: this.schedule.length,
      skipped: this.debugSkipped,
      phase: Number((this.songTime % 1000).toFixed(3)),
      ambientStars: this.ambientStars.length,
      ambientLanes: this.ambientLanes.length,
      ambientGlyphs: this.ambientGlyphs.length,
      continuousLayers: 5,
    };
  }

  #scheduleEvents(beatmap) {
    const events = Array.isArray(beatmap.visualEvents) && beatmap.visualEvents.length
      ? beatmap.visualEvents
      : this.#deriveEvents(beatmap);
    const seed = hashSeed(`${beatmap.id}:${beatmap.title}:${beatmap.nodes?.length || 0}`);
    return events
      .filter((event) => EVENT_TYPES.has(event?.type))
      .map((event, index) => {
        const random = seeded(seed + index * 97);
        return {
          time: Number(event.time) || 0,
          type: event.type,
          duration: clamp(Number(event.duration) || 0.5, 0.08, 3.4),
          intensity: clamp(Number(event.intensity) || 0.5, 0.2, 1),
          color: this.#safeColor(event.color),
          lane: Number.isFinite(Number(event.lane)) ? Number(event.lane) : index % 4,
          drift: random() * 2 - 1,
          variant: Math.floor(random() * 4),
          seed: seed + index * 193,
        };
      })
      .sort((a, b) => a.time - b.time);
  }

  #buildAmbientSet(beatmap) {
    const seed = hashSeed(`ambient:${beatmap.id}:${beatmap.title}:${beatmap.nodes?.length || 0}`);
    const random = seeded(seed);
    this.ambientStars = [];
    this.ambientLanes = [];
    this.ambientGlyphs = [];

    for (let i = 0; i < 46; i += 1) {
      this.ambientStars.push({
        x: random(),
        y: random(),
        speed: 0.018 + random() * 0.07,
        drift: random() * 2 - 1,
        size: 0.5 + random() * 2.2,
        phase: random(),
        colorIndex: Math.floor(random() * 3),
      });
    }
    for (let i = 0; i < 12; i += 1) {
      this.ambientLanes.push({
        offset: random() * 2 - 1,
        angle: (random() * 80 - 40) * (Math.PI / 180),
        speed: 0.05 + random() * 0.14,
        width: 1.4 + random() * 4.5,
        phase: random(),
        colorIndex: Math.floor(random() * 3),
      });
    }
    for (let i = 0; i < 9; i += 1) {
      this.ambientGlyphs.push({
        radius: 360 + random() * 540,
        angle: random() * TWO_PI,
        spin: (random() > 0.5 ? 1 : -1) * (0.08 + random() * 0.22),
        wobble: 45 + random() * 130,
        size: 14 + random() * 32,
        phase: random() * TWO_PI,
        colorIndex: Math.floor(random() * 3),
        variant: Math.floor(random() * 4),
      });
    }
  }

  #deriveEvents(beatmap) {
    return (beatmap.nodes || [])
      .filter((node) => (node.checkpoint || node.accent) && node.time > 0)
      .slice(0, 30)
      .map((node, index) => ({
        time: node.time,
        type: node.checkpoint ? "backgroundBurst" : index % 2 ? "starfall" : "laserSweep",
        duration: node.checkpoint ? 0.62 : 0.42,
        intensity: node.visualIntensity || 0.5,
        color: index % 3 === 0 ? this.theme?.accentColor : this.theme?.primaryColor,
        lane: index % 4,
      }));
  }

  #safeColor(color) {
    const normalized = String(color || "").toUpperCase();
    return APPROVED_COLORS.has(normalized) ? normalized : "#4FFFEF";
  }

  #themeColor(index) {
    const colors = [this.theme?.primaryColor, this.theme?.secondaryColor, this.theme?.accentColor]
      .map((color) => this.#safeColor(color));
    return colors[index % colors.length] || "#4FFFEF";
  }

  #wrap(value, max) {
    return ((value % max) + max) % max;
  }

  #readabilityAlpha(baseAlpha, event) {
    const point = this.activePoint;
    const next = this.nextPoint;
    if (!point) return baseAlpha;
    const eventPoint = this.#eventWorldPoint(event);
    const activeDistance = distance(point, eventPoint);
    const nextDistance = next ? distance(next, eventPoint) : activeDistance;
    const danger = Math.min(activeDistance, nextDistance) < 260;
    const dense = point.spam || next?.spam || point.interval < 0.34 || next?.interval < 0.34;
    let alpha = baseAlpha;
    if (danger) alpha = Math.min(alpha, 0.28);
    if (dense) alpha *= 0.58;
    if (this.reduceMotion) alpha *= 0.48;
    return alpha;
  }

  #eventWorldPoint(event) {
    const center = this.activePoint || { x: 0, y: 0 };
    const lane = event.lane - 1.5;
    return {
      x: center.x + lane * 180 + event.drift * 220,
      y: center.y + (event.variant - 1.5) * 150,
    };
  }

  #drawContinuousBackground(ctx, canvas, camera) {
    if (!this.beatmap) return;
    const time = this.songTime;
    const intensity = clamp(this.theme?.backgroundIntensity ?? 0.58, 0.25, 1);
    const motionScale = this.reduceMotion ? 0.38 : 1;
    const mode = this.theme?.backgroundMode || "deepSpace";
    const layers = MODE_LAYERS[mode] || MODE_LAYERS.deepSpace;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (layers.stars > 0) {
      for (const star of this.ambientStars) {
        const x = this.#wrap(star.x * canvas.width + time * star.speed * canvas.width * motionScale - camera.x * 0.018, canvas.width + 160) - 80;
        const y =
          this.#wrap(
            star.y * canvas.height +
              Math.sin(time * 0.32 + star.phase * TWO_PI) * 34 * star.drift * motionScale -
              camera.y * 0.012,
            canvas.height + 160,
          ) - 80;
        const pulse = 0.55 + Math.sin(time * (0.9 + star.speed * 10) + star.phase * TWO_PI) * 0.45;
        ctx.globalAlpha = clamp((0.12 + pulse * 0.26 + this.audioLevel * 0.22) * intensity * layers.stars, 0.02, 0.46);
        ctx.fillStyle = this.#themeColor(star.colorIndex);
        ctx.beginPath();
        ctx.arc(x, y, star.size * (1 + pulse * 0.7), 0, TWO_PI);
        ctx.fill();
      }
    }

    if (mode === "nebulaStorm") this.#drawStormScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "crystalOrbit") this.#drawCrystalScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "solarFlare") this.#drawSolarScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "voidWalker") this.#drawVoidScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "neonCircuit") this.#drawCircuitScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "starfallRush") this.#drawStarfallScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "bloomGarden") this.#drawGardenScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "helixTower" || mode === "omegaDrive") this.#drawHelixScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "prismCascade") this.#drawPrismScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "magmaCore") this.#drawMagmaScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "hyperTunnel") this.#drawTunnelScene(ctx, canvas, camera, time, intensity, motionScale);
    else if (mode === "singularity") this.#drawSingularityScene(ctx, canvas, camera, time, intensity, motionScale);
    else this.#drawDeepSpaceScene(ctx, canvas, camera, time, intensity, motionScale);

    // Optional shared depth layers, gated per mode.
    if (layers.grid > 0) this.#drawWarpGrid(ctx, canvas, time, intensity * layers.grid, motionScale);
    if (layers.solids > 0) this.#drawPolyhedra(ctx, canvas, camera, time, intensity * layers.solids, motionScale);
    ctx.restore();
  }

  // Perspective floor grid: converging verticals plus horizon lines that
  // accelerate toward the viewer, brightness keyed to the audio level.
  #drawWarpGrid(ctx, canvas, time, intensity, motionScale) {
    const horizon = canvas.height * 0.68;
    const depth = canvas.height - horizon;
    const cx = canvas.width / 2;
    const pulse = 0.5 + this.audioLevel * 1.4;
    ctx.strokeStyle = this.#themeColor(0);
    ctx.lineWidth = 1.2;
    for (let i = -9; i <= 9; i += 1) {
      const spread = i * canvas.width * 0.085;
      ctx.globalAlpha = clamp((0.028 + pulse * 0.02) * intensity * (1 - Math.abs(i) * 0.055), 0.004, 0.09);
      ctx.beginPath();
      ctx.moveTo(cx + spread * 0.22, horizon);
      ctx.lineTo(cx + spread * 2.4, canvas.height + 4);
      ctx.stroke();
    }
    ctx.strokeStyle = this.#themeColor(1);
    for (let k = 0; k < 9; k += 1) {
      const z = ((time * 0.22 * motionScale + k / 9) % 1);
      const y = horizon + depth * z * z;
      ctx.globalAlpha = clamp((0.02 + pulse * 0.028) * intensity * z, 0.004, 0.1);
      ctx.lineWidth = 1 + z * 2.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  // Distant rotating wireframe cubes/octahedra with simple 3D projection.
  #drawPolyhedra(ctx, canvas, camera, time, intensity, motionScale) {
    const solids = [
      { verts: CUBE_VERTS, edges: CUBE_EDGES, x: 0.16, y: 0.24, size: 52, speed: 0.32, color: 0 },
      { verts: OCTA_VERTS, edges: OCTA_EDGES, x: 0.84, y: 0.3, size: 64, speed: -0.24, color: 1 },
      { verts: CUBE_VERTS, edges: CUBE_EDGES, x: 0.7, y: 0.76, size: 40, speed: 0.45, color: 2 },
      { verts: OCTA_VERTS, edges: OCTA_EDGES, x: 0.26, y: 0.8, size: 46, speed: -0.38, color: 0 },
    ];
    for (const solid of solids) {
      const ax = time * solid.speed * motionScale;
      const ay = time * solid.speed * 0.7 * motionScale + 1.1;
      const cosX = Math.cos(ax);
      const sinX = Math.sin(ax);
      const cosY = Math.cos(ay);
      const sinY = Math.sin(ay);
      const px = canvas.width * solid.x - camera.x * 0.015 + Math.sin(time * 0.18 + solid.x * 9) * 26;
      const py = canvas.height * solid.y - camera.y * 0.012 + Math.cos(time * 0.15 + solid.y * 7) * 20;
      const projected = solid.verts.map(([vx, vy, vz]) => {
        const y1 = vy * cosX - vz * sinX;
        const z1 = vy * sinX + vz * cosX;
        const x2 = vx * cosY + z1 * sinY;
        const z2 = -vx * sinY + z1 * cosY;
        const persp = 3.1 / (3.1 + z2);
        return { x: px + x2 * solid.size * persp, y: py + y1 * solid.size * persp, d: persp };
      });
      ctx.strokeStyle = this.#themeColor(solid.color);
      for (const [a, b] of solid.edges) {
        const depthGlow = (projected[a].d + projected[b].d) / 2;
        ctx.globalAlpha = clamp((0.03 + this.audioLevel * 0.05) * intensity * depthGlow, 0.008, 0.14);
        ctx.lineWidth = 1 + depthGlow * 0.9;
        ctx.beginPath();
        ctx.moveTo(projected[a].x, projected[a].y);
        ctx.lineTo(projected[b].x, projected[b].y);
        ctx.stroke();
      }
    }
  }

  // ---------------------------------------------------------------------
  // Per-level scenes. Every backgroundMode owns a full set piece drawn in
  // screen space behind the track, so each stage reads as its own world.
  // ---------------------------------------------------------------------

  #glowCircle(ctx, x, y, radius, color, alpha) {
    if (alpha <= 0) return;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.55, "rgba(255,255,255,0.03)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TWO_PI);
    ctx.fill();
  }

  // Neon Drift: a huge ringed gas giant with cloud bands, orbiting moons,
  // and a drifting asteroid belt on camera parallax.
  #drawDeepSpaceScene(ctx, canvas, camera, time, intensity, motionScale) {
    const px = canvas.width * 0.78 - camera.x * 0.02;
    const py = canvas.height * 0.26 - camera.y * 0.016;
    const R = Math.min(canvas.width, canvas.height) * 0.17;

    this.#glowCircle(ctx, px, py, R * 2.6, this.#themeColor(0), 0.15 * intensity);

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const body = ctx.createRadialGradient(px - R * 0.4, py - R * 0.4, R * 0.1, px, py, R);
    body.addColorStop(0, "rgba(122, 212, 236, 0.55)");
    body.addColorStop(0.55, "rgba(32, 72, 112, 0.6)");
    body.addColorStop(1, "rgba(6, 14, 30, 0.75)");
    ctx.globalAlpha = 0.9 * intensity;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(px, py, R, 0, TWO_PI);
    ctx.fill();
    // Cloud bands clipped to the disc.
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, R, 0, TWO_PI);
    ctx.clip();
    for (let b = -3; b <= 3; b += 1) {
      const yy = py + b * R * 0.24 + Math.sin(time * 0.3 * motionScale + b * 1.7) * 4;
      ctx.globalAlpha = 0.12 * intensity;
      ctx.fillStyle = b % 2 ? this.#themeColor(0) : this.#themeColor(1);
      ctx.fillRect(px - R, yy, R * 2, R * 0.11);
    }
    ctx.restore();
    ctx.restore();

    // Tilted ring system.
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.42);
    for (let r = 0; r < 3; r += 1) {
      ctx.globalAlpha = (0.22 - r * 0.055) * intensity;
      ctx.strokeStyle = this.#themeColor(r);
      ctx.lineWidth = 4 - r;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * (1.45 + r * 0.22), R * (0.34 + r * 0.06), 0, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.restore();

    // Two moons on slow orbits.
    for (let m = 0; m < 2; m += 1) {
      const a = time * (0.16 + m * 0.09) * motionScale + m * 2.6;
      const mx = px + Math.cos(a) * R * (1.9 + m * 0.5);
      const my = py + Math.sin(a) * R * (0.62 + m * 0.2);
      this.#glowCircle(ctx, mx, my, 16, this.#themeColor(m + 1), 0.3 * intensity);
      ctx.globalAlpha = 0.55 * intensity;
      ctx.fillStyle = "rgba(190, 214, 240, 0.7)";
      ctx.beginPath();
      ctx.arc(mx, my, 5 + m * 2.4, 0, TWO_PI);
      ctx.fill();
    }

    // Asteroid belt drifting through the lower third.
    for (let i = 0; i < 20; i += 1) {
      const ax = this.#wrap(i * 137 + time * (14 + (i % 5) * 4) * motionScale - camera.x * 0.04, canvas.width + 120) - 60;
      const ay = canvas.height * (0.66 + Math.sin(i * 2.4) * 0.09) + Math.sin(time * 0.5 + i) * 10 - camera.y * 0.03;
      const s = 3 + (i % 4) * 2.4;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(time * 0.4 * motionScale + i);
      ctx.globalAlpha = 0.26 * intensity;
      ctx.fillStyle = "rgba(150, 180, 220, 0.55)";
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.5);
      ctx.lineTo(s * 0.3, -s);
      ctx.lineTo(s, 0);
      ctx.lineTo(s * 0.2, s * 0.8);
      ctx.lineTo(-s * 0.7, s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Nebula Run: rolling thunderheads, forked lightning, and driven rain.
  #drawStormScene(ctx, canvas, camera, time, intensity, motionScale) {
    for (let i = 0; i < 8; i += 1) {
      const cx = this.#wrap(i * canvas.width * 0.17 + time * (8 + i) * motionScale - camera.x * 0.02, canvas.width + 400) - 200;
      const cy = canvas.height * (0.13 + (i % 3) * 0.1) + Math.sin(time * 0.2 + i) * 18;
      this.#glowCircle(ctx, cx, cy, 150 + (i % 3) * 70, this.#themeColor(i % 2), 0.12 * intensity);
    }
    const strike = Math.floor(time / 1.6);
    const strikeT = (time % 1.6) / 1.6;
    if (strikeT < 0.22 && !this.reduceMotion) {
      const random = seeded(strike * 7919 + 13);
      const bx = canvas.width * (0.12 + random() * 0.76);
      let x = bx;
      let y = -10;
      ctx.globalAlpha = clamp((0.55 - strikeT * 2.2) * intensity, 0, 0.6);
      ctx.strokeStyle = "rgba(232, 244, 255, 0.95)";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      const bottom = canvas.height * (0.5 + random() * 0.3);
      while (y < bottom) {
        x += (random() - 0.5) * 90;
        y += 30 + random() * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha *= 0.45;
      ctx.lineWidth = 7;
      ctx.stroke();
      this.#glowCircle(ctx, bx, canvas.height * 0.2, 280, this.#themeColor(0), clamp((0.3 - strikeT) * intensity, 0, 0.3));
    }
    for (let i = 0; i < 34; i += 1) {
      const rx = this.#wrap(i * 61 + time * 90 * motionScale, canvas.width + 60) - 30;
      const ry = this.#wrap(i * 97 + time * 540 * motionScale, canvas.height + 80) - 40;
      ctx.globalAlpha = 0.1 * intensity;
      ctx.strokeStyle = this.#themeColor(1);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 7, ry + 26);
      ctx.stroke();
    }
  }

  // Crystal Orbit: faceted shards floating on parallax, glinting, with slow
  // refraction beams sweeping from the center.
  #drawCrystalScene(ctx, canvas, camera, time, intensity, motionScale) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    for (let b = 0; b < 3; b += 1) {
      const a = time * 0.1 * motionScale + b * (TWO_PI / 3);
      ctx.globalAlpha = 0.05 * intensity;
      ctx.fillStyle = this.#themeColor(b);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, Math.max(canvas.width, canvas.height), a, a + 0.16);
      ctx.closePath();
      ctx.fill();
    }
    const random = seeded(911);
    for (let i = 0; i < 9; i += 1) {
      const baseX = random();
      const baseY = random();
      const depth = 0.4 + random() * 0.8;
      const size = (26 + random() * 44) * depth;
      const spinSpeed = 0.2 + random() * 0.3;
      const x = canvas.width * baseX - camera.x * 0.03 * depth + Math.sin(time * 0.3 + i) * 24;
      const y = this.#wrap(canvas.height * baseY - time * 12 * motionScale * depth, canvas.height + 260) - 130;
      const color = this.#themeColor(i % 3);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * spinSpeed * motionScale + i);
      ctx.globalAlpha = 0.16 * intensity * depth;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.5, -size * 0.3);
      ctx.lineTo(size * 0.42, size * 0.5);
      ctx.lineTo(0, size);
      ctx.lineTo(-size * 0.42, size * 0.5);
      ctx.lineTo(-size * 0.5, -size * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.42 * intensity * depth;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // Inner facet lines.
      ctx.globalAlpha *= 0.55;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(0, size);
      ctx.moveTo(-size * 0.5, -size * 0.3);
      ctx.lineTo(size * 0.42, size * 0.5);
      ctx.stroke();
      const glint = (Math.sin(time * 2.2 + i * 1.7) + 1) / 2;
      if (glint > 0.82) this.#glowCircle(ctx, 0, -size * 0.6, size, color, (glint - 0.82) * 2.6 * intensity);
      ctx.restore();
    }
  }

  // Solar Flare: a massive sun cresting the bottom edge with animated
  // prominence loops and rising embers.
  #drawSolarScene(ctx, canvas, camera, time, intensity, motionScale) {
    const cx = canvas.width * 0.5;
    const cy = canvas.height * 1.18;
    const R = canvas.height * 0.52;
    this.#glowCircle(ctx, cx, cy, R * 2.1, this.#themeColor(0), 0.3 * intensity);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const body = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R);
    body.addColorStop(0, "rgba(255, 200, 80, 0.72)");
    body.addColorStop(0.8, "rgba(255, 110, 40, 0.55)");
    body.addColorStop(1, "rgba(90, 20, 8, 0.3)");
    ctx.globalAlpha = 0.8 * intensity;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
    for (let i = 0; i < 6; i += 1) {
      const a = -Math.PI * (0.15 + i * 0.14) + Math.sin(time * 0.3 + i) * 0.04;
      const bx = cx + Math.cos(a) * R;
      const by = cy + Math.sin(a) * R;
      const loop = 0.5 + Math.sin(time * 0.7 * motionScale + i * 2.1) * 0.5;
      const h = 40 + loop * 110;
      ctx.globalAlpha = (0.14 + loop * 0.2) * intensity;
      ctx.strokeStyle = this.#themeColor(i % 3);
      ctx.lineWidth = 3 + loop * 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bx - 30, by);
      ctx.quadraticCurveTo(bx + Math.cos(a) * h * 1.6, by + Math.sin(a) * h * 1.6, bx + 34, by + 8);
      ctx.stroke();
    }
    for (let i = 0; i < 26; i += 1) {
      const p = this.#wrap(time * (0.06 + (i % 5) * 0.02) * motionScale + i * 0.077, 1);
      const ex = cx + Math.sin(i * 2.6) * canvas.width * 0.42 + Math.sin(time * 0.8 + i) * 26;
      const ey = canvas.height - p * canvas.height * 1.1;
      ctx.globalAlpha = (1 - p) * 0.3 * intensity;
      ctx.fillStyle = i % 3 ? this.#themeColor(1) : this.#themeColor(2);
      ctx.beginPath();
      ctx.arc(ex, ey, 1.6 + (i % 3), 0, TWO_PI);
      ctx.fill();
    }
  }

  // Void Walker: a black hole with a lensing ring, infalling accretion
  // streaks, and glitch tears slicing the void.
  #drawVoidScene(ctx, canvas, camera, time, intensity, motionScale) {
    const cx = canvas.width * 0.5 - camera.x * 0.01;
    const cy = canvas.height * 0.42 - camera.y * 0.01;
    const R = Math.min(canvas.width, canvas.height) * 0.13;
    for (let i = 0; i < 30; i += 1) {
      const p = this.#wrap(time * (0.1 + (i % 6) * 0.02) * motionScale + i / 30, 1);
      const a = i * 2.399 + time * 0.5 * motionScale + p * 5;
      const r = R * 1.1 + (1 - p) * R * 3.4;
      ctx.globalAlpha = p * 0.28 * intensity;
      ctx.strokeStyle = this.#themeColor(i % 3);
      ctx.lineWidth = 1.4 + p * 1.8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a, a + 0.5 + p * 0.5);
      ctx.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.5);
    core.addColorStop(0, "rgba(0, 0, 4, 0.95)");
    core.addColorStop(0.72, "rgba(0, 0, 6, 0.8)");
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.5, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
    const pulse = 0.75 + this.audioLevel * 0.5;
    ctx.globalAlpha = clamp(0.5 * pulse, 0.2, 0.6) * intensity;
    ctx.strokeStyle = this.#themeColor(0);
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TWO_PI);
    ctx.stroke();
    ctx.globalAlpha = 0.2 * intensity;
    ctx.lineWidth = 7;
    ctx.stroke();
    const g = Math.floor(time * 2.3);
    const gr = seeded(g * 331 + 7);
    if (gr() > 0.45 && !this.reduceMotion) {
      const gy = gr() * canvas.height;
      const gh = 3 + gr() * 10;
      ctx.globalAlpha = 0.15 * intensity;
      ctx.fillStyle = this.#themeColor(Math.floor(gr() * 3));
      ctx.fillRect(0, gy, canvas.width, gh);
    }
  }

  // Comet Coil: perspective circuit floor/ceiling plus live traces with
  // data pulses running along them.
  #drawCircuitScene(ctx, canvas, camera, time, intensity, motionScale) {
    const horizonY = canvas.height * 0.5;
    for (const dir of [1, -1]) {
      const cx = canvas.width / 2;
      ctx.strokeStyle = this.#themeColor(0);
      for (let i = -8; i <= 8; i += 1) {
        ctx.globalAlpha = 0.11 * intensity * (1 - Math.abs(i) * 0.08);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx + i * 30, horizonY);
        ctx.lineTo(cx + i * canvas.width * 0.16, horizonY + dir * canvas.height * 0.55);
        ctx.stroke();
      }
      for (let k = 0; k < 8; k += 1) {
        const z = (time * 0.5 * motionScale + k / 8) % 1;
        const y = horizonY + dir * canvas.height * 0.55 * z * z;
        ctx.globalAlpha = 0.15 * intensity * z;
        ctx.lineWidth = 1 + z * 2.4;
        ctx.strokeStyle = this.#themeColor(1);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }
    const random = seeded(1723);
    for (let t = 0; t < 7; t += 1) {
      const pts = [];
      let px = random() * canvas.width;
      let py = random() * canvas.height;
      pts.push([px, py]);
      for (let s = 0; s < 4; s += 1) {
        if (s % 2 === 0) px += (random() - 0.5) * 360;
        else py += (random() - 0.5) * 260;
        pts.push([px, py]);
      }
      const color = this.#themeColor(t % 3);
      ctx.globalAlpha = 0.13 * intensity;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      pts.forEach(([xx, yy], idx) => (idx ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy)));
      ctx.stroke();
      ctx.fillStyle = color;
      for (const [xx, yy] of pts) {
        ctx.beginPath();
        ctx.arc(xx, yy, 2.6, 0, TWO_PI);
        ctx.fill();
      }
      const pp = this.#wrap(time * (0.3 + t * 0.06) * motionScale, 1) * (pts.length - 1);
      const seg = Math.min(pts.length - 2, Math.floor(pp));
      const frac = pp - seg;
      const dx = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * frac;
      const dy = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * frac;
      this.#glowCircle(ctx, dx, dy, 26, color, 0.4 * intensity);
    }
  }

  // Hyper Bloom: a dense meteor shower with gradient tails and recurring
  // mandala firework rings.
  #drawStarfallScene(ctx, canvas, camera, time, intensity, motionScale) {
    for (let i = 0; i < 22; i += 1) {
      const p = this.#wrap(time * (0.24 + (i % 7) * 0.05) * motionScale + i * 0.13, 1.25);
      if (p > 1) continue;
      const sx = this.#wrap(i * 173 + time * 30 * motionScale, canvas.width + 300) - 100;
      const sy = p * (canvas.height + 200) - 100;
      const len = 60 + (i % 4) * 34;
      const gradient = ctx.createLinearGradient(sx, sy, sx - len * 0.7, sy - len);
      gradient.addColorStop(0, this.#themeColor(i % 3));
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = (1 - p) * 0.45 * intensity;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2 + (i % 3);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - len * 0.7, sy - len);
      ctx.stroke();
    }
    const cyc = (time % 2.4) / 2.4;
    if (cyc < 0.55 && !this.reduceMotion) {
      const random = seeded(Math.floor(time / 2.4) * 613 + 3);
      const bx = canvas.width * (0.25 + random() * 0.5);
      const by = canvas.height * (0.2 + random() * 0.3);
      const spokes = 14;
      const rr = 30 + cyc * 320;
      ctx.globalAlpha = clamp((0.55 - cyc) * intensity, 0, 0.5);
      ctx.strokeStyle = this.#themeColor(Math.floor(random() * 3));
      ctx.lineWidth = 2;
      for (let sp = 0; sp < spokes; sp += 1) {
        const a = (sp / spokes) * TWO_PI + cyc * 0.8;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a) * rr * 0.55, by + Math.sin(a) * rr * 0.55);
        ctx.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr);
        ctx.stroke();
      }
      ctx.globalAlpha *= 0.6;
      ctx.beginPath();
      ctx.arc(bx, by, rr * 0.72, 0, TWO_PI);
      ctx.stroke();
    }
  }

  // Bloom Garden: a giant rotating mandala flower, drifting petals, and
  // vines climbing the screen edges.
  #drawGardenScene(ctx, canvas, camera, time, intensity, motionScale) {
    const cx = canvas.width * 0.5 - camera.x * 0.015;
    const cy = canvas.height * 0.46 - camera.y * 0.012;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.06 * motionScale);
    for (let ring = 0; ring < 3; ring += 1) {
      const petals = 8 + ring * 4;
      const radius = Math.min(canvas.width, canvas.height) * (0.16 + ring * 0.11);
      for (let p = 0; p < petals; p += 1) {
        const a = (p / petals) * TWO_PI + ring * 0.35;
        ctx.save();
        ctx.rotate(a);
        ctx.translate(radius, 0);
        ctx.rotate(Math.PI / 2);
        ctx.globalAlpha = clamp((0.1 - ring * 0.02 + Math.sin(time * 0.8 + ring) * 0.02) * intensity, 0.02, 0.2);
        ctx.fillStyle = this.#themeColor(ring);
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 0.16, radius * 0.34, 0, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha *= 2.1;
        ctx.strokeStyle = this.#themeColor(ring);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
    for (let i = 0; i < 20; i += 1) {
      const p = this.#wrap(time * (0.05 + (i % 5) * 0.016) * motionScale + i * 0.05, 1);
      const px = this.#wrap(i * 131 + Math.sin(time * 0.7 + i) * 60, canvas.width + 80) - 40;
      const py = p * (canvas.height + 60) - 30;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(time * 1.2 * motionScale + i);
      ctx.globalAlpha = 0.32 * (1 - p * 0.4) * intensity;
      ctx.fillStyle = this.#themeColor(i % 3);
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 3.4, 0, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }
    for (const side of [0, 1]) {
      const baseX = side ? canvas.width - 40 : 40;
      ctx.globalAlpha = 0.26 * intensity;
      ctx.strokeStyle = this.#themeColor(1);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let yy = 0; yy <= canvas.height; yy += 24) {
        const xx = baseX + Math.sin(yy * 0.02 + time * 0.5 * motionScale + side * 3) * 26;
        if (yy === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
  }

  // Helix Tower: two DNA rails climbing the screen with rungs between them
  // plus perspective tower rings rising past the camera.
  #drawHelixScene(ctx, canvas, camera, time, intensity, motionScale) {
    const cx = canvas.width * 0.5 - camera.x * 0.02;
    const scroll = time * 60 * motionScale;
    for (const strandOffset of [0, Math.PI]) {
      ctx.globalAlpha = 0.28 * intensity;
      ctx.strokeStyle = this.#themeColor(strandOffset ? 1 : 0);
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (let yy = -40; yy <= canvas.height + 40; yy += 12) {
        const phase = (yy + scroll) * 0.016 + strandOffset;
        const xx = cx + Math.sin(phase) * canvas.width * 0.3;
        if (yy === -40) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    for (let yy = -40; yy <= canvas.height + 40; yy += 46) {
      const phase = (yy + scroll) * 0.016;
      const x1 = cx + Math.sin(phase) * canvas.width * 0.3;
      const x2 = cx + Math.sin(phase + Math.PI) * canvas.width * 0.3;
      const depth = (Math.cos(phase) + 1) / 2;
      ctx.globalAlpha = (0.09 + depth * 0.18) * intensity;
      ctx.strokeStyle = this.#themeColor(2);
      ctx.lineWidth = 1.6 + depth * 1.6;
      ctx.beginPath();
      ctx.moveTo(x1, yy);
      ctx.lineTo(x2, yy);
      ctx.stroke();
    }
    for (let r = 0; r < 6; r += 1) {
      const p = this.#wrap(time * 0.07 * motionScale + r / 6, 1);
      const ry = canvas.height * (1 - p);
      const scale = 0.25 + p * 0.9;
      ctx.globalAlpha = clamp(0.14 * (1 - Math.abs(p - 0.5) * 1.4), 0.01, 0.14) * intensity;
      ctx.strokeStyle = this.#themeColor(r % 3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, ry, canvas.width * 0.36 * scale, 26 * scale, 0, 0, TWO_PI);
      ctx.stroke();
    }
  }

  // Star Cascade: floating prisms splitting white light into rainbow fans
  // over a rain of crystal shards.
  #drawPrismScene(ctx, canvas, camera, time, intensity, motionScale) {
    const random = seeded(419);
    for (let i = 0; i < 4; i += 1) {
      const px = canvas.width * (0.12 + random() * 0.76) - camera.x * 0.02;
      const py = canvas.height * (0.14 + random() * 0.5) + Math.sin(time * 0.4 + i * 2.2) * 22;
      const size = 26 + random() * 30;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(time * 0.12 * motionScale + i);
      ctx.globalAlpha = 0.34 * intensity;
      ctx.strokeStyle = "rgba(235, 245, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.87, size * 0.5);
      ctx.lineTo(-size * 0.87, size * 0.5);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 0.18 * intensity;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(px - canvas.width * 0.3, py - canvas.height * 0.16);
      ctx.lineTo(px, py);
      ctx.stroke();
      const fan = ["#FF6B35", "#FFDD00", "#39FF14", "#4FFFEF", "#A855F7", "#FF4FCB"];
      fan.forEach((color, f) => {
        const a = 0.5 + (f - 2.5) * 0.075 + Math.sin(time * 0.6 + i) * 0.03;
        ctx.globalAlpha = 0.18 * intensity;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * canvas.width * 0.34, py + Math.sin(a) * canvas.width * 0.34);
        ctx.stroke();
      });
    }
    for (let i = 0; i < 16; i += 1) {
      const p = this.#wrap(time * (0.1 + (i % 4) * 0.03) * motionScale + i * 0.062, 1);
      const sx = this.#wrap(i * 149, canvas.width);
      const sy = p * (canvas.height + 80) - 40;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(time * motionScale + i);
      ctx.globalAlpha = 0.28 * (1 - p * 0.5) * intensity;
      ctx.fillStyle = this.#themeColor(i % 3);
      ctx.fillRect(-2.4, -6, 4.8, 12);
      ctx.restore();
    }
  }

  // Inferno Core: a lava sea, glowing lava falls, obsidian silhouettes,
  // and embers rising through the heat.
  #drawMagmaScene(ctx, canvas, camera, time, intensity, motionScale) {
    for (let layer = 0; layer < 3; layer += 1) {
      const baseY = canvas.height * (0.78 + layer * 0.07);
      ctx.globalAlpha = (0.28 - layer * 0.07) * intensity;
      ctx.fillStyle = layer === 0 ? this.#themeColor(1) : this.#themeColor(0);
      ctx.beginPath();
      ctx.moveTo(-20, canvas.height + 20);
      for (let xx = -20; xx <= canvas.width + 20; xx += 36) {
        const yy = baseY + Math.sin(xx * 0.012 + time * (0.8 - layer * 0.2) * motionScale + layer * 2) * 16;
        ctx.lineTo(xx, yy);
      }
      ctx.lineTo(canvas.width + 20, canvas.height + 20);
      ctx.closePath();
      ctx.fill();
    }
    for (let i = 0; i < 3; i += 1) {
      const fx = canvas.width * (0.18 + i * 0.3) + Math.sin(i * 7) * 40;
      const flow = this.#wrap(time * 0.9 * motionScale + i * 0.3, 1);
      const gradient = ctx.createLinearGradient(fx, 0, fx, canvas.height * 0.8);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(0.5, this.#themeColor(0));
      gradient.addColorStop(1, this.#themeColor(1));
      ctx.globalAlpha = clamp((0.16 + Math.sin(time * 1.4 + i * 2) * 0.05) * intensity, 0.04, 0.24);
      ctx.fillStyle = gradient;
      ctx.fillRect(fx - 9, 0, 18, canvas.height * 0.82);
      this.#glowCircle(ctx, fx, flow * canvas.height * 0.8, 30, this.#themeColor(1), 0.28 * intensity);
    }
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "rgba(6, 3, 8, 0.85)";
    for (const side of [0, 1]) {
      const bx = side ? canvas.width : 0;
      const dir = side ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(bx, canvas.height);
      ctx.lineTo(bx, canvas.height * 0.55);
      ctx.lineTo(bx + dir * 70, canvas.height * 0.62);
      ctx.lineTo(bx + dir * 40, canvas.height * 0.74);
      ctx.lineTo(bx + dir * 130, canvas.height * 0.8);
      ctx.lineTo(bx + dir * 90, canvas.height);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    for (let i = 0; i < 30; i += 1) {
      const p = this.#wrap(time * (0.08 + (i % 6) * 0.02) * motionScale + i * 0.033, 1);
      const ex = this.#wrap(i * 127 + Math.sin(time * 0.9 + i) * 40, canvas.width);
      const ey = canvas.height * (1 - p * 1.05);
      ctx.globalAlpha = Math.sin(p * Math.PI) * 0.45 * intensity;
      ctx.fillStyle = i % 4 === 0 ? this.#themeColor(2) : this.#themeColor(1);
      ctx.beginPath();
      ctx.arc(ex, ey, 1.4 + (i % 3), 0, TWO_PI);
      ctx.fill();
    }
  }

  // Warp Tunnel: a full-screen 3D hyperspace tube — rings racing outward
  // from a wandering vanishing point with radial light streaks.
  #drawTunnelScene(ctx, canvas, camera, time, intensity, motionScale) {
    const cx = canvas.width / 2 + Math.sin(time * 0.4) * 30 * motionScale;
    const cy = canvas.height / 2 + Math.cos(time * 0.33) * 22 * motionScale;
    const maxR = Math.hypot(canvas.width, canvas.height) * 0.62;
    for (let i = 0; i < 10; i += 1) {
      const z = this.#wrap(time * 0.6 * motionScale + i / 10, 1);
      const r = z * z * maxR + 6;
      const bright = z * (1 - z * 0.3);
      ctx.globalAlpha = clamp((0.08 + bright * 0.28 + this.audioLevel * 0.15) * intensity, 0.02, 0.44);
      ctx.strokeStyle = this.#themeColor(i % 3);
      ctx.lineWidth = 1.4 + z * 5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TWO_PI);
      ctx.stroke();
    }
    for (let i = 0; i < 26; i += 1) {
      const a = i * 2.399;
      const z = this.#wrap(time * (0.7 + (i % 5) * 0.12) * motionScale + i * 0.077, 1);
      const r0 = z * z * maxR;
      const r1 = Math.min(maxR, r0 + 30 + z * 190);
      ctx.globalAlpha = z * 0.45 * intensity;
      ctx.strokeStyle = this.#themeColor(i % 3);
      ctx.lineWidth = 1 + z * 2.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    this.#glowCircle(ctx, cx, cy, 90 + this.audioLevel * 60, this.#themeColor(0), 0.35 * intensity);
  }

  // Singularity: a black hole with a tilted accretion disk, lensed halo
  // arcs, and matter streams spiraling into the event horizon.
  #drawSingularityScene(ctx, canvas, camera, time, intensity, motionScale) {
    const cx = canvas.width * 0.5 - camera.x * 0.008;
    const cy = canvas.height * 0.44 - camera.y * 0.008;
    const R = Math.min(canvas.width, canvas.height) * 0.11;
    for (let i = 0; i < 40; i += 1) {
      const a = i * 0.157 + time * (0.5 + (i % 4) * 0.1) * motionScale;
      const rr = R * (1.5 + (i % 8) * 0.24);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr * 0.32;
      const behind = Math.sin(a) < 0;
      ctx.globalAlpha = (behind ? 0.15 : 0.4) * intensity;
      ctx.fillStyle = this.#themeColor(i % 3);
      ctx.beginPath();
      ctx.arc(px, py, 1.4 + ((i + 2) % 3), 0, TWO_PI);
      ctx.fill();
    }
    for (const flip of [-1, 1]) {
      ctx.globalAlpha = 0.26 * intensity;
      ctx.strokeStyle = this.#themeColor(1);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy - flip * R * 0.55, R * 1.28, R * 0.62, 0, flip > 0 ? Math.PI : 0, flip > 0 ? TWO_PI : Math.PI);
      ctx.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = "rgba(2, 0, 6, 0.96)";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.82, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
    const flare = 0.5 + this.audioLevel * 0.8;
    ctx.globalAlpha = clamp(0.5 * flare, 0.2, 0.7) * intensity;
    ctx.strokeStyle = this.#themeColor(0);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.9, 0, TWO_PI);
    ctx.stroke();
    for (let s = 0; s < 3; s += 1) {
      ctx.globalAlpha = 0.18 * intensity;
      ctx.strokeStyle = this.#themeColor(s);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let t = 0; t < 46; t += 1) {
        const a = time * 0.7 * motionScale + s * 2.1 + t * 0.16;
        const rr = R * 0.95 + t * 9;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr * 0.8;
        if (t === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  #drawContinuousWorld(ctx, camera) {
    if (!this.beatmap || !this.activePoint) return;
    this.#drawPathEnergyPulses(ctx);
    this.#drawAmbientWorldLanes(ctx, camera);
    this.#drawPatrolGlyphs(ctx, camera);
  }

  #drawPathEnergyPulses(ctx) {
    const nodes = this.beatmap.nodes || [];
    const start = Math.max(0, this.activeIndex - 1);
    const end = Math.min(nodes.length - 1, this.activeIndex + 10);
    const time = this.songTime;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = start + 1; i <= end; i += 1) {
      const a = nodes[i - 1];
      const b = nodes[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const pulse = this.#wrap(time * (0.85 + (i % 3) * 0.18) + i * 0.19, 1);
      const px = a.x + dx * pulse;
      const py = a.y + dy * pulse;
      const alpha = clamp(0.18 + (b.visualIntensity || 0.5) * 0.22, 0.16, 0.42) * (this.reduceMotion ? 0.45 : 1);
      ctx.strokeStyle = this.#themeColor(i);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(px - dx * 0.12, py - dy * 0.12);
      ctx.lineTo(px + dx * 0.04, py + dy * 0.04);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawAmbientWorldLanes(ctx, camera) {
    const time = this.songTime;
    const densityAlpha = this.activePoint?.interval < 0.34 || this.nextPoint?.interval < 0.34 ? 0.45 : 1;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const lane of this.ambientLanes) {
      const phase = this.#wrap(time * lane.speed + lane.phase, 1);
      const offset = (phase - 0.5) * 980 + lane.offset * 260;
      const alpha = (0.06 + Math.sin(time * 0.6 + lane.phase * TWO_PI) * 0.02) * densityAlpha * (this.reduceMotion ? 0.45 : 1);
      ctx.save();
      ctx.translate(camera.x, camera.y);
      ctx.rotate(lane.angle + Math.sin(time * 0.08 + lane.phase) * 0.12);
      ctx.globalAlpha = clamp(alpha, 0.018, 0.105);
      ctx.strokeStyle = this.#themeColor(lane.colorIndex);
      ctx.lineWidth = lane.width;
      ctx.beginPath();
      ctx.moveTo(-740, offset);
      ctx.lineTo(740, offset + Math.sin(time * 0.21 + lane.phase) * 90);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  #drawPatrolGlyphs(ctx, camera) {
    const time = this.songTime;
    const dense = this.activePoint?.interval < 0.34 || this.nextPoint?.interval < 0.34;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const glyph of this.ambientGlyphs) {
      const angle = glyph.angle + time * glyph.spin * (this.reduceMotion ? 0.35 : 1);
      const x = camera.x + Math.cos(angle) * glyph.radius + Math.sin(time * 0.4 + glyph.phase) * glyph.wobble;
      const y = camera.y + Math.sin(angle) * glyph.radius * 0.62 + Math.cos(time * 0.34 + glyph.phase) * glyph.wobble;
      const dist = this.activePoint ? distance(this.activePoint, { x, y }) : 999;
      if (dist < 240) continue;
      const alpha = (dense ? 0.12 : 0.22) * (this.reduceMotion ? 0.45 : 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + time * 0.25);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = this.#themeColor(glyph.colorIndex);
      ctx.lineWidth = 2;
      if (glyph.variant === 0) this.#drawShipShape(ctx, this.#themeColor(glyph.colorIndex));
      else this.#drawGlyphShape(ctx, glyph.size, glyph.variant);
      ctx.restore();
    }
    ctx.restore();
  }

  #drawGlyphShape(ctx, size, variant) {
    ctx.beginPath();
    if (variant === 1) {
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.75, 0);
      ctx.lineTo(0, size);
      ctx.lineTo(-size * 0.75, 0);
      ctx.closePath();
    } else if (variant === 2) {
      ctx.arc(0, 0, size * 0.7, 0, TWO_PI);
      ctx.moveTo(-size, 0);
      ctx.lineTo(size, 0);
      ctx.moveTo(0, -size);
      ctx.lineTo(0, size);
    } else {
      ctx.moveTo(-size, -size * 0.45);
      ctx.lineTo(size, 0);
      ctx.lineTo(-size, size * 0.45);
    }
    ctx.stroke();
  }

  #drawContinuousForeground(ctx, canvas) {
    if (!this.beatmap) return;
    const time = this.songTime;
    const style = this.theme?.particleStyle || "sparks";
    const baseCount = style === "comets" ? 18 : style === "rings" ? 12 : 14;
    const count = this.reduceMotion ? Math.ceil(baseCount * 0.45) : baseCount;
    const speed = style === "pixelDust" ? 120 : style === "embers" ? 95 : 170;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < count; i += 1) {
      const star = this.ambientStars[(i * 3) % this.ambientStars.length];
      const progress = this.#wrap(time * (0.035 + star.speed) + star.phase + i * 0.071, 1);
      const x = this.#wrap(star.x * canvas.width + progress * canvas.width * 0.42, canvas.width + 140) - 70;
      const y = this.#wrap(star.y * canvas.height + progress * speed + Math.sin(time + i) * 18, canvas.height + 140) - 70;
      const alpha = (0.12 + this.audioLevel * 0.28) * (1 - progress * 0.45);
      ctx.globalAlpha = alpha * (this.reduceMotion ? 0.5 : 1);
      ctx.strokeStyle = this.#themeColor(star.colorIndex);
      ctx.lineWidth = 1.2 + star.size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 26 - star.size * 7, y - 12 - star.size * 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawNebulaPulse(ctx, canvas, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const alpha = (1 - t) * event.intensity * (this.reduceMotion ? 0.16 : 0.36);
    const radius = Math.max(canvas.width, canvas.height) * (0.18 + t * 0.62);
    const x = canvas.width * (0.28 + (event.lane % 3) * 0.22);
    const y = canvas.height * (0.24 + (event.variant % 3) * 0.2);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `${event.color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`);
    gradient.addColorStop(0.45, "rgba(255, 255, 255, 0.02)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  #drawBackgroundBurst(ctx, canvas, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const alpha = (1 - t) * event.intensity * (this.reduceMotion ? 0.14 : 0.4);
    const spokes = 18;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((event.lane * Math.PI) / 8);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = event.color;
    ctx.lineWidth = 2.6;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < spokes; i += 1) {
      const angle = (i / spokes) * Math.PI * 2;
      const inner = 80 + t * 180;
      const outer = Math.max(canvas.width, canvas.height) * (0.42 + t * 0.34);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawShipFlyby(ctx, camera, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const side = event.lane % 2 === 0 ? -1 : 1;
    const y = camera.y + (event.lane - 1.5) * 190 + event.drift * 70;
    const x = camera.x + side * (520 - t * 1040);
    let alpha = (1 - Math.abs(t - 0.5) * 1.35) * 0.86 * event.intensity;
    if (this.activePoint?.interval < 0.34 || this.nextPoint?.interval < 0.34) alpha *= 0.72;
    if (this.reduceMotion) alpha *= 0.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(side > 0 ? Math.PI : 0);
    ctx.globalAlpha = clamp(alpha, 0, 0.82);
    ctx.globalCompositeOperation = "lighter";
    const swarmCount = this.theme?.shipStyle === "droneSwarm" ? 3 : 1;
    for (let i = 0; i < swarmCount; i += 1) {
      ctx.save();
      if (swarmCount > 1) {
        ctx.translate(-i * 52, (i - 1) * 32 + Math.sin(t * Math.PI * 2 + i) * 8);
        ctx.scale(0.9 - i * 0.08, 0.9 - i * 0.08);
      }
      this.#drawShipShape(ctx, event.color);
      ctx.restore();
    }
    ctx.restore();
  }

  #drawShipShape(ctx, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.moveTo(48, 0);
    ctx.lineTo(-28, -22);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-28, 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-20, -12);
    ctx.lineTo(-62, 0);
    ctx.lineTo(-20, 12);
    ctx.stroke();
    ctx.globalAlpha *= 0.55;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-56, 0);
    ctx.lineTo(-112, 0);
    ctx.stroke();
  }

  #drawLaserSweep(ctx, camera, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const angle = ((event.lane - 1) * 24 + event.drift * 10) * (Math.PI / 180);
    const offset = (t - 0.5) * 900;
    const point = this.activePoint || { x: camera.x, y: camera.y };
    const alpha = this.#readabilityAlpha((1 - t) * 0.82 * event.intensity, event);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.globalAlpha = clamp(alpha, 0, 0.35);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = event.color;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-620, offset);
    ctx.lineTo(620, offset + event.drift * 80);
    ctx.stroke();
    ctx.globalAlpha *= 0.35;
    ctx.lineWidth = 34;
    ctx.stroke();
    ctx.restore();
  }

  #drawStarfall(ctx, canvas, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const count = Math.floor((this.reduceMotion ? 8 : 26) * event.intensity);
    const random = seeded(event.seed);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = event.color;
    ctx.lineCap = "round";
    for (let i = 0; i < count; i += 1) {
      const startX = random() * canvas.width;
      const startY = random() * canvas.height;
      const progress = (t + random() * 0.5) % 1;
      const x = startX + progress * 220;
      const y = startY + progress * 120;
      const alpha = (1 - progress) * 0.82 * event.intensity * (this.reduceMotion ? 0.5 : 1);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2.4 + random() * 3.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 32, y - 18);
      ctx.stroke();
    }
    ctx.restore();
  }

  // A rocket arcs across the sky on an exhaust plume, then pops into sparks.
  #drawRocket(ctx, canvas, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const dir = event.lane % 2 === 0 ? 1 : -1;
    const x0 = dir > 0 ? -90 : canvas.width + 90;
    const x = x0 + dir * (canvas.width + 180) * t;
    const y = canvas.height * (0.72 - 0.46 * t) + Math.sin(t * Math.PI * 2 + event.drift * 3) * 26;
    const angle = Math.atan2(-0.46 * canvas.height / (canvas.width + 180), 1) * dir + (dir > 0 ? 0 : Math.PI);
    const alpha = clamp((1 - Math.abs(t - 0.5) * 0.6) * event.intensity, 0, 0.9) * (this.reduceMotion ? 0.5 : 1);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Exhaust plume: puffs trail behind along the flight path.
    const random = seeded(event.seed);
    for (let i = 0; i < 14; i += 1) {
      const back = i / 14;
      const pt = Math.max(0, t - back * 0.22);
      const puffX = x0 + dir * (canvas.width + 180) * pt;
      const puffY = canvas.height * (0.72 - 0.46 * pt) + Math.sin(pt * Math.PI * 2 + event.drift * 3) * 26;
      ctx.globalAlpha = alpha * (1 - back) * 0.24;
      ctx.fillStyle = i % 3 === 0 ? event.color : "rgba(255, 214, 170, 0.8)";
      ctx.beginPath();
      ctx.arc(puffX + (random() - 0.5) * 14, puffY + (random() - 0.5) * 14, 4 + back * 15, 0, TWO_PI);
      ctx.fill();
    }

    if (t < 0.86) {
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.globalAlpha = alpha;
      // Body.
      ctx.fillStyle = "rgba(238, 246, 255, 0.92)";
      ctx.strokeStyle = event.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(30, 0);
      ctx.quadraticCurveTo(16, -9, -14, -8);
      ctx.lineTo(-14, 8);
      ctx.quadraticCurveTo(16, 9, 30, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Fins.
      ctx.fillStyle = event.color;
      ctx.beginPath();
      ctx.moveTo(-8, -7);
      ctx.lineTo(-22, -17);
      ctx.lineTo(-14, -2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-8, 7);
      ctx.lineTo(-22, 17);
      ctx.lineTo(-14, 2);
      ctx.closePath();
      ctx.fill();
      // Porthole.
      ctx.fillStyle = "rgba(80, 200, 255, 0.9)";
      ctx.beginPath();
      ctx.arc(10, 0, 3.6, 0, TWO_PI);
      ctx.fill();
      // Flicker flame.
      const flame = 16 + Math.sin(event.age * 40) * 7;
      ctx.fillStyle = "rgba(255, 190, 90, 0.9)";
      ctx.beginPath();
      ctx.moveTo(-14, -5);
      ctx.lineTo(-14 - flame, 0);
      ctx.lineTo(-14, 5);
      ctx.closePath();
      ctx.fill();
    } else {
      // Terminal pop: a small spark burst where the rocket ends.
      const burstT = (t - 0.86) / 0.14;
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * TWO_PI;
        const dist = burstT * 64;
        ctx.globalAlpha = alpha * (1 - burstT);
        ctx.fillStyle = i % 2 ? event.color : "#ffffff";
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, 2.6, 0, TWO_PI);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // An alien saucer glides across, strafing the ground with laser bolts.
  #drawUfo(ctx, canvas, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const dir = event.lane % 2 === 0 ? 1 : -1;
    const x = (dir > 0 ? -70 : canvas.width + 70) + dir * (canvas.width + 140) * t;
    const y = canvas.height * (0.16 + (event.variant % 3) * 0.07) + Math.sin(t * Math.PI * 5 + event.drift) * 16;
    const alpha = clamp((1 - Math.abs(t - 0.5) * 0.8) * event.intensity, 0, 0.85) * (this.reduceMotion ? 0.5 : 1);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Firing phases: two bursts across the flight.
    const firing = (t > 0.24 && t < 0.4) || (t > 0.58 && t < 0.74);
    if (firing) {
      const beamY = y + 12;
      const beamLen = canvas.height * 0.42;
      const gradient = ctx.createLinearGradient(x, beamY, x + dir * 60, beamY + beamLen);
      gradient.addColorStop(0, event.color);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = alpha * (0.5 + Math.sin(event.age * 60) * 0.3);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, beamY);
      ctx.lineTo(x + dir * 60, beamY + beamLen);
      ctx.stroke();
      // Impact flare.
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = event.color;
      ctx.beginPath();
      ctx.arc(x + dir * 60, beamY + beamLen, 9 + Math.sin(event.age * 44) * 4, 0, TWO_PI);
      ctx.fill();
    }

    ctx.globalAlpha = alpha;
    // Hull.
    ctx.fillStyle = "rgba(20, 30, 48, 0.92)";
    ctx.strokeStyle = event.color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(x, y, 42, 13, 0, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    // Dome.
    ctx.fillStyle = "rgba(140, 235, 190, 0.5)";
    ctx.beginPath();
    ctx.arc(x, y - 7, 15, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    // Rim lights chase around the hull.
    for (let i = 0; i < 5; i += 1) {
      const blink = (Math.floor(event.age * 8) + i) % 5 === 0;
      ctx.fillStyle = blink ? "#ffffff" : event.color;
      ctx.globalAlpha = alpha * (blink ? 1 : 0.55);
      ctx.beginPath();
      ctx.arc(x - 28 + i * 14, y + 4, 2.6, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  // Classic firework: rise, burst into two-tone sparks that droop and fade.
  #drawFirework(ctx, canvas, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const random = seeded(event.seed);
    const bx = canvas.width * (0.2 + random() * 0.6);
    const peakY = canvas.height * (0.18 + random() * 0.22);
    const alpha = event.intensity * (this.reduceMotion ? 0.45 : 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    if (t < 0.28) {
      // Ascent streak.
      const rise = t / 0.28;
      const y = canvas.height * 0.9 - (canvas.height * 0.9 - peakY) * rise;
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = "rgba(255, 226, 180, 0.9)";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bx, y + 26);
      ctx.lineTo(bx, y);
      ctx.stroke();
    } else {
      const boom = (t - 0.28) / 0.72;
      const sparks = this.reduceMotion ? 14 : 26;
      for (let i = 0; i < sparks; i += 1) {
        const a = (i / sparks) * TWO_PI + random() * 0.1;
        const speed = 90 + random() * 120;
        const px = bx + Math.cos(a) * speed * boom;
        const py = peakY + Math.sin(a) * speed * boom + 130 * boom * boom;
        ctx.globalAlpha = alpha * clamp(1 - boom, 0, 1);
        ctx.fillStyle = i % 2 ? event.color : "#ffffff";
        ctx.beginPath();
        ctx.arc(px, py, 2.8 * (1 - boom * 0.5), 0, TWO_PI);
        ctx.fill();
      }
      // Core glow right after the burst.
      if (boom < 0.4) {
        const glow = ctx.createRadialGradient(bx, peakY, 0, bx, peakY, 70);
        glow.addColorStop(0, event.color);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = alpha * (0.4 - boom) * 1.6;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(bx, peakY, 70, 0, TWO_PI);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Full-screen color wash that rolls the hue as it expands.
  #drawHueBloom(ctx, canvas, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const alpha = (1 - t) * event.intensity * (this.reduceMotion ? 0.1 : 0.24);
    const radius = Math.max(canvas.width, canvas.height) * (0.25 + t * 0.85);
    const cx = canvas.width * (0.3 + (event.lane % 3) * 0.2);
    const cy = canvas.height * 0.42;
    const hue = (event.seed % 360) + t * 140;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `hsla(${hue % 360}, 90%, 62%, ${alpha})`);
    gradient.addColorStop(0.5, `hsla(${(hue + 60) % 360}, 85%, 55%, ${alpha * 0.4})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // Radial anime speed lines announcing a spam corridor.
  #drawSpeedLines(ctx, canvas, event) {
    const t = clamp(event.age / event.duration, 0, 1);
    const alpha = Math.sin(Math.min(1, t * 1.6) * Math.PI) * event.intensity * (this.reduceMotion ? 0.2 : 0.5);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const random = seeded(event.seed);
    const inner = Math.min(canvas.width, canvas.height) * 0.34;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = event.color;
    ctx.lineCap = "round";
    for (let i = 0; i < 22; i += 1) {
      const a = random() * TWO_PI;
      const jitter = ((event.age * 13 + i) % 1) * 0.3;
      const r0 = inner + random() * 90;
      const r1 = r0 + 120 + random() * 260;
      ctx.globalAlpha = alpha * (0.4 + random() * 0.6) * (1 - jitter);
      ctx.lineWidth = 1.4 + random() * 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
}
