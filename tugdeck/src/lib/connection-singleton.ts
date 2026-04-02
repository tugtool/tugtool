/**
 * Connection singleton — provides the shared TugConnection instance to
 * modules that cannot import from main.tsx due to circular dependency risks.
 *
 * `main.tsx` calls `setConnection(connection)` immediately after constructing
 * the connection. All other modules import `getConnection()` from here instead
 * of importing directly from `main.tsx`.
 *
 * @module lib/connection-singleton
 */

import type { TugConnection } from "../connection";

let _connection: TugConnection | null = null;

/**
 * Set the shared connection instance. Called once from main.tsx.
 */
export function setConnection(conn: TugConnection): void {
  _connection = conn;
}

/**
 * Get the shared connection instance.
 *
 * Returns null before main.tsx has called setConnection. In practice this
 * should never be null when card components mount since main.tsx sets it
 * synchronously before any React rendering occurs.
 */
export function getConnection(): TugConnection | null {
  return _connection;
}
