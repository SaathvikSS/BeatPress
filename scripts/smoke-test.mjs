import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const port = Number(process.env.BEATSTAR_SMOKE_PORT || 4300 + Math.floor(Math.random() * 700));
const chromeCandidates = [
  process.env.BEATSTAR_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

const server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
});

let output = "";
server.stdout.on("data", (data) => {
  output += data.toString();
});
server.stderr.on("data", (data) => {
  output += data.toString();
});

try {
  await waitFor(() => output.includes("BeatStar running"), 5000, () => `Server did not start: ${output}`);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForSelector(".level-card", { state: "visible", timeout: 10000 });
  await assertMenu(page);

  for (let index = 0; index < 10; index += 1) {
    await page.locator(".level-card button").nth(index).click();
    const readyState = await waitForDebug(page, (state) => state?.state === "ready" && state?.nodes >= 170);
    assertDynamicVisualMetadata(readyState, `Level ${index + 1}`);
    await page.keyboard.press("Space");
    await waitForDebug(page, (state) => state?.state === "playing" && state?.audioTime > 0.3);
    const stateA = await page.evaluate(() => window.__beatStarDebug.getState());
    const visualA = await sampleCanvas(page);
    await new Promise((resolve) => setTimeout(resolve, 520));
    const stateB = await page.evaluate(() => window.__beatStarDebug.getState());
    const visualB = await sampleCanvas(page);
    if (stateB.audioTime <= stateA.audioTime + 0.25) {
      throw new Error(`Level ${index + 1} audio did not keep advancing: ${JSON.stringify({ stateA, stateB })}.`);
    }
    if (stateA.dynamicVisualPhase === stateB.dynamicVisualPhase) {
      throw new Error(`Level ${index + 1} dynamic visual phase did not advance.`);
    }
    assertCanvasVisible(visualA, `Level ${index + 1} first sample`);
    assertCanvasVisible(visualB, `Level ${index + 1} second sample`);
    if (visualA.hash === visualB.hash) {
      throw new Error(`Level ${index + 1} canvas did not visually change between samples.`);
    }
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".view-menu.is-active");
    await assertMenu(page);
  }

  if (consoleErrors.length) throw new Error(`Console errors:\n${consoleErrors.join("\n")}`);
  await browser.close();
  console.log("Smoke test ok: all ten levels load, continuous visual layers are active, and canvases change over time.");
} finally {
  server.kill();
}

async function assertMenu(page) {
  const titles = (await page.locator(".level-card h3").allTextContents()).map((text) => text.trim());
  const buttons = (await page.locator(".level-card button").allTextContents()).map((text) => text.trim());
  const expected =
    "Neon Drift|Nebula Run|Crystal Orbit|Solar Flare|Void Walker|" +
    "Bloom Garden|Helix Tower|Hyper Bloom|Comet Coil|Star Cascade";
  if (titles.join("|") !== expected) {
    throw new Error(`Expected ${expected}, saw ${titles.join("|")}.`);
  }
  if (buttons.join("|") !== Array(10).fill("Enter").join("|")) {
    throw new Error(`Expected ten Enter buttons, saw ${buttons.join("|")}.`);
  }
}

function assertDynamicVisualMetadata(state, label) {
  if (state.scheduledVisualEvents < 80) throw new Error(`${label} has too few scheduled visual events: ${state.scheduledVisualEvents}.`);
  if (state.continuousVisualLayers !== 5) throw new Error(`${label} continuous visual layers are not active.`);
  if (state.ambientVisualStars < 40 || state.ambientVisualLanes < 10 || state.ambientVisualGlyphs < 8) {
    throw new Error(`${label} ambient visual pools are incomplete: ${JSON.stringify(state)}.`);
  }
}

async function sampleCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#gameCanvas");
    const context = canvas.getContext("2d");
    const data = context.getImageData(
      Math.floor(canvas.width * 0.12),
      Math.floor(canvas.height * 0.12),
      Math.floor(canvas.width * 0.76),
      Math.floor(canvas.height * 0.76),
    ).data;
    let bright = 0;
    let saturated = 0;
    let varied = 0;
    let hash = 2166136261;
    let last = -1;
    for (let i = 0; i < data.length; i += 36) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const value = r + g + b;
      if (value > 45) bright += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 35) saturated += 1;
      if (last >= 0 && Math.abs(value - last) > 18) varied += 1;
      hash ^= value + (r << 1) + (g << 2) + (b << 3);
      hash = Math.imul(hash, 16777619);
      last = value;
    }
    return { bright, saturated, varied, hash: hash >>> 0 };
  });
}

function assertCanvasVisible(visual, label) {
  if (visual.bright < 500 || visual.saturated < 220 || visual.varied < 120) {
    throw new Error(`${label} canvas appears blank or flat: ${JSON.stringify(visual)}.`);
  }
}

async function waitForDebug(page, predicate, timeoutMs = 30000) {
  let matchedState = null;
  await waitFor(async () => {
    const state = await page.evaluate(() => window.__beatStarDebug?.getState?.());
    if (!predicate(state)) return false;
    matchedState = state;
    return true;
  }, timeoutMs, async () => {
    const state = await page.evaluate(() => window.__beatStarDebug?.getState?.());
    return `Timed out waiting for state. Last state: ${JSON.stringify(state)}`;
  });
  return matchedState;
}

async function waitFor(predicate, timeoutMs, messageFactory) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const message = typeof messageFactory === "function" ? await messageFactory() : messageFactory;
  throw new Error(message);
}

async function launchBrowser() {
  for (const executablePath of chromeCandidates) {
    try {
      return await chromium.launch({
        headless: true,
        executablePath,
        args: ["--autoplay-policy=no-user-gesture-required"],
      });
    } catch {
      // Try the next local browser candidate.
    }
  }
  return chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
}
