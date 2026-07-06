import { clamp } from "./utils.js";

export class ShaderController {
  constructor() {
    this.glitch = 0;
    this.flash = 0;
    this.invert = 0;
    this.comboFringe = 0;
  }

  reset() {
    this.glitch = 0;
    this.flash = 0;
    this.invert = 0;
    this.comboFringe = 0;
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
