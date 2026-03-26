import { describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { handleThemesActivate } from "../../vite.config";

describe("theme activate endpoint (thin)", () => {
  it("activates harmony by copying css and returning hostCanvasColor", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tugdeck-theme-activate-"));
    try {
      const themesCssDir = path.join(tmpDir, "themes");
      const activeCssPath = path.join(tmpDir, "tug-active-theme.css");
      fs.mkdirSync(themesCssDir, { recursive: true });
      fs.writeFileSync(
        path.join(themesCssDir, "harmony.css"),
        "body { --tugx-host-canvas-color: #e7eaf0; --tug-sample: #123456; }",
        "utf-8",
      );

      const result = await handleThemesActivate(
        { theme: "harmony" },
        themesCssDir,
        activeCssPath,
      );

      expect(result.status).toBe(200);
      expect(result.body).toContain("\"theme\":\"harmony\"");
      expect(result.body).toContain("\"hostCanvasColor\":\"#e7eaf0\"");
      expect(fs.readFileSync(activeCssPath, "utf-8")).toContain("--tugx-host-canvas-color: #e7eaf0;");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
