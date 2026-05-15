/**
 * Pure-logic tests for `tide-permission-dialog.tsx`.
 *
 * `PermissionDialog`'s behaviour is its exported pure helpers —
 * the body-kind picker, the suggestion narrowing + label composer,
 * the options builder for the radio-group scope picker, the
 * resolved-record summary, and the Read line-range badge — plus the
 * dispatch wiring (`KIND_RENDERERS.permission` resolves to the real
 * component). Per project policy (pure-logic `bun:test` + real-app
 * tests only, no fake-DOM render tests), the suite pins those
 * exhaustively; the Allow/Deny round-trip, the radio-group radio-mark
 * paint, and primary-button focus are HMR / live-smoke vetted because
 * the app-test harness can't inject `control_request_forward` events
 * (same gap that gates #step-15–#step-17).
 *
 * Coverage:
 *  - `selectPermissionBodyKind` — Bash / Edit / MultiEdit / Read /
 *    Write / fallthrough, case-insensitive.
 *  - `composePermissionSuggestionLabel` — every (behavior ×
 *    destination) cell, including the destination-less fallback and
 *    the unknown-destination passthrough.
 *  - `narrowPermissionSuggestion` — the v2.1.x catalog shape,
 *    allow/deny behaviors, non-actionable drop, the "rules content is
 *    intentionally dropped" contract.
 *  - `buildPermissionOptions` — empty list passthrough, allow-only
 *    filtering, implicit "Allow once" head, deny-suggestion drop.
 *  - `composePermissionRecordSummary` — allow / deny / resolved-null,
 *    empty tool name.
 *  - `composePermissionLineRange` — offset+limit / offset / limit /
 *    neither / non-object.
 *  - dispatch routing — a `permission` RenderInput resolves to
 *    `PermissionDialog`.
 */

import { describe, it, expect } from "bun:test";

import {
  ALLOW_ONCE_OPTION_DESCRIPTION,
  ALLOW_ONCE_OPTION_LABEL,
  ALLOW_ONCE_OPTION_VALUE,
  PermissionDialog,
  buildPermissionOptions,
  composePermissionLineRange,
  composePermissionRecordSummary,
  composePermissionSuggestionLabel,
  narrowPermissionSuggestion,
  selectPermissionBodyKind,
  type PermissionSuggestionAction,
} from "./tide-permission-dialog";
import {
  KIND_RENDERERS,
  dispatch,
  type DispatchContext,
  type RenderInput,
} from "@/components/tugways/cards/tide-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// selectPermissionBodyKind
// ---------------------------------------------------------------------------

describe("selectPermissionBodyKind", () => {
  it("routes Bash to the bash body kind", () => {
    expect(selectPermissionBodyKind("Bash")).toBe("bash");
    expect(selectPermissionBodyKind("bash")).toBe("bash");
  });

  it("routes Edit and MultiEdit to the edit body kind", () => {
    expect(selectPermissionBodyKind("Edit")).toBe("edit");
    expect(selectPermissionBodyKind("MultiEdit")).toBe("edit");
    expect(selectPermissionBodyKind("MULTIEDIT")).toBe("edit");
  });

  it("routes Read and Write to the path body kind", () => {
    expect(selectPermissionBodyKind("Read")).toBe("path");
    expect(selectPermissionBodyKind("Write")).toBe("path");
  });

  it("falls back to json for any other tool", () => {
    expect(selectPermissionBodyKind("Glob")).toBe("json");
    expect(selectPermissionBodyKind("WebFetch")).toBe("json");
    expect(selectPermissionBodyKind("")).toBe("json");
  });
});

// ---------------------------------------------------------------------------
// narrowPermissionSuggestion
// ---------------------------------------------------------------------------

describe("composePermissionSuggestionLabel", () => {
  it("renders allow + each known destination", () => {
    expect(composePermissionSuggestionLabel("allow", "session")).toBe(
      "Allow for this session",
    );
    expect(composePermissionSuggestionLabel("allow", "project")).toBe(
      "Allow for this project",
    );
    expect(composePermissionSuggestionLabel("allow", "localSettings")).toBe(
      "Allow for this project",
    );
    expect(composePermissionSuggestionLabel("allow", "projectSettings")).toBe(
      "Allow for this project",
    );
    expect(composePermissionSuggestionLabel("allow", "userSettings")).toBe(
      "Always allow",
    );
  });

  it("renders deny + each known destination", () => {
    expect(composePermissionSuggestionLabel("deny", "session")).toBe(
      "Deny for this session",
    );
    expect(composePermissionSuggestionLabel("deny", "project")).toBe(
      "Deny for this project",
    );
    expect(composePermissionSuggestionLabel("deny", "userSettings")).toBe(
      "Always deny",
    );
  });

  it("falls back to '{Verb} this action' when destination is omitted", () => {
    expect(composePermissionSuggestionLabel("allow", undefined)).toBe(
      "Allow this action",
    );
    expect(composePermissionSuggestionLabel("deny", undefined)).toBe(
      "Deny this action",
    );
  });

  it("passes an unknown destination through verbatim (forward-compat scope)", () => {
    expect(composePermissionSuggestionLabel("allow", "branch")).toBe(
      "Allow (branch)",
    );
    expect(composePermissionSuggestionLabel("deny", "global")).toBe(
      "Deny (global)",
    );
  });
});

describe("narrowPermissionSuggestion", () => {
  it("narrows the v2.1.x catalog allow + session shape", () => {
    // Verbatim from test-11-permission-deny-roundtrip.jsonl. The
    // wire's verbose `rules` content is intentionally dropped from
    // the visible label — the dialog's description already names the
    // specific tool + command being asked about.
    const suggestion = {
      behavior: "allow",
      destination: "session",
      rules: [{ ruleContent: "//nonexistent/**", toolName: "Read" }],
      type: "addRules",
    };
    expect(narrowPermissionSuggestion(suggestion)).toEqual({
      behavior: "allow",
      label: "Allow for this session",
    });
  });

  it("narrows a deny + userSettings suggestion", () => {
    const suggestion = {
      behavior: "deny",
      destination: "userSettings",
      rules: [{ ruleContent: "rm -rf *", toolName: "Bash" }],
    };
    expect(narrowPermissionSuggestion(suggestion)).toEqual({
      behavior: "deny",
      label: "Always deny",
    });
  });

  it("drops a suggestion whose behavior is not actionable", () => {
    // `ask` has no `tool_approval` wire representation — drop it.
    expect(
      narrowPermissionSuggestion({ behavior: "ask", rules: [] }),
    ).toBeNull();
    expect(narrowPermissionSuggestion({ rules: [] })).toBeNull();
  });

  it("drops non-object input", () => {
    expect(narrowPermissionSuggestion(null)).toBeNull();
    expect(narrowPermissionSuggestion("allow")).toBeNull();
    expect(narrowPermissionSuggestion(undefined)).toBeNull();
  });

  it("falls back to a destination-less label when destination is omitted", () => {
    expect(narrowPermissionSuggestion({ behavior: "allow" })).toEqual({
      behavior: "allow",
      label: "Allow this action",
    });
  });

  it("ignores rule content entirely (label keys off behavior + destination)", () => {
    // The wire `rules` array used to drive the label; it no longer
    // does. A suggestion with rules but no destination still falls
    // back to the destination-less label.
    expect(
      narrowPermissionSuggestion({
        behavior: "allow",
        rules: [{ ruleContent: "//x/**" }, { toolName: "Grep" }, null, 7],
      }),
    ).toEqual({
      behavior: "allow",
      label: "Allow this action",
    });
  });
});

// ---------------------------------------------------------------------------
// buildPermissionOptions — radio-group scope picker
// ---------------------------------------------------------------------------

describe("buildPermissionOptions", () => {
  it("returns an empty array when there are no suggestions", () => {
    // No suggestions → no scope picker; the dialog renders without
    // an options block and Allow defaults to one-shot scope.
    expect(buildPermissionOptions([])).toEqual([]);
  });

  it("returns an empty array when every suggestion is deny-scoped", () => {
    // Deny-scoped suggestions are not surfaced as scope choices —
    // Deny in this dialog is always the off-ramp button. A list
    // containing only deny-scoped entries collapses to no options.
    const denyOnly: ReadonlyArray<PermissionSuggestionAction> = [
      { behavior: "deny", label: "Always deny" },
      { behavior: "deny", label: "Deny for this project" },
    ];
    expect(buildPermissionOptions(denyOnly)).toEqual([]);
  });

  it("prepends the implicit 'Allow once' head when allow-scopes exist", () => {
    const allows: ReadonlyArray<PermissionSuggestionAction> = [
      { behavior: "allow", label: "Allow for this session" },
      { behavior: "allow", label: "Allow for this project" },
      { behavior: "allow", label: "Always allow" },
    ];
    expect(buildPermissionOptions(allows)).toEqual([
      {
        value: ALLOW_ONCE_OPTION_VALUE,
        label: ALLOW_ONCE_OPTION_LABEL,
        description: ALLOW_ONCE_OPTION_DESCRIPTION,
      },
      { value: "allow:Allow for this session", label: "Allow for this session" },
      { value: "allow:Allow for this project", label: "Allow for this project" },
      { value: "allow:Always allow",            label: "Always allow" },
    ]);
  });

  it("filters deny-scoped suggestions out of a mixed list", () => {
    const mixed: ReadonlyArray<PermissionSuggestionAction> = [
      { behavior: "allow", label: "Allow for this session" },
      { behavior: "deny",  label: "Deny for this project" },
      { behavior: "allow", label: "Always allow" },
    ];
    expect(buildPermissionOptions(mixed)).toEqual([
      {
        value: ALLOW_ONCE_OPTION_VALUE,
        label: ALLOW_ONCE_OPTION_LABEL,
        description: ALLOW_ONCE_OPTION_DESCRIPTION,
      },
      { value: "allow:Allow for this session", label: "Allow for this session" },
      { value: "allow:Always allow",            label: "Always allow" },
    ]);
  });

  it("'Allow once' is always the first option when present (radio default)", () => {
    const allows: ReadonlyArray<PermissionSuggestionAction> = [
      { behavior: "allow", label: "Always allow" },
    ];
    const options = buildPermissionOptions(allows);
    // Pinning the default ordering protects the radio-group's initial
    // selection: TugInlineDialog picks options[0] as the default,
    // and we want "Allow once" (the no-rule scope) to be that
    // default — never a persistent rule.
    expect(options[0].value).toBe(ALLOW_ONCE_OPTION_VALUE);
  });
});

// ---------------------------------------------------------------------------
// composePermissionRecordSummary
// ---------------------------------------------------------------------------

describe("composePermissionRecordSummary", () => {
  it("summarizes an allowed decision", () => {
    expect(composePermissionRecordSummary("Read", "allow")).toBe(
      "Read — Allowed",
    );
  });

  it("summarizes a denied decision", () => {
    expect(composePermissionRecordSummary("Bash", "deny")).toBe(
      "Bash — Denied",
    );
  });

  it("summarizes a null (out-of-band resolved) decision", () => {
    expect(composePermissionRecordSummary("Edit", null)).toBe(
      "Edit — Resolved",
    );
  });

  it("falls back to 'Tool' for an empty tool name", () => {
    expect(composePermissionRecordSummary("", "allow")).toBe("Tool — Allowed");
    expect(composePermissionRecordSummary("   ", "deny")).toBe("Tool — Denied");
  });
});

// ---------------------------------------------------------------------------
// composePermissionLineRange
// ---------------------------------------------------------------------------

describe("composePermissionLineRange", () => {
  it("composes a closed range from offset + limit", () => {
    expect(composePermissionLineRange({ offset: 10, limit: 20 })).toBe(
      "lines 10–29",
    );
  });

  it("composes an open-ended range from offset alone", () => {
    expect(composePermissionLineRange({ offset: 10 })).toBe("from line 10");
  });

  it("composes a head range from limit alone", () => {
    expect(composePermissionLineRange({ limit: 20 })).toBe("first 20 lines");
  });

  it("returns undefined when neither field is set", () => {
    expect(composePermissionLineRange({ file_path: "/x.ts" })).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(composePermissionLineRange(null)).toBeUndefined();
    expect(composePermissionLineRange("nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// dispatch routing
// ---------------------------------------------------------------------------

describe("dispatch — permission routing", () => {
  it("routes a permission RenderInput to the real PermissionDialog", () => {
    const input: RenderInput = {
      kind: "permission",
      request: {
        request_id: "req-1",
        is_question: false,
        tool_name: "Read",
        input: { file_path: "/nonexistent/file.txt" },
        decision_reason: "Path is outside allowed working directories",
      },
    };
    const result = dispatch(input, {} as DispatchContext);
    expect(result.Component).toBe(PermissionDialog);
    expect(result.Component).toBe(KIND_RENDERERS.permission);
    expect(result.caution).toBeUndefined();
    // The dispatch threads the input + context through as the prop bag.
    expect((result.props as { input: RenderInput }).input).toBe(input);
  });
});
