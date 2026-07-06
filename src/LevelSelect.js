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
  // Impossible tier (levels 14-23), escalating heat toward white.
  "Hyper Spam": "#ff5a3c",
  "Turbo Spam": "#ff7a2c",
  "Nitro Spam": "#ffa11e",
  "Plasma Spam": "#ffc61e",
  "Quantum Spam": "#ffe14a",
  "Nova Spam": "#ff8ad0",
  "Quasar Spam": "#d98aff",
  "Pulsar Spam": "#8ad0ff",
  "Cosmic Spam": "#ff4f8a",
  "Heat Death": "#ffffff",
};

export class LevelSelect {
  constructor(container, store, onSelect, account = null) {
    this.container = container;
    this.store = store;
    this.onSelect = onSelect;
    this.account = account;
    this.levels = [];
    this.selectedIndex = 0;
    this.renderToken = 0;
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

    // Fetch live per-level stats (best acc, tries) and the global top-5
    // leaderboard, then fill each card in without blocking the initial paint.
    this.renderToken += 1;
    this.#populateStats(this.renderToken);
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

  #levelStatsId(level) {
    return level.resultsId || level.variants?.find((variant) => variant.variant === "level")?.id || level.id;
  }

  #createLevelCard(level, index) {
    const diffColor = DIFF_COLORS[level.difficulty] || "#4FFFEF";

    const card = document.createElement("article");
    card.className = "level-card";
    card.dataset.levelId = this.#levelStatsId(level);
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
      <div class="level-meta level-meta-3">
        <div class="level-stat"><span>Length</span><strong>${level.durationLabel || "2:30"}</strong></div>
        <div class="level-stat"><span>Best acc</span><strong data-stat="best">--</strong></div>
        <div class="level-stat"><span>Tries</span><strong data-stat="tries">0</strong></div>
      </div>
      <div class="level-board" aria-label="Global top 5 by accuracy">
        <div class="board-title">Global Top 5 · Accuracy</div>
        <ol class="board-wheel" data-board><li class="board-empty">Loading…</li></ol>
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

  // Fill Best Acc + Tries (per player if logged in, else local) and the global
  // top-5 leaderboard wheel for every visible card.
  async #populateStats(token) {
    const cards = [...this.container.querySelectorAll(".level-card")];
    await Promise.all(
      cards.map(async (card) => {
        const levelId = card.dataset.levelId;
        if (!levelId) return;

        // Best accuracy + tries.
        let best = null;
        let tries = 0;
        const cloud = this.account?.isLoggedIn ? await this.account.myProgress(levelId) : null;
        if (cloud) {
          best = cloud.best_accuracy > 0 ? cloud.best_accuracy : null;
          tries = cloud.tries || 0;
        } else {
          const localBest = this.store.getBest(levelId);
          best = localBest?.accuracy ?? null;
          tries = this.store.getTries(levelId);
        }
        if (token !== this.renderToken) return;
        const bestEl = card.querySelector('[data-stat="best"]');
        const triesEl = card.querySelector('[data-stat="tries"]');
        if (bestEl) bestEl.textContent = best != null ? formatPercent(best) : "--";
        if (triesEl) triesEl.textContent = String(tries);

        // Global top-5 leaderboard.
        const rows = this.account ? await this.account.topScores(levelId, 5) : [];
        if (token !== this.renderToken) return;
        this.#fillBoard(card.querySelector("[data-board]"), rows);
      }),
    );
  }

  #fillBoard(listEl, rows) {
    if (!listEl) return;
    if (!rows || !rows.length) {
      listEl.innerHTML = `<li class="board-empty">No scores yet — be the first!</li>`;
      return;
    }
    const medals = ["🥇", "🥈", "🥉", "4", "5"];
    listEl.replaceChildren(
      ...rows.slice(0, 5).map((row, i) => {
        const li = document.createElement("li");
        li.className = "board-row";
        const name = String(row.display_name || "Anon").replace(/[<>]/g, "");
        const acc = typeof row.best_accuracy === "number" ? formatPercent(row.best_accuracy) : "--";
        li.innerHTML = `
          <span class="board-rank">${medals[i]}</span>
          <span class="board-name">${name}</span>
          <span class="board-acc">${acc}</span>`;
        return li;
      }),
    );
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
