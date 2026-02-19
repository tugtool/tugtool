#!/usr/bin/env bun
/**
 * watch-assets.ts
 *
 * Continuous dev asset watcher: copies HTML, CSS, and fonts to dist/ on change.
 * Runs alongside bun build --watch to enable hot reload for non-JS assets.
 */

import * as fs from "fs";
import * as path from "path";

const TUGDECK_DIR = path.join(import.meta.dir, "..");
const DIST_DIR = path.join(TUGDECK_DIR, "dist");
const FONTS_DIR = path.join(DIST_DIR, "fonts");

// Source-to-destination file mappings
const FILE_MAPPINGS: Array<{ src: string; dest: string }> = [
  { src: "index.html", dest: "index.html" },
  { src: "styles/tokens.css", dest: "tokens.css" },
  { src: "styles/cards.css", dest: "cards.css" },
  { src: "styles/cards-chrome.css", dest: "cards-chrome.css" },
  { src: "styles/dock.css", dest: "dock.css" },
  { src: "node_modules/@xterm/xterm/css/xterm.css", dest: "app.css" },
];

// Font files to copy
const FONT_SOURCES = path.join(TUGDECK_DIR, "styles/fonts");

/**
 * Ensure a directory exists
 */
function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Copy a single file from src to dest
 */
function copyFile(srcPath: string, destPath: string) {
  try {
    const content = fs.readFileSync(srcPath);
    fs.writeFileSync(destPath, content);
    console.log(`[watch-assets] copied ${path.basename(destPath)}`);
  } catch (err) {
    console.error(`[watch-assets] error copying ${srcPath}:`, err);
  }
}

/**
 * Copy all font files from fonts directory
 */
function copyFonts() {
  if (!fs.existsSync(FONT_SOURCES)) {
    return;
  }

  ensureDir(FONTS_DIR);

  const files = fs.readdirSync(FONT_SOURCES);
  for (const file of files) {
    if (file.endsWith(".woff2") || file.endsWith(".woff")) {
      const srcPath = path.join(FONT_SOURCES, file);
      const destPath = path.join(FONTS_DIR, file);
      copyFile(srcPath, destPath);
    }
  }
}

/**
 * Perform initial copy of all assets
 */
function initialCopy() {
  console.log("[watch-assets] performing initial copy...");
  ensureDir(DIST_DIR);

  for (const mapping of FILE_MAPPINGS) {
    const srcPath = path.join(TUGDECK_DIR, mapping.src);
    const destPath = path.join(DIST_DIR, mapping.dest);
    if (fs.existsSync(srcPath)) {
      copyFile(srcPath, destPath);
    } else {
      console.warn(`[watch-assets] warning: source file not found: ${srcPath}`);
    }
  }

  copyFonts();
  console.log("[watch-assets] initial copy complete");
}

/**
 * Watch a file and re-copy on change
 */
function watchFile(srcPath: string, destPath: string) {
  try {
    fs.watch(srcPath, (eventType) => {
      if (eventType === "change") {
        copyFile(srcPath, destPath);
      }
    });
  } catch (err) {
    console.warn(`[watch-assets] warning: fs.watch failed for ${srcPath}, falling back to polling`);
    // Fall back to polling
    let lastMtime = fs.statSync(srcPath).mtimeMs;
    setInterval(() => {
      try {
        const currentMtime = fs.statSync(srcPath).mtimeMs;
        if (currentMtime !== lastMtime) {
          lastMtime = currentMtime;
          copyFile(srcPath, destPath);
        }
      } catch (pollErr) {
        // File might have been deleted
      }
    }, 1000);
  }
}

/**
 * Watch fonts directory for changes
 */
function watchFonts() {
  if (!fs.existsSync(FONT_SOURCES)) {
    return;
  }

  try {
    fs.watch(FONT_SOURCES, (eventType, filename) => {
      if (filename && (filename.endsWith(".woff2") || filename.endsWith(".woff"))) {
        const srcPath = path.join(FONT_SOURCES, filename);
        const destPath = path.join(FONTS_DIR, filename);
        if (fs.existsSync(srcPath)) {
          copyFile(srcPath, destPath);
        }
      }
    });
  } catch (err) {
    console.warn(`[watch-assets] warning: fs.watch failed for fonts directory`);
  }
}

/**
 * Main: perform initial copy and set up watchers
 */
async function main() {
  initialCopy();

  console.log("[watch-assets] watching for changes...");

  // Watch each file mapping
  for (const mapping of FILE_MAPPINGS) {
    const srcPath = path.join(TUGDECK_DIR, mapping.src);
    const destPath = path.join(DIST_DIR, mapping.dest);
    if (fs.existsSync(srcPath)) {
      watchFile(srcPath, destPath);
    }
  }

  // Watch fonts directory
  watchFonts();

  // Keep process alive
  await new Promise(() => {});
}

main();
