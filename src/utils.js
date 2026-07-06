export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeInOutCubic(t) {
  const v = clamp(t, 0, 1);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
}

export function normalizeAngle(angle) {
  let value = angle;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${minutes}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return "100.0%";
  return `${value.toFixed(1)}%`;
}

export function gradeFromAccuracy(accuracy, misses) {
  if (misses === 0 && accuracy >= 99.5) return "S+";
  if (misses === 0 && accuracy >= 98) return "S";
  if (accuracy >= 95) return "A";
  if (accuracy >= 88) return "B";
  if (accuracy >= 78) return "C";
  return "D";
}

export function weightedAccuracy(stats) {
  const eperfect = stats.eperfect || 0;
  const perfect = stats.perfect || 0;
  const lperfect = stats.lperfect || 0;
  const early = stats.early || 0;
  const late = stats.late || 0;
  const spam = stats.spam || 0;
  const miss = stats.miss || 0;
  const judged = eperfect + perfect + lperfect + early + late + spam + miss;
  if (judged === 0) return 100;
  const score = perfect + spam + (eperfect + lperfect) * 0.99 + (early + late) * 0.72;
  return clamp((score / judged) * 100, 0, 100);
}

export function pointInViewport(point, camera, canvas) {
  const margin = 460 / Math.max(0.5, camera.zoom);
  const halfW = canvas.width / (2 * camera.zoom) + margin;
  const halfH = canvas.height / (2 * camera.zoom) + margin;
  return (
    point.x >= camera.x - halfW &&
    point.x <= camera.x + halfW &&
    point.y >= camera.y - halfH &&
    point.y <= camera.y + halfH
  );
}
