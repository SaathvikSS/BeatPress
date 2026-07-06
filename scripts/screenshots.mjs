// Capture menu + gameplay + FreePlay screenshots for visual verification.
// An in-page auto-player presses a key exactly when each node comes due,
// so gameplay shots show real combos, trails, shatters, and effects.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const port = 4612;
const chromeCandidates = [
  process.env.BEATSTAR_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

const server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
let out = "";
server.stdout.on("data", (d) => (out += d));
server.stderr.on("data", (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  for (const executablePath of chromeCandidates) {
    try {
      return await chromium.launch({ headless: true, executablePath, args: ["--autoplay-policy=no-user-gesture-required"] });
    } catch {}
  }
  return chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
}

async function startLevel(page, level) {
  await page.locator(".level-card button").nth(level - 1).click();
  const s = Date.now();
  while (Date.now() - s < 40000) {
    const st = await page.evaluate(() => window.__beatStarDebug?.getState?.());
    if (st?.state === "ready") break;
    await sleep(150);
  }
  await page.evaluate(async (levelNum) => {
    const beatmap = await (await fetch(`./beatmaps/dist/level${levelNum}.beatstar.json`)).json();
    const nodes = beatmap.nodes;
    if (window.__autoplay) clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const state = window.__beatStarDebug?.getState?.();
      if (!state || state.state !== "playing") return;
      const node = nodes[state.nextIndex];
      if (node && node.time - state.audioTime <= 0.02) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", bubbles: true }));
      }
    }, 4);
  }, level);
  await page.keyboard.press("Space");
}

async function report(page, name) {
  const st = await page.evaluate(() => window.__beatStarDebug?.getState?.());
  console.log(
    `${name}: state=${st.state} t=${st.audioTime.toFixed(1)} combo=${st.combo} acc=${st.accuracy.toFixed(1)} ` +
      `misses-allowed=${st.allowedMisses} strikes=${st.safetyStrikes}`,
  );
}

try {
  const start = Date.now();
  while (!out.includes("BeatStar running") && Date.now() - start < 6000) await sleep(150);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForSelector(".level-card", { state: "visible" });
  await sleep(800);
  await page.screenshot({ path: ".verification/menu-10.png" });

  // Aesthetic level: Bloom Garden flower section.
  await startLevel(page, 6);
  await sleep(26000);
  await page.screenshot({ path: ".verification/play-l6-bloom.png" });
  await report(page, "play-l6-bloom");

  // FreePlay from within the run: full map + hover ring.
  await page.locator("#freeplayButton").click();
  await sleep(400);
  const hoverPoint = await page.evaluate(() => {
    // Scan for a tile the pointer can land on.
    return null;
  });
  const box = { w: 1440, h: 810 };
  let found = false;
  for (let gy = 0.3; gy <= 0.85 && !found; gy += 0.09) {
    for (let gx = 0.15; gx <= 0.85 && !found; gx += 0.07) {
      await page.mouse.move(box.w * gx, box.h * gy);
      await sleep(30);
      const st = await page.evaluate(() => window.__beatStarDebug?.getState?.());
      if ((st?.freeplayHover ?? -1) >= 0) found = true;
    }
  }
  await sleep(300);
  await page.screenshot({ path: ".verification/freeplay-map.png" });
  console.log(`freeplay-map: hover found=${found}${hoverPoint ? "" : ""}`);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".level-card", { state: "visible" });
  await sleep(400);

  // Ultra spam level: Star Cascade mid-sprint.
  await startLevel(page, 10);
  await sleep(36000);
  await page.screenshot({ path: ".verification/play-l10-cascade.png" });
  await report(page, "play-l10-cascade");
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".level-card", { state: "visible" });

  // Countdown capture: start a level and shoot during the count-in.
  await page.locator(".level-card button").nth(0).click();
  const s2 = Date.now();
  while (Date.now() - s2 < 40000) {
    const st = await page.evaluate(() => window.__beatStarDebug?.getState?.());
    if (st?.state === "ready") break;
    await sleep(150);
  }
  await page.keyboard.press("Space");
  await sleep(450);
  await page.screenshot({ path: ".verification/countdown.png" });

  await browser.close();
  console.log("screenshots saved");
} finally {
  server.kill();
}
