/**
 * AboutCard React component tests — Step 4
 *
 * Verifies the About card renders the required content using RTL queries.
 * Tests: app name "Tug", version string, copyright notice.
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect } from "bun:test";
import { render } from "@testing-library/react";
import { AboutCard } from "./about-card";

describe("AboutCard", () => {
  it('renders app name "Tug"', () => {
    const { container } = render(<AboutCard />);
    const heading = container.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Tug");
  });

  it("renders version string", () => {
    const { container } = render(<AboutCard />);
    const versionEl = Array.from(container.querySelectorAll("p")).find((el) =>
      el.textContent?.includes("Version")
    );
    expect(versionEl).not.toBeNull();
    expect(versionEl?.textContent).toMatch(/Version/);
  });

  it("renders copyright notice", () => {
    const { container } = render(<AboutCard />);
    const copyrightEl = Array.from(container.querySelectorAll("p")).find((el) =>
      el.textContent?.includes("Copyright")
    );
    expect(copyrightEl).not.toBeNull();
    expect(copyrightEl?.textContent).toMatch(/Copyright/);
    expect(copyrightEl?.textContent).toMatch(/Ken Kocienda/);
  });

  it("renders the Tug logo SVG", () => {
    const { container } = render(<AboutCard />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });
});
