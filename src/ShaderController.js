import { clamp } from "./utils.js";

export class ShaderController {
  constructor() {
    this.glitch = 0;
    this.flash = 0;
    this.invert = 0;
    this.comboFringe = 0;
    this.reduceMotion = false;
    this.bloom = null;
    this.bloomCtx = null;
  }

  setReduceMotion(value) {
    this.reduceMotion = Boolean(value);
  }

  reset() {
    this.glitch = 0;
    this.flash = 0;
    this.invert = 0;
    this.comboFringe = 0;
  }

  // Bloom: downsample the frame keeping only the bright neon, blur it, and add
  // it back additively for a soft luminous glow around everything. This is the
  // single biggest quality lift for the whole game — every level benefits.
  applyBloom(ctx, canvas, audioLevel = 0) {
    const bw = Math.max(160, Math.round(canvas.width / 3));
    const bh = Math.max(90, Math.round(canvas.height / 3));
    if (!this.bloom || this.bloom.width !== bw || this.bloom.height !== bh) {
      this.bloom = document.createElement("canvas");
      this.bloom.width = bw;
      this.bloom.height = bh;
      this.bloomCtx = this.bloom.getContext("2d");
    }
    const bctx = this.bloomCtx;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalCompositeOperation = "source-over";
    bctx.clearRect(0, 0, bw, bh);
    // Threshold: darken and crush contrast so only genuinely bright neon
    // survives — mids/darks fall to black and never bloom (no white-out).
    bctx.filter = "blur(3px) brightness(0.55) contrast(2.6) saturate(1.35)";
    bctx.drawImage(canvas, 0, 0, bw, bh);
    bctx.filter = "none";

    const strength = this.reduceMotion ? 0.16 : 0.32;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = strength + audioLevel * 0.1;
    ctx.drawImage(this.bloom, 0, 0, canvas.width, canvas.height);
    // A second, slightly-scaled pass for a wider, softer halo.
    ctx.globalAlpha = strength * 0.5;
    const g = canvas.width * 0.014;
    ctx.drawImage(this.bloom, -g, -g * (canvas.height / canvas.width), canvas.width + g * 2, canvas.height + g * 2);
    ctx.restore();
  }

  hit(node, quality, combo) {
    if (node?.accent || combo % 16 === 0) this.flash = Math.max(this.flash, 0.18);
    if (node?.checkpoint || ["zoomOutDrop", "twistHeavy"].includes(node?.cameraCue)) {
      this.glitch = Math.max(this.glitch, 0.72);
    }
  }

  miss() {
    this.glitch = Math.max(this.glitch, 0.5);
    this.invert = Math.max(this.invert, 0.16);
  }

  sectionFlash() {
    this.flash = Math.max(this.flash, 0.92);
    this.invert = Math.max(this.invert, 0.55);
  }

  update(dt, combo, audioLevel) {
    this.glitch = Math.max(0, this.glitch - dt * 7.5);
    this.flash = Math.max(0, this.flash - dt * 5.4);
    this.invert = Math.max(0, this.invert - dt * 2.8);
    this.comboFringe = clamp(combo / 96 + audioLevel * 0.18, 0, 1);
  }

  draw(ctx, canvas) {
    const width = canvas.width;
    const height = canvas.height;
    const fringe = 0.05 + this.comboFringe * 0.26 + this.glitch * 0.42;

    if (fringe > 0.03) {
      ctx.save();
      ctx.globalAlpha = fringe;
      const edge = Math.min(width, height) * 0.16;
      const left = ctx.createLinearGradient(0, 0, edge, 0);
      left.addColorStop(0, "rgba(255, 44, 72, 0.55)");
      left.addColorStop(1, "rgba(255, 44, 72, 0)");
      ctx.fillStyle = left;
      ctx.fillRect(0, 0, edge, height);

      const right = ctx.createLinearGradient(width, 0, width - edge, 0);
      right.addColorStop(0, "rgba(54, 230, 255, 0.55)");
      right.addColorStop(1, "rgba(54, 230, 255, 0)");
      ctx.fillStyle = right;
      ctx.fillRect(width - edge, 0, edge, height);
      ctx.restore();
    }

    if (this.glitch > 0.02) {
      ctx.save();
      const bars = 6;
      for (let i = 0; i < bars; i += 1) {
        const y = Math.random() * height;
        const h = (4 + Math.random() * 18) * this.glitch;
        const x = (Math.random() - 0.5) * 70 * this.glitch;
        ctx.globalAlpha = this.glitch * (0.08 + Math.random() * 0.16);
        ctx.fillStyle = i % 2 ? "rgba(255, 46, 106, 0.6)" : "rgba(66, 224, 255, 0.6)";
        ctx.fillRect(x, y, width, h);
      }
      ctx.restore();
    }

    if (this.invert > 0) {
      ctx.save();
      ctx.globalAlpha = this.invert * 0.75;
      ctx.globalCompositeOperation = "difference";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = this.flash;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }
}
