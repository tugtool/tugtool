/**
 * Claude token counting for the static context breakdown and skills
 * inventory.
 *
 * Why this exists instead of `import { countTokens } from
 * "@anthropic-ai/tokenizer"`: that package (and `tiktoken/lite`) resolve
 * `tiktoken_bg.wasm` at *import* time via `fs.readFileSync` over
 * `__dirname`-derived candidate paths. When tugcode is `bun build
 * --compile`d into a standalone binary, `__dirname` is the virtual
 * `/$bunfs/root` and those candidates don't exist on disk — so the import
 * throws `Missing tiktoken_bg.wasm` the instant the module is evaluated,
 * killing tugcode before `main()` runs. (Works on a dev box only because
 * the source-tree `node_modules` happens to sit on a candidate path.)
 *
 * The fix: use `tiktoken/lite/init`, which defers wasm instantiation to a
 * callback, and feed it bytes from a wasm file embedded into the binary at
 * build time (`with { type: "file" }` — bun bundles the file and yields its
 * `/$bunfs` path, readable via `readFileSync` in both the compiled binary
 * and a plain `bun run`). The encoder is built once at startup; callers
 * must `await initTokenizer()` before the first `countTokens`.
 */
import { readFileSync } from "node:fs";

import { init, Tiktoken } from "tiktoken/lite/init";
import claude from "@anthropic-ai/tokenizer/claude.json";
// The wasm is embedded into the compiled binary; with bun's `type: "file"`
// loader `wasmFile` is its `/$bunfs` path string at runtime. The package's
// `.wasm.d.ts` types it as a wasm-exports module, so the value is coerced
// through `unknown` to the string it actually is at `initTokenizer`.
import wasmFile from "tiktoken/lite/tiktoken_bg.wasm" with { type: "file" };

let encoder: Tiktoken | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Instantiate the tiktoken wasm and build the Claude encoder. Idempotent —
 * concurrent or repeat calls share one in-flight instantiation. Must be
 * awaited (once, at tugcode startup) before any `countTokens` call.
 */
export function initTokenizer(): Promise<void> {
  if (initPromise === null) {
    initPromise = (async () => {
      const wasmBytes = readFileSync(wasmFile as unknown as string);
      await init((imports) => WebAssembly.instantiate(wasmBytes, imports));
      encoder = new Tiktoken(
        claude.bpe_ranks,
        claude.special_tokens,
        claude.pat_str,
      );
    })();
  }
  return initPromise;
}

/**
 * Token count of `text` under the Claude tokenizer. Synchronous; requires a
 * prior `await initTokenizer()`. Matches `@anthropic-ai/tokenizer`'s
 * `countTokens` (NFKC normalize, encode with all special tokens allowed).
 */
export function countTokens(text: string): number {
  if (encoder === null) {
    throw new Error("tokenizer not initialized; await initTokenizer() first");
  }
  return encoder.encode(text.normalize("NFKC"), "all").length;
}
