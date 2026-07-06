import { clamp, pointInViewport } from "./utils.js";

const TWO_PI = Math.PI * 2;

// ADOFAI-style connected track: each tile is a thick segment of road running
// midpoint-to-midpoint through its node, with dark casing, tile separators,
// and sharp mitered corners. Tiles are ~1.3x+ the area of the old floating
// diamonds.
const TRACK_WIDTH = 46;
const CASING_WIDTH = TRACK_WIDTH + 7;

export class PathRenderer {
  constructor() {
    this.beatmap = null;
    this.theme = null;
    this.hueShift = 0;
    this.lastPaletteHue = 0;
    this.shattered = new Set();
    this.mapTransform = null;
    this.mapCache = null;
    this.mapCacheKey = "";
    this.bgStars = [];
    this.bgNebulae = [];
    for (let i = 0; i < 90; i++) {
      this.bgStars.push({
        x: (Math.random() - 0.5) * 12000,
        y: (Math.random() - 0.5) * 8000,
        z: 0.1 + Math.random() * 0.9,
        size: 0.4 + Math.random() * 2.8,
        twinkleSpeed: 0.3 + Math.random() * 2.0,
        twinklePhase: Math.random() * TWO_PI,
        hue: Math.random() > 0.7 ? 200 + Math.random() * 40 : 30 + Math.random() * 30,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.bgNebulae.push({
        x: (Math.random() - 0.5) * 6000,
        y: (Math.random() - 0.5) * 4000,
        radius: 220 + Math.random() * 520,
        drift: 0.01 + Math.random() * 0.03,
        phase: Math.random() * TWO_PI,
      });
    }
  }

  loadBeatmap(beatmap) {
    this.beatmap = beatmap;
    this.theme = beatmap.levelTheme || null;
    this.hueShift = 0;
    this.lastPaletteHue = 0;
    this.shattered = new Set();
    this.mapTransform = null;
    this.mapCache = null;
    this.mapCacheKey = "";
    this._buildPalette();
  }

  // Slow global hue drift so the level's color grade keeps evolving —
  // a gentle wobble on top of a full rotation across the 2:30 runtime.
  setHuePhase(songTime) {
    const shift = songTime * 1.9 + Math.sin(songTime * 0.13) * 22;
    this.hueShift = shift;
    if (Math.abs(shift - this.lastPaletteHue) >= 4) {
      this.lastPaletteHue = shift;
      this._buildPalette();
    }
  }

  clearShattered() {
    this.shattered.clear();
  }

  // Hands the tile's geometry to the effects system exactly once, so it can
  // blow apart as the player moves on. Returns null if already shattered.
  takeShatterTile(index) {
    const nodes = this.beatmap?.nodes;
    if (!nodes || index <= 0 || index >= nodes.length) return null;
    if (this.shattered.has(index)) return null;
    this.shattered.add(index);
    const seg = this._tileSegment(nodes, index);
    return {
      a: { x: seg.a.x, y: seg.a.y },
      node: { x: seg.node.x, y: seg.node.y },
      b: { x: seg.b.x, y: seg.b.y },
      width: TRACK_WIDTH,
      color: this.palette.futureNear,
      casing: this.palette.casing,
    };
  }

  _buildPalette() {
    const primary = this._shiftHue(this.theme?.primaryColor || "#4FFFEF", this.hueShift);
    const secondary = this._shiftHue(this.theme?.secondaryColor || "#FF4FCB", this.hueShift);
    const accent = this._shiftHue(this.theme?.accentColor || "#FFDD00", this.hueShift);
    this.palette = {
      primary,
      secondary,
      accent,
      future: this._mix(primary, "#131c30", 0.5),
      futureNear: this._mix(primary, "#1b2c48", 0.32),
      past: this._mix("#5c6a80", "#141a26", 0.55),
      active: this._mix(primary, "#ffffff", 0.55),
      target: this._mix(primary, "#ffffff", 0.28),
      accentTile: this._mix(secondary, "#131c30", 0.42),
      swirlTile: this._mix("#E8434A", "#131c30", 0.3),
      powerTile: this._mix("#39FF14", "#0f2410", 0.36),
      checkpointTile: this._mix(accent, "#131c30", 0.4),
      sheen: "rgba(255,255,255,0.16)",
      casing: "rgba(3, 6, 13, 0.92)",
      separator: "rgba(4, 8, 16, 0.62)",
    };
  }

  // -------------------------------------------------------------------------
  // Background
  // -------------------------------------------------------------------------

  drawBackground(ctx, canvas, camera, songTime, audioLevel) {
    const theme = this.theme || {};
    const primary = this._shiftHue(theme.primaryColor || "#4FFFEF", this.hueShift);
    const secondary = this._shiftHue(theme.secondaryColor || "#FF4FCB", this.hueShift);
    const mode = theme.backgroundMode || "deepSpace";

    const bgColors = this._bgColorsForMode(mode);
    const gradient = ctx.createLinearGradient(0, 0, canvas.width * 0.35, canvas.height);
    gradient.addColorStop(0, bgColors[0]);
    gradient.addColorStop(0.5, bgColors[1]);
    gradient.addColorStop(1, bgColors[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.08 + audioLevel * 0.1;
    const wash = ctx.createRadialGradient(
      canvas.width * 0.62, canvas.height * 0.32, 0,
      canvas.width * 0.62, canvas.height * 0.32, canvas.width * 0.62,
    );
    wash.addColorStop(0, primary);
    wash.addColorStop(0.3, "rgba(255,255,255,0.02)");
    wash.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = 0.05 + audioLevel * 0.05;
    const wash2 = ctx.createRadialGradient(
      canvas.width * 0.24, canvas.height * 0.72, 0,
      canvas.width * 0.24, canvas.height * 0.72, canvas.width * 0.44,
    );
    wash2.addColorStop(0, secondary);
    wash2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = wash2;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Parallax star field.
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    for (const star of this.bgStars) {
      const parallax = star.z * 0.12;
      const px = star.x - camera.x * parallax + Math.sin(songTime * 0.1 + star.twinklePhase) * 8;
      const py = star.y - camera.y * parallax + Math.cos(songTime * 0.08 + star.twinklePhase) * 6;
      const screenX = ((px % (canvas.width + 400)) + canvas.width + 400) % (canvas.width + 400) - canvas.width / 2 - 200;
      const screenY = ((py % (canvas.height + 400)) + canvas.height + 400) % (canvas.height + 400) - canvas.height / 2 - 200;
      const twinkle = 0.3 + Math.sin(songTime * star.twinkleSpeed + star.twinklePhase) * 0.4 + audioLevel * 0.3;
      ctx.globalAlpha = clamp(twinkle * star.z, 0.05, 0.85);
      ctx.fillStyle = star.z > 0.7 ? primary : star.z > 0.4 ? `hsl(${star.hue}, 60%, 80%)` : secondary;
      ctx.beginPath();
      ctx.arc(screenX, screenY, star.size * (0.8 + audioLevel * 1.2), 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();

    // Nebula blobs.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(canvas.width / 2, canvas.height / 2);
    for (const neb of this.bgNebulae) {
      const nx = neb.x - camera.x * 0.05 + Math.sin(songTime * neb.drift + neb.phase) * 60;
      const ny = neb.y - camera.y * 0.05 + Math.cos(songTime * neb.drift * 0.7 + neb.phase) * 40;
      ctx.globalAlpha = 0.03 + audioLevel * 0.025;
      const nebGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, neb.radius);
      nebGrad.addColorStop(0, primary);
      nebGrad.addColorStop(0.4, "rgba(255,255,255,0.01)");
      nebGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = nebGrad;
      ctx.beginPath();
      ctx.arc(nx, ny, neb.radius, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Focus vignette.
    ctx.save();
    const vignette = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.height * 0.32,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.92,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  _bgColorsForMode(mode) {
    switch (mode) {
      case "nebulaStorm": return ["#0a0c22", "#1a1148", "#2a0e33"];
      case "crystalOrbit": return ["#04141f", "#082036", "#1a1035"];
      case "solarFlare": return ["#1a0a04", "#241002", "#120704"];
      case "voidWalker": return ["#030010", "#0a0018", "#050014"];
      case "neonCircuit": return ["#02100a", "#04180e", "#02100c"];
      case "starfallRush": return ["#100c04", "#141002", "#0c0812"];
      case "omegaDrive": return ["#0c0518", "#0e081c", "#080616"];
      case "helixTower": return ["#0a0418", "#120a26", "#06041a"];
      case "bloomGarden": return ["#120416", "#1c0a24", "#04140a"];
      case "prismCascade": return ["#0e0a02", "#140d04", "#0a0414"];
      case "magmaCore": return ["#170502", "#200803", "#0c0202"];
      case "hyperTunnel": return ["#020614", "#040a20", "#080418"];
      case "singularity": return ["#08020e", "#0e0418", "#040108"];
      default: return ["#060a1a", "#0a1830", "#1c0f2e"];
    }
  }

  // -------------------------------------------------------------------------
  // World: the track itself
  // -------------------------------------------------------------------------

  drawWorld(ctx, camera, songTime, activeIndex, targetIndex, debugEnabled) {
    if (!this.beatmap) return;
    this._drawTrack(ctx, camera, songTime, activeIndex, targetIndex);
    this._drawOverlays(ctx, camera, songTime, activeIndex, targetIndex, debugEnabled);
  }

  // Segment of road belonging to tile i: midpoint(prev,i) -> i -> midpoint(i,next).
  _tileSegment(nodes, i) {
    const node = nodes[i];
    const prev = nodes[i - 1];
    const next = nodes[i + 1];
    const a = prev ? { x: (prev.x + node.x) / 2, y: (prev.y + node.y) / 2 } : { x: node.x, y: node.y };
    const b = next ? { x: (next.x + node.x) / 2, y: (next.y + node.y) / 2 } : { x: node.x, y: node.y };
    return { a, b, node };
  }

  _tileState(i, activeIndex, targetIndex) {
    if (i === activeIndex) return "active";
    if (i === targetIndex) return "target";
    if (i < activeIndex) return "past";
    return "future";
  }

  _tileFill(node, prev, state, distFromActive) {
    const pal = this.palette;
    if (state === "past") return pal.past;
    if (state === "active") return pal.active;
    if (node.powerup) return pal.powerTile;
    if (node.checkpoint) return pal.checkpointTile;
    if (prev && node.spin !== prev.spin) return pal.swirlTile;
    if (state === "target") return pal.target;
    if (node.accent) return pal.accentTile;
    return distFromActive <= 4 ? pal.futureNear : pal.future;
  }

  _strokeSegment(ctx, seg, width) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.node.x, seg.node.y);
    ctx.lineTo(seg.b.x, seg.b.y);
    ctx.stroke();
  }

  _drawTrack(ctx, camera, songTime, activeIndex, targetIndex) {
    const nodes = this.beatmap.nodes;
    const pal = this.palette;
    const start = Math.max(0, activeIndex - 5);
    const spamAhead = (nodes[activeIndex + 1]?.interval || 1) < 0.15;
    const end = Math.min(nodes.length - 1, activeIndex + (spamAhead ? 34 : 20));

    ctx.save();
    ctx.lineJoin = "miter";
    ctx.miterLimit = 2.6;
    ctx.lineCap = "butt";

    // Soft glow underlay pooled beneath the upcoming road.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = pal.primary;
    for (let i = Math.max(activeIndex, start); i <= end; i += 1) {
      const seg = this._tileSegment(nodes, i);
      if (!pointInViewport(seg.node, camera, ctx.canvas)) continue;
      const fade = clamp(1 - (i - activeIndex) * 0.06, 0.1, 1);
      ctx.globalAlpha = 0.05 * fade;
      this._strokeSegment(ctx, seg, CASING_WIDTH + 16);
    }
    ctx.restore();

    // Draw far-to-near so tiles closest to the player sit on top at crossings.
    for (let i = end; i >= start; i -= 1) {
      const node = nodes[i];
      if (!pointInViewport(node, camera, ctx.canvas)) continue;
      // Passed tiles crumble away: shattered ones are gone entirely, the rest
      // dissolve over the next few steps behind the player.
      const distFromActive = i - activeIndex;
      if (distFromActive < 0 && (this.shattered.has(i) || distFromActive < -4)) continue;
      const seg = this._tileSegment(nodes, i);
      const state = this._tileState(i, activeIndex, targetIndex);
      const fade = state === "past"
        ? clamp(1 + distFromActive * 0.24, 0, 1)
        : clamp(1 - distFromActive * 0.028, 0.45, 1);

      // Casing (dark outline all around).
      ctx.globalAlpha = (state === "past" ? 0.6 : 0.95) * fade;
      ctx.strokeStyle = pal.casing;
      this._strokeSegment(ctx, seg, CASING_WIDTH);

      // Tile face.
      const fill = this._tileFill(node, nodes[i - 1], state, distFromActive);
      ctx.globalAlpha = (state === "past" ? 0.55 : 1) * fade;
      ctx.strokeStyle = fill;
      this._strokeSegment(ctx, seg, TRACK_WIDTH);

      // Glossy 3D rail: a bright additive neon core plus a hot white sheen
      // streak down the middle, so tiles read as lit glass and bloom nicely.
      if (state !== "past") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.2 * fade;
        ctx.strokeStyle = fill;
        this._strokeSegment(ctx, seg, TRACK_WIDTH * 0.72);
        ctx.restore();

        ctx.globalAlpha = 0.32 * fade;
        ctx.strokeStyle = pal.sheen;
        this._strokeSegment(ctx, seg, TRACK_WIDTH * 0.34);
      }

      // Target pulse: the next tile breathes.
      if (state === "target") {
        const pulse = Math.sin(songTime * Math.PI * 4) * 0.5 + 0.5;
        ctx.globalAlpha = 0.22 + pulse * 0.3;
        ctx.strokeStyle = "#ffffff";
        this._strokeSegment(ctx, seg, TRACK_WIDTH);
      }

      // Tile separator tick at the segment entry edge.
      if (i > start) {
        const dx = node.x - seg.a.x;
        const dy = node.y - seg.a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const half = TRACK_WIDTH * 0.46;
        ctx.globalAlpha = (state === "past" ? 0.4 : 0.75) * fade;
        ctx.strokeStyle = pal.separator;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(seg.a.x - nx * half, seg.a.y - ny * half);
        ctx.lineTo(seg.a.x + nx * half, seg.a.y + ny * half);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Overlays: rings, icons, powerup stars, debug labels
  // -------------------------------------------------------------------------

  _drawOverlays(ctx, camera, songTime, activeIndex, targetIndex, debugEnabled) {
    const nodes = this.beatmap.nodes;
    const pal = this.palette;
    const start = Math.max(0, activeIndex - 2);
    const end = Math.min(nodes.length - 1, activeIndex + 18);
    const pulse = Math.sin(songTime * Math.PI * 3) * 0.5 + 0.5;

    ctx.save();
    for (let i = start; i <= end; i += 1) {
      const node = nodes[i];
      if (!pointInViewport(node, camera, ctx.canvas)) continue;
      const isTarget = i === targetIndex;
      const isPast = i < activeIndex;
      const ringRadius = TRACK_WIDTH * 0.72;

      // Target anticipation ring.
      if (isTarget) {
        ctx.save();
        ctx.globalAlpha = 0.4 + pulse * 0.35;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.2;
        ctx.setLineDash([5, 7]);
        ctx.lineDashOffset = -songTime * 30;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ringRadius + 8 + pulse * 6, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Checkpoint ring.
      if (node.checkpoint && !isPast) {
        ctx.save();
        ctx.globalAlpha = 0.45 + pulse * 0.2;
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(node.x, node.y, ringRadius + 4 + pulse * 4, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Powerup tile: green halo + spinning star.
      if (node.powerup && !isPast) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.3 + pulse * 0.3;
        const halo = ctx.createRadialGradient(node.x, node.y, 4, node.x, node.y, ringRadius + 26);
        halo.addColorStop(0, "rgba(80, 255, 140, 0.55)");
        halo.addColorStop(1, "rgba(80, 255, 140, 0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ringRadius + 26, 0, TWO_PI);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.translate(node.x, node.y);
        ctx.rotate(songTime * 1.4);
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = "#eaffe9";
        ctx.strokeStyle = "rgba(6, 40, 14, 0.85)";
        ctx.lineWidth = 2;
        this._starPath(ctx, 11, 5);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Modifier icons drawn onto the tile face.
      if (!isPast) this._drawModifierIcon(ctx, node, nodes[i - 1], songTime);

      if (debugEnabled && i % 4 === 0) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#d9f6ff";
        ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
        ctx.fillText(`${i} ${node.time.toFixed(2)}`, node.x + ringRadius + 4, node.y - 4);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _starPath(ctx, outer, points) {
    const inner = outer * 0.45;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i += 1) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / (points * 2)) * TWO_PI - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
  }

  _drawModifierIcon(ctx, node, prev, songTime) {
    if (node.powerup) return; // star already drawn
    const interval = prev ? node.time - prev.time : 0.4;
    const spinShift = prev && node.spin !== prev.spin;
    const fast = interval < 0.3 && interval > 0;
    const slow = interval > 0.62;
    if (!spinShift && !node.checkpoint && !fast && !slow) return;

    const size = TRACK_WIDTH * 0.36;
    ctx.save();
    ctx.translate(node.x, node.y);
    ctx.strokeStyle = "rgba(5, 9, 18, 0.88)";
    ctx.fillStyle = "rgba(5, 9, 18, 0.88)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (node.checkpoint) {
      ctx.rotate(songTime * 1.2);
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.62, size * 0.26, 0.7, 0, TWO_PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.62, size * 0.26, -0.7, 0, TWO_PI);
      ctx.stroke();
    } else if (spinShift) {
      // Swirl marker: orbit direction flips here.
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.48, -0.4, Math.PI * 1.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-size * 0.36, -size * 0.05);
      ctx.lineTo(-size * 0.62, -size * 0.12);
      ctx.lineTo(-size * 0.44, -size * 0.34);
      ctx.stroke();
    } else if (fast) {
      // Double chevron: burst ahead.
      ctx.beginPath();
      ctx.moveTo(-size * 0.6, -size * 0.28);
      ctx.lineTo(-size * 0.05, 0);
      ctx.lineTo(-size * 0.6, size * 0.28);
      ctx.moveTo(0, -size * 0.28);
      ctx.lineTo(size * 0.55, 0);
      ctx.lineTo(0, size * 0.28);
      ctx.stroke();
    } else if (slow) {
      // Snail spiral: long wait.
      ctx.beginPath();
      ctx.arc(-size * 0.08, 0, size * 0.34, 0.3, TWO_PI + 0.05);
      ctx.stroke();
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // FreePlay: full-map overview with click-to-spawn
  // -------------------------------------------------------------------------

  getMapTransform(canvas) {
    if (!this.beatmap?.nodes?.length) return null;
    const cached = this.mapTransform;
    if (cached && cached.w === canvas.width && cached.h === canvas.height && cached.id === this.beatmap.id) {
      return cached;
    }
    const nodes = this.beatmap.nodes;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }
    const pad = 120;
    const scale = Math.min(
      canvas.width / (maxX - minX + pad * 2),
      (canvas.height * 0.84) / (maxY - minY + pad * 2),
      1.1,
    );
    this.mapTransform = {
      scale,
      ox: canvas.width / 2 - ((minX + maxX) / 2) * scale,
      oy: canvas.height * 0.55 - ((minY + maxY) / 2) * scale,
      w: canvas.width,
      h: canvas.height,
      id: this.beatmap.id,
    };
    return this.mapTransform;
  }

  drawFullMap(ctx, canvas, wallTime, hoverIndex, currentIndex) {
    const transform = this.getMapTransform(canvas);
    if (!transform) return;
    this._ensureMapCache(canvas, transform);
    ctx.drawImage(this.mapCache, 0, 0);

    const nodes = this.beatmap.nodes;
    const pulse = Math.sin(wallTime * Math.PI * 2) * 0.5 + 0.5;

    // Current position beacon.
    const current = nodes[Math.max(0, Math.min(currentIndex, nodes.length - 1))];
    const cx = current.x * transform.scale + transform.ox;
    const cy = current.y * transform.scale + transform.oy;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const beacon = ctx.createRadialGradient(cx, cy, 1, cx, cy, 26);
    beacon.addColorStop(0, "rgba(255,255,255,0.9)");
    beacon.addColorStop(0.4, this.palette.primary);
    beacon.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = beacon;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, TWO_PI);
    ctx.fill();
    ctx.restore();

    // Hover target ring + spawn tooltip.
    if (hoverIndex >= 0 && hoverIndex < nodes.length) {
      const node = nodes[hoverIndex];
      const hx = node.x * transform.scale + transform.ox;
      const hy = node.y * transform.scale + transform.oy;
      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.4;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -wallTime * 26;
      ctx.beginPath();
      ctx.arc(hx, hy, 15 + pulse * 5, 0, TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);

      const minutes = Math.floor(node.time / 60);
      const seconds = (node.time % 60).toFixed(1).padStart(4, "0");
      const label = `Spawn ${minutes}:${seconds}  ·  tile ${hoverIndex}`;
      ctx.font = "700 15px Inter, system-ui, sans-serif";
      const width = ctx.measureText(label).width + 22;
      const bx = clamp(hx - width / 2, 8, canvas.width - width - 8);
      const by = clamp(hy - 52, 60, canvas.height - 40);
      ctx.fillStyle = "rgba(5, 10, 20, 0.88)";
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, width, 30, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#eaf6ff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, bx + 11, by + 16);
      ctx.restore();
    }
  }

  _ensureMapCache(canvas, transform) {
    const key = `${this.beatmap.id}:${canvas.width}x${canvas.height}`;
    if (this.mapCache && this.mapCacheKey === key) return;
    this.mapCacheKey = key;
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const c = off.getContext("2d");
    const nodes = this.beatmap.nodes;
    const pal = this.palette;

    c.save();
    c.translate(transform.ox, transform.oy);
    c.scale(transform.scale, transform.scale);
    c.lineJoin = "round";
    c.lineCap = "round";

    // Casing pass, then colored tile pass (one segment per tile keeps the
    // accent / powerup / checkpoint colors visible on the overview).
    c.strokeStyle = pal.casing;
    c.globalAlpha = 0.95;
    c.lineWidth = CASING_WIDTH;
    c.beginPath();
    c.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < nodes.length; i += 1) c.lineTo(nodes[i].x, nodes[i].y);
    c.stroke();

    for (let i = 0; i < nodes.length; i += 1) {
      const seg = this._tileSegment(nodes, i);
      c.globalAlpha = 0.92;
      c.strokeStyle = this._tileFill(nodes[i], nodes[i - 1], "future", 6);
      c.lineWidth = TRACK_WIDTH;
      c.beginPath();
      c.moveTo(seg.a.x, seg.a.y);
      c.lineTo(seg.node.x, seg.node.y);
      c.lineTo(seg.b.x, seg.b.y);
      c.stroke();
    }

    // Checkpoint + powerup markers pop on the overview.
    for (const node of nodes) {
      if (!node.checkpoint && !node.powerup) continue;
      c.globalAlpha = 1;
      c.fillStyle = node.powerup ? "#39FF14" : pal.accent;
      c.strokeStyle = "rgba(3,6,13,0.9)";
      c.lineWidth = 8;
      c.beginPath();
      c.arc(node.x, node.y, TRACK_WIDTH * 0.62, 0, TWO_PI);
      c.stroke();
      c.beginPath();
      c.arc(node.x, node.y, TRACK_WIDTH * 0.62, 0, TWO_PI);
      c.fill();
    }
    c.restore();

    // Dim vignette so the HUD reads over the map.
    c.fillStyle = "rgba(2, 4, 10, 0.18)";
    c.fillRect(0, 0, off.width, off.height);

    this.mapCache = off;
  }

  // -------------------------------------------------------------------------
  // Color helpers
  // -------------------------------------------------------------------------

  // Rotate a hex/rgb color's hue by `deg` while keeping saturation/lightness.
  _shiftHue(color, deg) {
    if (!deg) return color;
    const { r, g, b } = this._rgb(color);
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d > 0.0001) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      const rn = r / 255;
      const gn = g / 255;
      const bn = b / 255;
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
      else if (max === gn) h = ((bn - rn) / d + 2) / 6;
      else h = ((rn - gn) / d + 4) / 6;
    }
    h = (((h * 360 + deg) % 360) + 360) % 360 / 360;
    const hueToRgb = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const rr = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
    const gg = Math.round(hueToRgb(p, q, h) * 255);
    const bb = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
    return `rgb(${rr},${gg},${bb})`;
  }

  _withAlpha(hexColor, alpha) {
    const { r, g, b } = this._rgb(hexColor);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  _mix(hexA, hexB, t) {
    const a = this._rgb(hexA);
    const b = this._rgb(hexB);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return `rgb(${r},${g},${bl})`;
  }

  _rgb(color) {
    if (color.startsWith("rgb")) {
      const parts = color.match(/[\d.]+/g).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
    const hex = String(color).replace("#", "");
    return {
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16),
    };
  }
}
