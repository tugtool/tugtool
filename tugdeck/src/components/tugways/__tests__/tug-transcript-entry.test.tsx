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
  formatSequenceNumber,
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

// ---------------------------------------------------------------------------
// Pin-stack contract — `--tugx-pin-stack-top`
// ---------------------------------------------------------------------------
//
// The entry writes its rendered `__header` height onto the root as
// `--tugx-pin-stack-top` so descendant sticky chrome (FileBlock /
// DiffBlock / TerminalBlock / fenced-code headers + actions rows;
// ToolWrapperChrome header) can telescope underneath the entry header
// rather than overlap it. happy-dom has no layout engine — `offsetHeight`
// returns 0 — so the assertion is just that the variable is *written*,
// not its numeric value. Real-browser pin behavior is verified manually
// against the gallery card per the happy-dom scoping rule.
describe("TugTranscriptEntry — pin-stack contract", () => {
  test("writes --tugx-pin-stack-top on the entry root after mount", () => {
    const { container } = render(
      <TugTranscriptEntry
        participant="code"
        identifier="Claude"
        timestamp="3:14 PM"
        body="hello"
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-transcript-entry"]',
    ) as HTMLElement | null;
    expect(root).not.toBeNull();
    if (root === null) return;
    const written = root.style.getPropertyValue("--tugx-pin-stack-top");
    expect(written).toMatch(/^\d+px$/);
  });

  test("variable persists across re-renders with new header content", () => {
    // ResizeObserver in happy-dom doesn't fire layout callbacks, so we
    // can't assert that a header content change updates the value to a
    // NEW number. What we CAN verify is that the variable is still set
    // (the effect's seed write runs on every dep-aware update path, and
    // the observer is re-attached when the component re-mounts; neither
    // path nulls out the property).
    const { container, rerender } = render(
      <TugTranscriptEntry
        participant="code"
        identifier="Claude"
        timestamp="3:14 PM"
        body="hello"
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-transcript-entry"]',
    ) as HTMLElement;
    expect(root.style.getPropertyValue("--tugx-pin-stack-top")).toMatch(/^\d+px$/);
    rerender(
      <TugTranscriptEntry
        participant="code"
        identifier={<span>Claude with a longer identifier</span>}
        timestamp="3:14 PM"
        body="hello"
      />,
    );
    expect(root.style.getPropertyValue("--tugx-pin-stack-top")).toMatch(/^\d+px$/);
  });

  test("formatSequenceNumber zero-pads to four digits up to 9999, then grows naturally", () => {
    expect(formatSequenceNumber(1)).toBe("#0001");
    expect(formatSequenceNumber(7)).toBe("#0007");
    expect(formatSequenceNumber(42)).toBe("#0042");
    expect(formatSequenceNumber(100)).toBe("#0100");
    expect(formatSequenceNumber(999)).toBe("#0999");
    expect(formatSequenceNumber(1000)).toBe("#1000");
    expect(formatSequenceNumber(9999)).toBe("#9999");
    expect(formatSequenceNumber(10000)).toBe("#10000");
    expect(formatSequenceNumber(12345)).toBe("#12345");
    // Defensive: non-finite / negative returns empty (caller mistake,
    // not a crash).
    expect(formatSequenceNumber(NaN)).toBe("");
    expect(formatSequenceNumber(-1)).toBe("");
  });

  test("sequenceNumber renders next to the timestamp as #NNNN", () => {
    const { container } = render(
      <TugTranscriptEntry
        participant="code"
        identifier="Claude"
        timestamp="12:39 PM"
        sequenceNumber={42}
        body="hi"
      />,
    );
    const badge = container.querySelector(
      '[data-slot="tug-transcript-entry-sequence"]',
    ) as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe("#0042");
    // Accessible name carries the spoken count so the badge isn't
    // read as a raw "#0042" token.
    expect(badge.getAttribute("aria-label")).toBe("Entry 42");
  });

  test("sequenceNumber renders in the entry header (next to timestamp)", () => {
    const { container } = render(
      <TugTranscriptEntry
        participant="code"
        identifier="Claude"
        timestamp="12:39 PM"
        sequenceNumber={3}
        body="hi"
      />,
    );
    const header = container.querySelector(
      ".tug-transcript-entry__header",
    ) as HTMLElement;
    expect(header).not.toBeNull();
    // Both the timestamp and the sequence badge live inside the header.
    expect(
      header.querySelector(".tug-transcript-entry__timestamp"),
    ).not.toBeNull();
    expect(
      header.querySelector('[data-slot="tug-transcript-entry-sequence"]'),
    ).not.toBeNull();
  });

  test("omitted sequenceNumber renders no badge", () => {
    const { container } = render(
      <TugTranscriptEntry
        participant="code"
        identifier="Claude"
        timestamp="12:39 PM"
        body="hi"
      />,
    );
    expect(
      container.querySelector('[data-slot="tug-transcript-entry-sequence"]'),
    ).toBeNull();
  });

  test("ResizeObserver disconnects cleanly on unmount", () => {
    // Mount + unmount must not throw. The effect's cleanup function
    // calls `observer.disconnect()`; happy-dom's ResizeObserver stub
    // accepts the call without error.
    const { container, unmount } = render(
      <TugTranscriptEntry
        participant="code"
        identifier="Claude"
        body="hello"
      />,
    );
    expect(
      container.querySelector('[data-slot="tug-transcript-entry"]'),
    ).not.toBeNull();
    expect(() => unmount()).not.toThrow();
  });
});
