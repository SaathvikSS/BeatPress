export class AudioManager {
  constructor() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = 0.88;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 128;
    this.levelData = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.buffers = new Map();
    this.sources = [];
    this.beatmap = null;
    this.startContextTime = 0;
    this.pausedAt = 0;
    this.playing = false;
  }

  async loadBeatmap(beatmap, onProgress = () => {}) {
    this.stop();
    this.beatmap = beatmap;
    let loaded = 0;
    for (const segment of beatmap.audio.segments) {
      if (this.buffers.has(segment.file)) {
        loaded += 1;
        onProgress({ file: segment.file, loaded, total: beatmap.audio.segments.length });
        continue;
      }
      onProgress({ file: segment.file, loaded, total: beatmap.audio.segments.length });
      const response = await fetch(`./${segment.file}`);
      if (!response.ok) throw new Error(`Could not load audio ${segment.file} (${response.status})`);
      const buffer = await response.arrayBuffer();
      let decoded;
      try {
        decoded = await this.context.decodeAudioData(buffer.slice(0));
      } catch (error) {
        throw new Error(`Could not decode audio ${segment.file}: ${error.message}`);
      }
      this.buffers.set(segment.file, decoded);
      loaded += 1;
      onProgress({ file: segment.file, loaded, total: beatmap.audio.segments.length });
    }
  }

  async start(startAt = 0) {
    if (!this.beatmap) throw new Error("No beatmap loaded.");
    await this.context.resume();
    this.stop(false);
    this.pausedAt = Math.max(0, Math.min(startAt, this.beatmap.duration));
    this.startContextTime = this.context.currentTime - this.pausedAt;
    this.playing = true;

    for (const segment of this.beatmap.audio.segments) {
      const buffer = this.buffers.get(segment.file);
      const segmentStart = Number(segment.levelStart);
      const segmentDuration = Number(segment.duration);
      const segmentEnd = segmentStart + segmentDuration;
      if (!buffer || segmentEnd <= this.pausedAt) continue;

      const localOffset = Math.max(0, this.pausedAt - segmentStart);
      const sourceOffset = Number(segment.sourceStart || 0) + localOffset;
      const available = Math.max(0, Math.min(segmentDuration - localOffset, buffer.duration - sourceOffset));
      if (available <= 0) continue;

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.master);
      const when = this.context.currentTime + Math.max(0, segmentStart - this.pausedAt);
      source.start(when, sourceOffset, available);
      source.onended = () => {
        this.sources = this.sources.filter((item) => item !== source);
      };
      this.sources.push(source);
    }
  }

  pause() {
    if (!this.playing) return this.pausedAt;
    this.pausedAt = this.getTime();
    this.stop(false);
    return this.pausedAt;
  }

  stop(reset = true) {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Source may already have ended.
      }
    }
    this.sources = [];
    this.playing = false;
    if (reset) this.pausedAt = 0;
  }

  getTime() {
    if (!this.beatmap) return 0;
    if (!this.playing) return this.pausedAt;
    return Math.min(this.beatmap.duration, Math.max(0, this.context.currentTime - this.startContextTime));
  }

  getLevel() {
    this.analyser.getByteFrequencyData(this.levelData);
    let sum = 0;
    for (const value of this.levelData) sum += value;
    return sum / (this.levelData.length * 255);
  }
}
