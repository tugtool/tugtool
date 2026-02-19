#!/usr/bin/env bun
/**
 * dev.ts
 *
 * Dev entry point: spawns both watch-assets and bun build --watch in parallel.
 * Uses Bun.spawn for portability (avoids shell & operator).
 */

const tugdeckDir = import.meta.dir + "/..";

console.log("[dev] starting watch-assets and bun build --watch...");

const watchAssets = Bun.spawn(["bun", "run", "scripts/watch-assets.ts"], {
  cwd: tugdeckDir,
  stdout: "inherit",
  stderr: "inherit",
});

const buildWatch = Bun.spawn(
  ["bun", "build", "src/main.ts", "--outfile=dist/app.js", "--watch"],
  {
    cwd: tugdeckDir,
    stdout: "inherit",
    stderr: "inherit",
  }
);

// Wait for either to exit
const exitCode = await Promise.race([watchAssets.exited, buildWatch.exited]);

console.log(`[dev] one process exited with code ${exitCode}, killing the other...`);

// Kill the other
watchAssets.kill();
buildWatch.kill();

process.exit(exitCode);
