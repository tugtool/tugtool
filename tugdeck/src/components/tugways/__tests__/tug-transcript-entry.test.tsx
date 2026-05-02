/**
 * TugTranscriptEntry — DOM shape, slot pass-through, optional-slot omission.
 *
 * Pure presentational primitive — happy-dom is sufficient because no
 * test asserts layout fidelity (no getBoundingClientRect / clip-rect
 * checks). All assertions live on the rendered DOM tree.
 *
 * Laws: [L02] no React state to verify; component is presentational.
 *       [L19] data-slot, data-participant, file-pair contract verified.
 */

import "../../../__tests__/setup-rtl";

import React from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import {
  TugTranscriptEntry,
  type Participant,
} from "../tug-transcript-entry";

const PARTICIPANTS: ReadonlyArray<Participant> = [
  "user",
  "code",
  "shell",
  "command",
];

/**
 * Lucide icon name each participant renders into the gutter. Mirrors
 * `PARTICIPANT_ICONS` in the primitive — kept here as a literal so the
 * test fails loudly if either side drifts. Lucide's `createLucideIcon`
 * stamps the SVG with `class="lucide-<iconName>"`, so we assert that
 * class is present to verify the right icon for the right participant.
 */
const PARTICIPANT_ICON_CLASSES: Record<Participant, string> = {
  user: "lucide-user",
  code: "lucide-bot",
  shell: "lucide-shell",
  command: "lucide-command",
};

afterEach(() => {
  cleanup();
});

describe("TugTranscriptEntry", () => {
  for (const participant of PARTICIPANTS) {
    test(`participant=${participant} renders the canonical DOM shape`, () => {
      const { container } = render(
        <TugTranscriptEntry
          participant={participant}
          identifier="Identifier"
          timestamp="2:14 PM"
          body="body content"
          controls={<button type="button">copy</button>}
        />,
      );

      const root = container.querySelector(
        '[data-slot="tug-transcript-entry"]',
      );
      expect(root).not.toBeNull();
      expect(root?.getAttribute("data-participant")).toBe(participant);
      expect(root?.classList.contains("tug-transcript-entry")).toBe(true);
      expect(root?.getAttribute("role")).toBe("article");

      const labelledBy = root?.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();

      const icon = root?.querySelector(".tug-transcript-entry__icon");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      const svg = icon?.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.classList.contains(PARTICIPANT_ICON_CLASSES[participant])).toBe(true);

      const identifier = root?.querySelector(
        ".tug-transcript-entry__identifier",
      );
      expect(identifier?.tagName).toBe("STRONG");
      expect(identifier?.textContent).toBe("Identifier");
      // The bold identifier is the article's accessible name.
      expect(identifier?.getAttribute("id")).toBe(labelledBy ?? null);

      const timestamp = root?.querySelector(
        ".tug-transcript-entry__timestamp",
      );
      expect(timestamp?.textContent).toBe("2:14 PM");

      const body = root?.querySelector(".tug-transcript-entry__body");
      expect(body?.textContent).toBe("body content");

      const controls = root?.querySelector(
        ".tug-transcript-entry__controls",
      );
      expect(controls?.querySelector("button")?.textContent).toBe("copy");
    });
  }

  test("body slot passes children through verbatim", () => {
    const { container } = render(
      <TugTranscriptEntry
        participant="user"
        identifier="You"
        body={
          <div data-testid="sentinel-body">unique-body-sentinel</div>
        }
      />,
    );
    const body = container.querySelector(".tug-transcript-entry__body");
    expect(
      body?.querySelector("[data-testid='sentinel-body']")?.textContent,
    ).toBe("unique-body-sentinel");
  });

  test("controls slot passes children through verbatim", () => {
    const { container } = render(
      <TugTranscriptEntry
        participant="code"
        identifier="claude-opus"
        body="ignored"
        controls={
          <div data-testid="sentinel-controls">
            unique-controls-sentinel
          </div>
        }
      />,
    );
    const controls = container.querySelector(
      ".tug-transcript-entry__controls",
    );
    expect(
      controls?.querySelector("[data-testid='sentinel-controls']")
        ?.textContent,
    ).toBe("unique-controls-sentinel");
  });

  test("omits the timestamp node when timestamp prop is undefined", () => {
    const { container } = render(
      <TugTranscriptEntry
        participant="user"
        identifier="You"
        body="hello"
      />,
    );
    expect(
      container.querySelector(".tug-transcript-entry__timestamp"),
    ).toBeNull();
  });

  test("omits the controls node when controls prop is undefined", () => {
    const { container } = render(
      <TugTranscriptEntry
        participant="user"
        identifier="You"
        body="hello"
      />,
    );
    expect(
      container.querySelector(".tug-transcript-entry__controls"),
    ).toBeNull();
  });

  test("forwards className alongside the canonical class", () => {
    const { container } = render(
      <TugTranscriptEntry
        participant="user"
        identifier="You"
        body="hello"
        className="custom-class"
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-transcript-entry"]',
    );
    expect(root?.classList.contains("tug-transcript-entry")).toBe(true);
    expect(root?.classList.contains("custom-class")).toBe(true);
  });
});
