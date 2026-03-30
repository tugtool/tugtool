/**
 * Echo worker for TugWorkerPool integration tests.
 *
 * Receives task messages and posts the payload straight back as the result.
 * Handles cancellation messages by ignoring them (echo is instant).
 */

interface EchoTaskMessage {
  taskId: number;
  type: "task";
  payload: unknown;
}

interface EchoCancelMessage {
  type: "cancel";
  taskId: number;
}

type InboundMessage = EchoTaskMessage | EchoCancelMessage;

self.onmessage = (e: MessageEvent<InboundMessage>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    // Nothing to cancel — echo is synchronous.
    return;
  }
  if (msg.type === "task") {
    self.postMessage({ taskId: msg.taskId, type: "result", payload: msg.payload });
  }
};

// Signal that the worker is ready.
self.postMessage({ type: "init" });
