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
      const overrideCssPath = path.join(tmpDir, "tug-theme-override.css");
      fs.mkdirSync(themesCssDir, { recursive: true });
      fs.writeFileSync(
        path.join(themesCssDir, "harmony.css"),
        "body { --tug-host-canvas-color: #e7eaf0; --tug-sample: #123456; }",
        "utf-8",
      );

      const result = await handleThemesActivate(
        { theme: "harmony" },
        themesCssDir,
        overrideCssPath,
      );

      expect(result.status).toBe(200);
      expect(result.body).toContain("\"theme\":\"harmony\"");
      expect(result.body).toContain("\"hostCanvasColor\":\"#e7eaf0\"");
      expect(fs.readFileSync(overrideCssPath, "utf-8")).toContain("--tug-host-canvas-color: #e7eaf0;");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
