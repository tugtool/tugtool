/**
 * gallery-prompt-entry-sandbox.tsx — TugPromptEntry interactive sandbox card.
 *
 * Companion to the pristine `GalleryPromptEntry` card. Wraps the same
 * component in a debug panel of `TugPushButton`s that dispatch
 * synthetic frames through the underlying `MockTugConnection`, driving
 * the embedded `CodeSessionStore` through every phase transition
 * `TugPromptEntry` surfaces.
 *
 * See Spec S06 (#s06-mock-driver) for the SYNTHETIC frame-factory API
 * this card exposes one button per factory, plus:
 *
 *   • "Run happy path" — chains session_init → assistantPartial (×2)
 *     → assistantFinal → turn_complete(success) with short async
 *     gaps so each phase transition is legible.
 *   • "Reset store" — disposes the in-flight `CodeSessionStore`,
 *     builds a fresh pair of mock services, and remounts
 *     `TugPromptEntry` via a key bump so the mock session starts
 *     clean.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TugPromptEntry } from "../tug-prompt-entry";
import { TugPushButton } from "../tug-push-button";
import { TugLabel } from "../tug-label";
import { FeedId, type FeedIdValue } from "@/protocol";

import {
  buildMockServices,
  GALLERY_TUG_SESSION_ID,
  type MockServices,
} from "./gallery-prompt-entry";

import "./gallery-prompt-entry-sandbox.css";

// ---------------------------------------------------------------------------
// SYNTHETIC frame factories (Spec S06)
// ---------------------------------------------------------------------------

/**
 * Synthetic frame factories covering every phase transition
 * `TugPromptEntry` observes via its `CodeSessionStore` snapshot.
 * Each returns a decoded payload matching the wire shape for the
 * named event; the caller threads the returned object through
 * `connection.dispatchDecoded(feedId, payload)`.
 */
const SYNTHETIC = {
  sessionInit: (tsid: string, sessionId: string) => ({
    type: "session_init",
    session_id: sessionId,
    tug_session_id: tsid,
  }),
  assistantPartial: (
    tsid: string,
    msgId: string,
    text: string,
    rev: number,
    seq: number,
  ) => ({
    type: "assistant_text",
    tug_session_id: tsid,
    msg_id: msgId,
    text,
    is_partial: true,
    rev,
    seq,
  }),
  assistantFinal: (tsid: string, msgId: string, text: string, rev: number) => ({
    type: "assistant_text",
    tug_session_id: tsid,
    msg_id: msgId,
    text,
    is_partial: false,
    rev,
  }),
  toolUse: (tsid: string, toolUseId: string, toolName: string, input: unknown) => ({
    type: "tool_use",
    tug_session_id: tsid,
    tool_use_id: toolUseId,
    tool_name: toolName,
    input,
  }),
  toolResult: (tsid: string, toolUseId: string, output: unknown) => ({
    type: "tool_result",
    tug_session_id: tsid,
    tool_use_id: toolUseId,
    output,
    is_error: false,
  }),
  turnCompleteSuccess: (tsid: string, msgId: string) => ({
    type: "turn_complete",
    tug_session_id: tsid,
    msg_id: msgId,
    result: "success",
  }),
  turnCompleteError: (tsid: string, msgId: string) => ({
    type: "turn_complete",
    tug_session_id: tsid,
    msg_id: msgId,
    result: "error",
  }),
  controlRequestApproval: (tsid: string, requestId: string, toolName: string) => ({
    type: "control_request_forward",
    tug_session_id: tsid,
    request_id: requestId,
    is_question: false,
    tool_name: toolName,
    input: {},
  }),
  controlRequestQuestion: (tsid: string, requestId: string, question: string) => ({
    type: "control_request_forward",
    tug_session_id: tsid,
    request_id: requestId,
    is_question: true,
    question,
    options: [],
  }),
  sessionStateErrored: (tsid: string, detail: string) => ({
    tug_session_id: tsid,
    state: "errored",
    detail,
  }),
  controlSessionUnknown: (tsid: string) => ({
    type: "error",
    detail: "session_unknown",
    tug_session_id: tsid,
  }),
} as const;

// ---------------------------------------------------------------------------
// Button config — pairs each SYNTHETIC factory with its target feed and a
// sensible default payload shape.
// ---------------------------------------------------------------------------

interface ButtonSpec {
  label: string;
  feedId: FeedIdValue;
  /** Produce the decoded payload for this button given the current session id. */
  build: (tsid: string) => unknown;
}

const BUTTON_ROWS: ReadonlyArray<{ title: string; buttons: ReadonlyArray<ButtonSpec> }> = [
  {
    title: "Session lifecycle",
    buttons: [
      {
        label: "session_init",
        feedId: FeedId.CODE_OUTPUT,
        build: (tsid) => SYNTHETIC.sessionInit(tsid, "claude-session-001"),
      },
      {
        label: "session_state errored",
        feedId: FeedId.SESSION_STATE,
        build: (tsid) => SYNTHETIC.sessionStateErrored(tsid, "mock error detail"),
      },
      {
        label: "control session_unknown",
        feedId: FeedId.CONTROL,
        build: (tsid) => SYNTHETIC.controlSessionUnknown(tsid),
      },
    ],
  },
  {
    title: "Assistant output",
    buttons: [
      {
        label: "assistant_text partial",
        feedId: FeedId.CODE_OUTPUT,
        build: (tsid) =>
          SYNTHETIC.assistantPartial(tsid, "msg-001", "Partial streaming text…", 0, 0),
      },
      {
        label: "assistant_text final",
        feedId: FeedId.CODE_OUTPUT,
        build: (tsid) =>
          SYNTHETIC.assistantFinal(tsid, "msg-001", "Final assistant text.", 0),
      },
    ],
  },
  {
    title: "Tools",
    buttons: [
      {
        label: "tool_use",
        feedId: FeedId.CODE_OUTPUT,
        build: (tsid) =>
          SYNTHETIC.toolUse(tsid, "tool-001", "read_file", {
            path: "/tmp/example.txt",
          }),
      },
      {
        label: "tool_result",
        feedId: FeedId.CODE_OUTPUT,
        build: (tsid) =>
          SYNTHETIC.toolResult(tsid, "tool-001", "fixture tool output"),
      },
    ],
  },
  {
    title: "Turn completion",
    buttons: [
      {
        label: "turn_complete success",
        feedId: FeedId.CODE_OUTPUT,
        build: (tsid) => SYNTHETIC.turnCompleteSuccess(tsid, "msg-001"),
      },
      {
        label: "turn_complete error",
        feedId: FeedId.CODE_OUTPUT,
        build: (tsid) => SYNTHETIC.turnCompleteError(tsid, "msg-001"),
      },
    ],
  },
  {
    title: "Approvals & questions",
    buttons: [
      {
        label: "control approval",
        feedId: FeedId.CONTROL,
        build: (tsid) =>
          SYNTHETIC.controlRequestApproval(tsid, "req-001", "write_file"),
      },
      {
        label: "control question",
        feedId: FeedId.CONTROL,
        build: (tsid) =>
          SYNTHETIC.controlRequestQuestion(tsid, "req-002", "Proceed?"),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Happy-path chain
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHappyPath(services: MockServices): Promise<void> {
  const tsid = GALLERY_TUG_SESSION_ID;
  const conn = services.connection;
  const store = services.codeSessionStore;

  conn.dispatchDecoded(
    FeedId.CODE_OUTPUT,
    SYNTHETIC.sessionInit(tsid, "claude-session-happy"),
  );
  await delay(120);

  store.send("hello from the gallery sandbox", []);
  await delay(120);

  conn.dispatchDecoded(
    FeedId.CODE_OUTPUT,
    SYNTHETIC.assistantPartial(tsid, "msg-happy", "Hi — ", 0, 0),
  );
  await delay(200);

  conn.dispatchDecoded(
    FeedId.CODE_OUTPUT,
    SYNTHETIC.assistantPartial(tsid, "msg-happy", "Hi — working on it.", 1, 1),
  );
  await delay(200);

  conn.dispatchDecoded(
    FeedId.CODE_OUTPUT,
    SYNTHETIC.assistantFinal(
      tsid,
      "msg-happy",
      "Hi — working on it. Done.",
      2,
    ),
  );
  await delay(120);

  conn.dispatchDecoded(
    FeedId.CODE_OUTPUT,
    SYNTHETIC.turnCompleteSuccess(tsid, "msg-happy"),
  );
}

// ---------------------------------------------------------------------------
// Sandbox component
// ---------------------------------------------------------------------------

export function GalleryPromptEntrySandbox() {
  const [services, setServices] = useState<MockServices>(() => buildMockServices());
  const [resetCount, setResetCount] = useState(0);

  // Track the latest services in a ref so the unmount cleanup sees the
  // current instance even if `setServices` has replaced the state since
  // the effect last ran.
  const servicesRef = useRef(services);
  useEffect(() => {
    servicesRef.current = services;
  }, [services]);

  useEffect(() => {
    return () => {
      servicesRef.current.codeSessionStore.dispose();
    };
  }, []);

  const handleReset = useCallback(() => {
    servicesRef.current.codeSessionStore.dispose();
    const fresh = buildMockServices();
    setServices(fresh);
    setResetCount((n) => n + 1);
  }, []);

  const handleHappyPath = useCallback(() => {
    // Fire-and-forget — the chain sleeps internally so state transitions
    // are observable; we don't need to await the final completion.
    void runHappyPath(services);
  }, [services]);

  const handleDispatch = useCallback(
    (spec: ButtonSpec) => {
      services.connection.dispatchDecoded(
        spec.feedId,
        spec.build(GALLERY_TUG_SESSION_ID),
      );
    },
    [services],
  );

  const entryId = useMemo(
    () => `gallery-prompt-entry-sandbox-${resetCount}`,
    [resetCount],
  );

  return (
    <div
      className="gallery-prompt-entry-sandbox-card"
      data-testid="gallery-prompt-entry-sandbox"
    >
      <div className="gallery-prompt-entry-sandbox-driver">
        <div className="gallery-prompt-entry-sandbox-row">
          <TugPushButton size="sm" onClick={handleHappyPath}>
            Run happy path
          </TugPushButton>
          <TugPushButton size="sm" emphasis="outlined" onClick={handleReset}>
            Reset store
          </TugPushButton>
        </div>
        {BUTTON_ROWS.map((row) => (
          <div className="gallery-prompt-entry-sandbox-row" key={row.title}>
            <TugLabel size="2xs" color="muted">
              {row.title}
            </TugLabel>
            {row.buttons.map((spec) => (
              <TugPushButton
                key={spec.label}
                size="sm"
                emphasis="ghost"
                onClick={() => handleDispatch(spec)}
                data-testid={`sandbox-btn-${spec.label}`}
              >
                {spec.label}
              </TugPushButton>
            ))}
          </div>
        ))}
      </div>

      <div className="gallery-prompt-entry-sandbox-entry">
        <TugPromptEntry
          key={resetCount}
          id={entryId}
          codeSessionStore={services.codeSessionStore}
          sessionMetadataStore={services.sessionMetadataStore}
          historyStore={services.historyStore}
          fileCompletionProvider={services.fileCompletionProvider}
        />
      </div>
    </div>
  );
}
