/// <reference lib="webworker" />

/**
 * `sparkline-render-worker` — paints every sparkline tape off the main thread.
 *
 * ## Why this exists as a worker
 *
 * The tape's motion was never the cost: the scroll is one WAAPI transform the
 * compositor runs on its own. The cost was the four-times-a-second geometry
 * write. Setting `points` on an SVG polyline invalidates style and schedules a
 * rendering update, so every live tape charged the main thread 4Hz whether or
 * not anything about the picture had changed — measured at 8 writes per second
 * for the two gauge rows alone, on a deck whose rendering updates cost ~10ms
 * each.
 *
 * `OffscreenCanvas` only goes off-thread when *owned* by a worker. The main
 * thread transfers control of each tape's canvas here at mount; from then on a
 * sample is one `postMessage` and the drawing, the tape array, and the pruning
 * all live on this thread. The canvas commits straight to the compositor
 * without waking the page.
 *
 * ## What stays on the main thread
 *
 * Everything that needs the DOM or the stores: the sample timer, the dormancy
 * protocol, the WAAPI scroll, the `IntersectionObserver` visibility gate,
 * reading `getSeries`, and resolving colors from computed style. This worker
 * is a pen, not a policy.
 *
 * ## Wire protocol
 *
 * One shared worker instance for all tapes, keyed by `id`. The HOT path is
 * one-directional by design — a reply on every sample would put the main
 * thread back in the loop it was taken out of. Rebase paints alone carry an
 * `ack`, and they are the only messages this thread answers.
 *
 *  - `init`     transfer the canvas and fix the geometry
 *  - `tape`     the whole tape plus the epoch origin — draw it
 *  - `colors`   theme or dominant-channel change
 *  - `dispose`  drop the entry
 *
 * The one outbound message is `painted`, posted at the END of the `tape`
 * handler when that message carried an `ack`. By then `paint()` has returned
 * and the `OffscreenCanvas` commit for this task is queued, so the main thread
 * may move the scroll knowing the pixels for the new origin exist. That
 * ordering is the whole point: move the transform first and the viewport
 * shows the new position over the previous epoch's pixels.
 *
 * Every draw carries the WHOLE tape rather than appending a sample, and `t0`
 * rides along rather than being stored. Both are deliberate: the main thread
 * owns the tape and the epoch origin (the same number the WAAPI translate is
 * measured from), so shipping them together makes it impossible for the two
 * threads to hold different pictures. The tape is at most a few dozen points
 * at 4Hz — a structured clone of that is far below the cost of the style
 * invalidation this replaces, and it buys away a whole class of divergence.
 *
 * Laws: [L06] appearance is painted, never React state; [L13] the motion is
 *       still the compositor's transform — this thread draws, it does not
 *       animate.
 *
 * @module lib/workers/sparkline-render-worker
 */

import {
  drawSparkline,
  pruneSparklineTape,
  type SparklineColors,
  type SparklineGeometry,
  type SparklinePoint,
} from "../sparkline-geometry";

export type SparklineWorkerRequest =
  | ({
      kind: "init";
      id: number;
      canvas: OffscreenCanvas;
      colors: SparklineColors;
    } & SparklineGeometry)
  | {
      kind: "tape";
      id: number;
      points: SparklinePoint[];
      t0: number;
      now: number;
      /** Present only on a rebase paint; answered with `painted`. */
      ack?: number;
    }
  | { kind: "colors"; id: number; colors: SparklineColors; t0: number }
  | { kind: "dispose"; id: number };

/** The worker's only outbound message. See the wire protocol above. */
export type SparklineWorkerResponse = { kind: "painted"; id: number; ack: number };

interface Entry {
  ctx: OffscreenCanvasRenderingContext2D;
  geo: SparklineGeometry;
  colors: SparklineColors;
  tape: SparklinePoint[];
}

const entries = new Map<number, Entry>();

function paint(entry: Entry, t0: number): void {
  drawSparkline(entry.ctx, entry.geo, entry.colors, entry.tape, t0);
}

self.onmessage = (event: MessageEvent<SparklineWorkerRequest>): void => {
  const msg = event.data;
  if (msg.kind === "init") {
    const ctx = msg.canvas.getContext("2d");
    if (ctx === null) return;
    const { kind, id, canvas, colors, ...geo } = msg;
    void kind;
    void canvas;
    entries.set(id, { ctx, geo, colors, tape: [] });
    return;
  }

  const entry = entries.get(msg.id);
  if (entry === undefined) return;

  switch (msg.kind) {
    case "tape": {
      entry.tape = msg.points;
      pruneSparklineTape(entry.tape, msg.now, entry.geo.retainMs);
      paint(entry, msg.t0);
      // After the draw, so the commit for this task is already queued.
      if (msg.ack !== undefined) {
        const painted: SparklineWorkerResponse = {
          kind: "painted",
          id: msg.id,
          ack: msg.ack,
        };
        self.postMessage(painted);
      }
      return;
    }
    case "colors":
      entry.colors = msg.colors;
      paint(entry, msg.t0);
      return;
    case "dispose":
      entries.delete(msg.id);
      return;
  }
};
