/**
 * TugbankClient — in-memory cache of tugbank domain snapshots
 * populated via the DEFAULTS WebSocket feed (FeedId 0x50).
 *
 * On WebSocket connect, tugcast pushes a single aggregated DEFAULTS frame
 * containing ALL domain snapshots. This frame fully populates the cache.
 * Subsequent DEFAULTS frames arrive when any domain changes.
 *
 * Frame payload format (JSON):
 * ```json
 * {
 *   "domains": {
 *     "dev.tugtool.deck.layout": {
 *       "generation": 42,
 *       "entries": {
 *         "layout": {"kind": "json", "value": {...}}
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * Each entry uses the tagged-value format: {"kind": "string"|"json"|"bool"|..., "value": ...}
 * This matches the format used by the /api/defaults/ HTTP endpoints.
 */

import { FeedId } from "../protocol";
import type { TugConnection } from "../connection";

// ── Types ────────────────────────────────────────────────────────────────────

/** A tagged value as received from tugcast (same format as HTTP API). */
export interface TaggedValue {
  kind: string;
  value: unknown;
}

/** Cached domain snapshot. */
interface DomainSnapshot {
  generation: number;
  entries: Record<string, TaggedValue>;
}

/** Callback fired when a domain's snapshot changes. */
export type DomainChangedCallback = (
  domain: string,
  entries: Record<string, TaggedValue>
) => void;

// ── TugbankClient ────────────────────────────────────────────────────────────

export class TugbankClient {
  private readonly cache = new Map<string, DomainSnapshot>();
  private readonly listeners: DomainChangedCallback[] = [];
  private readyResolve: (() => void) | null = null;
  private readonly readyPromise: Promise<void>;
  private hasReceivedInitialFrame = false;

  constructor(connection: TugConnection) {
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    connection.onFrame(FeedId.DEFAULTS, (payload: Uint8Array) => {
      this.handleDefaultsFrame(payload);
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Resolves when the first DEFAULTS frame has been received and the cache
   * is fully populated. After this, all reads are synchronous.
   */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Read a tagged value from the cache.
   * Returns undefined if the domain or key doesn't exist.
   */
  get(domain: string, key: string): TaggedValue | undefined {
    return this.cache.get(domain)?.entries[key];
  }

  /**
   * Read the unwrapped value from a tagged entry.
   * Convenience: returns tagged.value directly, or undefined if not found.
   */
  getValue(domain: string, key: string): unknown {
    return this.get(domain, key)?.value;
  }

  /**
   * Read all entries for a domain.
   * Returns undefined if the domain doesn't exist in cache.
   */
  readDomain(domain: string): Record<string, TaggedValue> | undefined {
    return this.cache.get(domain)?.entries;
  }

  /** List all cached domain names. */
  listDomains(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Register a callback fired when any domain snapshot changes.
   * Returns an unsubscribe function.
   */
  onDomainChanged(callback: DomainChangedCallback): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private handleDefaultsFrame(payload: Uint8Array): void {
    let parsed: { domains?: Record<string, { generation?: number; entries?: Record<string, TaggedValue> }> };
    try {
      const text = new TextDecoder().decode(payload);
      parsed = JSON.parse(text);
    } catch (err) {
      console.warn("[TugbankClient] failed to parse DEFAULTS frame:", err);
      return;
    }

    if (!parsed.domains) {
      console.warn("[TugbankClient] DEFAULTS frame missing 'domains' key");
      return;
    }

    const changedDomains: string[] = [];

    for (const [domain, snapshot] of Object.entries(parsed.domains)) {
      const generation = snapshot.generation ?? 0;
      const entries = snapshot.entries ?? {};
      const existing = this.cache.get(domain);

      if (!existing || existing.generation < generation) {
        this.cache.set(domain, { generation, entries });
        changedDomains.push(domain);
      }
    }

    // Fire callbacks for changed domains
    for (const domain of changedDomains) {
      const entries = this.cache.get(domain)!.entries;
      for (const cb of this.listeners) {
        try {
          cb(domain, entries);
        } catch (err) {
          console.warn("[TugbankClient] callback error:", err);
        }
      }
    }

    // Resolve ready promise on first frame
    if (!this.hasReceivedInitialFrame) {
      this.hasReceivedInitialFrame = true;
      this.readyResolve?.();
      this.readyResolve = null;
    }
  }
}
