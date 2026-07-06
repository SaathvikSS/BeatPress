import { formatTime } from "./utils.js";

export class DebugOverlay {
  constructor(panel, textNode) {
    this.panel = panel;
    this.textNode = textNode;
    this.enabled = false;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    this.panel.classList.toggle("is-active", this.enabled);
  }

  toggle() {
    this.setEnabled(!this.enabled);
  }

  update({ beatmap, audioTime, target, nextIndex, settings }) {
    if (!this.enabled) return;
    if (!beatmap) {
      this.textNode.textContent = "No beatmap loaded.";
      return;
    }
    const checkpointPreview = beatmap.checkpoints
      .slice(0, 8)
      .map((checkpoint) => `${checkpoint.nodeIndex}@${formatTime(checkpoint.time)} ${checkpoint.label}`)
      .join("\n");
    const section = target?.section || "none";
    const targetLine = target
      ? `Next node: ${nextIndex}
Time: ${target.time.toFixed(3)}s
Delta now: ${(audioTime - target.time).toFixed(3)}s
Angle: ${Math.round(target.angle)} deg
Turn: ${Math.round(target.turnDegrees)} deg
Section: ${section}
Accent: ${target.accent ? "yes" : "no"}`
      : "No target node.";

    this.textNode.textContent = `${beatmap.title}
Duration: ${formatTime(beatmap.duration)}
Nodes: ${beatmap.nodes.length}
Segments: ${beatmap.audio.segments.map((s) => s.file).join(", ")}
Calibration: ${settings.calibrationMs} ms
On miss: ${settings.missMode}

${targetLine}

Checkpoints:
${checkpointPreview}

Manual editing:
Open beatmaps/dist/${beatmap.id}.beatstar.json and inspect node.time, angle, x/y, visualIntensity, cameraCue, visualEvents, or checkpoint fields. Regenerate with scripts/generate-beatmaps.mjs when the source audio changes.`;
  }
}
