"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const version = process.argv[2];

if (!version) {
  console.error("Usage: node scripts/build-release.js <version>");
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const updateManifestScript = path.join(__dirname, "update-manifest.js");

const sharedEntries = ["background.js", "popup", "icons"];

function run(command, options = {}) {
  execSync(command, { stdio: "inherit", ...options });
}

function ensureCleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function stageFiles(tempDir, manifestFile) {
  ensureCleanDir(tempDir);
  for (const entry of sharedEntries) {
    copyRecursive(path.join(repoRoot, entry), path.join(tempDir, entry));
  }
  copyRecursive(
    path.join(repoRoot, manifestFile),
    path.join(tempDir, "manifest.json")
  );
}

fs.mkdirSync(distDir, { recursive: true });

run(`${process.execPath} "${updateManifestScript}" ${version}`, {
  cwd: repoRoot,
});

const firefoxTemp = path.join(distDir, "firefox-temp");
const chromiumTemp = path.join(distDir, "chromium-temp");

const firefoxZip = path.join(
  distDir,
  `akamai-debug-helper-${version}-firefox.zip`
);
const chromiumZip = path.join(
  distDir,
  `akamai-debug-helper-${version}-chromium.zip`
);

fs.rmSync(firefoxZip, { force: true });
fs.rmSync(chromiumZip, { force: true });

stageFiles(firefoxTemp, "manifest.json");
run(`zip -r "${firefoxZip}" .`, { cwd: firefoxTemp });

stageFiles(chromiumTemp, "manifest.chrome.json");
run(`zip -r "${chromiumZip}" .`, { cwd: chromiumTemp });

fs.rmSync(firefoxTemp, { recursive: true, force: true });
fs.rmSync(chromiumTemp, { recursive: true, force: true });
