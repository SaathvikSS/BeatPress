import { clamp, lerp } from "./utils.js";

export class EffectsSystem {
  constructor() {
    this.ripples = [];
    this.particles = [];
    this.trail = [];
    this.labels = [];
    this.shards = [];
    this.lastTrailByColor = new Map();
    this.flash = 0;
    // Per-hit judgement words (Perfect / Early / Late / Miss). No Death mode
    // turns these off so the run stays a clean light show.
    this.judgementLabels = true;
  }

  setJudgementLabels(enabled) {
    this.judgementLabels = Boolean(enabled);
  }

  reset() {
    this.ripples = [];
    this.particles = [];
    this.trail = [];
    this.labels = [];
    this.shards = [];
    this.lastTrailByColor = new Map();
    this.flash = 0;
  }

  // A passed tile blows apart: each half of the road segment splits into
  // three quads that spin away, drop, and fade.
  addTileShatter(piece) {
    const halves = [
      [piece.a, piece.node],
      [piece.node, piece.b],
    ];
    for (const [p0, p1] of halves) {
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const length = Math.hypot(dx, dy);
      if (length < 2) continue;
      const nx = -dy / length;
      const ny = dx / length;
      const half = piece.width / 2;
      for (let k = 0; k < 3; k += 1) {
        const t0 = k / 3;
        const t1 = (k + 1) / 3;
        const corners = [
          { x: p0.x + dx * t0 + nx * half, y: p0.y + dy * t0 + ny * half },
          { x: p0.x + dx * t1 + nx * half, y: p0.y + dy * t1 + ny * half },
          { x: p0.x + dx * t1 - nx * half, y: p0.y + dy * t1 - ny * half },
          { x: p0.x + dx * t0 - nx * half, y: p0.y + dy * t0 - ny * half },
        ];
        const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
        const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
        const side = Math.random() > 0.5 ? 1 : -1;
        this.shards.push({
          x: cx,
          y: cy,
          rel: corners.map((c) => ({ x: c.x - cx, y: c.y - cy })),
          vx: nx * side * (40 + Math.random() * 110) + (Math.random() - 0.5) * 50,
          vy: ny * side * (40 + Math.random() * 110) - 30,
          rot: 0,
          vr: (Math.random() - 0.5) * 7,
          age: 0,
          life: 0.5 + Math.random() * 0.32,
          color: piece.color,
          casing: piece.casing,
        });
      }
    }
    if (this.shards.length > 160) this.shards.splice(0, this.shards.length - 160);
  }

  addHit(point, quality, intensity = 0.5) {
    const color = this.#qualityColor(quality);
    if (this.judgementLabels) {
      this.labels.push({
        x: point.x,
        y: point.y - 44,
        text: quality,
        color,
        age: 0,
        life: 0.42,
      });
    }
    this.ripples.push({
      x: point.x,
      y: point.y,
      age: 0,
      life: 0.55,
      radius: 18,
      speed: 185 + intensity * 120,
      color,
      width: quality === "Perfect" || quality === "EPerfect" || quality === "LPerfect" ? 4 : 3,
    });
    const count = quality === "Perfect" || quality === "EPerfect" || quality === "LPerfect" ? 8 : 4;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = 70 + Math.random() * 180 + intensity * 55;
      this.particles.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.42 + Math.random() * 0.36,
        color,
        size: 2 + Math.random() * 3,
      });
    }
    this.flash = Math.max(this.flash, quality === "Perfect" ? 0.22 : 0.1);
  }

  addMiss(point) {
    this.ripples.push({
      x: point.x,
      y: point.y,
      age: 0,
      life: 0.75,
      radius: 26,
      speed: 260,
      color: "#ff5f9f",
      width: 6,
    });
    if (this.judgementLabels) {
      this.labels.push({
        x: point.x,
        y: point.y - 44,
        text: "Miss",
        color: "#ff5f9f",
        age: 0,
        life: 0.5,
      });
    }
    for (let i = 0; i < 4; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 260;
      this.particles.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.42 + Math.random() * 0.5,
        color: "#ff5f9f",
        size: 2 + Math.random() * 4,
      });
    }
    this.flash = 0.42;
  }

  addPowerup(point) {
    this.labels.push({
      x: point.x,
      y: point.y - 52,
      text: "3RD PLANET",
      color: "#4cff8a",
      age: 0,
      life: 0.7,
    });
    for (const delay of [0, 0.08]) {
      this.ripples.push({
        x: point.x,
        y: point.y,
        age: -delay,
        life: 0.6,
        radius: 20,
        speed: 260,
        color: "#4cff8a",
        width: 4,
      });
    }
    for (let i = 0; i < 14; i += 1) {
      const angle = (Math.PI * 2 * i) / 14;
      const speed = 120 + Math.random() * 190;
      this.particles.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.5 + Math.random() * 0.4,
        color: i % 2 ? "#4cff8a" : "#c8ffdd",
        size: 2.5 + Math.random() * 3,
      });
    }
    this.flash = Math.max(this.flash, 0.2);
  }

  addShield(point) {
    this.labels.push({
      x: point.x,
      y: point.y - 48,
      text: "Shielded",
      color: "#7dffb0",
      age: 0,
      life: 0.6,
    });
    this.ripples.push({
      x: point.x,
      y: point.y,
      age: 0,
      life: 0.7,
      radius: 24,
      speed: 300,
      color: "#4cff8a",
      width: 6,
    });
    for (let i = 0; i < 10; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 220;
      this.particles.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.4 + Math.random() * 0.4,
        color: "#7dffb0",
        size: 2 + Math.random() * 3.4,
      });
    }
    this.flash = Math.max(this.flash, 0.16);
  }

  // ADOFAI-style comet trail: each planet's arc is its own ribbon, keyed by
  // the planet's identity so same-colored planets never get visually linked.
  addTrail(point, color, id = "default") {
    const last = this.lastTrailByColor.get(id);
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 2.2) return;
    this.lastTrailByColor.set(id, { x: point.x, y: point.y });
    this.trail.push({
      x: point.x,
      y: point.y,
      age: 0,
      life: 0.55,
      color,
      id,
    });
    if (this.trail.length > 160) this.trail.splice(0, this.trail.length - 160);
  }

  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 1.8);
    for (const item of [...this.ripples, ...this.particles, ...this.trail, ...this.labels, ...this.shards]) {
      item.age += dt;
    }
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx = lerp(particle.vx, 0, dt * 2.5);
      particle.vy = lerp(particle.vy, 0, dt * 2.5);
    }
    for (const shard of this.shards) {
      shard.x += shard.vx * dt;
      shard.y += shard.vy * dt;
      shard.vy += 220 * dt;
      shard.rot += shard.vr * dt;
    }
    this.ripples = this.ripples.filter((item) => item.age < item.life);
    this.particles = this.particles.filter((item) => item.age < item.life);
    this.trail = this.trail.filter((item) => item.age < item.life);
    this.labels = this.labels.filter((item) => item.age < item.life);
    this.shards = this.shards.filter((item) => item.age < item.life);
  }

  drawWorld(ctx) {
    this.#drawShards(ctx);
    this.#drawRipples(ctx);
    this.#drawParticles(ctx);
    this.#drawLabels(ctx);
  }

  #drawShards(ctx) {
    if (!this.shards.length) return;
    ctx.save();
    for (const shard of this.shards) {
      const t = shard.age / shard.life;
      const scale = 1 - t * 0.45;
      ctx.save();
      ctx.translate(shard.x, shard.y);
      ctx.rotate(shard.rot);
      ctx.scale(scale, scale);
      ctx.globalAlpha = clamp((1 - t) * 0.9, 0, 1);
      ctx.fillStyle = shard.color;
      ctx.strokeStyle = shard.casing;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(shard.rel[0].x, shard.rel[0].y);
      for (let i = 1; i < shard.rel.length; i += 1) ctx.lineTo(shard.rel[i].x, shard.rel[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawScreen(ctx, canvas) {
    if (this.flash <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(this.flash, 0, 0.28);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  drawTrails(ctx) {
    ctx.save();
    ctx.lineCap = "round";
    // Connect only consecutive points from the SAME planet; linking by color
    // alone drew lines between the planets (star artifact) once they all
    // shared the jungle palette.
    const lastIndexById = new Map();
    for (let i = 0; i < this.trail.length; i += 1) {
      const item = this.trail[i];
      const prevIndex = lastIndexById.get(item.id);
      lastIndexById.set(item.id, i);
      if (prevIndex === undefined) continue;
      const previous = this.trail[prevIndex];
      if (Math.hypot(previous.x - item.x, previous.y - item.y) > 180) continue;
      const t = 1 - item.age / item.life;
      ctx.globalAlpha = t * 0.46;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2 + t * 11;
      ctx.shadowBlur = 0;
      ctx.shadowColor = item.color;
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(item.x, item.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  #qualityColor(quality) {
    if (quality === "Perfect") return "#efffff";
    if (quality === "EPerfect" || quality === "LPerfect") return "#90ffbd";
    if (quality === "Early") return "#ffd166";
    if (quality === "Late") return "#ff8a4c";
    return "#68e8ff";
  }

  #drawRipples(ctx) {
    ctx.save();
    for (const ripple of this.ripples) {
      if (ripple.age < 0) continue;
      const t = ripple.age / ripple.life;
      ctx.globalAlpha = clamp((1 - t) * 0.85, 0, 1);
      ctx.strokeStyle = ripple.color;
      ctx.lineWidth = ripple.width * (1 - t * 0.4);
      ctx.shadowBlur = 0;
      ctx.shadowColor = ripple.color;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, Math.max(0.5, ripple.radius + ripple.speed * ripple.age), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawParticles(ctx) {
    ctx.save();
    for (const particle of this.particles) {
      const t = 1 - particle.age / particle.life;
      ctx.globalAlpha = t;
      ctx.fillStyle = particle.color;
      ctx.shadowBlur = 0;
      ctx.shadowColor = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #drawLabels(ctx) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 24px Inter, system-ui, sans-serif";
    for (const label of this.labels) {
      const t = label.age / label.life;
      const scale = Math.sin(clamp(t / 0.24, 0, 1) * (Math.PI / 2));
      ctx.save();
      ctx.translate(label.x, label.y - t * 34);
      ctx.scale(scale, scale);
      ctx.globalAlpha = clamp(1 - t * 1.1, 0, 1);
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.72)";
      ctx.strokeText(label.text, 0, 0);
      ctx.fillStyle = label.color;
      ctx.shadowBlur = 0;
      ctx.shadowColor = label.color;
      ctx.fillText(label.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}
