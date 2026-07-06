import { clamp, distance, lerp, normalizeAngle } from "./utils.js";

// Unicolor jungle-green planets with a smokey aura, in the spirit of the
// original A Dance of Fire and Ice planets. Both orbs share the one palette;
// only their smoke phase differs.
const JUNGLE = {
  kind: "jungle",
  body: "#2e9d5e",
  light: "#7fd6a0",
  dark: "#155c33",
  glow: "rgba(46, 157, 94, 0.5)",
  trail: "#3fbf76",
  smoke: "rgba(110, 200, 150, 0.55)",
};
const PLANETS = [JUNGLE, JUNGLE];

// The temporary third planet (power-up) rides the same jungle palette.
const THIRD_PLANET = JUNGLE;

export class PlayerOrbitController {
  constructor(effects) {
    this.effects = effects;
    this.beatmap = null;
    this.anchorIndex = 0;
    this.lastHit = null;
    this.coreHue = 190;
    this.crashOrbit = null;
  }

  loadBeatmap(beatmap) {
    this.beatmap = beatmap;
    this.anchorIndex = 0;
    this.lastHit = null;
    this.crashOrbit = null;
  }

  resetToNode(nodeIndex) {
    this.anchorIndex = Math.max(0, Math.min(nodeIndex, this.beatmap.nodes.length - 1));
    this.lastHit = null;
    this.crashOrbit = null;
  }

  advanceTo(nodeIndex, quality) {
    this.anchorIndex = Math.max(0, Math.min(nodeIndex, this.beatmap.nodes.length - 1));
    const node = this.beatmap.nodes[this.anchorIndex];
    this.lastHit = { time: performance.now(), quality };
    this.crashOrbit = null;
    if (node) {
      this.effects.addHit({ x: node.x, y: node.y }, quality, node.visualIntensity || 0.5);
    }
  }

  startCrashOrbit({ songTime, duration, spin }) {
    const state = this.getState(songTime);
    this.crashOrbit = {
      anchorIndex: this.anchorIndex,
      startSongTime: songTime,
      duration,
      startAngle: Math.atan2(state.orbiter.y - state.anchor.y, state.orbiter.x - state.anchor.x),
      radius: state.radius,
      spin: spin || 1,
    };
  }

  getState(songTime) {
    if (!this.beatmap?.nodes?.length) {
      return {
        anchor: { x: 0, y: 0 },
        orbiter: { x: 0, y: 0 },
        mid: { x: 0, y: 0 },
        progress: 0,
        radius: 80,
      };
    }

    const nodes = this.beatmap.nodes;
    const anchor = nodes[this.anchorIndex] || nodes[0];
    if (this.crashOrbit) {
      const crashAnchor = nodes[this.crashOrbit.anchorIndex] || anchor;
      const crashProgress = clamp((songTime - this.crashOrbit.startSongTime) / this.crashOrbit.duration, 0, 1);
      const angle = this.crashOrbit.startAngle + this.crashOrbit.spin * Math.PI * 2 * crashProgress;
      const orbiter = {
        x: crashAnchor.x + Math.cos(angle) * this.crashOrbit.radius,
        y: crashAnchor.y + Math.sin(angle) * this.crashOrbit.radius,
      };
      return {
        anchor: crashAnchor,
        orbiter,
        mid: {
          x: (crashAnchor.x + orbiter.x) / 2,
          y: (crashAnchor.y + orbiter.y) / 2,
        },
        progress: crashProgress,
        radius: this.crashOrbit.radius,
        next: nodes[Math.min(nodes.length - 1, this.crashOrbit.anchorIndex + 1)] || crashAnchor,
        anchorPlanet: this.anchorIndex % 2,
        movingPlanet: 1 - (this.anchorIndex % 2),
      };
    }
    const previous = nodes[Math.max(0, this.anchorIndex - 1)] || anchor;
    const next = nodes[Math.min(nodes.length - 1, this.anchorIndex + 1)] || anchor;
    const interval = Math.max(0.001, next.time - anchor.time);
    const progress = clamp((songTime - anchor.time) / interval, 0, 1);
    const targetAngle = Math.atan2(next.y - anchor.y, next.x - anchor.x);
    const spin = next.spin || (next.turnDegrees >= 0 ? 1 : -1);
    const nextRadius = Math.max(34, distance(anchor, next));

    // Opening move: there is no real previous tile, so the moving planet
    // sweeps a FULL circle around the start tile at a constant radius and
    // lands on the first tile — ADOFAI's signature intro spin, instead of a
    // short elongated arc that spirals out from the tile center.
    const isIntro = this.anchorIndex === 0 && !this.lastHit;

    let startAngle;
    let delta;
    let radius;
    if (isIntro) {
      startAngle = targetAngle - spin * Math.PI * 2;
      delta = spin * Math.PI * 2;
      radius = nextRadius;
    } else {
      startAngle = Math.atan2(previous.y - anchor.y, previous.x - anchor.x);
      delta = normalizeAngle(targetAngle - startAngle);
      if (spin > 0 && delta < 0) delta += Math.PI * 2;
      if (spin < 0 && delta > 0) delta -= Math.PI * 2;
      const prevRadius = Math.max(34, distance(anchor, previous));
      radius = lerp(prevRadius, nextRadius, progress);
    }
    const angle = startAngle + delta * progress;
    const orbiter = {
      x: anchor.x + Math.cos(angle) * radius,
      y: anchor.y + Math.sin(angle) * radius,
    };

    return {
      anchor,
      orbiter,
      mid: {
        x: (anchor.x + orbiter.x) / 2,
        y: (anchor.y + orbiter.y) / 2,
      },
      progress,
      radius,
      next,
      anchorPlanet: this.anchorIndex % 2,
      movingPlanet: 1 - (this.anchorIndex % 2),
    };
  }

  draw(ctx, state, songTime, thirdPlanetActive = false) {
    const anchorPalette = PLANETS[state.anchorPlanet || 0];
    const movingPalette = PLANETS[state.movingPlanet || 1];

    // Landing squash: a brief pop right after a successful hit.
    const sinceHit = this.lastHit ? (performance.now() - this.lastHit.time) / 1000 : 9;
    const hitPop = Math.max(0, 1 - sinceHit / 0.14) * 0.16;

    this.#drawTrail(ctx);

    // Trails follow each PHYSICAL planet (never linked to each other): only
    // the swinging planet sweeps an arc, exactly like the real game.
    const movingId = `planet${state.movingPlanet ?? 1}`;

    if (thirdPlanetActive) {
      const third = this.#thirdPlanetPoint(state);
      this.#drawPlanet(ctx, third, 15, THIRD_PLANET, songTime, 4.2);
      this.effects.addTrail(third, THIRD_PLANET.trail, "third");
    }

    this.#drawPlanet(ctx, state.anchor, 19.5 * (1 + hitPop), anchorPalette, songTime, 0);
    this.#drawPlanet(ctx, state.orbiter, 19.5, movingPalette, songTime, 2.1);

    this.effects.addTrail(state.orbiter, movingPalette.trail, movingId);
  }

  // Neo Cosmos-style third planet: anchor, orbiter, and third form a rigid
  // equilateral triangle (third rides the same orbit 60 degrees behind, so
  // all three sides equal the orbit radius) and spin as one.
  #thirdPlanetPoint(state) {
    const dx = state.orbiter.x - state.anchor.x;
    const dy = state.orbiter.y - state.anchor.y;
    const angle = Math.atan2(dy, dx) + Math.PI / 3;
    const radius = Math.max(30, Math.hypot(dx, dy));
    return {
      x: state.anchor.x + Math.cos(angle) * radius,
      y: state.anchor.y + Math.sin(angle) * radius,
    };
  }

  // A single ADOFAI-style planet: smokey aura wisps curling around a flat
  // jungle-green ball with a thin dark rim and tiny gloss arc.
  #drawPlanet(ctx, point, radius, palette, songTime = 0, smokePhase = 0) {
    const { x, y } = point;

    // Soft luminous halo.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 3.4);
    halo.addColorStop(0, palette.glow);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.4, 0, Math.PI * 2);
    ctx.fill();

    // Subtle smokey haze hugging the body: a few soft puffs drifting close
    // to the rim so the planet stays a clean ADOFAI-style disc.
    for (let i = 0; i < 4; i += 1) {
      const angle = songTime * (0.5 + i * 0.09) + i * ((Math.PI * 2) / 4) + smokePhase;
      const dist = radius * (1.02 + Math.sin(songTime * 1.1 + i * 2.1) * 0.12);
      const sx = x + Math.cos(angle) * dist;
      const sy = y + Math.sin(angle) * dist;
      const size = radius * 0.62;
      const puff = ctx.createRadialGradient(sx, sy, 0, sx, sy, size);
      puff.addColorStop(0, palette.smoke);
      puff.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.09 + Math.sin(songTime * 1.6 + i) * 0.03;
      ctx.fillStyle = puff;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Body: vivid, nearly flat, gently darker toward the edge.
    ctx.save();
    const body = ctx.createRadialGradient(x, y, radius * 0.15, x, y, radius);
    body.addColorStop(0, palette.light);
    body.addColorStop(0.45, palette.body);
    body.addColorStop(1, palette.dark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Thin dark rim for crispness against bright tiles.
    ctx.strokeStyle = "rgba(4, 8, 16, 0.55)";
    ctx.lineWidth = Math.max(1.4, radius * 0.09);
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.97, 0, Math.PI * 2);
    ctx.stroke();

    // Tiny gloss arc, upper-left.
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = Math.max(1.6, radius * 0.13);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.6, -2.5, -1.35);
    ctx.stroke();
    ctx.restore();
  }

  #drawTrail(ctx) {
    this.effects.drawTrails(ctx);
  }
}
