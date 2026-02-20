#!/usr/bin/env bun
/**
 * dev.ts
 *
 * Dev entry point: runs bun build --watch for JS hot-reload.
 * CSS, HTML, and fonts are served directly from source by tugcast.
 */

const tugdeckDir = import.meta.dir + "/..";

console.log("[dev] starting bun build --watch...");

const buildWatch = Bun.spawn(
  ["bun", "build", "src/main.ts", "--outfile=dist/app.js", "--watch"],
  {
    cwd: tugdeckDir,
    stdout: "inherit",
    stderr: "inherit",
  }
);

await buildWatch.exited;
