/**
 * TugWorkerPool — typed worker pool for parallel computation across cores.
 *
 * Patterns adopted from MIT-licensed libraries per [L21]:
 *   - threads.js (Andy Wermke): thenable task handle, discriminated union protocol, init handshake
 *   - poolifier-web-worker (Jerome Benoit): least-busy dispatch, promise-response-map RPC
 *   - greenlet (Jason Miller): counter-based task IDs, automatic transferable detection
 *
 * See THIRD_PARTY_NOTICES.md for copyright notices.
 */

// ---------------------------------------------------------------------------
// Message protocol — discriminated union (W17)
// ---------------------------------------------------------------------------

/** Message sent from pool (main thread) to a worker. */
export type MainToWorkerMessage<TReq> =
  | { taskId: number; type: "task"; payload: TReq }
  | { type: "cancel"; taskId: number };

/** Message sent from a worker back to the pool (main thread). */
export type WorkerToMainMessage<TRes> =
  | { taskId: number; type: "result"; payload: TRes }
  | { taskId: number; type: "error"; error: { message: string; stack?: string; name: string } }
  | { type: "init" };

// ---------------------------------------------------------------------------
// TaskHandle — thenable with cancellation (from threads.js)
// ---------------------------------------------------------------------------

/** Handle returned by submit(). Awaitable and cancellable. */
export interface TaskHandle<TRes> extends PromiseLike<TRes> {
  /** Underlying promise — resolves with the worker result or rejects on error/cancel. */
  readonly promise: Promise<TRes>;
  /** Cancel the task. Removes it from the queue or signals the worker. */
  cancel(): void;
}

// ---------------------------------------------------------------------------
// Pool options
// ---------------------------------------------------------------------------

export interface TugWorkerPoolOptions<TReq, TRes> {
  /** Number of workers to spawn. Default: Math.max(1, Math.min((hardwareConcurrency || 4) - 2, 12)). */
  poolSize?: number;
  /** Milliseconds to wait for worker init handshake. Default: 5000. */
  initTimeoutMs?: number;
  /** Milliseconds of idle time before a worker is terminated. Default: 30000. */
  idleTimeoutMs?: number;
  /**
   * Fallback handler for environments where Worker construction fails (e.g. CSP, tests).
   * When provided, tasks run inline via queueMicrotask instead of in a worker thread.
   */
  fallbackHandler?: (req: TReq) => TRes | Promise<TRes>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PendingTask<TRes> {
  taskId: number;
  resolve: (value: TRes) => void;
  reject: (reason: unknown) => void;
  cancelled: boolean;
}

interface WorkerSlot<TReq, TRes> {
  worker: Worker;
  inFlight: number;
  /** Tasks sent to this worker, keyed by taskId. */
  pending: Map<number, PendingTask<TRes>>;
  /** Whether the worker has sent its init message. */
  ready: boolean;
  /** Queue of tasks waiting for this worker to become ready. */
  readyQueue: Array<{ msg: MainToWorkerMessage<TReq>; task: PendingTask<TRes> }>;
  /** Idle timer handle. */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Init handshake timeout handle. */
  initTimer: ReturnType<typeof setTimeout> | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default pool size: hardwareConcurrency - 2, clamped to [1, 12]. */
function defaultPoolSize(): number {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(cores - 2, 12));
}

/**
 * Collect transferable objects from a value (from greenlet).
 *
 * Short-circuits immediately for primitive and string payloads — the most
 * common case for markdown worker messages (lex/parse requests are plain
 * objects with string fields, not ArrayBuffers). Profiling under real markdown
 * payloads showed the tree-walk is measurable for deeply-nested objects but
 * negligible for strings and numbers; the short-circuit eliminates it entirely
 * for the common case.
 */
function collectTransferables(value: unknown): Transferable[] {
  // Fast path: primitives and strings never contain transferables.
  if (value === null || value === undefined) return [];
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "bigint") return [];

  const result: Transferable[] = [];
  if (value instanceof ArrayBuffer) {
    result.push(value);
  } else if (value instanceof MessagePort) {
    result.push(value);
  } else if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
    result.push(value);
  } else if (t === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      result.push(...collectTransferables(v));
    }
  }
  return result;
}

/** Serialize an error to a plain object for cross-thread transfer. Worker files can import this. */
export function serializeError(err: unknown): { message: string; stack?: string; name: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack, name: err.name };
  }
  return { message: String(err), name: "Error" };
}

// ---------------------------------------------------------------------------
// TugWorkerPool
// ---------------------------------------------------------------------------

/**
 * Factory function that creates a Worker instance.
 *
 * Vite requires static analysis to detect worker entry points. Using a factory
 * keeps the `new Worker()` call at the import site where Vite can see it:
 *
 *   import MyWorker from './my-worker?worker';
 *   const pool = new TugWorkerPool<Req, Res>(() => new MyWorker());
 *
 * In test environments (bun), a URL-based factory also works:
 *
 *   const url = new URL('./my-worker.ts', import.meta.url);
 *   const pool = new TugWorkerPool<Req, Res>(() => new Worker(url, { type: 'module' }));
 */
export type WorkerFactory = () => Worker;

/**
 * Typed worker pool that spreads computation across multiple cores.
 *
 * Usage:
 *   import MyWorker from './worker?worker';
 *   const pool = new TugWorkerPool<Req, Res>(() => new MyWorker());
 *   const handle = pool.submit(req);
 *   const result = await handle;      // thenable
 *   const result2 = await handle.promise;  // explicit
 *   handle.cancel();                  // cancel pending/in-flight
 *   pool.terminate();                 // shut down all workers
 */
export class TugWorkerPool<TReq, TRes> {
  private readonly _workerFactory: WorkerFactory;
  private readonly _poolSize: number;
  private readonly _initTimeoutMs: number;
  private readonly _idleTimeoutMs: number;
  private readonly _fallbackHandler?: (req: TReq) => TRes | Promise<TRes>;

  private _slots: Array<WorkerSlot<TReq, TRes>> = [];
  private _taskCounter = 0;
  /** Whether we've attempted to spawn workers. */
  private _spawned = false;
  /** True after terminate() is called. */
  private _terminated = false;
  /** Whether workers are running inline (fallback mode). */
  private _fallbackMode = false;
  /** All pending fallback tasks (for terminate()). */
  private _fallbackTasks: Map<number, PendingTask<TRes>> = new Map();

  constructor(workerFactory: WorkerFactory, options?: TugWorkerPoolOptions<TReq, TRes>) {
    this._workerFactory = workerFactory;
    this._poolSize = options?.poolSize ?? defaultPoolSize();
    this._initTimeoutMs = options?.initTimeoutMs ?? 5000;
    this._idleTimeoutMs = options?.idleTimeoutMs ?? 30000;
    this._fallbackHandler = options?.fallbackHandler;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** The configured number of workers (from options.poolSize or defaultPoolSize()). */
  get poolSize(): number {
    return this._poolSize;
  }

  /**
   * Submit a task to the pool. Returns a TaskHandle that is thenable and
   * has a .cancel() method.
   */
  submit(req: TReq): TaskHandle<TRes> {
    if (this._terminated) {
      const promise = Promise.reject(new Error("TugWorkerPool: pool has been terminated"));
      promise.catch(() => {}); // suppress unhandled rejection
      return this._makeHandle(promise, () => {});
    }

    // Lazy spawn on first submit.
    if (!this._spawned) {
      this._spawn();
    }

    const taskId = ++this._taskCounter;

    if (this._fallbackMode) {
      return this._submitFallback(taskId, req);
    }

    return this._submitToWorker(taskId, req);
  }

  /** Terminate all workers and reject all pending promises. */
  terminate(): void {
    if (this._terminated) return;
    this._terminated = true;

    // Reject fallback tasks.
    const err = new Error("TugWorkerPool: pool terminated");
    for (const task of this._fallbackTasks.values()) {
      if (!task.cancelled) {
        task.reject(err);
      }
    }
    this._fallbackTasks.clear();

    // Terminate workers and reject their pending tasks.
    for (const slot of this._slots) {
      if (slot.initTimer !== null) {
        clearTimeout(slot.initTimer);
        slot.initTimer = null;
      }
      if (slot.idleTimer !== null) {
        clearTimeout(slot.idleTimer);
        slot.idleTimer = null;
      }
      for (const task of slot.pending.values()) {
        if (!task.cancelled) {
          task.reject(err);
        }
      }
      slot.pending.clear();
      slot.readyQueue.length = 0;
      try {
        slot.worker.terminate();
      } catch {
        // ignore
      }
    }
    this._slots = [];
  }

  // -------------------------------------------------------------------------
  // Spawn
  // -------------------------------------------------------------------------

  private _spawn(): void {
    this._spawned = true;

    // poolSize of 0 with a fallbackHandler means "always run inline."
    // Also use fallback if Worker global is unavailable.
    if (this._poolSize === 0 || typeof Worker === "undefined") {
      if (this._fallbackHandler) {
        this._fallbackMode = true;
      }
      return;
    }

    // Per-slot lazy respawn: start with one worker and grow as demand arrives.
    // Profiling under scroll-burst patterns showed that spawning all N workers
    // simultaneously after idle termination causes a brief latency spike when
    // only one task is in flight. Lazy respawn spreads the startup cost across
    // successive submits, keeping the first task's dispatch latency minimal.
    try {
      const slot = this._createSlot();
      this._slots.push(slot);
    } catch {
      // Worker construction failed — switch to fallback mode.
      this._fallbackMode = true;
      this._slots = [];
    }
  }

  /**
   * Grow the pool by one slot if we are under capacity.
   * Called from _submitToWorker when all existing slots are busy, allowing
   * the pool to expand up to _poolSize on demand rather than at spawn time.
   */
  private _growIfNeeded(): void {
    if (this._slots.length >= this._poolSize) return;
    try {
      const slot = this._createSlot();
      this._slots.push(slot);
    } catch {
      // Growth failed — continue with existing slots.
    }
  }

  private _createSlot(): WorkerSlot<TReq, TRes> {
    // This may throw if Worker is not available or CSP blocks it.
    const worker = this._workerFactory();

    const slot: WorkerSlot<TReq, TRes> = {
      worker,
      inFlight: 0,
      pending: new Map(),
      ready: false,
      readyQueue: [],
      idleTimer: null,
      initTimer: null,
    };

    worker.onmessage = (e: MessageEvent<WorkerToMainMessage<TRes>>) => {
      this._onWorkerMessage(slot, e.data);
    };

    worker.onerror = (e: ErrorEvent) => {
      // Reject all in-flight tasks for this slot.
      const err = new Error(e.message || "Worker error");
      for (const task of slot.pending.values()) {
        if (!task.cancelled) {
          task.reject(err);
        }
      }
      slot.pending.clear();
      slot.inFlight = 0;

      // Terminate the broken worker and remove the slot from the pool.
      // A worker that has errored may be in a corrupt state — subsequent
      // tasks dispatched to it could silently fail.
      if (slot.initTimer !== null) {
        clearTimeout(slot.initTimer);
        slot.initTimer = null;
      }
      if (slot.idleTimer !== null) {
        clearTimeout(slot.idleTimer);
        slot.idleTimer = null;
      }
      try {
        slot.worker.terminate();
      } catch {
        // ignore
      }
      const idx = this._slots.indexOf(slot);
      if (idx >= 0) {
        this._slots.splice(idx, 1);
      }
      // Allow re-spawn on next submit if all slots are gone.
      if (this._slots.length === 0) {
        if (this._fallbackHandler) {
          this._fallbackMode = true;
          console.warn("[TugWorkerPool] All workers failed — switching to fallback mode");
        } else {
          this._spawned = false;
        }
      }
    };

    // Set up init timeout.
    slot.initTimer = setTimeout(() => {
      if (!slot.ready) {
        // Treat as ready anyway — some workers may not send init.
        slot.ready = true;
        slot.initTimer = null;
        this._flushReadyQueue(slot);
      }
    }, this._initTimeoutMs);

    return slot;
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  private _onWorkerMessage(slot: WorkerSlot<TReq, TRes>, msg: WorkerToMainMessage<TRes>): void {
    if (msg.type === "init") {
      if (slot.initTimer !== null) {
        clearTimeout(slot.initTimer);
        slot.initTimer = null;
      }
      slot.ready = true;
      this._flushReadyQueue(slot);
      return;
    }

    const task = slot.pending.get(msg.taskId);
    if (!task) return; // Already cancelled or unknown.

    slot.pending.delete(msg.taskId);
    slot.inFlight = Math.max(0, slot.inFlight - 1);

    if (!task.cancelled) {
      if (msg.type === "result") {
        task.resolve(msg.payload);
      } else if (msg.type === "error") {
        const err = Object.assign(new Error(msg.error.message), {
          name: msg.error.name,
          stack: msg.error.stack,
        });
        task.reject(err);
      }
    }

    this._scheduleIdleTimeout(slot);
  }

  private _flushReadyQueue(slot: WorkerSlot<TReq, TRes>): void {
    const queue = slot.readyQueue.splice(0);
    for (const { msg, task } of queue) {
      if (!task.cancelled) {
        this._postToSlot(slot, msg, task);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  private _submitToWorker(taskId: number, req: TReq): TaskHandle<TRes> {
    let resolve!: (v: TRes) => void;
    let reject!: (r: unknown) => void;
    const promise = new Promise<TRes>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Suppress unhandled-rejection warnings for cancellation and other synchronous
    // rejections. Callers still see the rejection when they await handle.promise.
    promise.catch(() => {});

    const task: PendingTask<TRes> = { taskId, resolve, reject, cancelled: false };
    const msg: MainToWorkerMessage<TReq> = { taskId, type: "task", payload: req };

    // Grow the pool on demand before picking a slot (per-slot lazy respawn).
    // If every current slot is busy, add one more worker up to _poolSize.
    if (this._slots.every((s) => s.inFlight > 0)) {
      this._growIfNeeded();
    }

    // Pick least-busy slot (from poolifier-web-worker).
    const slot = this._leastBusySlot();

    // Clear idle timer — this slot is now active.
    if (slot.idleTimer !== null) {
      clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
    }

    slot.inFlight++;
    slot.pending.set(taskId, task);

    if (slot.ready) {
      this._postToSlot(slot, msg, task);
    } else {
      slot.readyQueue.push({ msg, task });
    }

    const cancel = () => {
      if (task.cancelled) return;
      task.cancelled = true;
      // Remove from pending map.
      slot.pending.delete(taskId);
      slot.inFlight = Math.max(0, slot.inFlight - 1);
      // Signal worker (it may be mid-processing).
      if (slot.ready) {
        try {
          slot.worker.postMessage({ type: "cancel", taskId } satisfies MainToWorkerMessage<TReq>);
        } catch {
          // ignore
        }
      } else {
        // Remove from ready queue.
        const idx = slot.readyQueue.findIndex((e) => e.task.taskId === taskId);
        if (idx >= 0) slot.readyQueue.splice(idx, 1);
      }
      reject(new Error("TugWorkerPool: task cancelled"));
      this._scheduleIdleTimeout(slot);
    };

    return this._makeHandle(promise, cancel);
  }

  private _leastBusySlot(): WorkerSlot<TReq, TRes> {
    let best = this._slots[0];
    for (let i = 1; i < this._slots.length; i++) {
      if (this._slots[i].inFlight < best.inFlight) {
        best = this._slots[i];
      }
    }
    return best;
  }

  private _postToSlot(
    slot: WorkerSlot<TReq, TRes>,
    msg: MainToWorkerMessage<TReq>,
    task: PendingTask<TRes>,
  ): void {
    const transferables = msg.type === "task" ? collectTransferables(msg.payload) : [];
    try {
      slot.worker.postMessage(msg, transferables);
    } catch {
      if (!task.cancelled) {
        task.reject(new Error("TugWorkerPool: postMessage failed"));
        slot.pending.delete(task.taskId);
        slot.inFlight = Math.max(0, slot.inFlight - 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Idle timeout (W14)
  // -------------------------------------------------------------------------

  private _scheduleIdleTimeout(slot: WorkerSlot<TReq, TRes>): void {
    if (slot.inFlight > 0 || slot.readyQueue.length > 0) return;
    if (slot.idleTimer !== null) return;

    slot.idleTimer = setTimeout(() => {
      // Terminate this worker if it's still idle.
      if (slot.inFlight === 0 && slot.readyQueue.length === 0) {
        slot.idleTimer = null;
        // Remove from slots array and terminate.
        const idx = this._slots.indexOf(slot);
        if (idx >= 0) {
          this._slots.splice(idx, 1);
        }
        try {
          slot.worker.terminate();
        } catch {
          // ignore
        }
        // Mark pool as no longer spawned so next submit re-spawns.
        if (this._slots.length === 0) {
          this._spawned = false;
        }
      }
    }, this._idleTimeoutMs);
  }

  // -------------------------------------------------------------------------
  // Fallback (inline) mode (W16)
  // -------------------------------------------------------------------------

  private _submitFallback(taskId: number, req: TReq): TaskHandle<TRes> {
    const handler = this._fallbackHandler;
    if (!handler) {
      const err = new Error(
        "TugWorkerPool: Worker construction failed and no fallbackHandler provided",
      );
      const promise = Promise.reject(err);
      promise.catch(() => {});
      return this._makeHandle(promise, () => {});
    }

    let resolve!: (v: TRes) => void;
    let reject!: (r: unknown) => void;
    const promise = new Promise<TRes>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Suppress unhandled-rejection warnings.
    promise.catch(() => {});

    const task: PendingTask<TRes> = { taskId, resolve, reject, cancelled: false };
    this._fallbackTasks.set(taskId, task);

    queueMicrotask(async () => {
      if (task.cancelled) return;
      try {
        const result = await handler(req);
        if (!task.cancelled) {
          this._fallbackTasks.delete(taskId);
          resolve(result);
        }
      } catch (err) {
        if (!task.cancelled) {
          this._fallbackTasks.delete(taskId);
          reject(err);
        }
      }
    });

    const cancel = () => {
      if (task.cancelled) return;
      task.cancelled = true;
      this._fallbackTasks.delete(taskId);
      reject(new Error("TugWorkerPool: task cancelled"));
    };

    return this._makeHandle(promise, cancel);
  }

  // -------------------------------------------------------------------------
  // TaskHandle factory
  // -------------------------------------------------------------------------

  private _makeHandle(promise: Promise<TRes>, cancel: () => void): TaskHandle<TRes> {
    const handle: TaskHandle<TRes> = {
      promise,
      cancel,
      then<TResult1 = TRes, TResult2 = never>(
        onfulfilled?: ((value: TRes) => TResult1 | PromiseLike<TResult1>) | null | undefined,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
      ): Promise<TResult1 | TResult2> {
        return promise.then(onfulfilled, onrejected);
      },
    };
    return handle;
  }
}
