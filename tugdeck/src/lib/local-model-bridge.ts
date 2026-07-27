/**
 * `local-model-bridge.ts` — request/response client for on-device inference
 * in the macOS host.
 *
 * Tug.app exposes a `localModel` `WKScriptMessageHandler`. We post a
 * `{ v, requestId, task, … }` envelope; the host runs the task on whichever
 * backend it has — a downloaded MLX pack, or the system model on an OS that
 * ships one — and calls back
 * `window.__tugBridge.onLocalModelResult({ requestId, ok, … })`. Every request
 * carries its own id, so several can be in flight without ordering rules.
 *
 * **Everything here degrades to null.** Outside the host, with no model
 * installed, on a timeout, or on any host-side failure, the helpers resolve
 * `null` or an unavailable answer — never a throw and never a rejection.
 * Callers are meant to read that as "carry on the way you did before local
 * models existed"; a caller that has to special-case failure is a caller
 * doing it wrong.
 *
 * @module lib/local-model-bridge
 */

/** How long a request waits before the caller gives up on it. */
export const LOCAL_MODEL_TIMEOUT_MS = 1500;

/** What the host answers with. Shapes vary by task; all fields optional. */
export interface LocalModelResult {
  requestId: string;
  ok: boolean;
  done?: boolean;
  verdict?: string;
  text?: string;
  availability?: LocalModelAvailability;
  error?: string;
}

/** Whether inference can answer right now, and by what route. */
export interface LocalModelAvailability {
  ready: boolean;
  backend?: "mlx" | "foundation-models";
  reason?: string;
}

interface TugBridge {
  onLocalModelResult?: (result: LocalModelResult) => void;
}

interface WebkitHandles {
  webkit?: {
    messageHandlers?: Record<string, { postMessage: (value: unknown) => void } | undefined>;
  };
  __tugBridge?: TugBridge;
}

/** Resolvers awaiting a host callback, keyed by request id. */
const pending = new Map<string, (result: LocalModelResult | null) => void>();

/** Monotonic request-id counter — no clock, no randomness. */
let nextId = 0;

function handler(): { postMessage: (value: unknown) => void } | undefined {
  const w = globalThis as unknown as WebkitHandles;
  return w.webkit?.messageHandlers?.localModel ?? undefined;
}

/** Install the result sink once, preserving sibling bridge keys. */
function ensureBridge(): void {
  const w = globalThis as unknown as WebkitHandles;
  const bridge = (w.__tugBridge ??= {});
  if (bridge.onLocalModelResult === undefined) {
    bridge.onLocalModelResult = (result) => {
      const resolve = pending.get(result?.requestId ?? "");
      if (resolve !== undefined) {
        pending.delete(result.requestId);
        resolve(result);
      }
    };
  }
}

/** Whether the host exposes on-device inference at all. */
export function isLocalModelBridgeAvailable(): boolean {
  return handler() !== undefined;
}

/**
 * Post one task and resolve its answer, or `null` if the host is absent or
 * doesn't answer in time. A late reply for a timed-out request is dropped by
 * the sink, because its pending entry is already gone.
 */
function request(
  body: Record<string, unknown>,
  timeoutMs = LOCAL_MODEL_TIMEOUT_MS,
): Promise<LocalModelResult | null> {
  const post = handler();
  if (post === undefined) return Promise.resolve(null);
  ensureBridge();
  const requestId = `lm-${(nextId += 1)}`;
  return new Promise<LocalModelResult | null>((resolve) => {
    let settled = false;
    const finish = (result: LocalModelResult | null): void => {
      if (settled) return;
      settled = true;
      pending.delete(requestId);
      resolve(result);
    };
    pending.set(requestId, finish);
    globalThis.setTimeout(() => finish(null), timeoutMs);
    post.postMessage({ v: 1, requestId, ...body });
  });
}

/**
 * Classify one line as a shell command or a natural-language prompt.
 * `null` means "no opinion" — the caller keeps whatever it would have done.
 */
export async function requestClassify(
  text: string,
  timeoutMs?: number,
): Promise<"shell" | "prompt" | null> {
  const result = await request(
    { task: "classify", text, labels: ["shell", "prompt"] },
    timeoutMs,
  );
  if (result === null || !result.ok) return null;
  return result.verdict === "shell" || result.verdict === "prompt"
    ? result.verdict
    : null;
}

/** One-line summary of `prompt`, or `null`. Slower than classify by design. */
export async function requestSummarize(
  prompt: string,
  timeoutMs = 8000,
): Promise<string | null> {
  const result = await request({ task: "summarize", prompt }, timeoutMs);
  if (result === null || !result.ok) return null;
  const text = result.text ?? "";
  return text.length > 0 ? text : null;
}

/** Ask the host whether inference can answer, and by what route. */
export async function requestAvailability(
  timeoutMs?: number,
): Promise<LocalModelAvailability> {
  const result = await request({ task: "availability" }, timeoutMs);
  if (result === null || !result.ok || result.availability === undefined) {
    return { ready: false, reason: "host unavailable" };
  }
  return result.availability;
}

/**
 * Ask the host to load its model now, so the first real request doesn't pay
 * the load. Fire-and-forget: the answer carries nothing worth waiting for.
 */
export function prewarm(): void {
  void request({ task: "prewarm" }, 30_000);
}

/** Test-only: drop any in-flight resolvers between cases. */
export function _resetLocalModelBridgeForTest(): void {
  pending.clear();
  nextId = 0;
  const w = globalThis as unknown as WebkitHandles;
  if (w.__tugBridge !== undefined) delete w.__tugBridge.onLocalModelResult;
}
