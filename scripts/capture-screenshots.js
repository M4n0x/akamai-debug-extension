#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");
const os = require("os");

function tryRequire(moduleName) {
  try {
    return require(moduleName);
  } catch {
    return null;
  }
}

const playwright = tryRequire("playwright");
const sharp = tryRequire("sharp");

if (!playwright || !sharp) {
  console.error("Missing dependencies for screenshot automation.");
  console.error("Run: npm install");
  console.error("Then ensure Chromium is available for Playwright:");
  console.error("  npx playwright install --with-deps chromium");
  process.exit(1);
}

const { chromium } = playwright;

const ROOT_DIR = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT_DIR, "docs", "store-assets", "raw");
const CHROME_DIR = path.join(ROOT_DIR, "docs", "store-assets", "chrome");
const FIREFOX_DIR = path.join(ROOT_DIR, "docs", "store-assets", "firefox");
const SCREENSHOTS_DIR = path.join(ROOT_DIR, "docs", "screenshots");

/* ------------------------------------------------------------------ */
/*  CLI                                                                */
/* ------------------------------------------------------------------ */

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { headless: false };
  for (const token of args) {
    if (token === "--headless") parsed.headless = true;
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/*  Filesystem helpers                                                 */
/* ------------------------------------------------------------------ */

async function ensureDirs() {
  await Promise.all([
    fs.mkdir(RAW_DIR, { recursive: true }),
    fs.mkdir(CHROME_DIR, { recursive: true }),
    fs.mkdir(FIREFOX_DIR, { recursive: true }),
    fs.mkdir(SCREENSHOTS_DIR, { recursive: true }),
  ]);
}

async function copyRecursive(src, dest) {
  const stats = await fs.stat(src);
  if (stats.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const entry of entries) {
      await copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

/**
 * Stage extension files into a temp directory using the Chrome manifest.
 * This avoids mutating the repo checkout.
 */
async function stageExtension() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "akamai-ext-"));
  const entries = ["background.js", "popup", "icons", "_locales"];

  for (const entry of entries) {
    await copyRecursive(
      path.join(ROOT_DIR, entry),
      path.join(tempDir, entry),
    );
  }

  await fs.copyFile(
    path.join(ROOT_DIR, "manifest.chrome.json"),
    path.join(tempDir, "manifest.json"),
  );

  return tempDir;
}

/* ------------------------------------------------------------------ */
/*  Demo data                                                          */
/* ------------------------------------------------------------------ */

const DEMO = {
  hit: {
    pageUrl: "www.example.com/products/catalog",
    tabStatus: { text: "Debug On", variant: "hit" },
    debugToggle: true,
    injectionStatus: "Header injection active \u00b7 matched 14:32:01",
    cacheSummary: "Edge: TCP_HIT | Parent: TCP_HIT",
    cachePill: { text: "HIT", variant: "hit" },

    xCache: "TCP_HIT from a23-72-54-192.deploy.akamaitechnologies.com",
    xCacheRemote: "TCP_HIT from a23-72-54-128.deploy.akamaitechnologies.com",
    xCheckCacheable: "YES",
    age: "847",
    ttl: "3600s",
    ttlRemaining: "2753s",

    analysisStatus: "HIT",
    cacheDisabled: "No",
    stale: "No",
    keyDiff: "Match",
    keyChanges: "1/3",

    xCacheKey: "S/L/4521/981234/30d/www.example.com/products/catalog",
    xTrueCacheKey: "S/L/4521/981234/30d/www.example.com/products/catalog",
    cacheControl: "public, max-age=3600, s-maxage=3600",
    expires: "Wed, 25 Feb 2026 22:30:00 GMT",

    requestId: "2a4b6c8d.f1e2d3c4",
    server: "AkamaiGHost",
    sessionInfo: "AKA_PM_BASEDIR=\\; AKA_PM_CACHEABLE_OBJECT=true",
    staging: "--",

    transformed: "9/2 text/html",
    contentType: "text/html; charset=UTF-8",
    statusCode: "200",
    lastUpdated: "14:32:01",

    alerts: [],
    history: [
      { time: "14:32:01", status: "HIT", cls: "hit", url: "/products/catalog", code: "200", active: true },
      { time: "14:31:45", status: "HIT", cls: "hit", url: "/products/catalog", code: "200", active: false },
      { time: "14:30:12", status: "MISS", cls: "miss", url: "/products/catalog", code: "200", active: false },
    ],
    hint: "Headers captured for the current page.",
  },

  miss: {
    pageUrl: "api.example.com/v2/users",
    tabStatus: { text: "Debug On", variant: "hit" },
    debugToggle: true,
    injectionStatus: "Header injection active \u00b7 matched 14:35:22",
    cacheSummary: "Edge: TCP_MISS | Parent: TCP_MISS",
    cachePill: { text: "MISS", variant: "miss" },

    xCache: "TCP_MISS from a104-96-178-42.deploy.akamaitechnologies.com",
    xCacheRemote: "TCP_MISS from a104-96-178-12.deploy.akamaitechnologies.com",
    xCheckCacheable: "NO",
    age: "0",
    ttl: "--",
    ttlRemaining: "--",

    analysisStatus: "MISS",
    cacheDisabled: "Yes",
    stale: "No",
    keyDiff: "Diff",
    keyChanges: "3/5",

    xCacheKey: "S/D/0/api.example.com/v2/users?nocache=1",
    xTrueCacheKey: "S/D/0/api.example.com/v2/users",
    cacheControl: "no-cache, no-store, must-revalidate",
    expires: "0",

    requestId: "5e7f9a1b.c3d4e5f6",
    server: "AkamaiGHost",
    sessionInfo: "AKA_PM_BASEDIR=\\; AKA_PM_CACHEABLE_OBJECT=false",
    staging: "--",

    transformed: "--",
    contentType: "application/json; charset=UTF-8",
    statusCode: "200",
    lastUpdated: "14:35:22",

    alerts: [
      { type: "CACHE DISABLED", message: "Cache-Control indicates caching is disabled (no-cache or no-store)", time: "14:35:22" },
      { type: "HIT TO MISS", message: "Cache status changed from HIT to MISS for this URL", time: "14:34:08" },
    ],
    history: [
      { time: "14:35:22", status: "MISS", cls: "miss", url: "/v2/users", code: "200", active: true },
      { time: "14:34:08", status: "MISS", cls: "miss", url: "/v2/users", code: "200", active: false },
      { time: "14:33:44", status: "HIT", cls: "hit", url: "/v2/users", code: "200", active: false },
      { time: "14:32:55", status: "MISS", cls: "miss", url: "/v2/users?nocache=1", code: "200", active: false },
      { time: "14:31:10", status: "BYPASS", cls: "bypass", url: "/v2/users", code: "302", active: false },
    ],
    hint: "Headers captured for the current page.",
  },
};

/* ------------------------------------------------------------------ */
/*  DOM injection                                                      */
/* ------------------------------------------------------------------ */

async function injectDemoData(page, data) {
  await page.evaluate((d) => {
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    const setPill = (id, variant, text) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove("hit", "miss", "bypass", "neutral");
      el.classList.add(variant);
      el.textContent = text;
    };

    /* Header */
    setText("page-url", d.pageUrl);
    setPill("tab-status", d.tabStatus.variant, d.tabStatus.text);

    /* Toggle */
    const toggle = document.getElementById("debug-toggle");
    if (toggle) toggle.checked = d.debugToggle;

    const injStatus = document.getElementById("injection-status");
    if (injStatus) {
      injStatus.textContent = d.injectionStatus;
      if (d.debugToggle) injStatus.classList.add("active");
    }

    /* Cache Status */
    setText("cache-summary", d.cacheSummary);
    setPill("cache-pill", d.cachePill.variant, d.cachePill.text);

    /* Cache Details */
    setText("x-cache", d.xCache);
    setText("x-cache-remote", d.xCacheRemote);
    setText("x-check-cacheable", d.xCheckCacheable);
    setText("age", d.age);
    setText("ttl", d.ttl);
    setText("ttl-remaining", d.ttlRemaining);

    /* Cache Analysis */
    setText("analysis-status", d.analysisStatus);
    setText("cache-disabled", d.cacheDisabled);
    setText("stale", d.stale);
    setText("key-diff", d.keyDiff);
    setText("key-changes", d.keyChanges);

    /* Cache Keys */
    setText("x-cache-key", d.xCacheKey);
    setText("x-true-cache-key", d.xTrueCacheKey);
    setText("cache-control", d.cacheControl);
    setText("expires", d.expires);

    /* Request Info */
    setText("request-id", d.requestId);
    setText("server", d.server);
    setText("session-info", d.sessionInfo);
    setText("staging", d.staging);

    /* Transformations */
    setText("transformed", d.transformed);
    setText("content-type", d.contentType);
    setText("status-code", d.statusCode);
    setText("last-updated", d.lastUpdated);

    /* Hint */
    setText("hint", d.hint);

    /* Alerts */
    const alertList = document.getElementById("alert-list");
    if (alertList) {
      alertList.innerHTML = "";
      if (!d.alerts.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No alerts yet";
        alertList.appendChild(p);
      } else {
        for (const a of d.alerts) {
          const item = document.createElement("div");
          item.className = "alert-item";

          const tag = document.createElement("span");
          tag.className = "alert-tag";
          tag.textContent = a.type;

          const msg = document.createElement("span");
          msg.className = "alert-message";
          msg.textContent = a.message;

          const time = document.createElement("span");
          time.className = "alert-time";
          time.textContent = a.time;

          item.append(tag, msg, time);
          alertList.appendChild(item);
        }
      }
    }

    /* History */
    const historyList = document.getElementById("history-list");
    if (historyList) {
      historyList.innerHTML = "";
      if (!d.history.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No requests captured yet";
        historyList.appendChild(p);
      } else {
        d.history.forEach((entry, i) => {
          const btn = document.createElement("button");
          btn.className = `history-item${entry.active ? " active" : ""}`;
          btn.dataset.index = String(i);

          const time = document.createElement("span");
          time.className = "history-time";
          time.textContent = entry.time;

          const status = document.createElement("span");
          status.className = `history-status ${entry.cls}`;
          status.textContent = entry.status;

          const url = document.createElement("span");
          url.className = "history-url";
          url.textContent = entry.url;

          const code = document.createElement("span");
          code.className = "history-code";
          code.textContent = entry.code;

          btn.append(time, status, url, code);
          historyList.appendChild(btn);
        });
      }
    }
  }, data);
}

/* ------------------------------------------------------------------ */
/*  Screenshot helpers                                                 */
/* ------------------------------------------------------------------ */

async function screenshotPopup(context, popupUrl, outPath, demoData) {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 700, height: 1200 });
  await popup.goto(popupUrl, { waitUntil: "domcontentloaded" });
  await popup.waitForTimeout(500);

  if (demoData) {
    await injectDemoData(popup, demoData);
    await popup.waitForTimeout(250);
  }

  const app = popup.locator(".app");
  const box = await app.boundingBox();
  if (!box) throw new Error("Unable to locate popup root for screenshot");

  const pad = 24;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(700, box.width + pad * 2),
    height: Math.min(2400, box.height + pad * 2),
  };

  await popup.screenshot({ path: outPath, clip });
  await popup.close();
}

/* ------------------------------------------------------------------ */
/*  Image processing (sharp)                                           */
/* ------------------------------------------------------------------ */

async function renderContain(input, output, w, h, bg = "#f7f2ea") {
  await sharp(input)
    .resize(w, h, { fit: "contain", background: bg })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function renderCover(input, output, w, h) {
  await sharp(input)
    .resize(w, h, { fit: "cover", position: "north" })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function buildAssets(rawIdle, rawHit, rawMiss) {
  await Promise.all([
    /* README screenshots */
    renderContain(rawHit, path.join(SCREENSHOTS_DIR, "popup.png"), 1200, 800),
    renderContain(rawMiss, path.join(SCREENSHOTS_DIR, "popup-alerts.png"), 1200, 800),

    /* Chrome Web Store (1280×800) */
    renderContain(rawIdle, path.join(CHROME_DIR, "screenshot-1-idle.png"), 1280, 800),
    renderContain(rawHit, path.join(CHROME_DIR, "screenshot-2-cache-hit.png"), 1280, 800),
    renderContain(rawMiss, path.join(CHROME_DIR, "screenshot-3-cache-miss-alerts.png"), 1280, 800),
    renderCover(rawHit, path.join(CHROME_DIR, "small-promo-tile-440x280.png"), 440, 280),
    renderCover(rawHit, path.join(CHROME_DIR, "marquee-promo-tile-1400x560.png"), 1400, 560),

    /* Firefox Add-on Hub */
    renderContain(rawIdle, path.join(FIREFOX_DIR, "screenshot-1-idle.png"), 1280, 800),
    renderContain(rawHit, path.join(FIREFOX_DIR, "screenshot-2-cache-hit.png"), 1280, 800),
    renderContain(rawMiss, path.join(FIREFOX_DIR, "screenshot-3-cache-miss-alerts.png"), 1280, 800),
    renderCover(rawHit, path.join(FIREFOX_DIR, "promotional-1400x560.png"), 1400, 560),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs();
  await ensureDirs();

  const extensionDir = await stageExtension();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "akamai-shot-"));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: args.headless,
      viewport: { width: 800, height: 1200 },
      deviceScaleFactor: 2,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    });

    const sw =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
    const extensionId = new URL(sw.url()).host;
    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;

    const rawIdle = path.join(RAW_DIR, "popup-idle.png");
    const rawHit = path.join(RAW_DIR, "popup-hit.png");
    const rawMiss = path.join(RAW_DIR, "popup-miss-alerts.png");

    console.log("Capturing idle state...");
    await screenshotPopup(context, popupUrl, rawIdle, null);

    console.log("Capturing cache HIT state...");
    await screenshotPopup(context, popupUrl, rawHit, DEMO.hit);

    console.log("Capturing cache MISS + alerts state...");
    await screenshotPopup(context, popupUrl, rawMiss, DEMO.miss);

    console.log("Building store assets...");
    await buildAssets(rawIdle, rawHit, rawMiss);

    console.log("\nScreenshots generated successfully.");
    console.log(`  README images:         ${SCREENSHOTS_DIR}`);
    console.log(`  Chrome store assets:   ${CHROME_DIR}`);
    console.log(`  Firefox store assets:  ${FIREFOX_DIR}`);
  } finally {
    if (context) await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.rm(extensionDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const text = String(error?.message || error || "");
  if (text.includes("error while loading shared libraries")) {
    console.error("Playwright browser dependencies are missing.");
    console.error("Try:  npx playwright install --with-deps chromium");
  }
  console.error(error);
  process.exit(1);
});
