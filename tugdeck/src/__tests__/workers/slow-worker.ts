/**
 * Slow worker for TugWorkerPool multi-slot dispatch tests.
 *
 * Accepts task payloads of the shape { delayMs: number; value: number }.
 * Sleeps for delayMs milliseconds then resolves with value.
 * Used to verify that least-busy dispatch routes a fast task to a different
 * slot than the slow tasks, allowing it to complete first.
 */

interface SlowTaskPayload {
  delayMs: number;
  value: number;
}

interface SlowTaskMessage {
  taskId: number;
  type: "task";
  payload: SlowTaskPayload;
}

interface CancelMessage {
  type: "cancel";
  taskId: number;
}

type InboundMessage = SlowTaskMessage | CancelMessage;

const cancelledTasks = new Set<number>();

self.onmessage = (e: MessageEvent<InboundMessage>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelledTasks.add(msg.taskId);
    return;
  }
  if (msg.type === "task") {
    const { taskId, payload } = msg;
    setTimeout(() => {
      if (!cancelledTasks.has(taskId)) {
        self.postMessage({ taskId, type: "result", payload: payload.value });
      }
      cancelledTasks.delete(taskId);
    }, payload.delayMs);
  }
};

// Signal that the worker is ready.
self.postMessage({ type: "init" });
