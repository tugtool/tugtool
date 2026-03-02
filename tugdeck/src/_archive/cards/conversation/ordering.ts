/**
 * Message ordering buffer and deduplication
 *
 * Implements the message identity model from Spec S04:
 * - Ensures messages are delivered in seq order
 * - Deduplicates messages by (msg_id, seq) pairs
 * - Handles out-of-order delivery with buffer and timeout
 * - Passes through non-sequenced events immediately
 */

import type { ConversationEvent } from "./types.ts";

/** Gap timeout in milliseconds (5 seconds) */
const GAP_TIMEOUT_MS = 5000;

/**
 * Check if an event has message identity fields (msg_id and seq)
 */
function hasMessageIdentity(
  event: ConversationEvent
): event is ConversationEvent & { msg_id: string; seq: number } {
  return "msg_id" in event && "seq" in event;
}

/**
 * Message ordering buffer with deduplication and gap timeout
 */
export class MessageOrderingBuffer {
  private nextExpectedSeq: number = 0;
  private buffer: Map<number, ConversationEvent> = new Map();
  private seen: Set<string> = new Set();
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private onMessage: (event: ConversationEvent) => void;
  private onResync: () => void;

  constructor(
    onMessage: (event: ConversationEvent) => void,
    onResync: () => void
  ) {
    this.onMessage = onMessage;
    this.onResync = onResync;
  }

  /**
   * Push an event into the ordering buffer
   *
   * - Events without seq (protocol_ack, session_init, error) pass through immediately
   * - Events with seq are ordered and deduplicated
   * - Partial updates (same msg_id+seq, higher rev) are always delivered
   */
  push(event: ConversationEvent): void {
    // Pass through non-sequenced events immediately
    if (!hasMessageIdentity(event)) {
      this.onMessage(event);
      return;
    }

    const { msg_id, seq } = event;
    const dedupKey = `${msg_id}:${seq}`;

    // Handle partial updates: same msg_id+seq, check if higher rev
    const isPartialUpdate =
      "rev" in event &&
      typeof event.rev === "number" &&
      "is_partial" in event &&
      event.is_partial === true;

    // Deduplicate (but allow partial updates through)
    if (this.seen.has(dedupKey)) {
      if (!isPartialUpdate) {
        return; // Drop duplicate
      }
      // Partial updates pass through even if already seen
    } else {
      this.seen.add(dedupKey);
    }

    // Check if this is the next expected message
    if (seq === this.nextExpectedSeq) {
      this.deliver(event);
      // Partial updates don't increment seq (we wait for the final message)
      if (!isPartialUpdate) {
        this.nextExpectedSeq++;
        this.flushBuffer();
      }
    } else if (seq > this.nextExpectedSeq) {
      // Out of order - buffer it
      this.buffer.set(seq, event);
      this.startGapTimer();
    }
    // If seq < nextExpectedSeq, drop (stale/duplicate)
  }

  /**
   * Deliver an event to the consumer
   */
  private deliver(event: ConversationEvent): void {
    this.onMessage(event);
  }

  /**
   * Flush buffered messages that are now in order
   */
  private flushBuffer(): void {
    while (this.buffer.has(this.nextExpectedSeq)) {
      const event = this.buffer.get(this.nextExpectedSeq)!;
      this.buffer.delete(this.nextExpectedSeq);
      this.deliver(event);
      this.nextExpectedSeq++;
    }

    // If buffer is now empty, clear gap timer
    if (this.buffer.size === 0 && this.gapTimer !== null) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
  }

  /**
   * Start gap timeout timer
   */
  private startGapTimer(): void {
    if (this.gapTimer !== null) {
      return; // Already running
    }

    this.gapTimer = setTimeout(() => {
      // Gap timeout expired - skip the gap
      if (this.buffer.size > 0) {
        const bufferedSeqs = Array.from(this.buffer.keys()).sort((a, b) => a - b);
        const lowestBuffered = bufferedSeqs[0];

        // Skip to the lowest buffered seq
        this.nextExpectedSeq = lowestBuffered;
        this.flushBuffer();

        // Trigger resync callback
        this.onResync();
      }

      this.gapTimer = null;
    }, GAP_TIMEOUT_MS);
  }

  /**
   * Reset the buffer state
   */
  reset(): void {
    this.nextExpectedSeq = 0;
    this.buffer.clear();
    this.seen.clear();

    if (this.gapTimer !== null) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
  }
}
