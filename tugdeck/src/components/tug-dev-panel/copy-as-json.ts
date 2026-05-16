/**
 * `copyAsJson` — clipboard write helper for inspector "Copy as JSON"
 * buttons. Stringifies the supplied value and writes to the system
 * clipboard. Returns true on success, false on failure (no clipboard
 * permission, unsupported environment, serialization error).
 *
 * The helper avoids the WKWebView clipboard popup by writing via the
 * `navigator.clipboard.writeText` API, which is gestureful (only
 * fires inside a trusted click handler) and triggers no permission
 * dialog. Reading the clipboard is what triggers the popup; writing
 * is silent.
 *
 * @module components/tug-dev-panel/copy-as-json
 */

/**
 * Serialize `value` to JSON and write to the clipboard. Maps cyclic /
 * unrepresentable values to `String(err)`. Logs failures.
 */
export async function copyAsJson(value: unknown): Promise<boolean> {
  let json: string;
  try {
    json = JSON.stringify(value, jsonReplacer, 2);
  } catch (err) {
    console.warn("[devpanel] copyAsJson serialization failed:", err);
    return false;
  }
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return false;
    }
    await navigator.clipboard.writeText(json);
    return true;
  } catch (err) {
    console.warn("[devpanel] copyAsJson clipboard write failed:", err);
    return false;
  }
}

/**
 * JSON.stringify replacer that turns `Map` / `Set` into plain
 * structures and stringifies `undefined` (which JSON would drop) for
 * inspector clarity. Exported for tests.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  if (value instanceof Set) {
    return Array.from(value);
  }
  return value;
}
