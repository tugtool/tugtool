/**
 * TugbankClient — WebSocket-backed cache for tugbank defaults.
 *
 * Subscribes to FeedId.DEFAULTS (0x50) frames from the server. Each frame
 * carries a full snapshot of one or more domains. The client caches the
 * latest snapshot per domain and allows synchronous reads after the first
 * frame arrives.
 *
 * Wire format (JSON payload inside the DEFAULTS frame):
 *   {
 *     "domains": {
 *       "domain.name": {
 *         "generation": N,
 *         "entries": {
 *           "key": { "type": "...", "value": ... }
 *         }
 *       }
 *     }
 *   }
 *
 * Usage:
 *   const client = new TugbankClient(connection);
 *   await client.ready();
 *   const val = client.get("dev.tugtool.app", "theme");
 */

import { FeedId } from "../protocol";
import type { TugConnection } from "../connection";

/** A tagged value stored in tugbank. */
export interface TaggedValue {
  type: string;
  value: unknown;
}

/** Cached snapshot for a single domain. */
interface DomainSnapshot {
  generation: number;
  entries: Map<string, TaggedValue>;
}

/**
 * Callback fired when a domain's snapshot is updated.
 *
 * @param domain  - The domain name that changed.
 * @param entries - The full updated entries map for that domain.
 */
export type DomainChangedCallback = (
  domain: string,
  entries: Map<string, TaggedValue>
) => void;

/** Wire-format shape of a single domain inside the DEFAULTS frame payload. */
interface WireDomain {
  generation: number;
  entries: Record<string, { type: string; value: unknown }>;
}

/** Wire-format shape of the full DEFAULTS frame payload. */
interface WirePayload {
  domains: Record<string, WireDomain>;
}

/**
 * WebSocket-backed synchronous cache for tugbank defaults.
 *
 * Register this with a TugConnection before calling connect(); the first
 * DEFAULTS frame resolves the ready() promise, after which all reads are
 * synchronous.
 */
export class TugbankClient {
  private cache: Map<string, DomainSnapshot> = new Map();
  private domainChangedCallbacks: DomainChangedCallback[] = [];
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void>;
  private settled = false;

  constructor(connection: TugConnection) {
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    connection.onFrame(FeedId.DEFAULTS, (payload: Uint8Array) => {
      this.handleFrame(payload);
    });
  }

  /**
   * Returns a Promise that resolves when the first DEFAULTS frame has been
   * received and the cache is populated. After this point all reads are
   * synchronous.
   */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Synchronous read for a single key within a domain.
   *
   * Returns the TaggedValue, or undefined if the domain or key is not cached.
   */
  get(domain: string, key: string): TaggedValue | undefined {
    return this.cache.get(domain)?.entries.get(key);
  }

  /**
   * Returns the full entries map for a domain, or undefined if not cached.
   */
  readDomain(domain: string): Map<string, TaggedValue> | undefined {
    return this.cache.get(domain)?.entries;
  }

  /**
   * Returns an array of all currently cached domain names.
   */
  listDomains(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Register a callback that fires whenever any domain snapshot is updated.
   *
   * Returns an unsubscribe function.
   */
  onDomainChanged(callback: DomainChangedCallback): () => void {
    this.domainChangedCallbacks.push(callback);
    return () => {
      const idx = this.domainChangedCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.domainChangedCallbacks.splice(idx, 1);
      }
    };
  }

  /** Parse and apply a raw DEFAULTS frame payload. */
  private handleFrame(payload: Uint8Array): void {
    let wire: WirePayload;
    try {
      const json = new TextDecoder().decode(payload);
      wire = JSON.parse(json) as WirePayload;
    } catch (err) {
      console.error("[tugbank] failed to parse DEFAULTS frame:", err);
      return;
    }

    if (!wire.domains || typeof wire.domains !== "object") {
      console.warn("[tugbank] DEFAULTS frame missing domains field");
      return;
    }

    for (const [domainName, wireDomain] of Object.entries(wire.domains)) {
      const incoming = wireDomain.generation;
      const cached = this.cache.get(domainName);

      // Skip if we already have a newer or equal generation cached.
      if (cached !== undefined && cached.generation >= incoming) {
        continue;
      }

      const entries = new Map<string, TaggedValue>();
      for (const [key, tagged] of Object.entries(wireDomain.entries)) {
        entries.set(key, { type: tagged.type, value: tagged.value });
      }

      this.cache.set(domainName, { generation: incoming, entries });

      // Fire domain-changed callbacks.
      for (const cb of this.domainChangedCallbacks) {
        try {
          cb(domainName, entries);
        } catch (e) {
          console.error("[tugbank] onDomainChanged callback error:", e);
        }
      }
    }

    // Resolve the ready promise on first successful frame.
    if (!this.settled) {
      this.settled = true;
      if (this.readyResolve !== null) {
        this.readyResolve();
        this.readyResolve = null;
      }
    }
  }
}
