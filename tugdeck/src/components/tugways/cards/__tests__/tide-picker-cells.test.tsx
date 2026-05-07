/**
 * tide-picker-cells — unit tests for the seven picker cell
 * renderers.
 *
 * Each cell is rendered in isolation (no `TugListView` wrapper) with
 * a stub `TidePickerDataSource` carrying exactly one row of the
 * tested kind. We assert:
 *
 *   - The visible markup the cell paints (text, badges, icons).
 *   - `data-selected` reflects the context's selection state.
 *   - The trailing trash icon on `session-resume` fires
 *     `onRequestForgetSession` AND stops the click from propagating
 *     to the wrapper.
 *   - The `forget-all` link fires `onRequestForgetAll`.
 *   - `path-recent` paints `<mark>` over the matched ranges
 *     supplied by the data source.
 *   - Live and failed `session-resume` rows render the right
 *     badges and disable / enable the forget icon accordingly.
 *
 * The tests sit in the "component markup" tier — we render the cell,
 * inspect DOM attributes, and dispatch synchronous click events. No
 * focus, no selection-across-renders, no event-ordering between
 * mounts.
 */
import "../../../../__tests__/setup-rtl";

import { afterEach, describe, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
} from "@testing-library/react";
import React from "react";

import {
  ForgetAllCell,
  HeaderRecentsCell,
  HeaderSessionsCell,
  LoadingCell,
  PathRecentCell,
  PickerCellProvider,
  type PickerSelection,
  SessionNewCell,
  SessionResumeCell,
} from "../tide-picker-cells";
import {
  TidePickerDataSource,
  type PickerInputs,
} from "@/lib/tide-picker-data-source";
import type { SessionRow } from "@/protocol";
import type { WorkspaceSnapshot } from "@/lib/tide-session-ledger-store";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

const READY_EMPTY: WorkspaceSnapshot = {
  status: "ready",
  rows: [],
};

function readyWith(rows: ReadonlyArray<SessionRow>): WorkspaceSnapshot {
  return { status: "ready", rows };
}

function pendingSnapshot(): WorkspaceSnapshot {
  return { status: "pending", rows: [] };
}

function makeRow(overrides: Partial<SessionRow> = {}): SessionRow {
  // Spread merge — overrides take precedence even when their value
  // is `null` (e.g. setting `first_user_prompt: null` to test the
  // "No prompts yet" placeholder). The `??`-fallback pattern would
  // misread `null` as "not provided" and use the default instead.
  const defaults: SessionRow = {
    session_id: "sid-default",
    workspace_key: "/Users/Ken/projects/foo",
    project_dir: "/Users/Ken/projects/foo",
    created_at: 0,
    last_used_at: Date.now() - 60_000,
    turn_count: 5,
    first_user_prompt: "Build the picker redesign data source",
    state: "closed",
    card_id: null,
  };
  return { ...defaults, ...overrides };
}

function buildDataSource(inputs: PickerInputs): TidePickerDataSource {
  return new TidePickerDataSource(inputs);
}

interface ProviderHarnessProps {
  selection?: PickerSelection | null;
  currentPath?: string;
  onConfirmForgetSession?: (sessionId: string) => void;
  children: React.ReactNode;
}

function Harness({
  selection = null,
  currentPath = "",
  onConfirmForgetSession = () => {},
  children,
}: ProviderHarnessProps): React.ReactElement {
  return (
    <PickerCellProvider
      value={{
        currentPath,
        selection,
        onConfirmForgetSession,
      }}
    >
      {children}
    </PickerCellProvider>
  );
}

/**
 * Helper to find the index of the first row with a given kind in a
 * data source. Tests build a data source with known shape, then pull
 * the index of the cell they want to render.
 */
function indexOfKind(ds: TidePickerDataSource, kind: string): number {
  for (let i = 0; i < ds.numberOfItems(); i += 1) {
    if (ds.kindForIndex(i) === kind) return i;
  }
  throw new Error(`Kind not found: ${kind}`);
}

// ---------------------------------------------------------------------------
// Header cells
// ---------------------------------------------------------------------------

describe("HeaderRecentsCell / HeaderSessionsCell", () => {
  test("HeaderRecentsCell paints 'Recents' (sentence case)", () => {
    const ds = buildDataSource({
      recents: ["/Users/Ken/projects/foo"],
      query: "",
      ledger: READY_EMPTY,
    });
    const idx = indexOfKind(ds, "header-recents");
    const { container } = render(
      <HeaderRecentsCell
        index={idx}
        id={ds.idForIndex(idx)}
        kind="header-recents"
        dataSource={ds}
      />,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-header-recents"]',
    );
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("Recents");
  });

  test("HeaderSessionsCell paints 'Sessions' (sentence case)", () => {
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([makeRow()]),
    });
    const idx = indexOfKind(ds, "header-sessions");
    const { container } = render(
      <HeaderSessionsCell
        index={idx}
        id={ds.idForIndex(idx)}
        kind="header-sessions"
        dataSource={ds}
      />,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-header-sessions"]',
    );
    expect(el?.textContent).toBe("Sessions");
  });
});

// ---------------------------------------------------------------------------
// PathRecentCell
// ---------------------------------------------------------------------------

describe("PathRecentCell", () => {
  test("renders the path with title and aria-label set to the full path", () => {
    const ds = buildDataSource({
      recents: ["/Users/Ken/projects/tugtool"],
      query: "",
      ledger: READY_EMPTY,
    });
    const idx = indexOfKind(ds, "path-recent");
    const { container } = render(
      <PathRecentCell
        index={idx}
        id={ds.idForIndex(idx)}
        kind="path-recent"
        dataSource={ds}
      />,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-path-recent"]',
    );
    expect(el).not.toBeNull();
    expect(el?.getAttribute("title")).toBe("/Users/Ken/projects/tugtool");
    expect(el?.getAttribute("aria-label")).toBe(
      "/Users/Ken/projects/tugtool",
    );
    expect(el?.textContent).toContain("/Users/Ken/projects/tugtool");
  });

  test("paints <mark> spans over matched ranges from the data source", () => {
    const ds = buildDataSource({
      recents: ["/Users/Ken/projects/tugtool"],
      query: "tug",
      ledger: READY_EMPTY,
    });
    const idx = indexOfKind(ds, "path-recent");
    const { container } = render(
      <PathRecentCell
        index={idx}
        id={ds.idForIndex(idx)}
        kind="path-recent"
        dataSource={ds}
      />,
    );
    const marks = container.querySelectorAll(".tide-card-picker-match");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("tug");
  });

  test("no <mark> spans on empty query (matches array empty)", () => {
    const ds = buildDataSource({
      recents: ["/Users/Ken/projects/tugtool"],
      query: "",
      ledger: READY_EMPTY,
    });
    const idx = indexOfKind(ds, "path-recent");
    const { container } = render(
      <PathRecentCell
        index={idx}
        id={ds.idForIndex(idx)}
        kind="path-recent"
        dataSource={ds}
      />,
    );
    expect(
      container.querySelectorAll(".tide-card-picker-match").length,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SessionNewCell
// ---------------------------------------------------------------------------

describe("SessionNewCell", () => {
  test("paints 'New session' single-row label", () => {
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([]),
    });
    const idx = indexOfKind(ds, "session-new");
    const { container } = render(
      <SessionNewCell
        index={idx}
        id={ds.idForIndex(idx)}
        kind="session-new"
        dataSource={ds}
      />,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-session-new"]',
    );
    expect(el?.textContent).toContain("New session");
  });

  test("data-selected is absent when context selection does not match", () => {
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([makeRow()]),
    });
    const idx = indexOfKind(ds, "session-new");
    const { container } = render(
      <Harness selection={null}>
        <SessionNewCell
          index={idx}
          id={ds.idForIndex(idx)}
          kind="session-new"
          dataSource={ds}
        />
      </Harness>,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-session-new"]',
    );
    expect(el?.hasAttribute("data-selected")).toBe(false);
  });

  test("data-selected='true' when context selection is { kind: 'session-new' }", () => {
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([]),
    });
    const idx = indexOfKind(ds, "session-new");
    const { container } = render(
      <Harness selection={{ kind: "session-new" }}>
        <SessionNewCell
          index={idx}
          id={ds.idForIndex(idx)}
          kind="session-new"
          dataSource={ds}
        />
      </Harness>,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-session-new"]',
    );
    expect(el?.getAttribute("data-selected")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// SessionResumeCell
// ---------------------------------------------------------------------------

describe("SessionResumeCell", () => {
  test("renders snippet + subtitle for a closed row", () => {
    const row = makeRow({
      session_id: "sid-1",
      state: "closed",
      first_user_prompt: "First prompt",
      turn_count: 3,
    });
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([row]),
    });
    const idx = indexOfKind(ds, "session-resume");
    const { container } = render(
      <Harness>
        <SessionResumeCell
          index={idx}
          id={ds.idForIndex(idx)}
          kind="session-resume"
          dataSource={ds}
        />
      </Harness>,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-session-resume"]',
    );
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-state")).toBe("closed");
    expect(el?.textContent).toContain("First prompt");
  });

  test("data-selected='true' when context selection.sessionId matches", () => {
    const row = makeRow({ session_id: "sid-1", state: "closed" });
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([row]),
    });
    const idx = indexOfKind(ds, "session-resume");
    const { container } = render(
      <Harness
        selection={{ kind: "session-resume", sessionId: "sid-1" }}
      >
        <SessionResumeCell
          index={idx}
          id={ds.idForIndex(idx)}
          kind="session-resume"
          dataSource={ds}
        />
      </Harness>,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-session-resume"]',
    );
    expect(el?.getAttribute("data-selected")).toBe("true");
  });

  test("live row shows 'live' badge, hides forget icon, has data-disabled", () => {
    const row = makeRow({ session_id: "sid-live", state: "live" });
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([row]),
    });
    const idx = indexOfKind(ds, "session-resume");
    const { container } = render(
      <Harness>
        <SessionResumeCell
          index={idx}
          id={ds.idForIndex(idx)}
          kind="session-resume"
          dataSource={ds}
        />
      </Harness>,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-session-resume"]',
    );
    expect(el?.getAttribute("data-disabled")).toBe("true");
    expect(el?.textContent).toContain("live");
    expect(el?.textContent).toContain("Live in another card");
    expect(
      el?.querySelector(".tide-card-picker-session-forget"),
    ).toBeNull();
  });

  test("failed row shows 'failed' badge AND keeps forget icon", () => {
    const row = makeRow({ session_id: "sid-failed", state: "failed" });
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([row]),
    });
    const idx = indexOfKind(ds, "session-resume");
    const { container } = render(
      <Harness>
        <SessionResumeCell
          index={idx}
          id={ds.idForIndex(idx)}
          kind="session-resume"
          dataSource={ds}
        />
      </Harness>,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-session-resume"]',
    );
    expect(el?.textContent).toContain("failed");
    expect(el?.textContent).toContain("Couldn't resume — JSONL missing");
    expect(
      el?.querySelector(".tide-card-picker-session-forget"),
    ).not.toBeNull();
  });

  test("forget icon click fires onRequestForgetSession AND stops propagation", () => {
    const row = makeRow({ session_id: "sid-1", state: "closed" });
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([row]),
    });
    const idx = indexOfKind(ds, "session-resume");

    const calls: string[] = [];
    let parentClickFired = false;

    const { container } = render(
      <div onClick={() => { parentClickFired = true; }}>
        <Harness onConfirmForgetSession={(sid: string) => { calls.push(sid); }}>
          <SessionResumeCell
            index={idx}
            id={ds.idForIndex(idx)}
            kind="session-resume"
            dataSource={ds}
          />
        </Harness>
      </div>,
    );

    const btn = container.querySelector(
      ".tide-card-picker-session-forget",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();

    act(() => {
      fireEvent.click(btn!);
    });

    expect(calls).toEqual(["sid-1"]);
    // Parent's onClick must NOT fire — propagation was stopped so
    // the wrapper's `onSelect` won't race with the forget-confirm
    // panel open.
    expect(parentClickFired).toBe(false);
  });

  test("renders 'No prompts yet' placeholder when first_user_prompt is null", () => {
    const row = makeRow({
      session_id: "sid-empty",
      state: "closed",
      first_user_prompt: null,
    });
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([row]),
    });
    const idx = indexOfKind(ds, "session-resume");
    const { container } = render(
      <Harness>
        <SessionResumeCell
          index={idx}
          id={ds.idForIndex(idx)}
          kind="session-resume"
          dataSource={ds}
        />
      </Harness>,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-session-resume"]',
    );
    expect(el?.textContent).toContain("No prompts yet");
  });
});

// ---------------------------------------------------------------------------
// ForgetAllCell
// ---------------------------------------------------------------------------

describe("ForgetAllCell", () => {
  test("renders the all-sessions label without count when nonLiveCount is 1", () => {
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([makeRow({ state: "closed", session_id: "s1" })]),
    });
    const idx = indexOfKind(ds, "forget-all");
    const { container } = render(
      <Harness>
        <ForgetAllCell
          index={idx}
          id={ds.idForIndex(idx)}
          kind="forget-all"
          dataSource={ds}
        />
      </Harness>,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-forget-all"]',
    );
    expect(el?.textContent).toBe("Forget all sessions for this path");
  });

  test("renders the count when nonLiveCount > 1", () => {
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([
        makeRow({ state: "closed", session_id: "s1" }),
        makeRow({ state: "closed", session_id: "s2" }),
        makeRow({ state: "closed", session_id: "s3" }),
      ]),
    });
    const idx = indexOfKind(ds, "forget-all");
    const { container } = render(
      <Harness>
        <ForgetAllCell
          index={idx}
          id={ds.idForIndex(idx)}
          kind="forget-all"
          dataSource={ds}
        />
      </Harness>,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-forget-all"]',
    );
    expect(el?.textContent).toBe("Forget all sessions for this path (3)");
  });

  test("click fires onRequestForgetAll AND stops propagation", () => {
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([makeRow({ state: "closed", session_id: "s1" })]),
    });
    const idx = indexOfKind(ds, "forget-all");

    let calls = 0;
    let parentClickFired = false;

    const { container } = render(
      <div onClick={() => { parentClickFired = true; }}>
        <Harness>
          <ForgetAllCell
            index={idx}
            id={ds.idForIndex(idx)}
            kind="forget-all"
            dataSource={ds}
          />
        </Harness>
      </div>,
    );

    const btn = container.querySelector(
      '[data-testid="tide-card-picker-forget-all"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();

    act(() => {
      fireEvent.click(btn!);
    });

    expect(calls).toBe(1);
    expect(parentClickFired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LoadingCell
// ---------------------------------------------------------------------------

describe("LoadingCell", () => {
  test("renders 'checking…' with role=status and aria-live=polite", () => {
    const ds = buildDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: pendingSnapshot(),
    });
    const idx = indexOfKind(ds, "loading");
    const { container } = render(
      <LoadingCell
        index={idx}
        id={ds.idForIndex(idx)}
        kind="loading"
        dataSource={ds}
      />,
    );
    const el = container.querySelector(
      '[data-testid="tide-card-picker-pending-placeholder"]',
    );
    expect(el?.textContent).toBe("checking…");
    expect(el?.getAttribute("role")).toBe("status");
    expect(el?.getAttribute("aria-live")).toBe("polite");
  });
});
