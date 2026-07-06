import { formatPercent } from "./utils.js";

const DIFF_COLORS = {
  Medium: "#4FFFEF",
  Advanced: "#A855F7",
  Hard: "#FF6B35",
  Expert: "#FF4FCB",
  Insane: "#39FF14",
  Extreme: "#FFDD00",
  Scenic: "#39FF14",
  "Scenic+": "#7ae7ff",
  "Ultra Spam": "#ff3b4d",
  "Mega Spam": "#ff6b35",
  "Giga Spam": "#7ae7ff",
  "Omega Spam": "#c084fc",
};

export class LevelSelect {
  constructor(container, store, onSelect) {
    this.container = container;
    this.store = store;
    this.onSelect = onSelect;
    this.levels = [];
    this.selectedIndex = 0;
  }

  render(levels) {
    this.levels = levels;
    this.container.className = "level-grid level-select";

    const path = document.createElement("div");
    path.className = "select-path";
    path.setAttribute("aria-hidden", "true");
    path.replaceChildren(...this.#buildPathTiles(levels.length));

    const row = document.createElement("div");
    row.className = "select-row";
    row.replaceChildren(...levels.map((level, index) => this.#createLevelCard(level, index)));

    this.container.replaceChildren(path, row);
    this.#syncSelection();
  }

  advanceSelection(direction = 1) {
    if (!this.levels.length) return null;
    this.select(this.selectedIndex + direction);
    return this.getSelectedLevel();
  }

  getSelectedLevel() {
    return this.levels[this.selectedIndex] || null;
  }

  select(index) {
    if (!this.levels.length) return;
    this.selectedIndex = (index + this.levels.length) % this.levels.length;
    this.#syncSelection();
  }

  #createLevelCard(level, index) {
    const bestId = level.resultsId || level.variants?.find((variant) => variant.variant === "level")?.id || level.id;
    const best = this.store.getBest(bestId);
    const diffColor = DIFF_COLORS[level.difficulty] || "#4FFFEF";

    const card = document.createElement("article");
    card.className = "level-card";
    card.style.setProperty("--diff-color", diffColor);
    card.style.setProperty("--card-index", String(index));
    card.innerHTML = `
      <div class="card-glow" aria-hidden="true"></div>
      <span class="card-number">${String(index + 1).padStart(2, "0")}</span>
      <div class="portal-orbit" aria-hidden="true">
        <span class="portal-ring portal-ring-a"></span>
        <span class="portal-ring portal-ring-b"></span>
        <span class="portal-core"></span>
        <span class="portal-moon portal-moon-a"></span>
        <span class="portal-moon portal-moon-b"></span>
      </div>
      <div class="level-copy">
        <p class="eyebrow">Stage ${index + 1}</p>
        <h3>${level.title}</h3>
        <p class="level-sub">${level.subtitle}</p>
      </div>
      <span class="diff-chip">${level.difficulty}</span>
      <p class="level-tagline">${level.tagline || ""}</p>
      <div class="level-meta">
        <div class="level-stat"><span>Length</span><strong>${level.durationLabel || "2:30"}</strong></div>
        <div class="level-stat"><span>Best acc</span><strong>${best ? formatPercent(best.accuracy) : "--"}</strong></div>
        <div class="level-stat"><span>Best combo</span><strong>${best ? best.maxCombo : "--"}</strong></div>
        <div class="level-stat"><span>Grade</span><strong>${best?.grade || "--"}</strong></div>
      </div>
    `;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = level.variants?.length ? "Choose" : "Enter";
    button.addEventListener("click", () => {
      this.select(index);
      this.onSelect(level);
    });
    card.addEventListener("mouseenter", () => this.select(index));
    card.append(button);
    return card;
  }

  #buildPathTiles(count) {
    // A gentle winding tile path threading the stages, ADOFAI world-map style.
    const tiles = [];
    const segments = Math.max(12, count * 5);
    for (let i = 0; i < segments; i += 1) {
      const t = i / (segments - 1);
      const x = 6 + t * 88;
      const y = 50 + Math.sin(t * Math.PI * 2.2) * 12;
      const rotation = Math.cos(t * Math.PI * 2.2) * 24;
      const accent = i % 5 === 2;
      const tile = document.createElement("span");
      tile.className = `path-tile${accent ? " path-tile-accent" : ""}`;
      tile.style.setProperty("--tile-x", `${x}%`);
      tile.style.setProperty("--tile-y", `${y}%`);
      tile.style.setProperty("--tile-r", `${rotation}deg`);
      tile.style.setProperty("--tile-delay", `${(i * 0.06).toFixed(2)}s`);
      tiles.push(tile);
    }
    return tiles;
  }

  #syncSelection() {
    const cards = this.container.querySelectorAll(".level-card");
    cards.forEach((card, index) => {
      const selected = index === this.selectedIndex;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-current", selected ? "true" : "false");
    });
  }
}
