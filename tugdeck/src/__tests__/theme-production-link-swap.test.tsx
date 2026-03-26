import "./setup-rtl";

import { afterEach, describe, expect, it } from "bun:test";

import { activateProductionTheme } from "@/contexts/theme-provider";

describe("theme production link swap (thin)", () => {
  afterEach(() => {
    const link = document.getElementById("tug-theme-override");
    if (link) link.remove();
    document.body.style.removeProperty("--tugx-host-canvas-color");
  });

  it("adds/updates override link for non-brio themes", async () => {
    document.body.style.setProperty("--tugx-host-canvas-color", "#e7eaf0");

    const promise = activateProductionTheme("harmony");
    const link = document.getElementById("tug-theme-override") as HTMLLinkElement | null;
    expect(link).not.toBeNull();
    link!.dispatchEvent(new Event("load"));

    const hostColor = await promise;
    expect(link!.getAttribute("href")).toBe("/assets/themes/harmony.css");
    expect(hostColor).toBe("#e7eaf0");
  });

  it("removes override link when switching back to brio", async () => {
    const link = document.createElement("link");
    link.id = "tug-theme-override";
    link.rel = "stylesheet";
    link.href = "/assets/themes/harmony.css";
    document.head.appendChild(link);
    document.body.style.setProperty("--tugx-host-canvas-color", "#16181a");

    const hostColor = await activateProductionTheme("brio");
    expect(document.getElementById("tug-theme-override")).toBeNull();
    expect(hostColor).toBe("#16181a");
  });
});
