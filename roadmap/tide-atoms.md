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
- **AtomChip is a single primitive.** Editor + transcript user-row + assistant tool-blocks all render through the same component. Visual rhyme across the surface; no chance of style drift.
- **Tuglaws apply.** Touching prompt-entry's drop / paste extensions, the bytes-store, the wire-flattening logic, the new attachment-strip primitive, and the tool-block path renderers re-checks against `tuglaws/tuglaws.md`. The closing step records a walkthrough.

#### Success Criteria (Measurable) {#success-criteria}

**Send path:**
- Dropping a 4K screenshot (e.g., 3840×2160 PNG, ~6 MB) submits successfully without an Anthropic API error. (verification: manual smoke + canvas-stub unit test asserting post-downsample dimensions ≤ 2576 px and encoded size ≤ 5 MB)
- The reducer's `send-frame` effect at `reducer.ts:743-749` and the queued-send flush at `reducer.ts:2210-2216` carry the flattened-text-and-attachments payload, not `attachments: []`. (verification: `code-session-store/__tests__/reducer.test.ts` asserts shape on submit)
- The wire text submitted to claude contains zero `U+FFFC` characters when the prompt had atoms. (verification: unit test of `buildWirePayload`)

**Transcript rendering:**
- The transcript user row renders atom chips at `U+FFFC` positions for both in-flight and committed turns. (verification: render test in `tide-card-transcript.test.tsx` + manual against gallery card)
- The transcript user row renders an image-thumbnail strip above the body when the turn has image attachments. (verification: same as above)
- Read / Edit / Write / NotebookEdit tool blocks render their `file_path` (and `notebook_path`) as an `AtomChip`, identical to the user-side chip rendering. (verification: render test + manual)

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
5. AtomChip primitive + user-row atom rendering (Step 5) — extract a shared React component from `createAtomImgElement`; the transcript user row renders chips at substituted positions.
6. Image attachment strip + thumbnail bake (Step 6) — `tug-attachment-strip.tsx` renders above the user body; `bakeThumbnail` shares the Step-1 pipeline at 256 px.
7. Replay-side cleanup + assistant tool-block chips (Step 7) — fix the `handleAddUserMessage` type-cast; switch tool-block path renderers to `AtomChip`.
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

The drop / paste pipeline rejects file kinds it can't ship at drop time (not at submit time): binary non-image, non-text sources (PDF, archives, audio, video) produce no atom — instead they surface a banner via the `attachment_rejected` channel. The user sees the rejection immediately; no skeleton chip is left behind for them to wonder about.

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

#### [D07] `AtomChip` is a shared React primitive (DECIDED) {#d07-atom-chip-primitive}

**Decision:** Extract the chip rendering currently inside `createAtomImgElement` (`tug-atom-img.ts`) into a shared React component `AtomChip` consumed by three surfaces:
- The CM6 atom decoration (current consumer; the imperative DOM widget is replaced with a React mount).
- The transcript user-row body (via `TugAtomTextBody`).
- Tool-block path renderings (`read-tool-block.tsx`, `edit-tool-block.tsx`, `write-tool-block.tsx`, `notebook-edit-tool-block.tsx`).

**Rationale:**
- Visual consistency between user input and claude's tool calls reinforces the substrate model — the path the user typed reappears as the same chip in claude's tool call.
- A single primitive avoids divergent chip styles drifting over time.
- React-component shape allows accessibility (`aria-label`, `role="button"` when interactive) without re-implementing in raw DOM.

**Implications:**
- New `tugdeck/src/components/tugways/tug-atom-chip.tsx` + CSS.
- The CM6 atom decoration path mounts a `<AtomChip>` inside a CM6 widget (existing pattern; `tug-text-editor/atom-decoration.ts`).
- Tool-block components update their path renders.

#### [D08] Assistant-side atoms only at tool-block surfaces (DECIDED) {#d08-tool-block-only}

**Decision:** For v1, the assistant-side atom-chip rendering applies only to Read / Edit / Write / NotebookEdit tool blocks (where the file path is a structured `input` field). Free-prose `@`-path detection in assistant markdown is out of scope.

**Rationale:**
- Tool inputs carry the file path as a structured field; no parsing required.
- Free-prose detection is fragile (false positives like `@stable` annotations in code blocks, npm-style `@scope/pkg` mentions).
- The visual goal — user's chips reappearing in claude's response — is already met by tool-block chipping.

**Implications:**
- A small change in each of the four tool-block components to render the path through `AtomChip`.
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

#### Spec S05: `AtomChip` component contract {#s05-atom-chip}

`tugdeck/src/components/tugways/tug-atom-chip.tsx`:

```tsx
interface AtomChipProps {
  atom: AtomSegment;
  /** Optional click handler; click is a no-op when undefined. */
  onClick?: (atom: AtomSegment, event: React.MouseEvent) => void;
  /** Override the default icon mapping; null forces no-icon. */
  iconOverride?: React.ReactNode | null;
  className?: string;
}

function AtomChip(props: AtomChipProps): React.ReactElement;
```

Renders the same chip widget the editor uses today, plus React-side accessibility (`aria-label={atom.label}`, `role="button"` when `onClick` is set). Theme tokens via `getTokenValue` (same as `createAtomImgElement`). Consumed by: editor's atom decoration, transcript `TugAtomTextBody`, tool-block path renderers.

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
- Sits above the user-row body inside `UserRowCell`.

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
| `tugdeck/src/components/tugways/tug-atom-chip.tsx` | Shared chip primitive ([Spec S05](#s05-atom-chip)) |
| `tugdeck/src/components/tugways/tug-atom-chip.css` | Chip styling |
| `tugdeck/src/components/tugways/cards/tug-attachment-strip.tsx` | Image thumbnail strip ([Spec S06](#s06-attachment-strip)) |
| `tugdeck/src/components/tugways/cards/tug-attachment-strip.css` | Strip styling |
| `tugdeck/src/components/tugways/cards/tug-atom-text-body.tsx` | Walks `text` + `atoms`, interleaves `AtomChip` widgets |

#### Files modified {#files-modified}

| File | Change |
|------|--------|
| `tugdeck/src/lib/tug-atom-img.ts` | `AtomSegment.id?: string`; refactor `createAtomImgElement` to delegate to `AtomChip` |
| `tugdeck/src/components/tugways/tug-text-editor/drop-extension.ts` | `await downsampleImage` for image files; mint atom-id; stash bytes |
| `tugdeck/src/components/tugways/tug-text-editor/clipboard-filters.ts` | Paste handler for `image/*` `ClipboardItem`; same path as drop |
| `tugdeck/src/components/tugways/tug-text-editor/atom-decoration.ts` | Render via `AtomChip` (existing CM6 widget mount pattern) |
| `tugdeck/src/lib/code-session-store.ts` | Pass `bytesStore` ref into the reducer; expose via send wrapper |
| `tugdeck/src/lib/code-session-store/reducer.ts` | `handleSend` and queued-flush use `buildWirePayload`; commit path bakes thumbnails; `handleAddUserMessage` converts attachments to atoms cleanly |
| `tugdeck/src/lib/code-session-store/types.ts` | `AttachmentRecord` shape; `TurnEntry.userMessage.attachments` typed |
| `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` | `UserRowCell` renders `TugAttachmentStrip` + `TugAtomTextBody` |
| `tugdeck/src/components/tugways/cards/tool-blocks/read-tool-block.tsx` | Path rendered via `AtomChip` |
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
| `AtomChip` | component | `tug-atom-chip.tsx` | [Spec S05](#s05-atom-chip) |
| `TugAtomTextBody` | component | `tug-atom-text-body.tsx` | Walks `(text, atoms)` and interleaves `AtomChip` widgets |
| `TugAttachmentStrip` | component | `tug-attachment-strip.tsx` | [Spec S06](#s06-attachment-strip) |
| `AtomSegment.id` | field | `tug-atom-img.ts:24` | Optional; minted at drop / paste |
| `SECRET_FILE_DENYLIST` | const | `filetree_provider.rs` | [List L01](#l01-secret-file-denylist) |
| `read_tugattachignore` | fn | `filetree_provider.rs` | Reads `.tugattachignore` at workspace root if present |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `roadmap/transport-exploration.md` §Test 23 with a note pointing at this plan as the v1 consumer of the image content-block path baseline.
- [ ] Add a `tuglaws/atom-chip.md` (or fold into `tuglaws/component-authoring.md`) describing `AtomChip`'s contract for future consumers.
- [ ] Update `tuglaws/tuglaws.md` if any new responder / state-preservation laws emerge from the bytes-store integration.
- [ ] Document `.tugattachignore` syntax in a workspace-facing readme (`docs/tugattachignore.md` or appended to existing project-config docs).

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (TS)** | Pure-function coverage | `build-wire-payload`, `atom-bytes-store`, `image-downsample` (with canvas mocks) |
| **Unit (Rust)** | Filter provider coverage | `filetree_provider` built-in denylist, `.tugattachignore` parse |
| **Integration (TS)** | Reducer + store + bytes-store wiring | `code-session-store/__tests__/reducer.test.ts` extensions for `handleSend` and `handleAddUserMessage` |
| **Render** | Component renders correctly | `tug-atom-chip.test.tsx`, `tug-attachment-strip.test.tsx`, `tide-card-transcript.test.tsx` |
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
- [ ] **3.5.1 — Banner cascade fix.** In `tide-card.tsx:1847-1849`, extend the `sessionErrored` exclusion list to include `"attachment_rejected"`. Add a render test asserting the unplug-icon dialog does not appear for an `attachment_rejected` `lastError`. Per [Table T01](#t01-failure-modes).
- [ ] **3.5.2 — Drag-level rejection.** `tugDropExtension`'s `dragover` handler walks `event.dataTransfer.items`; if every item's `type` is a known-unsupported MIME, return without `preventDefault`. Otherwise preventDefault (accept). Drop handler's branch 3 stops surfacing the rejection banner — silently skip unsupported items (they're already rejected at the cursor level for pure-unsupported drops; mixed drops just process the supported subset).
- [ ] **3.5.3 — Web Worker downsample.** New `tugdeck/src/lib/workers/image-downsample-worker.ts`. Main-thread `downsampleImage` spawns a worker, posts `{ blob }`, awaits `{ ok: true, result } | { ok: false, error }`, terminates. `isAnimatedGif` (synchronous parser) stays main-thread — it's microseconds and avoids the worker round-trip.
- [ ] **3.5.4 — Skeleton visual polish.** Rewrite `pendingAtomTheme` with stronger opacity floor + amplitude. Add a CSS-animated spinner glyph rendered inside the chip's icon slot via a separate SVG overlay (positioned absolute on top of the atom `<img>`) — keeps the atom widget itself unchanged. Append `…` to the chip label for pending atoms.
- [ ] **3.5.5 — Empty-editor skeleton-render fix.** After `insertAtomsAt` in `drop-extension.ts`, call `view.focus()` (no-op when already focused) and `view.requestMeasure({ read: () => null })` to force a layout pass. Add a manual checkpoint: open a fresh card with no content, drop a PNG → skeleton atom must appear at the drop point.

**Tests:**
- [ ] `unit: dragover with all-unsupported items → returns without preventDefault` (synthetic `DragEvent` with `dataTransfer.items` mock; verify the handler's return value)
- [ ] `unit: dragover with at least one image item → preventDefault is called`
- [ ] `unit: dragover with at least one text MIME item → preventDefault is called`
- [ ] `unit: dragover with all empty-MIME items → preventDefault is called (extension fallback at drop time)`
- [ ] `unit: tide-card-banner-spec — lastError.cause === "attachment_rejected" produces a banner, not a session-dead overlay` (extend existing banner-spec tests)
- [ ] `unit: worker downsample wrapper — posting a synthetic blob returns the expected result shape (using a Worker mock)` — pure-logic-testable parts only; canvas work is real-app verified.
- [ ] Manual: drop a 25 MB PNG; observe the editor stays responsive to keystrokes throughout encoding.
- [ ] Manual: drop a PDF onto the editor; observe the OS no-drop cursor; release; observe no banner / no atom appears.
- [ ] Manual: open a fresh card with empty editor; drop a PNG; skeleton atom appears immediately at the drop point.

**Checkpoint:**
- [ ] `bun test` clean
- [ ] `bun run check` clean
- [ ] `bun run audit:tokens lint` clean
- [ ] Manual: all three drop scenarios above behave correctly.

---

#### Step 4: Completion-time secret-file filter + `.tugattachignore` {#step-4}

**Depends on:** (none — independent of Steps 1-3)

**Commit:** `feat(tugcast): filetree provider secret-file denylist + .tugattachignore`

**References:** [D06](#d06-completion-time-filter), [List L01](#l01-secret-file-denylist), [Risk R04](#r04-manual-path-leak), [Risk R05](#r05-tugattachignore-parser), (#permission-gating)

**Artifacts:**
- `tugrust/crates/tugcast/src/feeds/filetree_provider.rs` — built-in denylist constant per [List L01](#l01-secret-file-denylist); `read_tugattachignore` reads workspace root file at provider startup; additive to existing `.gitignore` handling via the `ignore` crate.

**Tasks:**
- [ ] Add `SECRET_FILE_DENYLIST` constant in `filetree_provider.rs` per [List L01](#l01-secret-file-denylist).
- [ ] Implement `.tugattachignore` reader using the existing `ignore` crate; cache compiled patterns at provider start.
- [ ] Plumb the combined matcher into the per-query filter path; surface a tugcast-telemetry `parse-error` event on malformed patterns per [Table T01](#t01-failure-modes).
- [ ] Document the syntax in a fresh `docs/tugattachignore.md` (kept ≤ 50 lines).

**Tests:**
- [ ] `unit (Rust): SECRET_FILE_DENYLIST matches .env, .env.local, foo.pem, id_rsa, etc.`
- [ ] `unit (Rust): .tugattachignore patterns parsed via the ignore crate match expected paths`
- [ ] `unit (Rust): combined match order — built-in denylist + .tugattachignore + .gitignore — produces deny-precedence`
- [ ] `integration: live filetree query against a synthetic workspace containing .env + .tugattachignore (matching local-secrets/) → query results exclude both`

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast feeds::filetree_provider`
- [ ] `cd tugrust && cargo build --tests` (warnings-as-errors clean)
- [ ] Manual: type `@.env` in the prompt-entry's `@`-popup in a workspace containing `.env` → no suggestion appears.

---

#### Step 5: `AtomChip` primitive + user-row atom rendering {#step-5}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): AtomChip primitive + transcript user-row atom rendering`

**References:** [D07](#d07-atom-chip-primitive), [Spec S05](#s05-atom-chip), (#transcript-rendering)

**Artifacts:**
- `tugdeck/src/components/tugways/tug-atom-chip.tsx` + CSS per [Spec S05](#s05-atom-chip).
- `tugdeck/src/components/tugways/cards/tug-atom-text-body.tsx` — walks `(text, atoms)`, interleaves `AtomChip` at `U+FFFC` positions.
- `tugdeck/src/components/tugways/tug-text-editor/atom-decoration.ts` — CM6 widget mounts `<AtomChip>` instead of `createAtomImgElement`'s raw DOM widget (or `createAtomImgElement` delegates internally; either way `AtomChip` is the single render path).
- `tide-card-transcript.tsx:UserRowCell` (`:368-451`) replaces the body `<span>{text}</span>` with `<TugAtomTextBody text={text} atoms={atoms} />`.
- A gallery card variant for design tuning (`gallery-atom-chip.tsx`).

**Tasks:**
- [ ] Extract chip rendering from `createAtomImgElement` into the `AtomChip` React component per [Spec S05](#s05-atom-chip); preserve theme-token reads via `getTokenValue`.
- [ ] Refactor the CM6 atom-decoration to render `AtomChip` inside a CM6 widget (existing pattern; see `atom-decoration.ts`).
- [ ] Build `TugAtomTextBody` per the existing render contract (walks `text`, splits at `U+FFFC`, interleaves chips).
- [ ] Wire `UserRowCell` to use `TugAtomTextBody`.
- [ ] Add the gallery card variant for design review.

**Tests:**
- [ ] `render: AtomChip with type:"file" + label:"README.md" → renders chip with file icon + label`
- [ ] `render: AtomChip with type:"image" + label:"screenshot.png" → renders chip with image icon`
- [ ] `render: TugAtomTextBody with "before ￼ after" + [{file atom}] → renders [text "before "] [chip] [text " after"]`
- [ ] `render: TugAtomTextBody with no atoms → renders plain text only`
- [ ] `render: UserRowCell against a committed turn with 2 atoms → chips appear at expected positions`

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run check`
- [ ] `cd tugdeck && bun run audit:tokens lint`
- [ ] Manual: open the gallery card → chip renders match the editor's chips by eye.

---

#### Step 6: Image attachment strip + thumbnail bake {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): tug-attachment-strip + thumbnail bake on commit`

**References:** [D04](#d04-no-bytes-on-snapshot), [Spec S04](#s04-image-downsample) (`bakeThumbnail`), [Spec S06](#s06-attachment-strip), [Risk R03](#r03-bytes-store-memory), (#transcript-rendering)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tug-attachment-strip.tsx` + CSS per [Spec S06](#s06-attachment-strip).
- `code-session-store/types.ts` — `AttachmentRecord` typed; `TurnEntry.userMessage.attachments: ReadonlyArray<AttachmentRecord>` (replacing the current `ReadonlyArray<AtomSegment>` cast).
- `reducer.ts` commit path bakes thumbnails for image attachments via `bakeThumbnail` from [Spec S04](#s04-image-downsample).
- `UserRowCell` mounts `TugAttachmentStrip` above `TugAtomTextBody` when `attachments.length > 0`.
- `TugListView` row-height accounting includes the strip (measured on the same `useLayoutEffect` cycle as the body).
- Click handler — v1 opens the source data URL via `window.open(content)` (lightbox is v1.1 polish).

**Tasks:**
- [ ] Tighten `TurnEntry.userMessage.attachments` to `AttachmentRecord[]`.
- [ ] Add `bakeThumbnail` to `image-downsample.ts` and call it from the commit path.
- [ ] Build `TugAttachmentStrip` per [Spec S06](#s06-attachment-strip).
- [ ] Wire the strip into `UserRowCell` above the body.
- [ ] Extend `TugListView` row-height contract to sum strip + body heights.
- [ ] Add gallery variant for design review.

**Tests:**
- [ ] `render: TugAttachmentStrip with 1 image AttachmentRecord → 1 tile rendered with thumbnail data URL`
- [ ] `render: TugAttachmentStrip with 0 attachments → renders nothing`
- [ ] `integration: turn_complete commits an image-bearing turn → AttachmentRecord carries non-empty thumbnailDataUrl`
- [ ] `render: UserRowCell with attachments → strip renders above body; row height accounts for both`

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run check`
- [ ] `cd tugdeck && bun run audit:tokens lint`
- [ ] Manual: drop image → submit → see thumbnail in the transcript user row above the body text.

---

#### Step 7: Replay-side cleanup + assistant tool-block atom chips {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): replay attachments + tool-block path chips`

**References:** [D02](#d02-image-attach-text-rest), [D07](#d07-atom-chip-primitive), [D08](#d08-tool-block-only), [Table T02](#t02-persistence-tiers), (#replay-side-cleanup, #transcript-rendering)

**Artifacts:**
- `reducer.ts:handleAddUserMessage` (`:3233-3273`) — replace the `event.attachments as ReadonlyArray<AtomSegment>` cast with an explicit conversion to `AttachmentRecord[]`. Bytes from `event.attachments[i].content` write into the per-card bytes-store keyed by a freshly-minted UUID; the same UUID lands on the `AttachmentRecord.id`. Thumbnails bake from the bytes on the spot.
- `tool-blocks/read-tool-block.tsx`, `edit-tool-block.tsx`, `write-tool-block.tsx`, `notebook-edit-tool-block.tsx` — path renderings switch from monospace `<code>` to `<AtomChip>`.

**Tasks:**
- [ ] Implement the `handleAddUserMessage` conversion. Bake thumbnails inline; populate the bytes-store.
- [ ] Update each tool-block component to render `input.file_path` (and `input.notebook_path` for notebook-edit) via `<AtomChip>`.
- [ ] Verify cold-mount of a session with an image-bearing turn renders both the user-row thumbnail and the body (manual + integration test).

**Tests:**
- [ ] `integration: handleAddUserMessage with 1 image attachment → AttachmentRecord on TurnEntry with populated thumbnailDataUrl; bytes-store has entry under same id`
- [ ] `render: ReadToolBlock with input.file_path:"src/main.ts" → renders AtomChip, not monospace text`
- [ ] `render: NotebookEditToolBlock with both file_path and notebook_path → both render as AtomChips`
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
- [ ] Walk the tuglaws checklist for new components: `tug-atom-chip.tsx`, `tug-attachment-strip.tsx`, `tug-atom-text-body.tsx`, the bytes-store, `image-downsample.ts`.
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
| AtomChip renders consistently in editor + transcript | Step 5 render tests + gallery card |
| Attachment strip + thumbnails | Step 6 render tests + manual drop-then-submit |
| Replay round-trips + tool-block chips | Step 7 cold-mount test + manual tool-call verification |
| End-to-end | Step 8 `just app-test` recipe + manual smoke |
