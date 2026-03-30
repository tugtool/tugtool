/**
 * Delayed-init worker for TugWorkerPool init-timeout tests.
 *
 * Waits 200ms before sending the { type: 'init' } handshake message,
 * then processes tasks normally. Used to verify that:
 *   1. Tasks submitted before init are queued in the readyQueue.
 *   2. When the init message arrives (or init timeout fires), queued tasks
 *      are flushed and complete successfully.
 *
 * The pool under test should be configured with initTimeoutMs > 200ms so the
 * real init message fires first, or initTimeoutMs < 200ms to exercise the
 * timeout-fires-first path.
 */

interface EchoTaskMessage {
  taskId: number;
  type: "task";
  payload: unknown;
}

interface CancelMessage {
  type: "cancel";
  taskId: number;
}

type InboundMessage = EchoTaskMessage | CancelMessage;

// Buffer incoming messages received before init is sent.
const buffered: EchoTaskMessage[] = [];
let initSent = false;

function processTask(msg: EchoTaskMessage): void {
  self.postMessage({ taskId: msg.taskId, type: "result", payload: msg.payload });
}

self.onmessage = (e: MessageEvent<InboundMessage>) => {
  const msg = e.data;
  if (msg.type === "cancel") return;
  if (msg.type === "task") {
    if (!initSent) {
      // Hold the task until init is sent — simulates the pool flushing the readyQueue.
      buffered.push(msg);
    } else {
      processTask(msg);
    }
  }
};

// Delay the init message so the pool accumulates tasks in its readyQueue.
setTimeout(() => {
  initSent = true;
  self.postMessage({ type: "init" });
  // Flush buffered tasks (tasks received before init was sent to this worker).
  for (const msg of buffered) {
    processTask(msg);
  }
  buffered.length = 0;
}, 200);
