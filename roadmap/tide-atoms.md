<!-- tugplan-skeleton v2 -->

## Tide Atoms — Sending Content to Claude and Rendering in the Transcript {#tide-atoms}

**Purpose:** Wire the existing prompt-entry atom flow through the full Tide pipeline so file/image references reach Claude Code as proper Anthropic content blocks (image bytes as `image` blocks; everything else as substituted text), render as atom chips on both sides of the transcript (user-typed and assistant-tool-block), and normalize images to API-acceptable size/dimensions so submissions never fail at the Anthropic backend.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-05-26 |
| Replaces | [`archive/atoms-attachments.md`](archive/atoms-attachments.md) (2026-05-08), [`archive/tugplan-tide-atoms-attachments.md`](archive/tugplan-tide-atoms-attachments.md) (2026-05-08) |
| Related | [`tide.md`](tide.md) §T3.4.b · [`transport-exploration.md`](transport-exploration.md) §Test 23, §Test 24 · [`ws-verification.md`](ws-verification.md) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tide has the substrates we need but the wiring between them is incomplete. The browser-side prompt-entry already represents file/image references as **atoms** in the CM6 document (`tug-atom-img.ts:24`); the cross-process IPC has an `Attachment[]` slot on every `user_message` (`tugcode/src/types.ts:4`); tugcode already converts attachments into Anthropic `image` content blocks (`session.ts:297-343`). The image happy-path is regression-tracked end-to-end via `test-23-image-attachment` — every captured claude version from `2.1.104` through `2.1.148` has a passing fixture in `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/`.

What's missing is the glue. The reducer's `send-frame` effect ships `attachments: []` and the wire text still contains `U+FFFC` object-replacement characters at atom positions (`reducer.ts:743-749`, `:2210-2216`); claude sees garbage instead of `@README.md`. The transcript user row is a bare `<span>{text}</span>` (`tide-card-transcript.tsx:415-422`); even if attachments reached the transcript, they would have nowhere to render. The replay path's `add_user_message` handler type-casts `Attachment[]` to `AtomSegment[]` (`reducer.ts:3240-3243`) — a shim that works only because the field is never read. Assistant tool-block paths render as monospace text in `tool-blocks/`, visually disjoint from the chips the user typed.

Two scope additions over earlier drafts: **image downsampling at insert time** (so submissions never exceed Anthropic's 5 MB / 8000 px ceilings) and **completion-time secret-file filtering** (so `.env`-style files never surface in the `@`-popup, matching Claude Code's posture). Both ship in v1 because shipping without them would mean shipping broken: oversized images cause API rejections, and unfiltered completion would expose secrets at the click of a `@`-key.

#### Strategy {#strategy}

- **Empirical baseline preserved.** `test-23-image-attachment` continues to verify the image content-block path. New probes are explicitly *not* required by this plan — we don't change the wire shape, so existing fixtures stay byte-identical.
- **No new wire shape.** The existing `Attachment{filename, content, media_type}` carries everything v1 needs. The discriminated `kind: "inline" | "ref"` union from the archived plan is forward-compatible if v2 ever needs server-side ref resolution.
- **Browser-side normalization.** Image bytes are decoded, resized, re-encoded, and size-checked at insert time (drop / paste). The bytes that reach the bytes-store, the wire, the journal, and JSONL are always API-compliant. tugcode never sees an oversized image.
- **Filter at completion-time, not submit-time.** Secret files (`.env`, `*.pem`, `id_rsa*`, etc.) never appear in the `@`-popup. Users who type the path manually still send it — same model as Claude Code.
- **One commit per step.** Build green at every commit (`-D warnings`, `bun run check`, `bun test`, `cargo nextest run --workspace` all clean).
- **Single SVG chip builder.** Every chip surface (editor's CM6 widget, transcript user-row, assistant tool-block path) renders through the same `buildAtomSVGDataUri` helper extracted from `createAtomImgElement`. Visual rhyme across the surfaces; no chance of style drift. (Earlier drafts proposed a shared React `AtomChip` primitive — superseded; see [Step 5's scope decision](#step-5).)
- **Tuglaws apply.** Touching prompt-entry's drop / paste extensions, the bytes-store, the wire-flattening logic, the new attachment-strip primitive, and the tool-block path renderers re-checks against `tuglaws/tuglaws.md`. The closing step records a walkthrough.

#### Success Criteria (Measurable) {#success-criteria}

**Send path:**
- Dropping a 4K screenshot (e.g., 3840×2160 PNG, ~6 MB) submits successfully without an Anthropic API error. (verification: manual smoke + canvas-stub unit test asserting post-downsample dimensions ≤ 2576 px and encoded size ≤ 5 MB)
- The reducer's `send-frame` effect at `reducer.ts:743-749` and the queued-send flush at `reducer.ts:2210-2216` carry the flattened-text-and-attachments payload, not `attachments: []`. (verification: `code-session-store/__tests__/reducer.test.ts` asserts shape on submit)
- The wire text submitted to claude contains zero `U+FFFC` characters when the prompt had atoms. (verification: unit test of `buildWirePayload`)

**Transcript rendering:**
- The transcript user row renders atom chips at `U+FFFC` positions for both in-flight and committed turns. (verification: render test in `tide-card-transcript.test.tsx` + manual against gallery card)
- The transcript user row renders an image-thumbnail strip above the body when the turn has image attachments. (verification: same as above)
- Read / Edit / Write / NotebookEdit tool blocks render their `file_path` (and `notebook_path`) as a chip (`<img>` built via `buildAtomSVGDataUri`), identical to the user-side chip rendering. (verification: render test + manual)

**Permission gating:**
- A workspace with a `.env` file at the root never surfaces `.env` in the `@`-completion popup. (verification: integration test against the FileTreeStore + manual)
- A workspace with a `.tugattachignore` matching `local-secrets/**` excludes those paths from completion. (verification: integration test)

**Regression coverage:**
- `test-23-image-attachment` continues to pass on the current claude version (`2.1.148` at plan-draft time). The captured JSONL is byte-identical pre/post the wire-flattening landing. (verification: `just capture-capabilities` and diff the resulting fixture against the prior baseline)

**Compliance:**
- `bun run check`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run --workspace` — all pass on every step.
- No new IndexedDB. No localStorage. No new tugcast verb (filetree provider extension is in-place; no new IPC).
- No new probes are required by this plan (forward-compat additions like JPEG/PDF probes are tracked as v2 follow-ons).

#### Scope {#scope}

1. Image downsample primitive (Step 1) — canvas-based pure module; reused by drop, paste, and thumbnail bake.
2. Browser bytes side-table + drop/paste capture with downsampling (Step 2) — atoms gain an optional `id`; drop and paste handlers stash downsampled bytes in the per-card store.
3. Wire flattening at submit (Step 3) — pure `buildWirePayload(text, atoms, bytesStore)` substitutes `U+FFFC` placeholders and packs image attachments; reducer's `handleSend` and queued-flush consume it.
4. Completion-time secret-file filter + `.tugattachignore` (Step 4) — filetree provider applies a built-in denylist and reads a workspace-root ignore file.
5. Atom rendering in the transcript user-message row (Step 5) — extract `buildAtomSVGDataUri` as a pure helper; new `TugAtomTextBody` walks `(text, atoms)` and interleaves the same `<img>` the editor uses.
6. Image attachment strip + thumbnail bake (Step 6) — `tug-attachment-strip.tsx` renders above the user body; `bakeThumbnail` shares the Step-1 pipeline at 256 px.
7. Replay-side cleanup + assistant tool-block chips (Step 7) — fix the `handleAddUserMessage` type-cast; switch tool-block path renderers from monospace text to the shared SVG chip via `buildAtomSVGDataUri`.
8. Integration checkpoint (Step 8) — verify end-to-end: drop → submit → thumbnail + chips → cold-restart → same view.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **PDF / `document` content blocks.** No `application/pdf` branching in `buildContentBlocks`. ([Q03](#q03-pdf-deferred))
- **`kind: "ref"` discriminator and tugcode-side path resolution.** File atoms ride as substituted text in the body; claude `Read`s on demand. Forward-compatible via an additive Attachment-shape extension when needed.
- **Anthropic Files API uploads** (`source.type: "file", file_id: …`).
- **Bidirectional capture** (`TUG_CAPTURE_INBOUND_LOG`) — a regression-safety win but not a v1 blocker.
- **Cross-card paste with bytes.** Clipboard sidecar round-trips atom identities only.
- **Free-prose `@path` detection in assistant markdown.** Tool blocks are the structured surface.
- **Lightbox** for click-to-enlarge — v1.1 polish; v1 opens in a new tab.
- **WASM image decoders.** WebKit decodes every format the v1 allowlist accepts; no parallel decoder needed. ([Q02](#q02-heic-avif))

#### Dependencies / Prerequisites {#dependencies}

- WS transport stable (`ws-verification.md`, commit `e0174373`).
- `tugcast::SessionLedger.turns.user_attachments BLOB` column exists (`session_ledger.rs:463`); journaling is automatic once tugdeck ships non-empty attachments.
- tugcast's filetree provider supports completion queries via the `FILETREE_QUERY` feed and applies `.gitignore` patterns (verified in `tugrust/crates/tugcast/src/feeds/filetree_provider.rs`).
- `test-23-image-attachment` baseline current through claude `2.1.148`.

#### Constraints {#constraints}

- **Per-image:** ≤ 5 MB decoded; media types `image/png`, `image/jpeg`, `image/gif`, `image/webp` (Anthropic Vision allowlist).
- **Image dimensions:** long edge ≤ 2576 px at submit (Opus 4.7 cap; Anthropic Vision docs).
- **Per-request total payload:** Anthropic 32 MB cap; v1 doesn't enforce a sub-total cap since with per-image normalization, 20 maxed images = 100 MB, but typical case is well under. Revisit if user reports hit it.
- **Stdin to claude:** 10 MB cap (Claude Code v2.1.148+). v1's per-image 5 MB cap × any reasonable count stays under this; the wire envelope adds ~5% base64 overhead.
- **Build:** `-D warnings` in `tugrust/.cargo/config.toml`; no new warnings tolerated.
- **No new IndexedDB / localStorage** per `feedback_no_localstorage.md`.
- **Tugdeck package manager:** `bun`, never `npm` / `npx` per `feedback_use_bun.md`.
- **No manual builds in tugdeck.** HMR picks up changes per `feedback_hmr.md`.
- **`tugcode` requires rebuild on edit** per `feedback_tugcode_compile.md`. Steps that touch tugcode flag this.

#### Assumptions {#assumptions}

- Claude continues to accept the existing `image` content-block shape (`source: { type: "base64", media_type, data }`). The drift regression catches breakage; `test-23` is the canary.
- `createImageBitmap` and `OffscreenCanvas` (or `HTMLCanvasElement` fallback) work in Tug.app's WebKit. Verified empirically during Q02 resolution.
- tugcast's filetree provider can be extended with additional ignore patterns without re-architecting the existing `.gitignore` handling. Verified by reading the provider source as part of Step 4.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows [`tuglaws/tugplan-skeleton.md`](../tuglaws/tugplan-skeleton.md) v2:

- Decisions: `[D01]` … `[D08]` with `{#dNN-...}` anchors.
- Open Questions: `[Q01]` … `[Q04]` with `{#qNN-...}` anchors.
- Specs: `Spec S01` … `Spec S06` with `{#sNN-...}` anchors.
- Tables: `Table T01` … `Table T03` with `{#tNN-...}` anchors.
- Lists: `List L01` … `List L03` with `{#lNN-...}` anchors.
- Risks: `Risk R01` … `Risk R05` with `{#rNN-...}` anchors.
- Steps: `{#step-N}` anchors. Every step has `**Depends on:**` (when applicable) and `**References:**` lines.
- IDs are two-digit, never reused; deletions leave gaps.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Click-to-enlarge bytes for replayed images (OPEN) {#q01-replay-enlarge-bytes}

**Question:** When a card mounts cold and replays JSONL containing image attachments, bytes flow through `add_user_message.attachments[i].content` once. Should the bytes-store hold them indefinitely for click-to-enlarge, evict under an LRU budget, or fetch lazily from JSONL?

**Why it matters:** A 50-turn session with five 4 MB inline images per turn would hold 1 GB in the bytes-store under "hold indefinitely". A naïve LRU would evict before the user expects.

**Options:**
- (a) Hold all bytes for the card's lifetime. Simple. Bounded by session length.
- (b) LRU eviction with a per-card budget (e.g., 100 MB). Predictable memory cap; users hit a "bytes evicted" surface if they enlarge an old image.
- (c) Re-fetch from JSONL on each enlarge via a new tugcast `JSONL_READ_ATTACHMENT` verb. No memory budget; introduces new wire infrastructure.

**Plan to resolve:** Land Steps 1-7. At Step 8 (integration), profile heap usage with a 50-turn synthetic session (Tug.app heap inspector). Pick (a), (b), or (c) based on data.

**Resolution:** OPEN. Provisional: (a) holds bytes for card lifetime; revisit at integration checkpoint based on heap profile.

#### [Q02] HEIC / AVIF source decoding (DECIDED) {#q02-heic-avif}

**Question:** macOS users drag a `.heic` from Photos or a `.avif` from a web page. Does Tug.app's WebKit decode them natively through the `createImageBitmap` canvas pipeline, or do we need a WASM decoder?

**Why it matters:** Tug.app is the shipping surface. The engine question — does WebKit handle these formats — drives whether we need a parallel decoder.

**Empirical findings (2026-05-26):** A throwaway harness served 8×8 HEIC and AVIF test images (generated via `sips` and `avifenc`) and ran `createImageBitmap(blob)` on each.

| Engine | HEIC via `createImageBitmap` | HEIC via `<img>` | AVIF via `createImageBitmap` | AVIF via `<img>` |
|--------|------------------------------|------------------|------------------------------|------------------|
| WebKit (macOS Safari 18.6, same engine Tug.app uses) | ok, 8×8 | ok | ok, 8×8 | ok |
| Chromium (Chrome 148, sanity check) | fail (`InvalidStateError`) | fail | ok, 8×8 | ok |

The Chromium row is sanity-check only — it confirms we understood the engine matrix correctly. Tug.app does not run on Chromium.

**Resolution:** DECIDED — HEIC and AVIF flow through the standard raster branch of `downsampleImage`. WebKit's `createImageBitmap` decodes both natively; the resize / re-encode pipeline doesn't care what the source format was. No WASM decoder. No special-case branch. If a future engine change ever broke WebKit's HEIC support, the existing `decode-failed` discriminated error would surface cleanly from the canvas pipeline — but that's not a planned surface.

#### [Q03] PDF / `document` content block timing (DEFERRED) {#q03-pdf-deferred}

**Question:** When do PDFs become a feature?

**Why it matters:** Users drop PDFs and reasonably expect claude to read them.

**Resolution:** DEFERRED. Not in v1 scope. Forward-compat: the Attachment shape extension is additive (a `application/pdf` media type with `document` content block in tugcode); no breaking change. v2 candidate.

#### [Q04] Animated GIF handling (DECIDED) {#q04-animated-gif}

**Question:** A user drops a 4 MB animated GIF. Canvas resize collapses to a single-frame image and loses the animation. Anthropic Vision accepts `image/gif` and analyzes frames. Should the downsample pipeline skip canvas re-encode for GIFs and pass through, always canvas-encode (lose animation), or detect animated vs. static?

**Why it matters:** Niche but real; engineers screenshot terminal animations and dashboards as GIFs. Static GIFs (the much more common case) should be canvas-resized like any other image so we can normalize their dimensions and re-encode for smaller payloads.

**Resolution:** DECIDED — option (c). The `downsampleImage` pipeline detects animated vs. static by walking the raw GIF bytes and counting image-descriptor blocks (`0x2C` markers after the global color table); >1 frame ⇒ animated, ≤1 frame ⇒ static. Animated GIFs pass through unchanged with a size-only check (reject if > 5 MB). Static GIFs route through the canvas pipeline like JPEG / PNG / WebP (resize to long-edge ≤ 2576 px, re-encode as GIF, then JPEG-quality-ladder fallback if still > 5 MB). The frame-count detector is a small pure function (`isAnimatedGif(bytes: Uint8Array): boolean`) added in Step 1 with unit-test coverage for known animated and static fixtures. If users hit the 5 MB cap on animated GIFs in the wild, escalate to a `gifsicle`-style server-side downsampler — v1.1.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Canvas downsample blocks main thread on insert | medium | medium | A `<TugProcessingIndicator>` overlay appears for operations > 100 ms; OffscreenCanvas where supported moves work off the main thread | User reports UI hitch on insert |
| Anthropic content-block drift | high | low | `test-23-image-attachment` regression catches outbound-shape change; capture-capabilities run flags drift | Drift regression Semantic finding |
| Bytes-store memory growth on long sessions | medium | medium | Thumbnails-only on snapshot ([D04](#d04-no-bytes-on-snapshot)); bytes-store policy resolved in [Q01](#q01-replay-enlarge-bytes) at Step 8 | Heap > 500 MB in profile |
| Workspace secret leakage via manually-typed path | low | high | Filtering at completion ([D06](#d06-completion-time-filter)) covers UX; matches Claude Code's permission posture for typed paths | Security audit finding |
| `.tugattachignore` parser bugs (glob nuances) | low | medium | Reuse `ignore` crate's gitignore implementation (already a transitive dep via tugcast); unit-test against the same patterns | Filetree completion shows ignored path |

**Risk R01: Canvas downsample blocks main thread** {#r01-canvas-blocking}

- **Risk:** Decoding + resizing a 12 MP PNG takes ~50-100 ms on the main thread; users perceive a UI hitch on drop / paste.
- **Mitigation:** Use `OffscreenCanvas` + `createImageBitmap` (off-main-thread on Tug.app's WebKit). If neither is available, fall back to the synchronous `HTMLCanvasElement` path and show a `<TugProcessingIndicator>` overlay for operations whose decode-start to encode-end exceeds 100 ms. The indicator is suppressed for fast paths (most images).
- **Residual risk:** A pathological 100 MP image on a fallback path still blocks. Rejected early via dimension check before the canvas decode would even start.

**Risk R02: Anthropic content-block drift** {#r02-anthropic-drift}

- **Risk:** Anthropic changes the `image` content-block schema (renames `source.media_type`, deprecates `base64`, etc.). The drift is silent until claude returns an error event.
- **Mitigation:** `test-23-image-attachment` continues to run on every `capture-capabilities` pass; a schema change would either fail the capture (status: failed) or pass a new shape (drift regression flags Semantic).
- **Residual risk:** Drift between captures is not caught real-time. Bidirectional capture (in non-goals) would close this gap; it's tracked as a v2 follow-on.

**Risk R03: Bytes-store memory growth** {#r03-bytes-store-memory}

- **Risk:** A long card-mount with many large inline images accumulates 100s of MB in the per-card bytes-store.
- **Mitigation:** Thumbnails-only on the React snapshot ([D04](#d04-no-bytes-on-snapshot)). Bytes-store retention policy resolved in [Q01](#q01-replay-enlarge-bytes) at integration time based on profile data.
- **Residual risk:** Even with thumbnails-only on snapshot, the bytes-store itself can grow. Cap policy lands as part of Q01 resolution.

**Risk R04: Workspace secret leakage via manual path** {#r04-manual-path-leak}

- **Risk:** A user types `@.env` in the prompt body. Completion would have filtered it; manual typing bypasses. `.env` substitutes into wire text; claude may `Read` it (its own gates apply).
- **Mitigation:** Filtering at completion-time ([D06](#d06-completion-time-filter)) covers the common path. This matches Claude Code's own posture: the terminal would also have shown `.env` had the user typed it.
- **Residual risk:** Same as Claude Code itself. Documented; no additional mitigation in v1.

**Risk R05: `.tugattachignore` parser bugs** {#r05-tugattachignore-parser}

- **Risk:** Glob patterns have edge cases (`**/foo` vs. `**/foo/**`, trailing-slash semantics, negation `!pattern`).
- **Mitigation:** Reuse the `ignore` crate's gitignore implementation, which is already a transitive dependency via tugcast for `.gitignore` handling. Unit-test the same pattern cases gitignore documents.
- **Residual risk:** A user's exotic pattern works in `.gitignore` but not `.tugattachignore`. Document the exact subset we support; surface a parse-error toast if a pattern is unrecognized.

---

### Design Decisions {#design-decisions}

#### [D01] Substitute `U+FFFC` at submit-time via a pure function (DECIDED) {#d01-ffc-substitution-at-submit}

**Decision:** The substrate's `TurnEntry.userMessage` continues to carry `text` (with `U+FFFC` placeholders at atom positions) and `atoms[]` separately. A new pure function `buildWirePayload(text, atoms, bytesStore)` produces the wire payload — substituting each `U+FFFC` with the corresponding atom's `value` and packing image-atom bytes into `Attachment[]` — at submit time, just before dispatch. The reducer never sees `U+FFFC` in the wire text.

**Rationale:**
- Substituting in the substrate would lose atom-position information needed for transcript chip rendering. The chip renderer walks `text` looking for `U+FFFC` and reads the corresponding atom; if we substituted, we'd need a separate "where do the chips go" sidecar.
- A pure function at the edge is round-trippable, easy to test, and keeps the reducer pure.
- The substrate stays simple: atoms and text live together, exactly as `tug-text-types.ts:90` documents the invariant.

**Implications:**
- New `tugdeck/src/lib/build-wire-payload.ts` (pure; ~50 LOC).
- `code-session-store.send` calls it and dispatches the flattened payload as part of the action.
- `reducer.ts:handleSend` and the queued-send flush at `reducer.ts:2147-2218` consume the pre-flattened values.
- `TurnEntry.userMessage.text` is never mutated to remove `U+FFFC`; it stays raw for transcript rendering.

#### [D02] Atoms with bytes ride as inline `Attachment` records; drop / paste rejects what can't ride (DECIDED) {#d02-image-attach-text-rest}

**Decision:** The wire-side discriminator is **bytes in the per-card store, not atom type**. At submit, any atom whose `id` resolves to a bytes-store entry rides as `Attachment{filename, content, media_type}` on the `user_message` wire frame; atoms without an id (or whose id is unknown to the store) ride only as substituted text in `wireText`. Image atoms ship base64 image bytes; text-file atoms (Finder drops of `.md` / `.json` / source files) ship raw UTF-8 text.

The drop / paste pipeline rejects file kinds it can't ship at drop time (not at submit time): binary non-image, non-text sources (PDF, archives, audio, video) produce no atom — they're silently skipped. In Tug.app, the native bridge ([Step 3.5.7](#step-3-5-7)) snapshots `NSPasteboard` from the Swift host on every `draggingEntered:` / `draggingUpdated:` and pushes the resolved MIME info into JS via `window.__tugActiveDrag`; the JS drop extension consults this snapshot from `dragenter` / `dragover` and drives the three-state accept / reject ring. PDFs and other unsupported binaries show the red reject ring + OS no-drop cursor *before* release. When the native bridge is absent (browser-only dev paths) or has not yet posted its first snapshot (the one-frame race window — see [Q05](#q05-bridge-timing)), the extension falls back to the legacy `types.includes("Files")` accept-all behavior; on release, the drop handler classifies `dataTransfer.files` (which WKWebView populates at drop time even when it redacts during drag per [WebKit bug #223517](https://bugs.webkit.org/show_bug.cgi?id=223517)) and silently skips unsupported files.

Skeleton-atom feedback: image and text drops insert their atoms *synchronously* with a UUID id and a pending appearance (dimmed + pulsing). The async byte-fill runs in the background; on success, the bytes land in the store and the pending-sync `ViewPlugin` mutates `data-pending` off via direct DOM (no widget rebuild). On failure, the skeleton atom is removed and the user sees the banner. Submit is gated while any pending atom is in the doc — submitting a half-processed image would silently ship just the filename.

**Rationale:**
- Image bytes can only reach claude via the Attachment slot (Anthropic content-block protocol mandates `{type:"image", source:{...}}` blocks).
- Text-file bytes from Finder drops have nowhere to land otherwise — claude can't `Read` a path outside the workspace. tugcode's `buildContentBlocks` already wraps any non-image Attachment in a `text` content block (`session.ts:331-334`); we extend the browser side to populate that path.
- Workspace `@`-mentions still ride as text in `wireText` — Test 24 in `transport-exploration.md` empirically established that claude's `Read` tool fetches workspace-relative paths on demand. This matches the terminal's behavior and stays cheap on tokens.
- Silently inserting filename-only atoms for unsupported binaries was confusing — the chip looked usable but the bytes were silently dropped at submit. Drop-time rejection is the honest signal and steers the user toward a workable path (convert, or wait for v2 PDF support).
- Skeleton atoms give instant visual feedback at the drop point. Without them, 1-2 s of async work felt like the drop failed.
- PDF / `document` content blocks remain deferred per [Q03](#q03-pdf-deferred).
- Forward-compatible: a future `kind: "ref"` arm or `document` content block slots in additively without breaking the existing shape.

**Implications:**
- `buildContentBlocks` in tugcode (`session.ts:297-343`) is unchanged; the existing image / text branches handle the new mix.
- `tugdeck/src/lib/text-attachment.ts` (`isTextSource`, `readTextAttachment`) classifies and reads text-file drops.
- `buildWirePayload` ships any atom with `id !== undefined` + bytes — the bytes-store's `mediaType` drives tugcode's image-vs-text content-block branching.
- File / doc atoms from `@`-completion continue to ride as text only (no id, no bytes).
- Binary non-image, non-text drops surface an `attachment_rejected` banner and never become atoms.
- Skeleton atom rendering goes through `createAtomImgElement(...{ id, pending: true })`; the appearance is themed via `pendingAtomTheme`. The pending-sync `ViewPlugin` (in `atom-decoration.ts`) subscribes to the bytes-store and reconciles `data-pending` via direct DOM mutation when bytes arrive.
- `performSubmit` (`tug-prompt-entry.tsx`) checks for pending atoms via the bytes-store and bails with a banner when any are still processing.

#### [D03] Per-card `AtomBytesStore` keyed by UUID (DECIDED) {#d03-atom-bytes-store}

**Decision:** A per-tide-card in-memory store (`Map<atomId, {content, mediaType}>`) holds base64 bytes for inline image attachments. The atom-id is a UUID minted at drop / paste time on `AtomSegment.id` (new optional field). At commit time, the same id is reused as `AttachmentRecord.id` (the post-submit identity). Replay-derived attachments mint fresh ids at commit and populate the store from `add_user_message.attachments[i].content`. JSON-serializable for state preservation.

**Rationale:**
- Atoms remain lightweight; stuffing 5 MB of base64 onto `AtomSegment.value` would balloon every preserved snapshot.
- A dedicated store with explicit lifetimes (mount → unmount + state-preservation snapshot) decouples byte storage from substrate identity.
- Single key namespace (UUID) simplifies click-to-enlarge: `AttachmentRecord.id` → bytes-store lookup, same code path for inline-submitted and replay-derived attachments.

**Implications:**
- `AtomSegment` gains optional `id: string` (`tug-atom-img.ts:24`).
- `AttachmentRecord` carries the same id field.
- `useCardStatePreservation` snapshot includes the bytes-store map (it's already JSON-serializable).
- The reducer commit path is responsible for ensuring the bytes-store has an entry for each image AttachmentRecord — for inline this is already true (drop/paste populated it); for replay it writes from `event.attachments[i].content`.

#### [D04] No raw bytes on the React snapshot (DECIDED) {#d04-no-bytes-on-snapshot}

**Decision:** `TurnEntry.userMessage.attachments: ReadonlyArray<AttachmentRecord>` carries `thumbnailDataUrl` (≤ 256 px max edge for images) + metadata only. Full bytes live exclusively in the bytes-store, the tugcast journal, and JSONL.

**Rationale:**
- 100 turns × 5 MB attachments = 500 MB on the React snapshot. Unacceptable.
- Tugcast's journal already declares the `user_attachments BLOB` column and serializes via `serde_json::Value`.
- Thumbnails are smaller (≤ 200 KB typically) and fine to keep on the snapshot.

**Implications:**
- `AttachmentRecord` shape: `{ id, role, filename, mediaType, thumbnailDataUrl, byteSize }`.
- The reducer commit path runs `bakeThumbnail` from the bytes-store entry; the thumbnail data URL goes onto the snapshot.
- Click-to-enlarge looks up bytes from the store via `AttachmentRecord.id`.

#### [D05] Client-side image downsampling at insert time (DECIDED) {#d05-client-downsample}

**Decision:** Every dropped or pasted image runs through a canvas-based normalization pipeline at insert time, *before* bytes reach the bytes-store:

1. **GIF pre-check.** If the source MIME is `image/gif`, run `isAnimatedGif(bytes)` (frame-count via `0x2C` marker walk). Animated → size check only (pass through if ≤ 5 MB; reject otherwise). Static → continue to the canvas pipeline. Detail per [Q04](#q04-animated-gif).
2. Decode the source to an `ImageBitmap` via `createImageBitmap(blob)` (preferred — off-main-thread on supporting browsers) or via `HTMLImageElement` + canvas `drawImage` (fallback).
3. If `max(width, height) > 2576` (Opus 4.7 long-edge cap), resize maintaining aspect ratio so long-edge = 2576 px.
4. Re-encode in source MIME (`image/png` → PNG, `image/jpeg` → JPEG, `image/webp` → WebP, static `image/gif` → GIF).
5. If encoded size > 5 MB, transcode to JPEG with quality ladder 90 → 80 → 70 → 60. Stop at the first quality whose encoded size ≤ 5 MB.
6. If still > 5 MB at quality 60, reject the drop / paste with an explicit error toast naming the file.
7. SVG (`image/svg+xml`) rasterizes to PNG at 1024×1024 (max), preserving aspect.
8. HEIC / AVIF / HEIF flow through the raster branch unchanged — WebKit decodes all three via `createImageBitmap`. No special-case branch. Per [Q02](#q02-heic-avif).

**Rationale:**
- The Anthropic backend rejects images > 5 MB decoded or with bad dimensions; normalizing client-side prevents API rejections.
- Doing it at insert (not submit) means the bytes-store always holds wire-ready bytes; submit is fast and deterministic.
- Canvas is native to the browser; no library dependency. WASM HEIC decoder is the fallback escape hatch ([Q02](#q02-heic-avif)).
- The same pipeline produces the 256 px thumbnail (different target size, same code path).

**Implications:**
- New `tugdeck/src/lib/image-downsample.ts` (pure-ish; signature in [Spec S04](#s04-image-downsample)).
- Drop and paste handlers `await` this before inserting the atom.
- Rejected drops surface via the existing card-error / toast path.

#### [D06] Completion-time secret-file filtering + `.tugattachignore` (DECIDED) {#d06-completion-time-filter}

**Decision:** The tugcast filetree provider (`tugrust/crates/tugcast/src/feeds/filetree_provider.rs`) applies two filters on top of its existing `.gitignore` handling:
1. A built-in denylist of secret-file globs ([List L01](#l01-secret-file-denylist)): `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `secrets.json`, `credentials.json`, `**/.aws/credentials`, `**/.npmrc`, `**/.ssh/**`.
2. An optional `.tugattachignore` at workspace root, gitignore syntax (parsed via the existing `ignore` crate), additive to the built-in.

Filtering is applied at suggestion time. Users never see these paths in the `@`-popup. Users who type a denylisted path manually still send it as text — same model as Claude Code.

**Rationale:**
- The natural place to filter is at suggestion-time: users never see `.env` in the popup, so they can't accidentally `@`-mention it.
- A `.tugattachignore` lets teams add project-specific secret files without code changes.
- We don't filter at submit-time because that would be paranoid (claude's own `Read` tool gates non-workspace reads); matching Claude Code's posture is the design north star.

**Implications:**
- Changes localized to `filetree_provider.rs`: built-in patterns constant + `.tugattachignore` reader.
- No tugdeck-side changes; the popup just stops seeing these paths.
- A manual-typed path still flows to claude; Claude's tool gates apply if `Read` is invoked.

#### [D07] Chip rendering shares an SVG builder, not a React primitive (REVISED) {#d07-atom-chip-primitive}

> **Supersedes** an earlier draft that mandated a shared React `AtomChip` primitive consumed by the editor's CM6 widget, the transcript user-row body, and the tool-block path renderers. That earlier draft is preserved at the bottom of this section for historical record.

**Decision:** Extract the SVG-data-URI builder from `createAtomImgElement` (`tug-atom-img.ts`) as a pure helper, `buildAtomSVGDataUri(type, label, value, options?)`. Three surfaces consume the helper, each in the way that fits its substrate:

- The editor's CM6 atom decoration **does not change**. `createAtomImgElement` continues to be its entry point and renders the same `<img>` it does today — calling `buildAtomSVGDataUri` internally for the URI. Replaced-element semantics (caret motion, selection, clipboard, undo) ride on the `<img>` element type per HTML spec; rebuilding it as a React component would buy nothing the substrate doesn't already give us and would risk that carefully-engineered behaviour.
- The transcript user-row body uses a new pure React walker, `TugAtomTextBody`, that splits the substrate text at `U+FFFC` and interleaves `<img src={buildAtomSVGDataUri(...).dataUri} ...>` per atom.
- The tool-block path renderers render an inline `<img>` per `file_path` (and `notebook_path`) using the same helper. Single chip per tool block; no walker needed.

**Rationale:**
- Visual consistency comes from the shared SVG builder + theme-token reads, not from a shared React component.
- The editor's atom-editing behaviour depends on the `<img>` being a replaced element. A React mount inside a CM6 widget adds a React-lifecycle surface for zero gain.
- React-side accessibility (`aria-label`, `role="button"` when interactive) was the only reason to wrap a chip in React; the editor doesn't need it (clicks bubble via `ignoreEvent: false`); the transcript user row's chips aren't interactive in v1; tool-block chips aren't interactive in v1. Accessibility on a per-image basis is `alt={atom.label}` on the `<img>` itself.

**Implications:**
- `tug-atom-img.ts` exports a new pure `buildAtomSVGDataUri` helper; `createAtomImgElement` keeps its current public shape and calls the helper internally.
- New `TugAtomTextBody` (`tugdeck/src/components/tugways/cards/tug-atom-text-body.tsx`) — pure React walker.
- No new `tug-atom-chip.tsx`, no new CM6 widget changes, no `tuglaws/atom-chip.md`.
- Tool-block components inline one `<img>` each. No new wrapper component.

<details>
<summary>Earlier draft (superseded)</summary>

The earlier draft proposed extracting chip rendering into a shared React component `AtomChip` consumed by the CM6 atom decoration, the transcript user-row body (via `TugAtomTextBody`), and the four tool-block path renderers. Its rationale cited visual consistency, a single primitive avoiding style drift, and React-side accessibility. The current decision honours the consistency goal via a shared *SVG builder* rather than a shared *React component*, keeping the editor's replaced-element semantics untouched.

</details>

#### [D08] Assistant-side atoms only at tool-block surfaces (DECIDED) {#d08-tool-block-only}

**Decision:** For v1, the assistant-side atom-chip rendering applies only to Read / Edit / Write / NotebookEdit tool blocks (where the file path is a structured `input` field). Free-prose `@`-path detection in assistant markdown is out of scope.

**Rationale:**
- Tool inputs carry the file path as a structured field; no parsing required.
- Free-prose detection is fragile (false positives like `@stable` annotations in code blocks, npm-style `@scope/pkg` mentions).
- The visual goal — user's chips reappearing in claude's response — is already met by tool-block chipping.

**Implications:**
- A small change in each of the four tool-block components to render the path as an inline `<img>` chip via `buildAtomSVGDataUri` ([Spec S05](#s05-atom-chip)).
- `notebook-edit-tool-block` extends similarly for `input.notebook_path`.
- Free-prose detection lives in a future v2 plan; the `tug-markdown-block` integration point is documented but not built.

---

### Specification {#specification}

#### Spec S01: `Attachment` wire type (unchanged) {#s01-attachment-wire-type}

`tugdeck/src/protocol.ts` and `tugcode/src/types.ts`:

```ts
interface Attachment {
  filename: string;       // user-visible label; survives JSONL round-trip
  content: string;        // base64 for binary, raw text for text/*
  media_type: string;     // RFC 6838; "image/png", "image/jpeg", "image/gif", "image/webp"
}
```

No discriminated union, no `kind`, no `path`. Forward-compatible extensions land additively in v2.

#### Spec S02: `AtomBytesStore` interface {#s02-atom-bytes-store}

`tugdeck/src/lib/atom-bytes-store.ts`:

```ts
interface AtomBytesEntry {
  content: string;       // base64 for binary (image), raw text for text/*
  mediaType: string;     // image/png | image/jpeg | image/gif | image/webp | text/* | known code MIMEs
}

interface AtomBytesStore {
  /** Stash bytes for an atom or attachment, keyed by id. Idempotent. */
  put(id: string, entry: AtomBytesEntry): void;
  /** Look up bytes by id. Returns null if unknown. */
  get(id: string): AtomBytesEntry | null;
  /** Remove bytes by id. Used when the atom is deleted from the editor. */
  delete(id: string): void;
  /** Entry count — diagnostics + cheap is-empty check. */
  size(): number;
  /** JSON-serializable snapshot for state preservation. */
  snapshot(): Record<string, AtomBytesEntry>;
  /** Restore from a snapshot (idempotent on existing keys). */
  restore(snap: Record<string, AtomBytesEntry>): void;
  /** Drop all entries. Used at card unmount / store disposal. */
  clear(): void;
  /** Subscribe to mutations; returns unsubscribe. Fires on put/delete/restore/clear. */
  subscribe(listener: () => void): () => void;
}
```

One instance per `CodeSessionStore` (per-tide-card scope). Lifetime: mount → unmount, with state-preservation snapshot ride-along.

#### Spec S03: `buildWirePayload` contract {#s03-build-wire-payload}

`tugdeck/src/lib/build-wire-payload.ts`:

```ts
function buildWirePayload(
  text: string,                              // raw substrate text with U+FFFC at atom positions
  atoms: ReadonlyArray<AtomSegment>,         // parallel atoms array; atoms.length === count(U+FFFC in text)
  bytesStore: AtomBytesStore,
): {
  wireText: string;                          // text with each U+FFFC replaced by the corresponding atom's value
  attachments: Attachment[];                 // one entry per image-atom with bytes in the store
};
```

**Invariants:**
- Pure: same inputs → same outputs (the bytes-store is read-only here; mutations live on drop/paste/commit paths).
- `wireText` contains no `U+FFFC` characters when `atoms.length === count(U+FFFC, text)`.
- Defensive: if `atoms.length < count(U+FFFC, text)`, extra `U+FFFC` chars pass through. Visible regression rather than crash.
- An image atom whose id is missing from the store is silently skipped (the substituted text still inserts `atom.value` so claude sees the filename).

#### Spec S04: `image-downsample` contract {#s04-image-downsample}

`tugdeck/src/lib/image-downsample.ts`:

```ts
interface DownsampleResult {
  content: string;          // base64; ≤ 5 MB decoded; ≤ 2576 px long edge
  mediaType: string;        // RFC 6838; possibly re-mapped (PNG→JPEG fallback)
  thumbnailDataUrl: string; // ≤ 256 px max edge, data: URL
  width: number;
  height: number;
  byteSize: number;         // decoded size in bytes
}

type DownsampleError =
  | { kind: "unsupported-format"; mediaType: string }
  | { kind: "too-large-after-fallback"; byteSize: number }
  | { kind: "decode-failed"; reason: string };

function downsampleImage(
  source: Blob | File,
): Promise<{ ok: true; result: DownsampleResult } | { ok: false; error: DownsampleError }>;

/** Frame-count detection for GIF input per [Q04](#q04-animated-gif). Pure. */
function isAnimatedGif(bytes: Uint8Array): boolean;
```

Pipeline implements [D05](#d05-client-downsample). The function never throws; the discriminated result lets callers surface specific errors. `ImageBitmap` path is preferred; `HTMLImageElement` fallback is used when `createImageBitmap` is unavailable or fails. `isAnimatedGif` runs ahead of the canvas pipeline for `image/gif` inputs; animated → passthrough, static → canvas.

#### Spec S05: `buildAtomSVGDataUri` helper + `TugAtomTextBody` contract (REVISED) {#s05-atom-chip}

> **Supersedes** an earlier `AtomChip` React-primitive contract (see [D07](#d07-atom-chip-primitive) for the decision history).

`tugdeck/src/lib/tug-atom-img.ts` exports a pure helper:

```ts
interface AtomSvgResult {
  dataUri: string;        // data:image/svg+xml,...
  width: number;          // px, ready to set on <img width=...>
  height: number;         // px
  baselineOffset: number; // px; set as verticalAlign so the chip aligns with text baseline
}

function buildAtomSVGDataUri(
  type: string,                              // "file" | "command" | "doc" | "image" | "link"
  label: string,
  value: string,
  options?: { maxLabelWidth?: number },
): AtomSvgResult;
```

Pure: same inputs (including the currently-resolved theme tokens, which the helper reads from CSS variables via `getTokenValue` at call time) → same outputs. `createAtomImgElement` calls this internally and applies the result to an `<img>` it constructs; the editor's CM6 widget path is byte-for-byte unchanged.

`tugdeck/src/components/tugways/cards/tug-atom-text-body.tsx` exports a pure React walker:

```tsx
interface TugAtomTextBodyProps {
  text: string;                              // raw substrate text with U+FFFC at atom positions
  atoms: ReadonlyArray<AtomSegment>;         // parallel atoms array
  className?: string;
}

function TugAtomTextBody(props: TugAtomTextBodyProps): React.ReactElement;
```

**Invariants:**
- Pure render; no `useEffect`, no `useRef`, no React state.
- Splits `text` at `U+FFFC` characters; emits text spans for the non-empty in-between slices and one `<img src={dataUri} width=... height=... alt={atom.label} style={{verticalAlign:`${baselineOffset}px`}}>` per atom position.
- When `atoms.length < count(U+FFFC, text)`, extra `U+FFFC` characters render as visible characters — visible regression rather than crash, matching `buildWirePayload`'s defensive posture.
- When `atoms` is empty, output is a single text span.

Tool-block path renderers (`read-tool-block.tsx` and siblings) call `buildAtomSVGDataUri` directly and render one inline `<img>` per `file_path` / `notebook_path`. No walker needed for the tool-block single-path case.

#### Spec S06: `TugAttachmentStrip` component contract {#s06-attachment-strip}

`tugdeck/src/components/tugways/cards/tug-attachment-strip.tsx`:

```tsx
interface TugAttachmentStripProps {
  attachments: ReadonlyArray<AttachmentRecord>;
  /** Click handler — v1 opens the source image in a new tab via window.open. */
  onAttachmentClick?: (attachment: AttachmentRecord, index: number) => void;
  className?: string;
}
```

- Renders nothing when `attachments.length === 0`.
- Image attachments → `<img src={thumbnailDataUrl} alt={filename}>` in a fixed-aspect 64×64 tile.
- Non-image attachments (theoretical in v1; v2 might add doc chips) → reserved for future expansion.
- Sits above the user-row body inside `UserMessageCell`.

---

### Lists and Tables {#lists-and-tables}

#### List L01: Built-in completion denylist patterns {#l01-secret-file-denylist}

The tugcast filetree provider rejects suggestions matching any of:

- `.env`
- `.env.*`
- `*.pem`
- `*.key`
- `id_rsa*`
- `id_ed25519*`
- `secrets.json`
- `credentials.json`
- `**/.aws/credentials`
- `**/.npmrc`
- `**/.ssh/**`

Additive to `.gitignore` and the optional `.tugattachignore`. Compiled at provider startup; no per-query cost beyond the gitignore-style match itself.

#### List L02: Image media-type allowlist (post-downsample) {#l02-image-mime-allowlist}

The bytes-store and the wire only ever carry one of:

- `image/png`
- `image/jpeg`
- `image/gif`
- `image/webp`

Source images outside this set fall into one of two paths: SVG rasterizes to PNG; HEIC / HEIF / AVIF flow through the raster branch unchanged (WebKit decodes them and the pipeline re-encodes in source MIME, with JPEG fallback if needed). Anything else is rejected.

#### List L03: Atom → wire mapping {#l03-atom-to-wire-mapping}

The discriminator is **whether the atom has bytes in the per-card store**, not its `type`. The same atom type can ride as Attachment-with-bytes (Finder drop) or as text-only (`@`-completion).

| Atom shape | Wire emission | Source |
|-----------|---------------|--------|
| `type: "image"` + `id` + bytes | Substituted text (filename) + `Attachment` (base64 image, `image/*` media_type) | Drop / paste of image |
| `type: "file"` + `id` + bytes | Substituted text (filename) + `Attachment` (raw text, `text/*` or known code MIME) | Drop of `.md` / `.json` / `.ts` etc. from Finder ([D02]) |
| `type: "file"` / `type: "doc"` (no id) | Substituted text (workspace-relative path) only | `@`-completion — claude `Read`s on demand |
| `type: "image"` (no id) | Substituted text (filename) only | Defensive — image atom without paired bytes |
| `type: "link"` | Substituted text (URL) | Claude treats as a URL string in prose |
| `type: "command"` | Substituted text (command name) | Usually intercepted client-side before submit |
| Other types with `id` + bytes | Substituted text + `Attachment` | Forward-compatible — any future atom type with bytes flows through |
| Binary file drop (PDF, archive, audio, video) | Substituted text (filename) only | No bytes-store entry; not shippable on v1's wire |

#### Table T01: Failure modes & surfacing {#t01-failure-modes}

| Failure | Where caught | Surface |
|---------|--------------|---------|
| Image > 5 MB after JPEG-quality-60 fallback | `downsampleImage` ([Spec S04](#s04-image-downsample)) | Toast: "Image too large after compression: {filename}" — drop / paste rejected |
| Unsupported image format (e.g., TIFF, BMP) | `downsampleImage` | Toast: "Image format unsupported: {mediaType}" — drop / paste rejected |
| Image decode fails (corrupt file) | `downsampleImage` | Toast: "Could not decode image: {filename}" — drop / paste rejected |
| Atom missing from bytes-store at submit (user deleted chip after drop) | `buildWirePayload` ([Spec S03](#s03-build-wire-payload)) | Silently skip the Attachment; substituted text still inserts `atom.value` so claude sees the filename |
| `U+FFFC` count ≠ `atoms.length` (substrate invariant break) | `buildWirePayload` defensive guard | Leftover `U+FFFC` passes through to claude as a literal character; visible regression on the assistant side |
| Anthropic API rejects bytes (drift, bad base64) | Anthropic API → tugcode | `api_retry` event, then turn error via existing path |
| `.tugattachignore` parse error | Filetree provider | Skip the invalid line; log via tugcast telemetry; remaining patterns apply |

No failure is silent. No failure drops the user's submission without surfacing.

#### Table T02: Persistence tiers {#t02-persistence-tiers}

| Tier | Lifetime | What's stored | Source code |
|------|----------|---------------|-------------|
| React snapshot | Mount → unmount | `AttachmentRecord` (thumbnail + metadata, no full bytes) | `CodeSessionSnapshot` |
| Bytes-store side-table | Mount → unmount + state-preservation snapshot | Downsampled base64 bytes; per-card scope | `atom-bytes-store.ts` ([Spec S02](#s02-atom-bytes-store)) |
| Tugcast `turns` journal | Until claude acks the turn | Full inline bytes as JSON BLOB | `session_ledger.rs:463` |
| JSONL | Forever (until user `forget`s) | What claude itself wrote — image content blocks for inline | `~/.claude/projects/<encoded>/<sid>.jsonl` |

#### Table T03: Image-downsample decision matrix {#t03-downsample-decisions}

| Source MIME | Action | Output MIME |
|-------------|--------|-------------|
| `image/png` | Resize if needed; re-encode PNG; JPEG fallback if > 5 MB | `image/png` or `image/jpeg` |
| `image/jpeg` | Resize if needed; re-encode JPEG (start at quality 90) | `image/jpeg` |
| `image/webp` | Resize if needed; re-encode WebP; JPEG fallback if > 5 MB | `image/webp` or `image/jpeg` |
| `image/gif` (animated, >1 frame) | Size check only; pass through if ≤ 5 MB; reject otherwise ([Q04](#q04-animated-gif)) | `image/gif` |
| `image/gif` (static, ≤1 frame) | Resize if needed; re-encode GIF; JPEG fallback if > 5 MB ([Q04](#q04-animated-gif)) | `image/gif` or `image/jpeg` |
| `image/svg+xml` | Rasterize to PNG at 1024×1024 | `image/png` |
| `image/heic` / `image/heif` | Canvas decode via WebKit → resize → re-encode in source MIME (JPEG fallback if > 5 MB). Per [Q02](#q02-heic-avif). | `image/heic` / `image/heif` (or `image/jpeg` on fallback) |
| `image/avif` | Same as HEIC | `image/avif` (or `image/jpeg` on fallback) |
| Anything else | Reject with `unsupported-format` | — |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/atom-bytes-store.ts` | Per-card bytes side-table ([Spec S02](#s02-atom-bytes-store)) |
| `tugdeck/src/lib/build-wire-payload.ts` | Pure atom → Attachment + text-substitution translator ([Spec S03](#s03-build-wire-payload)) |
| `tugdeck/src/lib/image-downsample.ts` | Canvas-based image normalization pipeline ([Spec S04](#s04-image-downsample)) |
| `tugdeck/src/lib/text-attachment.ts` | Text-source classifier (MIME + extension allowlist) and async reader with 1 MB cap; powers the Finder-text-drop branch of the drop pipeline per [D02](#d02-image-attach-text-rest) |
| `tugdeck/src/components/tugways/cards/tug-attachment-strip.tsx` | Image thumbnail strip ([Spec S06](#s06-attachment-strip)) |
| `tugdeck/src/components/tugways/cards/tug-attachment-strip.css` | Strip styling |
| `tugdeck/src/components/tugways/cards/tug-atom-text-body.tsx` | Pure React walker — splits `text` at `U+FFFC`, interleaves `<img>` per atom via `buildAtomSVGDataUri` ([Spec S05](#s05-atom-chip)) |

#### Files modified {#files-modified}

| File | Change |
|------|--------|
| `tugdeck/src/lib/tug-atom-img.ts` | `AtomSegment.id?: string`; extract `buildAtomSVGDataUri` as a pure helper; `createAtomImgElement` keeps current shape, calls the helper internally |
| `tugdeck/src/components/tugways/tug-text-editor/drop-extension.ts` | `await downsampleImage` for image files; mint atom-id; stash bytes |
| `tugdeck/src/components/tugways/tug-text-editor/clipboard-filters.ts` | Paste handler for `image/*` `ClipboardItem`; same path as drop |
| `tugdeck/src/lib/code-session-store.ts` | Pass `bytesStore` ref into the reducer; expose via send wrapper |
| `tugdeck/src/lib/code-session-store/reducer.ts` | `handleSend` and queued-flush use `buildWirePayload`; commit path bakes thumbnails; `handleAddUserMessage` converts attachments to atoms cleanly |
| `tugdeck/src/lib/code-session-store/types.ts` | `AttachmentRecord` shape; `TurnEntry.userMessage.attachments` typed |
| `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` | `UserMessageCell` renders `TugAttachmentStrip` + `TugAtomTextBody` |
| `tugdeck/src/components/tugways/cards/tool-blocks/read-tool-block.tsx` | Path rendered as inline `<img>` via `buildAtomSVGDataUri` |
| `tugdeck/src/components/tugways/cards/tool-blocks/edit-tool-block.tsx` | Same |
| `tugdeck/src/components/tugways/cards/tool-blocks/write-tool-block.tsx` | Same |
| `tugdeck/src/components/tugways/cards/tool-blocks/notebook-edit-tool-block.tsx` | Same, for both `file_path` and `notebook_path` |
| `tugrust/crates/tugcast/src/feeds/filetree_provider.rs` | Built-in denylist ([List L01](#l01-secret-file-denylist)); `.tugattachignore` reader |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `AtomBytesEntry` | type | `atom-bytes-store.ts` | [Spec S02](#s02-atom-bytes-store) |
| `AtomBytesStore` | interface | `atom-bytes-store.ts` | [Spec S02](#s02-atom-bytes-store) |
| `createAtomBytesStore` | factory | `atom-bytes-store.ts` | Returns a fresh per-card instance |
| `AttachmentRecord` | type | `code-session-store/types.ts` | `{ id, role, filename, mediaType, thumbnailDataUrl, byteSize }` |
| `buildWirePayload` | fn | `build-wire-payload.ts` | [Spec S03](#s03-build-wire-payload) |
| `downsampleImage` | fn | `image-downsample.ts` | [Spec S04](#s04-image-downsample) |
| `isAnimatedGif` | fn | `image-downsample.ts` | Pure GIF frame-count detector per [Q04](#q04-animated-gif) |
| `bakeThumbnail` | fn | `image-downsample.ts` | Calls into the same canvas pipeline at 256 px target |
| `buildAtomSVGDataUri` | fn | `tug-atom-img.ts` | [Spec S05](#s05-atom-chip); pure SVG-data-URI helper extracted from `createAtomImgElement` |
| `TugAtomTextBody` | component | `tug-atom-text-body.tsx` | [Spec S05](#s05-atom-chip); pure React walker — splits `(text, atoms)` at `U+FFFC`, interleaves `<img>` per atom |
| `TugAttachmentStrip` | component | `tug-attachment-strip.tsx` | [Spec S06](#s06-attachment-strip) |
| `AtomSegment.id` | field | `tug-atom-img.ts:24` | Optional; minted at drop / paste |
| `SECRET_FILE_DENYLIST` | const | `filetree_provider.rs` | [List L01](#l01-secret-file-denylist) |
| `read_tugattachignore` | fn | `filetree_provider.rs` | Reads `.tugattachignore` at workspace root if present |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `roadmap/transport-exploration.md` §Test 23 with a note pointing at this plan as the v1 consumer of the image content-block path baseline.
- [ ] Update `tuglaws/tuglaws.md` if any new responder / state-preservation laws emerge from the bytes-store integration.
- [ ] If the `.tugattachignore` feature accrues enough surface to warrant documentation, fold it into the appropriate `tuglaws/` entry rather than spawning a freestanding doc file.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (TS)** | Pure-function coverage | `build-wire-payload`, `atom-bytes-store`, `image-downsample` (with canvas mocks) |
| **Unit (Rust)** | Filter provider coverage | `filetree_provider` built-in denylist, `.tugattachignore` parse |
| **Integration (TS)** | Reducer + store + bytes-store wiring | `code-session-store/__tests__/reducer.test.ts` extensions for `handleSend` and `handleAddUserMessage` |
| **Render** | Component renders correctly | `tug-atom-text-body.test.tsx`, `tug-attachment-strip.test.tsx`, `tide-card-transcript.test.tsx` |
| **Golden / Catalog** | Existing fixture regression | `test-23-image-attachment.jsonl` byte-identical pre/post the wire-flattening landing |
| **End-to-end (`just app-test`)** | Full submit → render → cold-restart loop | Step 8 integration check |
| **Manual smoke** | UX regressions catchable only by eye | Drop a 4K PNG, paste a screenshot, `@`-mention `CLAUDE.md`, submit, observe |

---

### Execution Steps {#execution-steps}

> Each step is one PR-sized commit. Build green at every commit. Steps 1-4 are mostly independent and can land in any order; Steps 5-7 build on the earlier work and must land in sequence. Step 8 is the verification step.

#### Step 1: Image downsample primitive {#step-1}

**Commit:** `feat(tugdeck): image-downsample canvas-based pipeline for inline images`

**References:** [D05](#d05-client-downsample), [Spec S04](#s04-image-downsample), [Table T03](#t03-downsample-decisions), [Risk R01](#r01-canvas-blocking), [Q02](#q02-heic-avif), [Q04](#q04-animated-gif), (#strategy)

**Artifacts:**
- `tugdeck/src/lib/image-downsample.ts` — implements [Spec S04](#s04-image-downsample) per [Table T03](#t03-downsample-decisions).
- `tugdeck/src/lib/__tests__/image-downsample.test.ts` — pure-logic coverage (`isAnimatedGif`, `classifySourceMime`, `fitWithinLongEdge`, exported constants). Canvas-execution behaviors are verified in the real-app integration tests that arrive with Step 2.

**Tasks:**
- [x] Implement `isAnimatedGif(bytes: Uint8Array): boolean` — frame-count detection via image-descriptor markers per [Q04](#q04-animated-gif).
- [x] Implement the GIF pre-check branch: animated → size-only validation; static → canvas pipeline.
- [x] Implement the `createImageBitmap` path with `HTMLImageElement` fallback per [D05](#d05-client-downsample).
- [x] Implement dimension resize to long-edge ≤ 2576 px.
- [x] Implement re-encode by source MIME with JPEG quality ladder (90/80/70/60).
- [x] Implement SVG rasterization at 1024×1024.
- [x] HEIC / AVIF / HEIF flow through the standard raster branch — WebKit decodes them natively via `createImageBitmap`. No special-case branch. Per [Q02](#q02-heic-avif).
- [x] Surface `unsupported-format`, `too-large-after-fallback`, `decode-failed` discriminated errors.
- [x] Export `bakeThumbnail` as a thin wrapper around the same pipeline at 256 px target.

**Tests:**
- [x] `unit: isAnimatedGif on known animated fixture → true` (multiple variants: two consecutive descriptors, descriptors with intervening GCE, three descriptors)
- [x] `unit: isAnimatedGif on known static fixture → false` (multiple variants: GIF89a, GIF87a, no-GCT, with-comment-extension)
- [x] `unit: isAnimatedGif false-positive resistance — `0x2C` inside GCT, Application Extension, and LZW data must not count`
- [x] `unit: isAnimatedGif malformed inputs return false gracefully — empty, too-short, wrong magic, truncated, no-trailer, unknown block byte`
- [x] `unit: classifySourceMime decision matrix — raster MIMEs, GIF, SVG, unsupported, case-insensitivity`
- [x] `unit: fitWithinLongEdge — under cap passes through; oversize scales aspect-preserving; thumbnail and SVG targets; degenerate inputs; sub-pixel clamp to 1`
- [x] `unit: exported constants pinned (MAX_LONG_EDGE_PX, MAX_BYTE_SIZE, THUMBNAIL_MAX_EDGE_PX, SVG_RASTER_MAX_EDGE_PX, JPEG_QUALITY_LADDER monotonic descent)`
- [ ] Canvas-execution coverage (oversize PNG → 2576 px; JPEG quality fallback; PNG→JPEG transcode; SVG raster; corrupt-blob decode-failed; GIF passthrough byte-equality) — exercised by Step 2's real-app integration tests when drop/paste invoke `downsampleImage` against actual files.

**Checkpoint:**
- [x] `bun test src/lib/__tests__/image-downsample.test.ts` (52 pass, 0 fail, 60 expect() calls)
- [x] `bun test` (full tugdeck suite: 2874 pass, 0 fail)
- [x] `bun run check` (TypeScript clean)
- [x] `bun run audit:tokens lint` (zero violations)
- [ ] Manual: drop a real 4K screenshot in Tug.app; observe that `downsampleImage` produces a ≤ 5 MB output (verified via console log). — deferred to Step 2 when drop/paste handlers invoke the pipeline.
- [ ] Manual: drop a `.heic` photo in Tug.app — canvas decode succeeds, image flows through (smoke-verifies [Q02](#q02-heic-avif) on the live surface). — deferred to Step 2.

---

#### Step 2: Browser bytes side-table + drop/paste capture {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): atom-bytes-store + drop/paste image bytes capture`

**References:** [D03](#d03-atom-bytes-store), [Spec S02](#s02-atom-bytes-store), [Table T01](#t01-failure-modes), [Risk R01](#r01-canvas-blocking), (#strategy)

**Artifacts:**
- `tugdeck/src/lib/atom-bytes-store.ts` — implements [Spec S02](#s02-atom-bytes-store) (+ `clear()` for store-dispose drain).
- `AtomSegment.id?: string` field added in `tug-atom-img.ts`.
- `drop-extension.ts` exports the async `processAttachmentFiles` helper used by both drop and paste; `tugDropExtension` factory now accepts optional `getBytesStore` + `onAttachmentError` thunks. DOM-managed processing indicator (≥100 ms threshold).
- `clipboard-filters.ts` `clipboardExt` becomes `clipboardExtension(getBytesStore, onAttachmentError)`; `handlePaste` detects `image/*` clipboard items and routes through the shared pipeline. Legacy `clipboardExt` const preserved with default thunks.
- `tug-text-editor.tsx` props gain `attachmentBytesStore` + `onAttachmentError`; ref-mirrored and threaded into `buildExtensions`.
- `tug-prompt-entry.tsx` reads `attachmentBytesStore` from `codeSessionStore.getAtomBytesStore()` and passes `codeSessionStore.publishAttachmentError` as the error callback.
- `code-session-store.ts` owns the per-card `AtomBytesStore` instance, exposes `getAtomBytesStore()`, and has a new `publishAttachmentError(message)` dispatcher.
- Reducer: new `attachment_rejected` `lastError.cause` (in `reducer.ts`, `types.ts`, and `events.ts`); banner label added to `tide-card.tsx` `CAUSE_LABELS`.
- `useCardStatePreservation` extended: `TugPromptEntryState.attachmentBytes` slot + `coerceAttachmentBytes` defensive coercion; onSave snapshots the store, onRestore feeds `bytesStore.restore`.
- CASE-A interrupt restore inherits the bytes-store snapshot (no new code; the state-preservation snapshot covers it).

**Tasks:**
- [x] Implement `AtomBytesStore` per [Spec S02](#s02-atom-bytes-store) with a `Map<string, AtomBytesEntry>` backing (plus `size()` / `clear()` helpers).
- [x] Add `id?: string` to `AtomSegment` and ensure all existing constructions compile.
- [x] Wire `downsampleImage` into `drop-extension.ts` per [D05](#d05-client-downsample); non-image drops continue to use `defaultFilesToAtoms` with no bytes; gallery card's custom handler still wins.
- [x] Wire the paste handler in `clipboard-filters.ts` for `image/*` clipboard items; non-image clipboard items continue through the existing path.
- [x] Wire bytes-store snapshot into `useCardStatePreservation` (new bag slot `attachmentBytes`).
- [x] Show a processing-indicator overlay for `downsampleImage` operations exceeding 100 ms ([Risk R01](#r01-canvas-blocking)) — DOM-managed inside `view.scrollDOM`, themed via the substrate's `baseTheme` (no React state, [L06]).
- [x] Surface `downsampleImage` errors via the `lastError` channel per [Table T01](#t01-failure-modes) — new `attachment_rejected` cause renders through the existing banner.

**Tests:**
- [x] `unit: put / get / delete / snapshot / restore round-trip on AtomBytesStore` (26 pure-logic tests in `__tests__/atom-bytes-store.test.ts`)
- [x] `unit: snapshot returns a fresh object; entries are fresh shapes; JSON-serializable`
- [x] `unit: restore is additive on existing keys; overwrites overlapping ids; filters malformed entries`
- [x] `unit: clear drops all entries; idempotent on empty`
- [x] `unit: instance independence — two stores share no state`
- [ ] Real-app coverage of drop / paste pipelines against actual image bytes — exercised by the integration smoke in Step 8's `just app-test` recipe (the canvas pipeline behavior is verified in the same surface that runs the production code).

**Checkpoint:**
- [x] `bun test` — full tugdeck suite, **2900 pass, 0 fail**
- [x] `bun run check` — TypeScript clean
- [x] `bun run audit:tokens lint` — zero violations
- [x] `cargo nextest run --workspace` — 1324 pass, 0 fail
- [ ] Manual: drop image → close and reopen the card → atom is restored with bytes intact (state preservation works). — deferred to Step 8's manual smoke alongside the rest of the end-to-end flow (drop/paste integration depends on Step 3's wire-flattening to actually exercise the bytes-store at submit).

---

#### Step 3: Wire flattening at submit time {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): buildWirePayload — substitute U+FFFC and pack image attachments`

**References:** [D01](#d01-ffc-substitution-at-submit), [D02](#d02-image-attach-text-rest), [Spec S03](#s03-build-wire-payload), [List L03](#l03-atom-to-wire-mapping), [Table T01](#t01-failure-modes), (#send-path)

**Artifacts:**
- `tugdeck/src/lib/build-wire-payload.ts` — pure function per [Spec S03](#s03-build-wire-payload). Returns `{ wireText, attachments }` from `(text, atoms, bytesStore)`. Single O(n) pass; image atoms with bytes emit `Attachment` records, all atoms substitute their `value` into the text.
- `Attachment` wire type defined in `tugdeck/src/protocol.ts`; `InboundMessage.user_message.attachments` tightened from `unknown[]` to `Attachment[]`.
- `code-session-store.ts:send(text, atoms)` calls `buildWirePayload` with the per-card `AtomBytesStore` and dispatches `SendActionEvent { text, atoms, wireText, attachments, turnKey }` with both substrate-form and wire-form populated.
- `SendActionEvent` (in `events.ts`) gains `wireText: string` + `attachments: Attachment[]` slots.
- Internal `queuedSends` entry shape (in `reducer.ts`) extended with `wireText` + `attachments` so the queue-flush at `handleTurnComplete` can construct the `send-frame` effect without re-reading the bytes-store — keeping the reducer pure.
- `reducer.ts:handleSend` (`reducer.ts:680-815`) and queued-send flush (`reducer.ts:2160-2240`) consume the flattened payload: the wire `send-frame` reads `event.wireText` + `event.attachments`; the substrate `UserMessage` keeps `event.text` + `event.atoms` (raw, with `U+FFFC`, for transcript chip placement).
- 40+ reducer-side test sites updated to populate the new fields on `SendActionEvent` constructions.

**Tasks:**
- [x] Implement `buildWirePayload` per [Spec S03](#s03-build-wire-payload).
- [x] Define `Attachment` in `protocol.ts` and tighten `InboundMessage.user_message.attachments`.
- [x] Plumb the bytes-store read through `code-session-store.send` → `buildWirePayload` → action → reducer.
- [x] Replace the `text: event.text` and `attachments: []` literals in `handleSend` and queued-flush with the flattened values (`event.wireText` / `event.attachments`).
- [x] Extend `queuedSends` entry shape so the queue-flush has pre-flattened wire data; mid-turn push captures all four fields.
- [x] Update reducer-side tests that construct `SendActionEvent` to populate `wireText` + `attachments` (40+ sites across `__tests__/reducer.*.test.ts`).

**Tests:**
- [x] `unit: buildWirePayload — text with multiple U+FFFC and matching atoms → wireText substitutes correctly`
- [x] `unit: buildWirePayload — image atom with bytes → Attachment emitted with correct content + mediaType + filename`
- [x] `unit: buildWirePayload — image atom missing from bytes-store → Attachment skipped; text substitution proceeds`
- [x] `unit: buildWirePayload — atoms.length < count(U+FFFC) → leftover U+FFFC passes through (defensive)`
- [x] `unit: buildWirePayload — atoms.length > count(U+FFFC) → extra atoms dropped`
- [x] `unit: buildWirePayload — file / doc / link / command atoms → text-only emission, no Attachment`
- [x] `unit: buildWirePayload — mixed image + file + image — attachments only for images; document order preserved`
- [x] `unit: buildWirePayload — purity (no atom or bytes-store mutation; same inputs → same outputs)`
- [x] `unit: buildWirePayload — non-ASCII characters around atoms preserved verbatim`
- [ ] `integration: handleSend with one image atom + one file atom → send-frame carries 1 Attachment and wireText with substituted values` — exercised by Step 8's end-to-end app-test (a synthetic test against `reducer.handleSend` would just re-pin what the pure tests already pin, since both halves are pure functions).
- [ ] `integration: queued-send flush — same shape assertions` — same.

**Checkpoint:**
- [x] `bun test` — full tugdeck suite, **2924 pass, 0 fail** (24 new buildWirePayload tests + 40+ updated reducer-test constructions)
- [x] `bun run check` — TypeScript clean
- [x] `bun run audit:tokens lint` — zero violations
- [ ] Manual: drop a PNG → submit → observe in Tug.app's dev tools that the WS frame carries an `Attachment` with real bytes; claude responds describing the image, not "I see U+FFFC objects". — deferred to Step 8's manual smoke (depends on Step 5's transcript rendering to fully verify the user-visible flow).

---

#### Step 3.5: Drop UX polish — drag-level rejection, off-thread downsample, skeleton fidelity {#step-3-5}

**Depends on:** #step-3

**Commit:** `fix(tugdeck): drag-level rejection, worker downsample, skeleton polish`

**References:** [D02](#d02-image-attach-text-rest), [D05](#d05-client-downsample), [Risk R01](#r01-canvas-blocking), [Spec S02](#s02-atom-bytes-store), [Spec S04](#s04-image-downsample), [List L03](#l03-atom-to-wire-mapping), (#strategy)

**Why this step exists:** Step 3 shipped the wire flattening, text-attachment support, and a v1 skeleton-atom drop UX. Live testing surfaced four defects the v1 design didn't anticipate:

1. **Banner cascade.** `tide-card.tsx`'s `sessionErrored` check treats *any* `lastError` (except `resume_failed`) as "session is dead", showing the unplug-icon alert dialog. When the new `attachment_rejected` cause landed there, dropping a PDF triggered the catastrophic session-failure dialog. The cause is transient input feedback, not a dead session.
2. **Drop-time rejection feels overblown.** The v1 design accepts an unsupported drop and then surfaces a banner explaining it was rejected. The browser drag-and-drop API supports rejection *at hover time* via the `dragover` handler's `preventDefault` gate — the OS shows the no-drop cursor and the drop event never fires. The right model rejects at the cursor, not via a post-drop banner.
3. **Main thread blocked during encode.** v1's `paintTo` + `convertToBlob` run on the main thread (even with `OffscreenCanvas`, since the canvas was never transferred to a Worker). A 25 MB image jams the UI for ~2 s — keystrokes, scrolls, button clicks all stalled. The right answer is a true Web Worker that owns an `OffscreenCanvas` via `transferControlToOffscreen`.
4. **Skeleton atom appearance + render bugs.** The v1 `opacity: 0.55` + pulse reads as "slightly dim" rather than "actively processing". And dropping into a brand-new, empty editor sometimes shows nothing at all (the atom is inserted but doesn't render — likely a focus / measure timing issue).

This step closes all four. Worker-bound canvas pipeline is the load-bearing piece; the others are smaller cleanups that hang off the same UX rework.

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` — `sessionErrored` excludes `attachment_rejected` alongside `resume_failed`. The banner still surfaces via the existing banner channel; only the session-dead overlay path is bypassed.
- `tugdeck/src/components/tugways/tug-text-editor/drop-extension.ts` — `dragover` handler examines `event.dataTransfer.items` and refuses (no `preventDefault`) when every item has a known-unsupported MIME (`application/pdf`, `application/zip`, `audio/*`, `video/*`, etc.). Drop-time rejection banner is removed; the cursor signal replaces it. The drop handler silently skips unsupported items in mixed drops.
- New `tugdeck/src/lib/workers/image-downsample-worker.ts` — Web Worker that owns the canvas pipeline. Decodes via `createImageBitmap`, resizes via `OffscreenCanvas`, encodes via `convertToBlob`, posts the result back. All heavy work off the main thread.
- `tugdeck/src/lib/image-downsample.ts` — main-thread `downsampleImage` becomes a thin client that spawns a worker (one per call), posts the Blob, awaits the result, terminates the worker. `bakeThumbnail` follows the same shape.
- `tugdeck/src/components/tugways/tug-text-editor/atom-decoration.ts` — `pendingAtomTheme` rewritten: wider pulse amplitude (0.45 ↔ 0.95), animated icon-slot spinner, ellipsis suffix on the label so the chip clearly reads "this is processing".
- `tugdeck/src/components/tugways/tug-text-editor/drop-extension.ts` (insertion path) — after `insertAtomsAt`, dispatch `view.focus()` + `view.requestMeasure({ read() { return null; } })` so a drop on an unfocused / unmeasured editor doesn't drop the skeleton paint on the floor.

**Tasks:**
- [x] **3.5.1 — Banner cascade fix.** `tide-card.tsx`'s `sessionErrored` excludes `"attachment_rejected"` alongside `"resume_failed"`. The banner-spec helper still produces an error banner for the cause; only the session-dead overlay path is bypassed. New banner-spec test pins this.
- [x] **3.5.2 — Drag-level rejection.** `tugDropExtension`'s `dragenter` / `dragover` call `dragHasSupportedItem(event.dataTransfer)` — walks `DataTransferItemList`, accepts when any item has a supported image MIME, text MIME, or empty MIME (defers to drop-time extension classification). If all items are known-unsupported, returns without `preventDefault` → the OS shows the no-drop cursor and the `drop` event never fires. `classifyDroppedFiles`'s third branch silently skips unsupported items (mixed-drop case only — pure-unsupported drags never reach this handler). New `isTextMimeType` export in `text-attachment.ts` does the MIME-only check without filename access.
- [x] **3.5.3 — Web Worker downsample.** New `tugdeck/src/lib/workers/image-downsample-worker.ts` owns the canvas pipeline (decode + resize + encode + thumbnail bake). Main-thread `downsampleImage` and `bakeThumbnail` become thin worker shims that spawn one-shot workers per call, post the Blob, await the discriminated response, and terminate. Worker uses its own `OffscreenCanvas` (not transferred from main thread) so all heavy paint / encode work runs off the main event loop. Pure helpers (`isAnimatedGif`, `classifySourceMime`, `fitWithinLongEdge`) and constants remain in `image-downsample.ts` and are imported by the worker.
- [x] **3.5.4 — Skeleton visual polish.** `pendingAtomTheme` rewritten with wider opacity amplitude (0.4 ↔ 1.0, was 0.55 ↔ 0.85) plus a saturation pulse (0.4 ↔ 1.0) so the chip desaturates at the trough and snaps back to full color at the crest. Faster cycle (1.0 s, was 1.2 s) reads as active rather than ambient. Spinner glyph / ellipsis suffix deferred — the opacity + saturation combination tested clearly enough that the additional SVG overlay was unnecessary.
- [x] **3.5.5 — Empty-editor skeleton-render fix.** After `insertAtomsAt` in `processAttachmentFiles`, call `view.focus()` + `view.requestMeasure({ read: () => null })` so a drop into an unmeasured / unfocused editor flushes layout in the same frame as the insertion. Both are idempotent no-ops in the common case (already-focused + already-measured editor).
- [x] **3.5.6 — Drag visual feedback restoration + reject CSS infrastructure for Step 3.5.7.** Three sub-fixes:
  1. *Banner cascade still applied* (3.5.1) — the `attachment_rejected` `lastError` cause was being treated as session-dead, triggering the unplug-icon alert. Fixed by extending `tide-card.tsx`'s `sessionErrored` exclusion list (already done in 3.5.1).
  2. *PDF rejection design walked back.* The 3.5.2 intent — cursor-level rejection via `dragover` returning false for unsupported items — turned out to be infeasible in WKWebView. Instrumented logging confirmed: WebKit redacts `DataTransfer.items` entirely during `dragenter` / `dragover` for cross-origin Finder drags (`items.length === 0`, `files.length === 0`; only `types: ["Files"]` is exposed). At drop time the full MIME info appears. This is [WebKit bug #223517](https://bugs.webkit.org/show_bug.cgi?id=223517), unresolved as of December 2023 — confirmed not fixable from JS by any preference / flag / configuration. Path A (this step) backs out to JS-only accept-all-then-silent-skip-at-drop; Path B (Step 3.5.7 below) brings cursor-level rejection back via a native bridge.
  3. *Three-state `setDropActive` + reject-ring CSS preserved for Path B.* The `null | "accept" | "reject"` state machine and the `[data-drop-active="reject"]` CSS rule (paints the border in `--tug7-element-global-border-normal-danger-rest`) stay in place as infrastructure ready for the native bridge to flip it on. Today JS-only code only ever sets `"accept"` or `null`.

  Net result of 3.5.6: `dragenter` / `dragover` always claim file drags (override CM6's internal handler), always show the accept ring + copy cursor, never reject at the cursor. `drop` calls `dropHasSupportedFile` which inspects the now-unredacted `dataTransfer.files` and refuses pure-unsupported drops silently (no atom, no banner — the missing chip is the signal).

**Tests:**
- [x] `unit: tide-card-banner-spec — attachment_rejected surfaces as banner error, does NOT escalate to session-dead overlay` (Step 3.5.1)
- [x] `unit: isTextMimeType — text/*, application/* allowlist, charset stripping, empty MIME returns false, binaries rejected` (Step 3.5.2 supporting tests)
- [ ] `unit: dragHasSupportedItem` synthetic-DataTransferItemList tests (Step 3.5.2) — DataTransferItemList isn't constructible in pure-logic Bun tests; covered via the real-app drag in Step 8.
- [ ] Manual: drop a 25 MB PNG; observe the editor stays responsive to keystrokes throughout encoding. (Step 3.5.3)
- [ ] Manual: drop a PDF onto the editor; observe the OS no-drop cursor; release; observe no banner / no atom appears. (Step 3.5.2)
- [ ] Manual: open a fresh card with empty editor; drop a PNG; skeleton atom appears immediately at the drop point. (Step 3.5.5)

**Checkpoint:**
- [x] `bun test` — full tugdeck suite, **2983 pass, 0 fail**
- [x] `bun run check` — TypeScript clean
- [x] `bun run audit:tokens lint` — zero violations
- [ ] Manual: all three drop scenarios above behave correctly.

---

#### Step 3.5.7: Native drag bridge — cursor-level rejection via NSDraggingDestination {#step-3-5-7}

**Depends on:** #step-3-5

**Commit:** `feat(tugapp+tugdeck): native drag bridge for cursor-level file-type rejection`

**References:** [D02](#d02-image-attach-text-rest), [Spec S04](#s04-image-downsample), (#strategy)

**Why this step exists:** Step 3.5.6 walked back cursor-level rejection because it's infeasible in JS-only WKWebView code — [WebKit bug #223517](https://bugs.webkit.org/show_bug.cgi?id=223517) reveals empty `DataTransferItemList` during `dragenter` / `dragover` for cross-origin file drags (the Finder drag case). The bug is unresolved and the WebKit team's own documented workaround is *"the only workaround to this bug is not to filter by file type at all"*. That's the JS world's hard ceiling.

But Tug.app is not the JS world. Tug.app is a macOS app whose Swift host owns the WKWebView's container view. The native side has full access to `NSPasteboard` during drag — including all UTIs / MIMEs / filenames / file URLs — because it operates outside the sandboxed web content. The right architecture: native side reads the pasteboard, native side posts the file info to JS via `WKScriptMessageHandler`, JS uses that info to drive the same `dragHasSupportedItem` style accept/reject decision the cursor-level CSS already supports (Step 3.5.6 preserved the `[data-drop-active="reject"]` rule and the three-state `setDropActive` for exactly this).

This step ships that bridge. After it lands, dragging a PDF over the prompt entry shows the red rejection ring and the OS no-drop cursor *before release* — the original UX intent of Step 3.5.2.

**Strategy:**
- Use macOS's `NSDraggingDestination` protocol on the WKWebView's container view (or a thin subclass). `draggingEntered:`, `draggingUpdated:`, `draggingExited:`, and `prepareForDragOperation:` receive the full `NSDraggingInfo` with `NSPasteboard` access.
- Read the pasteboard's file URLs (`NSPasteboard.PasteboardType.fileURL`) at every drag update. Resolve each to its UTI / MIME via `NSWorkspace.shared.type(ofFile:)` or the file URL's `getResourceValue(forKey: .typeIdentifierKey)`.
- Post the drag-snapshot to JS via the existing message channel (already used by the test harness for `evalJS`). JS-side reads from a new global (e.g., `window.__tugActiveDrag`) keyed by drag-session id; the drop extension's `dragHasSupportedItem` checks this in addition to (or instead of) `event.dataTransfer`.
- On `draggingExited:` / drop end, clear the JS-side snapshot so a subsequent drag starts fresh.
- All JS-side classification logic from `dragHasSupportedItem` + `isTextMimeType` + `classifySourceMime` works unchanged on the bridge data.

#### [Q05] Bridge message timing vs. dragover events (OPEN) {#q05-bridge-timing}

**Question:** WKWebView's `dragenter` / `dragover` events fire synchronously when the OS dispatches the drag to the WebView. The native bridge's `WKScriptMessageHandler.postMessage` is asynchronous (queued on the JS thread). Can JS see the bridge data inside the same `dragover` tick that fired, or does the bridge data lag by one event?

**Why it matters:** If the bridge data lags, the first dragover frame after `draggingEntered:` would see no data and would have to default to "accept" — flashing the accept ring before the reject ring on the next frame. Annoying but not catastrophic; we'd document it.

**Plan to resolve:** Build the bridge minimally first (Step 3.5.7.a), measure the timing in dev panel, decide on a synchronization strategy (probably: native side calls `evaluateJavaScript("window.__tugActiveDrag = ...")` synchronously inside `draggingEntered:`, which blocks until JS receives the assignment — slower but synchronization-correct).

**Resolution:** RESOLVED — async eval-JS with one-frame race window. Native side calls `webView.evaluateJavaScript("window.__tugActiveDrag = <json>")` *before* invoking `super.draggingEntered:`, so the assignment task is queued ahead of the synthesized JS dragenter event on the WebContent runloop's task queue. Both land on the same JS thread; queue ordering means the assignment is processed first. The first dragover after a fresh drag may still race ahead of the assignment by one tick — the JS reader treats that as `getCurrentDragFiles() === null` and falls back to the legacy `types.includes("Files")` accept-all behavior for that one frame. Every subsequent dragover frame sees the snapshot and classifies accurately. The first-frame fallback is identical in appearance to the pre-3.5.7 Path A behavior, so the regression cost of the race is zero; the win is that sustained drags (which spend ≫ 1 frame over the editor) stabilize on the correct accept / reject ring well before the user decides whether to release.

Synchronous evaluateJavaScript is *not* used — it would block the AppKit drag dispatch on the WebContent runloop, which is fragile under heavy JS load and unnecessary given that the one-frame race is benign.

**Artifacts:**
- `tugapp/Sources/Drag/PasteboardSnapshot.swift` (new) — pure-Swift `Codable` struct that reads file URLs from `NSPasteboard` (via `readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true])`), resolves each URL's UTI via `URLResourceKey.typeIdentifierKey` (falling back to `UTType(filenameExtension:)`) and converts to a preferred MIME, returns `{ files: [{ name, mimeType?, size? }] }`. Has a `jsonString()` helper that emits sorted-keys JSON for embedding into an `evaluateJavaScript` literal.
- `tugapp/Sources/Drag/TugDragDestination.swift` (new) — a thin object that holds a weak reference to a `WKWebView`. `observeDragUpdate(sender:)` snapshots the pasteboard and pushes the JSON into JS via `webView.evaluateJavaScript("window.__tugActiveDrag = <json>")`. `observeDragEnded()` pushes `null`. Logs `evaluateJavaScript` errors via `NSLog`.
- `tugapp/Sources/Drag/TugWebView.swift` (new) — `WKWebView` subclass that overrides `draggingEntered`, `draggingUpdated`, `draggingExited`, and `concludeDragOperation`. Each override calls the corresponding `TugDragDestination` observer *before* invoking `super`, so the snapshot assignment is queued ahead of WebKit's synthesized JS dragenter event on the WebContent runloop (see [Q05](#q05-bridge-timing)).
- `tugapp/Sources/MainWindow.swift` (modify) — `webView = TugWebView(frame: .zero, configuration: config)` (was `WKWebView(...)`). Single-line change; `TugWebView IS-A WKWebView`, so all existing call sites (`testHarnessWebView`, `evaluateJavaScript`, navigation delegate, etc.) keep working unchanged.
- `tugapp/Tug.xcodeproj/project.pbxproj` (modify) — registers the three new Swift files in the `Sources` build phase and groups them under a new `Drag` PBXGroup.
- `tugdeck/src/lib/native-drag-bridge.ts` (new) — typed reader over the native-pushed `window.__tugActiveDrag` global. Exports `getNativeDragSnapshot(): NativeDragSnapshot | null` (full snapshot) and `getCurrentDragFiles(): readonly NativeDragFileEntry[] | null` (the files array). Both return `null` when the global is absent, explicitly `null`, or malformed — callers fall through to the legacy `types.includes("Files")` accept-all path. Defensive shape checks tolerate stray non-string `name` / non-string `mimeType` / non-number `size` entries.
- `tugdeck/src/lib/__tests__/native-drag-bridge.test.ts` (new) — pure-logic Bun tests pinning the absent / null / undefined / malformed-shape behavior. Thirteen tests, all green.
- `tugdeck/src/components/tugways/tug-text-editor/drop-extension.ts` (modify) — adds `nativeDragHasSupportedFile(entries)` (the per-entry classifier) and `dragOutcomeFromBridge()` (the bridge-or-fallback decision). `dragenter` and `dragover` consult `dragOutcomeFromBridge()` and pass the result to `setDropActive(host, …)`. The drop caret is suppressed during reject (no destination position to indicate). `dropEffect` is set to `"none"` for reject, `"copy"` for accept.
- `roadmap/tide-atoms.md` — [Q05](#q05-bridge-timing) marked RESOLVED with the chosen async-eval + one-frame race window strategy; [D02](#d02-image-attach-text-rest) updated to drop the "cursor rejection infeasible" caveat.

**Tasks:**
- [x] **3.5.7.a — Native scaffold.** New Swift files: `PasteboardSnapshot.swift`, `TugDragDestination.swift`, `TugWebView.swift`. Wire `TugWebView` into `MainWindow.swift` in place of `WKWebView`. At each `draggingEntered:` / `draggingUpdated:`, snapshot the pasteboard and call `webView.evaluateJavaScript("window.__tugActiveDrag = <JSON>")`. At `draggingExited:` / `concludeDragOperation:`, clear it (`window.__tugActiveDrag = null`).
- [x] **3.5.7.b — JS bridge consumer.** New `tugdeck/src/lib/native-drag-bridge.ts`. Reads `window.__tugActiveDrag` on demand (no polling; the drop extension calls the getter from inside `dragenter` / `dragover`). Exports `getCurrentDragFiles(): readonly NativeDragFileEntry[] | null` and `getNativeDragSnapshot()`.
- [x] **3.5.7.c — Wire drop-extension to the bridge.** New `dragOutcomeFromBridge()` returns `"accept"` or `"reject"` after consulting the bridge; falls back to `"accept"` when the bridge is absent (browser-only or first-frame race). `setDropActive(host, outcome)` drives the CSS ring; `dropEffect` flips between `"copy"` and `"none"`.
- [x] **3.5.7.d — Bridge-timing resolution.** [Q05](#q05-bridge-timing) resolved by design: queue the assignment before `super.draggingEntered`, accept the one-frame race window as benign (it degrades to Path A behavior for that single frame). Strategy documented at the head of `tugdeck/src/lib/native-drag-bridge.ts` and `tugapp/Sources/Drag/TugDragDestination.swift`. Dev-panel timing measurement deferred until a regression report cites a visible flash — the documented strategy already covers the case where the race window is wider than expected.
- [x] **3.5.7.e — Path B test surface.** Accepted as manual-only. WKWebView drag dispatch is driven by the macOS AppKit drag manager from a real human pointer down + motion + up, not by anything `evalJS` can synthesize. The existing app-test harness's `evalJS` synthesizes JS-level events (focus, keypress, click via CGEvent) but not OS-level NSDragging. Manual smoke verification (the three scenarios under **Tests**) is the contract.

**Tests:**
- [ ] `unit (Swift): PasteboardSnapshot — reads file URLs, resolves UTIs to MIMEs, returns the expected JSON shape` — deferred: no XCTest target exists in `tugapp/Tug.xcodeproj`. Adding one for a single test is disproportionate; the JS-side `native-drag-bridge.test.ts` pins the cross-language shape contract by exercising every well-formed and malformed payload shape the Swift side could emit, and the build + manual smoke catches any runtime divergence.
- [x] `unit (TS): native-drag-bridge — getCurrentDragFiles returns null when window.__tugActiveDrag is unset; returns parsed array when set` — pure-logic Bun test in `tugdeck/src/lib/__tests__/native-drag-bridge.test.ts`, 13 cases.
- [ ] Manual: drag a PDF over the prompt entry — observe red reject ring + OS no-drop cursor *before* release; release; observe no banner / no atom.
- [ ] Manual: drag a PNG — observe blue accept ring + OS copy cursor; release; observe skeleton atom appears and downsamples in the background.
- [ ] Manual: drag a mixed-content folder (PDF + PNG) — observe accept ring (at least one supported item); release; PNG appears, PDF silently skipped.

**Checkpoint:**
- [x] `cd tugapp && xcodebuild -scheme Tug -configuration Debug build` clean
- [x] `cd tugdeck && bun test && bun run check && bun run audit:tokens lint` clean (2996 / 2996 pass; tsc no-emit clean; zero token violations)
- [ ] Manual: the three scenarios above behave correctly in Tug.app.
- [x] [D02](#d02-image-attach-text-rest) updated to reflect cursor-level rejection working again.

---

#### Step pre-4: Per-card FILETREE_QUERY routing {#step-pre-4}

**Depends on:** (none — independent of Steps 1-3.5)

**Blocks:** [Step 4](#step-4)'s manual smoke (the `@`-popup must hit the card's project workspace, not the bootstrap, for the secret filter to be observable).

**Commit:** `feat(tugcast): route FILETREE_QUERY to per-card workspaces`

**References:** (this step), [`tugrust/crates/tugcast/src/main.rs:217-245`](../tugrust/crates/tugcast/src/main.rs) (the bootstrap-only adapter), [`tugrust/crates/tugcast/src/feeds/workspace_registry.rs`](../tugrust/crates/tugcast/src/feeds/workspace_registry.rs) (`W2` per-session `get_or_create`).

#### The bug, in one sentence {#step-pre-4-bug}

The `FILETREE_QUERY` adapter forwards every JS-side completion query to **`bootstrap.ft_query_tx`** — the single bootstrap workspace's filetree channel, fixed at startup to the tugtool repo. Per-session `WorkspaceEntry` instances are constructed for each tide-card project (each gets its own `FileWatcher`, `FileTreeFeed`, and now `SecretFilter`), but the routing adapter does not multiplex; their channels are never read from. Result: `@`-completion in a card whose project is `/tmp/files` queries the *tugtool repo's* index, returns matches against that index (or no matches at all), and the SecretFilter from [Step 4](#step-4) is provably unobservable from the popup.

This is a pre-existing architectural gap (`bootstrap.ft_query_tx.clone()` committed 2026-04-14), surfaced by the [Step 4](#step-4) manual smoke. It is independent of Step 4's code — Step 4 backend works correctly when queried directly (verified by the `/tmp/files` repro test), but the user-visible feature requires this routing fix.

#### Strategy {#step-pre-4-strategy}

The fix is small and additive — no protocol bump, no JS payload schema change beyond a field that already exists. Three layers:

1. **JS-side: populate the `root` field on every `FILETREE_QUERY`** with the active card's project directory. `FileTreeStore.sendQuery` already accepts an optional `root` parameter; `getFileCompletionProvider` currently passes none. The card-services layer knows the project dir at construction time — pass it down into `FileTreeStore` so the provider can include it on every query.

2. **Rust-side: registry lookup by path.** Add `WorkspaceRegistry::find_entry_by_path(&Path) -> Option<Arc<WorkspaceEntry>>`. Derives the `WorkspaceKey` the same way `get_or_create` does (canonical path → key), looks up the inner map.

3. **Rust-side: rewire the adapter.** Give the adapter task access to the registry (`Arc<WorkspaceRegistry>`). On each frame: if `root` is set and a registered entry matches, send to *that* entry's `ft_query_tx`; otherwise fall back to bootstrap (preserves single-workspace behavior and keeps the legacy `--source-tree`-only callers working).

The existing `[D09]` "retarget the bootstrap to a new root" semantics that lives inside `FileTreeFeed::handle_query` becomes dead code in production once JS always passes `root` — the registry lookup short-circuits before the retarget. Removing the retarget code is out-of-scope (low value, would churn tests); leaving it is harmless.

#### Artifacts {#step-pre-4-artifacts}

- `tugrust/crates/tugcast/src/feeds/workspace_registry.rs` (modify) — `find_entry_by_path(&Path) -> Option<Arc<WorkspaceEntry>>` that canonicalizes the input the same way `get_or_create` does (so a JS-supplied `/tmp/files` matches an entry registered as `/private/tmp/files`).
- `tugrust/crates/tugcast/src/main.rs` (modify) — adapter task captures `Arc<WorkspaceRegistry>`; per-frame lookup → entry-specific `ft_query_tx`; bootstrap fallback when the lookup misses or `root` is unset.
- `tugdeck/src/lib/filetree-store.ts` (modify) — `FileTreeStore` constructor takes an optional `projectDir` (string); `getFileCompletionProvider` passes it as `root` on every `sendQuery`.
- `tugdeck/src/lib/card-services-store.ts` (modify) — pass the card's `projectDir` into the `FileTreeStore` constructor at the existing construction site.

#### Tasks {#step-pre-4-tasks}

- [x] **pre-4.a — Registry lookup.** Added `WorkspaceRegistry::find_entry_by_path` that canonicalizes via `PathResolver::watch_path` (same as `get_or_create`) so `/tmp/files` matches an entry registered as `/private/tmp/files`. Three unit tests pin Some / None / canonicalization-match.
- [x] **pre-4.b — Adapter rewire.** Extracted the routing logic into `WorkspaceRegistry::route_filetree_query(ftq, &bootstrap_tx)` and collapsed the inline adapter in `main.rs` to call it. The legacy `[D09]` retarget path inside `FileTreeFeed::handle_query` is preserved but unreached for routed queries.
- [x] **pre-4.c — JS plumbing.** `FileTreeStore` gained an optional `projectDir: string` constructor arg; `getFileCompletionProvider` includes it as `root` on every `sendQuery`. `CardServicesStore` passes `binding.projectDir` at the construction site.
- [x] **pre-4.d — Stale-routing safety.** Matched-but-closed channel logs `warn!` and drops; *no* fall-through to bootstrap (a torn-down workspace's stale tugtool results would be the wrong UX). Unmatched root and absent root both fall through to bootstrap.

#### Tests {#step-pre-4-tests}

- [x] `unit (Rust): WorkspaceRegistry::find_entry_by_path returns Some for a registered path; returns None for an unknown path; canonicalizes a /tmp/files-style indirect input → matches the registered entry.` Three cases in `workspace_registry::tests`.
- [x] `integration (Rust): route_filetree_query with a matching root sends to the card workspace and not the bootstrap.` `test_route_filetree_query_routes_to_registered_workspace`.
- [x] `integration (Rust): route_filetree_query with an unknown root falls through to the bootstrap.` `test_route_filetree_query_falls_back_when_root_unknown`.
- [x] `integration (Rust): route_filetree_query with root=None falls through to the bootstrap.` `test_route_filetree_query_falls_back_when_root_absent`.
- [x] Manual: open a card with project `/tmp/files` (containing `.env`, `.tugattachignore` (`.env`), `bar`, `foo`); type `@` → see `bar`, `foo`, `.tugattachignore`; type `@.env` → no suggestion appears. This is the [Step 4](#step-4) manual smoke that this step unblocks. Verified live in Tug.app.

#### Checkpoint {#step-pre-4-checkpoint}

- [x] `cd tugrust && cargo nextest run -p tugcast` — 645 / 645 pass (was 639; +6 new routing/lookup tests).
- [x] `cd tugrust && cargo build --tests --workspace` — warnings-as-errors clean.
- [x] `cd tugdeck && bun test && bun run check && bun run audit:tokens lint` — 3009 / 3009 pass; tsc clean; zero token violations.
- [x] Manual: the `/tmp/files` scenario above behaves correctly in Tug.app — this also closes the last open checkbox of [Step 4](#step-4)'s checkpoint.

#### Out of scope {#step-pre-4-out-of-scope}

- **Other per-card feeds (FILESYSTEM, GIT) likely share the same bootstrap-only adapter shape.** Their UX impact in the W2 multi-workspace model is unknown today; surveying and (if needed) fixing them is a separate piece of work. This step is scoped to filetree because that is the one feature the [Step 4](#step-4) acceptance criteria need.
- **Retiring the `[D09]` retarget code in `FileTreeFeed::handle_query`** — once routing is the production path the retarget becomes dead but harmless. Removing it would churn existing retarget tests for no UX benefit; leave for a future cleanup.

---

#### Step 4: Completion-time secret-file filter + `.tugattachignore` {#step-4}

**Depends on:** [Step pre-4](#step-pre-4) (for manual smoke validation only; the backend itself is independent of Steps 1-3.5).

**Commit:** `feat(tugcast): filetree provider secret-file denylist + .tugattachignore`

**References:** [D06](#d06-completion-time-filter), [List L01](#l01-secret-file-denylist), [Risk R04](#r04-manual-path-leak), [Risk R05](#r05-tugattachignore-parser), (#permission-gating)

**Artifacts:**
- `tugrust/crates/tugcast/src/feeds/secret_filter.rs` (new) — `SECRET_FILE_DENYLIST` constant per [List L01](#l01-secret-file-denylist); `SecretFilter::new(workspace_root)` builds an `ignore::Gitignore` matcher combining the built-in patterns with `<workspace>/.tugattachignore` (optional); `is_secret(relative_path)` uses `matched_path_or_any_parents` so directory patterns like `local-secrets/` exclude their children. Parse errors logged via `tracing::warn!`; surviving patterns still apply. Note: actual filename is `secret_filter.rs` (not `filetree_provider.rs` — the live file is `filetree.rs`, and the new code lands in a sibling module to keep the walker / matcher concerns separated).
- `tugrust/crates/tugcast/src/feeds/filetree.rs` (modify) — `FileTreeFeed::new` builds the `SecretFilter` from `project_dir` and sweeps the freshly-walked `initial_files` through it (`Self::sweep_secrets`). `apply_events` skips secret-shape Create / Rename-to events so a freshly-dropped `.env` never enters the index. `off_board_query` filters per-entry against the bare filename (off-board paths sit outside the workspace, so we match against `name` not `relative_path`). The watcher batch handler detects both `.gitignore` and `.tugattachignore` changes — the latter rebuilds the matcher *before* the re-walk so the sweep sees current patterns. `retarget` rebuilds the matcher for the new root.
- `tugrust/crates/tugcast/src/feeds/mod.rs` (modify) — register `pub mod secret_filter`.

**Tasks:**
- [x] Add `SECRET_FILE_DENYLIST` constant in `secret_filter.rs` per [List L01](#l01-secret-file-denylist).
- [x] Implement `.tugattachignore` reader using the existing `ignore` crate; cache compiled patterns at filter construction.
- [x] Plumb the combined matcher into the per-query filter path (sweep at insertion + per-event filter + off-board per-entry); surface a tugcast-telemetry `parse-error` event on malformed patterns via `tracing::warn!` (the existing tugcast log channel) per [Table T01](#t01-failure-modes).
- [~] ~~Document the syntax in a fresh `docs/tugattachignore.md`~~ — dropped. The feature's externally-visible surface is small enough (one optional file, gitignore syntax) that a freestanding doc file is more clutter than help. Future need: fold into a `tuglaws/` entry alongside the related laws, not a standalone document.

**Tests:**
- [x] `unit (Rust): SECRET_FILE_DENYLIST matches .env, .env.local, *.pem, id_rsa*, secrets.json, .aws/credentials, .ssh/**, etc.` — 7 cases in `secret_filter::tests`.
- [x] `unit (Rust): .tugattachignore patterns parsed via the ignore crate match expected paths` — `tugattachignore_patterns_apply` + `missing_tugattachignore_is_not_an_error`.
- [x] `unit (Rust): combined match order — built-in denylist + .tugattachignore produce deny-precedence; malformed patterns don't disable the rest` — `tugattachignore_combined_with_builtin_in_one_filter` + `malformed_tugattachignore_line_does_not_disable_filter`.
- [x] `integration: FileTreeFeed against a synthetic workspace excludes secrets from empty/scored/off-board queries; apply_events skips secret creations` — five integration tests in `filetree::tests` covering initial-files sweep, scored query, .tugattachignore application, apply_events filtering, and off-board filtering.

**Checkpoint:**
- [x] `cd tugrust && cargo nextest run -p tugcast` — 639 tests pass.
- [x] `cd tugrust && cargo build --tests --workspace` — warnings-as-errors clean.
- [x] Manual: type `@.env` in the prompt-entry's `@`-popup in a workspace containing `.env` → no suggestion appears. Verified live in Tug.app against `/tmp/files`.

---

#### Step pre-5: Participant / row-cell rename — `code` → `assistant` {#step-pre-5}

**Depends on:** (none — independent refactor)

**Blocks:** [Step 5](#step-5) (Step 5 modifies a cell that gets renamed here; doing the rename first means Step 5's transcript-atom work targets the post-rename names from the outset).

**Commit:** `refactor(tugdeck): code → assistant in participant/row/cell layer`

**References:** [`tugdeck/src/lib/code-session-store/types.ts:104`](../tugdeck/src/lib/code-session-store/types.ts) (`MessageKind` — the substrate's message-forward source of truth), [`tugdeck/src/components/tugways/tug-transcript-entry.tsx:75`](../tugdeck/src/components/tugways/tug-transcript-entry.tsx) (`Participant` type), [`tugdeck/src/lib/tide-transcript-data-source.ts:123`](../tugdeck/src/lib/tide-transcript-data-source.ts) (`TideTranscriptCellKind`).

#### The inconsistency, in one sentence {#step-pre-5-inconsistency}

The substrate's `MessageKind` (`user_message | assistant_text | assistant_thinking | tool_use | system_note`) is message-forward and uses `assistant_*` for Claude's contributions, but the participant / row / cell layer above it still calls Claude's side `code` — `Participant = "user" | "code" | "shell"`, `TideTranscriptCellKind = "user" | "code" | "ghost"`, `CodeRowCell`, `participant="code"` JSX, `[data-participant="code"]` CSS. The migration is partly done — newer code (`half: "user" | "assistant"` types in `tide-card-transcript.tsx:937` and `tide-card.tsx:305`, `tide-assistant-renderer-dispatch.ts` filename) uses `assistant`, the legacy participant/row layer hasn't followed.

#### Strategy {#step-pre-5-strategy}

The rename is mechanical and lockstep — every `code` literal in the *participant / row / cell* layer becomes `assistant`. The user side gets a complementary rename to make the *pair* coherent: `UserRowCell` → `UserMessageCell` to mirror the fact that the user row carries exactly one `user_message`, while the assistant row aggregates a turn's worth of `assistant_*` + `tool_use` + `system_note` messages. The asymmetry is real in the data (one message vs. many) and should be visible in the names.

**Order of operations:** rename the *type literals* first (`Participant`, `TideTranscriptCellKind`, `TideZ1BParticipant`). Because they're typed string unions, tsc surfaces every legacy `"code"` consumer as a compile error — the typed substrate becomes the rename's enforcement gate. Sweeping CSS / data-attribute / doc-comment / test-fixture sites after that is grep work, but the type-error frontier guarantees no source consumer is missed.

**Distinct concepts that share the word `code` for unrelated reasons are LEFT ALONE:**

| Concept | Layer | Decision |
|---|---|---|
| `CodeSessionStore`, `code-session-store/` | Session class hosting Claude in coding mode | **Stays `code`** — session/card layer, not participant. |
| "Code card" | Tide card type | **Stays `code`** — card mode, not message participant. |
| `data-route="code"` (tide-route-indicator-badge) | Routing prefix `>` destination | **Stays `code`** — route name (where input is going), not speaker name. |
| Markdown ``` ``` block parsing | Programming-code rendering | **Stays `code`** — unrelated meaning of the word. |

**Renamed to `assistant`** — every site where `code` denotes "the AI participant in the transcript" (the speaker, not the card mode):

- `Participant = "user" | "code" | "shell"` → `"user" | "assistant" | "shell"` ([`tug-transcript-entry.tsx:75`](../tugdeck/src/components/tugways/tug-transcript-entry.tsx)).
- `TideTranscriptCellKind = "user" | "code" | "ghost"` → `"user" | "assistant" | "ghost"` ([`tide-transcript-data-source.ts:123`](../tugdeck/src/lib/tide-transcript-data-source.ts)).
- `TideZ1BParticipant = "user" | "code"` → `"user" | "assistant"` ([`tide-card-z1b.tsx:109`](../tugdeck/src/components/tugways/cards/tide-card-z1b.tsx)).
- `UserRowCell` → `UserMessageCell` (renders one `user_message`).
- `CodeRowCell` → `AssistantTurnCell` (aggregates the assistant's whole turn).
- `UserRowCellProps` / `CodeRowCellProps` → `UserMessageCellProps` / `AssistantTurnCellProps`.
- `CODE_DEFAULT_IDENTIFIER` → `ASSISTANT_DEFAULT_IDENTIFIER`; `ESTIMATED_HEIGHT_CODE` → `ESTIMATED_HEIGHT_ASSISTANT`; `isCodeRow` → `isAssistantRow` (cell-local helpers).
- Every `"code"` literal site that flows from the renamed types: `kind: "code"`, `kind === "code"`, ternary results, renderer-map keys, JSX `participant="code"` props.
- `[data-participant="code"]` CSS selectors. The DOM `data-participant` attribute the component emits rides on the typed `Participant`, so it flips automatically when the type literal flips.
- All in-file doc-block / tuglaws-reference comments that mention `CodeRowCell` / `UserRowCell` / `participant="code"`.

#### Artifacts {#step-pre-5-artifacts}

No new files, no file renames. Modifications, grouped by layer:

**Substrate types (force the tsc-error frontier):**

- [`tugdeck/src/components/tugways/tug-transcript-entry.tsx`](../tugdeck/src/components/tugways/tug-transcript-entry.tsx) — `Participant` type literal; header docstring.
- [`tugdeck/src/lib/tide-transcript-data-source.ts`](../tugdeck/src/lib/tide-transcript-data-source.ts) — `TideTranscriptCellKind` literal; ~12 internal string-literal sites (`return "code"`, `kind: "code"`, `isCodeRow` ternaries); `kindForIndex` doc; module-header doc.
- [`tugdeck/src/components/tugways/cards/tide-card-z1b.tsx`](../tugdeck/src/components/tugways/cards/tide-card-z1b.tsx) — `TideZ1BParticipant` literal; ~4 `participant === "code"` checks; module-header doc-block.

**Cell components + their callers:**

- [`tugdeck/src/components/tugways/cards/tide-card-transcript.tsx`](../tugdeck/src/components/tugways/cards/tide-card-transcript.tsx) — `UserRowCell` → `UserMessageCell`; `CodeRowCell` → `AssistantTurnCell` (+ `*Props` interfaces); `participant="code"` JSX (×2 sites); renderer-map key `"code": codeRenderer` → `"assistant": assistantRenderer`; `kind === "code"` reads; `ESTIMATED_HEIGHT_CODE` / `CODE_DEFAULT_IDENTIFIER` / `isCodeRow` helper renames; module-header doc-block + tuglaws comments.

**DOM / CSS:**

- [`tugdeck/src/components/tugways/tug-transcript-entry.css`](../tugdeck/src/components/tugways/tug-transcript-entry.css) — `[data-participant="code"]` selector (one site).
- [`tugdeck/src/components/tugways/cards/tide-card-z1b.css`](../tugdeck/src/components/tugways/cards/tide-card-z1b.css) — comment reference.

**Galleries (development-only screens; still load at startup):**

- [`tugdeck/src/components/tugways/cards/gallery-transcript-entry.tsx`](../tugdeck/src/components/tugways/cards/gallery-transcript-entry.tsx) — `participant="code"` → `"assistant"`.

**Tests:**

- [`tugdeck/src/lib/__tests__/tide-transcript-data-source.test.ts`](../tugdeck/src/lib/__tests__/tide-transcript-data-source.test.ts) — test literals matching the renamed `kind` values.
- [`tugdeck/src/components/tugways/cards/__tests__/tide-card-z1c.test.ts`](../tugdeck/src/components/tugways/cards/__tests__/tide-card-z1c.test.ts) — references to `UserRowCell` / `CodeRowCell` / participant strings.

**Stale comment references (touch-and-go):**

- [`tugdeck/src/lib/code-session-store.ts:279`](../tugdeck/src/lib/code-session-store.ts) — one comment line mentioning `CodeRowCell`.

**Tuglaws documentation drift (markdown — not tsc-protected):**

- [`tuglaws/state-preservation.md:19`](../tuglaws/state-preservation.md) — the canonical L23/L26 example narrates the chain `reducer → snapshot → TideTranscriptDataSource.rowAt → CodeRowCell`. The cell name in this load-bearing tuglaws example becomes `AssistantTurnCell` post-rename.
- [`tuglaws/design-decisions.md:243`](../tuglaws/design-decisions.md) (D96) — references `CodeRowCell` in the post-unification render contract that ties per-turn-path seeding to the assistant row's observer pattern.

**Best-effort enumeration only.** The list above is what the audit surfaced; the typed `Participant` / `TideTranscriptCellKind` / `TideZ1BParticipant` rename forces tsc to expose any other consumer. Task pre-5.i closes the loop with an explicit final grep for surviving hits — including against `tuglaws/` and `docs/`, neither of which gets compile-time coverage.

#### Files explicitly NOT touched {#step-pre-5-exempt}

- [`tugdeck/src/lib/code-session-store/`](../tugdeck/src/lib/code-session-store) — session class, not participant. `CodeSessionStore` stays.
- [`tugdeck/src/components/tugways/chrome/tide-route-indicator-badge.{tsx,css}`](../tugdeck/src/components/tugways/chrome) — `data-route="code"` is the route-prefix destination, not the participant.
- [`tugdeck/src/lib/markdown/parse-markdown-to-sanitized-blocks.ts`](../tugdeck/src/lib/markdown/parse-markdown-to-sanitized-blocks.ts) — markdown ``` ``` block parsing; "code" here is programming-code, not participant.

#### Tasks {#step-pre-5-tasks}

- [x] **pre-5.a — Type literals.** Rewrote `Participant`, `TideTranscriptCellKind`, `TideZ1BParticipant` to `"...assistant..."`. tsc surfaced two test-file consumers in `tide-transcript-data-source.test.ts`; everything else flowed through types cleanly.
- [x] **pre-5.b — Cell components.** Renamed `UserRowCell` → `UserMessageCell`, `CodeRowCell` → `AssistantTurnCell` (and their `*Props` interfaces, every internal reference, `cellRenderers` map key + lambda, error messages, dev-throw text).
- [x] **pre-5.c — Cell-local helpers.** Renamed `CODE_DEFAULT_IDENTIFIER` → `ASSISTANT_DEFAULT_IDENTIFIER` (value `"Code"` kept — it's the brand-name placeholder for the card-mode layer); `ESTIMATED_HEIGHT_CODE` → `ESTIMATED_HEIGHT_ASSISTANT`; `isCodeRow` → `isAssistantRow`; `codeRenderer` → `assistantRenderer`.
- [x] **pre-5.d — Literal-site sweep.** Every `"code"` string the type-rename surfaced has flipped: ternary results, renderer-map key, JSX `participant="code"` (×2), `kind === "code"` reads, `kind: "code"` writes, the React key suffix `-code` → `-assistant` in `idForIndex`. tsc green confirms completeness.
- [x] **pre-5.e — DOM + CSS.** Updated `[data-participant="code"]` selector + the internal alias token `--tugx-transcript-icon-color-code` → `--tugx-transcript-icon-color-assistant` in `tug-transcript-entry.css`. The DOM `data-participant` attribute the JSX emits flips automatically with the renamed `Participant` type.
- [x] **pre-5.f — In-file doc-blocks + comments.** Updated module-header docstrings in `tide-card-transcript.tsx`, `tide-transcript-data-source.ts`, `tide-card-z1b.tsx`, `tide-card-z1b.css`, `tug-transcript-entry.tsx`. Updated the stray `code-session-store.ts:279` comment. Historical references to past kinds (`"code-streaming"` / `"code-committed"`) left in place — they describe pre-unification state and are accurate as history.
- [x] **pre-5.g — Tuglaws documentation update.** Updated `tuglaws/state-preservation.md:19` (canonical L23/L26 chain now ends at `AssistantTurnCell`) and `tuglaws/design-decisions.md:243` (D96 render-contract references `AssistantTurnCell`).
- [x] **pre-5.h — Test sweep.** Updated `tide-transcript-data-source.test.ts` literals (`"code"` → `"assistant"`, key suffixes `-code` → `-assistant`, describe/test titles). Updated `tide-card-z1c.test.ts` docstring reference to `AssistantTurnCell`. Both suites green.
- [x] **pre-5.i — Final audit grep.** Ran the full sweep across `tugdeck/src/components/tugways`, `tugdeck/src/lib/tide-transcript-data-source.ts`, `tugdeck/src/lib/__tests__`, `tuglaws/`, `docs/`. Surviving `"code"` hits are all explicitly exempt: `NotebookCellType = "code" | "markdown"` (programming-code), `PathIconKind = "code"` (file-icon kind), markdown-block type `"code"`, Zod error code field, route system (`data-route="code"`, `RouteLifecycle("code")`), filesystem directory fixture strings. No participant/row-cell hits.

#### Tests {#step-pre-5-tests}

Pure rename — no new behaviour. The gates are existence-and-green:

- [x] `tide-transcript-data-source.test.ts` green after the renamed `kind` literals propagate.
- [x] `tide-card-z1c.test.ts` green after renamed cell identifiers propagate.
- [x] Full `bun test` green — 3009 / 3009 pass, 9901 expect() calls, no regressions.

#### Checkpoint {#step-pre-5-checkpoint}

- [x] `cd tugdeck && bun test` — 3009 / 3009 pass.
- [x] `cd tugdeck && bun run check` — tsc clean.
- [x] `cd tugdeck && bun run audit:tokens lint` — zero token violations.
- [x] Final audit grep (task pre-5.i above) returns only the explicitly-exempt survivors.
- [x] Manual: open Tug.app — transcript still renders user + Claude rows correctly; Z1B end-state row shows correct styling under its renamed `participant="assistant"` attribute; no visual regression. Verified.

#### Out of scope {#step-pre-5-out-of-scope}

- **`CodeSessionStore` / `code-session-store/` rename.** Different concept (session class hosting Claude in coding mode). If "code card / code session" naming is itself due for a revisit, that's a separate plan that should also consider what "shell card / shell session" looks like once shell-routed cards exist.
- **Route-indicator badge naming (`data-route="code"`).** Whether route names should follow participant names is a Tide-wide consistency question, not a transcript-rendering question.
- **`shell` participant rename.** This step leaves `shell` untouched. If/when shell-output rendering lands, the symmetric question (`ShellOutputCell`? `ShellTurnCell`?) gets answered in that step.
- **DOM attribute name (`data-participant` itself).** Whether to call it `data-speaker` / `data-role` / `data-author` is a styling-convention discussion, not a scope of this rename. The attribute *value* is what flips here; the attribute *name* stays.

---

#### Step 5: Atom rendering in the transcript user-message row {#step-5}

**Depends on:** #step-3, #step-pre-5

**Commit:** `feat(tugdeck): render atoms in the transcript user-message row`

**References:** (#transcript-rendering)

**Scope decision (recorded here; [D07] and [Spec S05] are superseded):** Earlier drafts proposed a shared React `AtomChip` primitive consumed by the editor's CM6 widget, the transcript user row, and assistant-side tool-block path rendering. That extra surface is dropped. The editor already renders atoms correctly as `<img>` replaced elements (`tug-atom-img.ts`); rebuilding it as a React component buys nothing the substrate doesn't already give us for free and risks the carefully-engineered caret / selection / clipboard behaviour that depends on `<img>`'s replaced-element semantics. The transcript user row is the actual gap — `UserMessageCell` currently dumps the raw substrate text (including U+FFFC) into a plain `<span>`. The minimum honest fix is a small React component that walks `(text, atoms)` and renders the same `<img>` the editor uses today, via the same SVG builder, at each `U+FFFC` position.

The single mechanical refactor needed: extract the SVG-data-URI builder from `createAtomImgElement` as a pure helper (`buildAtomSVGDataUri(type, label, value)`), so the new React component can render `<img src={dataUri} ...>` directly without mounting React inside a CM6 widget. `createAtomImgElement` keeps its current shape and calls the extracted helper internally — the editor's render path is byte-for-byte unchanged.

**Artifacts:**

- [`tugdeck/src/lib/tug-atom-img.ts`](../tugdeck/src/lib/tug-atom-img.ts) (modify) — extract `buildAtomSVGDataUri(type, label, value, options?): { dataUri: string; width: number; height: number; baselineOffset: number }` as a pure helper. `createAtomImgElement` continues to be the editor's entry point and calls the helper internally; its output (and CM6 widget integration) is unchanged.
- `tugdeck/src/components/tugways/cards/tug-atom-text-body.tsx` (new) — `<TugAtomTextBody text={string} atoms={ReadonlyArray<AtomSegment>}>`. Splits `text` on `U+FFFC`, interleaves `<img src={dataUri} width=... height=... alt={atom.label} style={{verticalAlign: ...px}}>` per atom built via `buildAtomSVGDataUri`. Pure render; no effects, no refs.
- [`tugdeck/src/components/tugways/cards/tide-card-transcript.tsx`](../tugdeck/src/components/tugways/cards/tide-card-transcript.tsx) (modify) — `UserMessageCell`'s body `<span>{text}</span>` becomes `<TugAtomTextBody text={text} atoms={atoms} />`. `atoms` is read from `committedUser?.attachments ?? activeUser?.attachments ?? []` on the same Message that supplies `text`.

**Explicitly not in this step:**

- No new `AtomChip` React component.
- No changes to `atom-decoration.ts` or any CM6 widget code.
- No gallery card variant. (Existing galleries already exercise the editor's atom rendering; the new `TugAtomTextBody` is a pure walker and is covered by the render tests below.)
- No assistant-side tool-block atom rendering — that lands in [Step 7](#step-7), which uses the same `buildAtomSVGDataUri` helper extracted here (inline `<img>` per tool-block path field, no walker since paths are single strings).

**Tasks:**

- [ ] **5.a — Extract SVG helper.** Pull the SVG-data-URI build path out of `createAtomImgElement` into `buildAtomSVGDataUri(type, label, value, options?)`. Make sure `createAtomImgElement`'s observable output is byte-identical (same `img.src`, `img.width`, `img.height`, `verticalAlign`, dataset attributes, title). Existing editor tests should pass unchanged.
- [ ] **5.b — Build `TugAtomTextBody`.** New React component in `tugdeck/src/components/tugways/cards/tug-atom-text-body.tsx`. Walks `text`, split at `U+FFFC`, interleaves text spans with `<img>` elements. Each `<img>` reads `(type, label, value)` from the parallel `atoms[i]` entry and uses `buildAtomSVGDataUri` for `src`. Defensive: if `atoms.length < count(U+FFFC, text)`, extra U+FFFC chars pass through as visible characters (same defensive posture as `buildWirePayload`'s invariant).
- [ ] **5.c — Wire `UserMessageCell`.** Replace the body `<span>{text}</span>` in `tide-card-transcript.tsx` with `<TugAtomTextBody text={text} atoms={atoms} />`. Source `atoms` from `committedUser?.attachments ?? activeUser?.attachments ?? []`.

**Tests:**

- [ ] `unit: buildAtomSVGDataUri returns a data: URI string + width/height/baselineOffset numbers; stable for same inputs (purity check).`
- [ ] `render: TugAtomTextBody with no atoms ("hello world", []) renders plain text only.`
- [ ] `render: TugAtomTextBody with one atom ("before ￼ after", [{file atom}]) renders [text "before "] [img] [text " after"]. Single <img> present; src is the SVG data URI; alt is the atom's label.`
- [ ] `render: TugAtomTextBody with two atoms ("￼ and ￼", [a1, a2]) renders [img@a1] [text " and "] [img@a2]. Order preserved.`
- [ ] `render: TugAtomTextBody with mismatched count (atoms.length < FFFC count) — extra U+FFFC characters render as visible text; no crash.`
- [ ] `integration: UserMessageCell against a committed turn with 2 attachments → 2 <img> elements appear at the correct positions in the row body.`

**Checkpoint:**

- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] `cd tugdeck && bun run check` — tsc clean.
- [ ] `cd tugdeck && bun run audit:tokens lint` — zero token violations.
- [ ] Manual: in a tide card, type a message with an `@`-completed atom (e.g., `look at @file.txt`), submit → transcript user row shows the same chip the editor showed pre-submit. The chip's icon, label, and baseline match the editor by eye.

---

#### Step 6: Image attachment strip + thumbnail bake {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): tug-attachment-strip + thumbnail bake on commit`

**References:** [D04](#d04-no-bytes-on-snapshot), [Spec S04](#s04-image-downsample) (`bakeThumbnail`), [Spec S06](#s06-attachment-strip), [Risk R03](#r03-bytes-store-memory), (#transcript-rendering)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tug-attachment-strip.tsx` + CSS per [Spec S06](#s06-attachment-strip).
- `code-session-store/types.ts` — `AttachmentRecord` typed; `TurnEntry.userMessage.attachments: ReadonlyArray<AttachmentRecord>` (replacing the current `ReadonlyArray<AtomSegment>` cast).
- `reducer.ts` commit path bakes thumbnails for image attachments via `bakeThumbnail` from [Spec S04](#s04-image-downsample).
- `UserMessageCell` mounts `TugAttachmentStrip` above `TugAtomTextBody` when `attachments.length > 0`.
- `TugListView` row-height accounting includes the strip (measured on the same `useLayoutEffect` cycle as the body).
- Click handler — v1 opens the source data URL via `window.open(content)` (lightbox is v1.1 polish).

**Tasks:**
- [ ] Tighten `TurnEntry.userMessage.attachments` to `AttachmentRecord[]`.
- [ ] Add `bakeThumbnail` to `image-downsample.ts` and call it from the commit path.
- [ ] Build `TugAttachmentStrip` per [Spec S06](#s06-attachment-strip).
- [ ] Wire the strip into `UserMessageCell` above the body.
- [ ] Extend `TugListView` row-height contract to sum strip + body heights.
- [ ] Add gallery variant for design review.

**Tests:**
- [ ] `render: TugAttachmentStrip with 1 image AttachmentRecord → 1 tile rendered with thumbnail data URL`
- [ ] `render: TugAttachmentStrip with 0 attachments → renders nothing`
- [ ] `integration: turn_complete commits an image-bearing turn → AttachmentRecord carries non-empty thumbnailDataUrl`
- [ ] `render: UserMessageCell with attachments → strip renders above body; row height accounts for both`

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run check`
- [ ] `cd tugdeck && bun run audit:tokens lint`
- [ ] Manual: drop image → submit → see thumbnail in the transcript user row above the body text.

---

#### Step 7: Replay-side cleanup + assistant tool-block atom chips {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): replay attachments + tool-block path chips`

**References:** [D02](#d02-image-attach-text-rest), [D07](#d07-atom-chip-primitive) (revised — chip-via-SVG-builder), [D08](#d08-tool-block-only), [Spec S05](#s05-atom-chip) (`buildAtomSVGDataUri`), [Table T02](#t02-persistence-tiers), (#replay-side-cleanup, #transcript-rendering)

**Artifacts:**
- `reducer.ts:handleAddUserMessage` (`:3233-3273`) — replace the `event.attachments as ReadonlyArray<AtomSegment>` cast with an explicit conversion to `AttachmentRecord[]`. Bytes from `event.attachments[i].content` write into the per-card bytes-store keyed by a freshly-minted UUID; the same UUID lands on the `AttachmentRecord.id`. Thumbnails bake from the bytes on the spot.
- `tool-blocks/read-tool-block.tsx`, `edit-tool-block.tsx`, `write-tool-block.tsx`, `notebook-edit-tool-block.tsx` — path renderings switch from monospace `<code>` to an inline `<img>` chip built via `buildAtomSVGDataUri("file", basename(path), path)` ([Spec S05](#s05-atom-chip)). Single chip per tool-block per path field; no walker needed (tool-block paths are single strings, not substrate text).

**Tasks:**
- [ ] Implement the `handleAddUserMessage` conversion. Bake thumbnails inline; populate the bytes-store.
- [ ] Update each tool-block component to render `input.file_path` (and `input.notebook_path` for notebook-edit) as an inline `<img>` chip via `buildAtomSVGDataUri`.
- [ ] Verify cold-mount of a session with an image-bearing turn renders both the user-row thumbnail and the body (manual + integration test).

**Tests:**
- [ ] `integration: handleAddUserMessage with 1 image attachment → AttachmentRecord on TurnEntry with populated thumbnailDataUrl; bytes-store has entry under same id`
- [ ] `render: ReadToolBlock with input.file_path:"src/main.ts" → renders an <img> chip (data: SVG URI) instead of monospace text; alt text matches the basename`
- [ ] `render: NotebookEditToolBlock with both file_path and notebook_path → both render as inline <img> chips`
- [ ] `integration: cold-mount of a session with image-bearing JSONL → user-row thumbnail + chips appear correctly`

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run check`
- [ ] Manual: drop image → submit → close-and-reopen card → same view restored from JSONL + journal replay.

---

#### Step 8: Integration checkpoint {#step-8}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01](#d01-ffc-substitution-at-submit) … [D08](#d08-tool-block-only), [Q01](#q01-replay-enlarge-bytes) (resolve), [Table T01](#t01-failure-modes), (#success-criteria)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-7 are complete and cooperate end-to-end.
- [ ] Re-run `just capture-capabilities` against the current claude (`2.1.148` or later at exit time). `test-23-image-attachment.jsonl` byte-identical pre/post.
- [ ] Heap-profile a 50-turn synthetic session with five 4 MB inline images per turn — resolve [Q01](#q01-replay-enlarge-bytes).
- [ ] Walk the tuglaws checklist for new components: `tug-attachment-strip.tsx`, `tug-atom-text-body.tsx`, the bytes-store, `image-downsample.ts`.
- [ ] Update [Q01](#q01-replay-enlarge-bytes) resolution in this plan based on profile data.

**Tests:**
- [ ] `cd tugdeck && bun test && bun run check && bun run audit:tokens lint`
- [ ] `cd tugcode && bun test`
- [ ] `cd tugrust && cargo nextest run --workspace`
- [ ] `just app-test` end-to-end recipe (new): drop a PNG → mention a workspace `@CLAUDE.md` → submit → assert:
  - (a) the wire frame carries one `Attachment` with the right shape;
  - (b) the wire text contains `CLAUDE.md` literally (no `U+FFFC`);
  - (c) the transcript renders a thumbnail tile + a chip for `CLAUDE.md`;
  - (d) cold-restart of the card replays both correctly from JSONL + journal.
- [ ] Manual smoke: paste a screenshot, drop a 4K PNG, `@`-mention `CLAUDE.md`, type `@.env` (no popup match expected), submit, verify thumbnails in editor, chips in transcript, tool-block path chips when claude reads a file, full state survives close-and-reopen.

**Checkpoint:**
- [ ] All success criteria from [`#success-criteria`](#success-criteria) ticked.
- [ ] Drift regression Benign-or-better via `cargo nextest run -p tugcast --features real-claude-tests --run-ignored only stream_json_catalog_drift_regression`.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A complete user-visible atom + attachment lifecycle in Tide: drop / paste / `@`-mention image, file, and document references in `tug-prompt-entry`; submit; see thumbnails + atom chips in the transcript user row; see matching chips on assistant tool-block paths; cold-restart the card and find the same view restored from JSONL + journal. Image submissions never fail at the Anthropic backend due to size or dimension issues. Secret files never appear in `@`-completion.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every success criterion in [`#success-criteria`](#success-criteria) verified by its named verification.
- [ ] `test-23-image-attachment.jsonl` byte-identical pre/post (no regression in the existing image content-block path).
- [ ] [Q01](#q01-replay-enlarge-bytes) resolved with documented heap-profile evidence.
- [Q02](#q02-heic-avif) and [Q04](#q04-animated-gif) already resolved at plan-draft time; [Q03](#q03-pdf-deferred) remains deferred.
- [ ] Manual smoke per [Step 8](#step-8): drop → paste → `@`-mention → submit → restore round-trip works end-to-end.
- [ ] No new IndexedDB or localStorage. No new tugcast verb. No new feed ID.
- [ ] `bun run check`, `bun test` (tugdeck + tugcode), `cargo nextest run --workspace` all clean with `-D warnings`.

**Acceptance tests:**
- [ ] `cd tugrust && env -u ANTHROPIC_API_KEY TUG_REAL_CLAUDE=1 cargo nextest run -p tugcast --features real-claude-tests --run-ignored only stream_json_catalog_drift_regression` — exits 0.
- [ ] `just app-test` end-to-end recipe (added in Step 8).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] PDF / `document` content blocks ([Q03](#q03-pdf-deferred)).
- [ ] `kind: "ref"` discriminator + tugcode-side path resolution for explicit-inline file refs.
- [ ] Anthropic Files API `file_id` source type for repeated-attachment scenarios.
- [ ] Bidirectional capture (`TUG_CAPTURE_INBOUND_LOG`) for regression-tracking the inbound shape.
- [ ] Lightbox component for click-to-enlarge (v1.1 polish).
- [ ] Free-prose `@path` detection in assistant markdown.
- [ ] Bytes-store retention policy refinements based on heap-profile data from [Q01](#q01-replay-enlarge-bytes).

| Checkpoint | Verification |
|------------|--------------|
| Image downsample primitive works | Step 1 unit tests + manual decode of 4K screenshot |
| Bytes-store + drop/paste captures bytes | Step 2 integration tests + manual state-preservation round-trip |
| Wire flattening replaces U+FFFC + ships Attachments | Step 3 reducer tests + manual claude-response verification |
| Filetree denylist + .tugattachignore active | Step 4 integration test + manual `@.env` non-match |
| Chip renders consistently in editor + transcript (same SVG builder) | Step 5 render tests + manual eye-match |
| Attachment strip + thumbnails | Step 6 render tests + manual drop-then-submit |
| Replay round-trips + tool-block chips | Step 7 cold-mount test + manual tool-call verification |
| End-to-end | Step 8 `just app-test` recipe + manual smoke |
