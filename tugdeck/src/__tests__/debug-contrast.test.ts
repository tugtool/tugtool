/**
 * Temporary debug test to check actual contrast values for step-7 planning.
 * This file will be deleted after step-7 analysis.
 */
import { deriveTheme, EXAMPLE_RECIPES } from "@/components/tugways/theme-derivation-engine";
import {
  validateThemeContrast,
  CONTRAST_THRESHOLDS,
} from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/element-surface-pairing-map";

describe("debug: step-7 contrast calibration check", () => {
  it("reports contrast for B03/B04/B05 after calibration changes", () => {
    const output = deriveTheme(EXAMPLE_RECIPES.brio);
    const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
    const bugPairs = [
      "--tug-base-fg-default|--tug-base-tab-bg-active",
      "--tug-base-fg-default|--tug-base-accent-subtle",
      "--tug-base-fg-default|--tug-base-tone-caution-bg",
    ];
    const summary = bugPairs.map((pair) => {
      const [fg, bg] = pair.split("|");
      const r = results.find((res) => res.fg === fg && res.bg === bg);
      if (!r) return `${pair}: NOT FOUND`;
      const threshold = CONTRAST_THRESHOLDS[r.role] ?? 0;
      return `${fg.replace("--tug-base-", "")} | ${bg.replace("--tug-base-", "")}: contrast=${r.contrast.toFixed(1)}, threshold=${threshold}, pass=${Math.abs(r.contrast) >= threshold}`;
    });
    // Expect all to pass
    const failing = summary.filter((s) => s.includes("pass=false"));
    expect(failing).toEqual([]);
    expect(summary).toBeDefined(); // shows results
  });
});
