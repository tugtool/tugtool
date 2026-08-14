# Markdown Attachments {#markdown-attachments}

**Purpose:** Give every markdown-editing surface durable, honest attachment handling: files dropped on a Text card become real files in a sibling `assets/` folder referenced by standard markdown links, and images dropped on the Session card's prompt entry survive an app relaunch as resubmittable attachments instead of vanishing.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-13 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Two attachment problems today, both rooted in "the bytes have no durable home":

1. **Text cards can't attach anything.** The Text card (`tugdeck/src/components/tugways/cards/text-card.tsx` + `tugdeck/src/components/tugways/tug-text-card-editor.tsx`) is a CM6 editor over a plain file on disk. Its editor deliberately excludes the composer's atom/drop machinery (see the `tug-text-card-editor.tsx` module docblock — atoms, completion, and drop are listed as "deliberately NOT here"), so dropping a file on it does nothing. There is no storage or linkage story for an attachment, and the documents must remain pure markdown — no `.rtfd`-style sidecar bundle, no proprietary link scheme.

2. **Prompt-entry attachments do not survive a relaunch.** A dropped/pasted image becomes a chip atom (`AtomSegment` with a UUID `id`) plus base64 bytes in a per-card in-memory `AtomBytesStore` (`tugdeck/src/lib/atom-bytes-store.ts`). No source path is ever captured. On save, `capDurableCardState()` (`tugdeck/src/settings-api.ts`) deliberately deletes `content.attachmentBytes` before the tugbank write — persisting megabytes of base64 through the defaults store once stalled boot at ~18 MB — and on restore `pruneOrphanedImageAtoms` (`tugdeck/src/components/tugways/tug-prompt-entry.tsx`) splices the now-payload-less chips out of the draft. Only the small baked thumbnail survives (via prompt history), and it is preview-only: `buildWirePayload` skips entries with empty `content`. This reads as user data loss.

A database-backed store with app-served links (Joplin's `:/resource-id`, Notion's signed URLs) was considered and **rejected**: it produces markdown that parses but is dead outside the app, and tugcast's per-instance port (allocated from the 55300–55399 window with walk-on-collision) makes any `http://127.0.0.1:<port>/…` link wrong on the next launch. The survey of prior art (Typora, Zettlr, Logseq, TextBundle, Obsidian-in-markdown-links-mode) converged on the pattern this plan adopts: copy bytes into a deterministic relative folder at drop time and write a standard markdown link. The durable in-repo template for the draft tier already exists: Gazette attachments are path-backed — `store_attachments` (`tugrust/crates/tugcast/src/feeds/operator.rs`) rests uploaded bytes under `tugcore::instance::data_dir().join("gazette-attachments")` (`tugrust/crates/tugcast/src/main.rs`, `OperatorContext.attachments_dir`), the post carries `{path, media_type}`, and the deck re-fetches through `GET /api/fs/blob` (`tugdeck/src/lib/gazette-attachment-bytes.ts`).

#### Strategy {#strategy}

- **No database, no new server.** Attachments are files; tugcast (the only HTTP server in the suite, `tugrust/crates/tugcast/src/server.rs::build_app`) grows two small upload routes and a GC sweep. [P01]
- **Two tiers, one vocabulary.** *Attach = the bytes get a durable home and the surface holds a reference.* For documents the home is next to the document (portable, user-owned, git-visible). For composer drafts the home is app-owned under the per-instance data dir (transient by nature, GC'd). [P02] [P06]
- **Rust first, then the deck.** Land and test the upload routes and storage helpers before touching tugdeck, so every frontend step verifies against a real endpoint.
- **Originals at rest, downsampling at time of use.** Stored bytes are always the verbatim original; the existing downsample pipeline runs when bytes are about to be shown to a model. [P04]
- **The Text card stays a raw-source editor.** No image widgets, no preview pane — the drop gesture writes bytes and inserts a link; syntax stays visible per the card's existing doctrine. ⌘-click opens a viewable asset in a viewer card. [P10]
- **Sequencing:** Tier 2 (composer durability) first — it is nearly mechanical given the Gazette template and pays off the "user data loss" pain immediately — then Tier 1 (Text card drops), then GC.

#### Success Criteria (Measurable) {#success-criteria}

- Drop an image on the prompt entry, quit and relaunch Tug.app: the draft restores with the image chip and thumbnail intact, and submitting sends a real image block (verify via the transcript showing the image and the model describing it). App-test asserts the durable card state carries a `path` and no `content`.
- Recall a pre-relaunch prompt from history (↑): the image atom rehydrates to resubmittable bytes, not a preview-only tile.
- Drop `photo.png` on a Text card editing `roadmap/foo.md`: `roadmap/assets/photo.png` appears on disk byte-identical to the source, and `![photo](assets/photo.png)` is inserted at the drop caret. Drop the same filename again: `assets/photo-2.png` and a matching link.
- The written markdown renders the image on GitHub / any standard renderer (relative link, no Tug-specific syntax) — verify by `git diff` inspection of the link form.
- tugbank card-state writes stay small: the durable bag for a card with three dropped images carries three short path strings, not megabytes of base64 (unit test on `capDurableCardState`).
- GC: a file in `draft-attachments/` referenced by no card-state draft and no prompt-history entry, with mtime older than the grace period, is removed at tugcast startup; a referenced or young file is not (Rust unit test).

#### Scope {#scope}

1. Tier 2: durable, resubmittable image attachments in the Session card prompt entry (drop + paste), across relaunch, including prompt-history recall.
2. Tier 1: file drops on the Text card — bytes copied to a sibling `assets/` folder, standard markdown link inserted; images and non-images alike.
3. Two tugcast upload routes plus a startup GC sweep for the draft tier.
4. ⌘-click on a relative asset link in the Text card opens the asset in a viewer card (viewable extensions only).

#### Non-goals (Explicitly out of scope) {#non-goals}

- Inline image rendering / preview panes in the Text card — it remains a raw-source editor.
- Attachments in Jots rows (`TugMessageEditor`) or any other `TugTextEditor` host beyond the Session card prompt entry — jots are reusable prompt fragments; a dropped image has no home there yet.
- Non-image attachments in the prompt entry — they continue to degrade to filename text ([P05]; see [Q01]).
- The Gazette composer — already path-backed; untouched.
- GC for Tier 1 `assets/` folders — user-owned files in user-owned (usually git-tracked) space; orphans are visible in `git status` and are the user's to manage (Risk R02).
- Cross-tool link rewriting on document rename/move (Obsidian-style) — the link is relative; moving the `.md` without its `assets/` folder breaks it, as in every tool using this pattern.

#### Dependencies / Prerequisites {#dependencies}

- tugcast's existing fs route guards: `guard_absolute_path`, secret-denylist, loopback-only posture (`tugrust/crates/tugcast/src/fs_read.rs`, shared by `fs_write.rs` / `fs_blob.rs`).
- `GET /api/fs/blob` (`tugrust/crates/tugcast/src/fs_blob.rs`) — serves the stored bytes back; its extension→MIME table already covers png/jpeg/gif/webp/heic/heif/avif/tiff/bmp/ico/pdf.
- The existing downsample pipeline (`tugdeck/src/lib/image-downsample.ts` — `downsampleImage`, `MAX_LONG_EDGE_PX = 2576`, `MAX_BASE64_SIZE = 5 MB`, `THUMBNAIL_MAX_EDGE_PX = 512`).
- tugbank reachable from tugcast (already true: `TugbankClient` is passed into `build_app` for the `/api/defaults` routes; per [D15] tugbank unavailability is fatal at startup).

#### Constraints {#constraints}

- **Warnings are errors** (`-D warnings` via `tugrust/.cargo/config.toml`).
- Documents stay pure markdown: links must be standard CommonMark, resolvable by non-Tug tools.
- No Web storage; all persistence through tugbank / files ([no-localStorage rule]).
- tugdeck laws apply: [L02] external state via stores, [L06] appearance via CSS/DOM, no React state for chip pending-appearance.
- App-tests run selectively via `just app-test-changed`; new tests carry `@covers` headers.
- Verify tugdeck changes with `bunx vite build` before declaring done (debug app loads the prod rollup bundle).

#### Assumptions {#assumptions}

- The per-instance `data_dir()` is stable across relaunches of the same instance (it is: `TUG_INSTANCE_ID` keys it), so absolute paths recorded in durable card state remain valid. A draft restored under a *different* instance still resolves, because the path is absolute and `/api/fs/blob` accepts any guarded absolute path.
- Original dropped files are reachable as browser `File` blobs at drop time (they are — the drop pipeline already reads them for downsampling), so "upload the original" needs no filesystem source path.

---

### Open Questions {#open-questions}

#### [Q01] Non-image drops on the prompt entry (DEFERRED) {#q01-composer-non-image}

**Question:** Should a `.zip`/`.md` dropped on the composer become a durable `file` atom carrying a stored path, instead of degrading to filename text?

**Why it matters:** It changes what submit means for non-images and touches the wire docblock's explicit "text-file inline attachments not supported" stance (`tugdeck/src/lib/build-wire-payload.ts` module docblock).

**Resolution:** DEFERRED — parity-with-today scope ([P05]) ships first; revisit once Tier 2 is in use.

#### [Q02] Attachment affordances for Jots and other TugTextEditor hosts (DEFERRED) {#q02-jots-surfaces}

**Question:** Do jot rows ever want image attachments?

**Resolution:** DEFERRED — jots are prompt fragments stored in `jots.json` (1 MiB doc cap); an attachment story there needs its own design. Nothing in this plan blocks it: `tugDropExtension`'s bytes-store parameter is already per-host.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| GC deletes a live draft attachment | high | low | Conservative sweep: both root sets (card state + prompt history) union'd, grace period on mtime, delete only inside `draft-attachments/` | Any user report of a chip losing its bytes |
| Tier 1 orphaned assets accumulate | low | med | None by design — user space, git-visible | User asks for a sweep tool |
| Large originals inflate uploads | med | low | Raw-bytes bodies (no base64/JSON inflation), explicit per-route body limits | Body-limit 413s in the wild |
| Durable path stops resolving (file moved/deleted externally) | med | low | Rehydrate failure degrades to today's behavior: thumbnail-only chip, pruned from wire | — |

**Risk R01: GC correctness** {#r01-gc-correctness}

- **Risk:** The sweep's root set misses a reference class and reclaims live bytes (Joplin's history is the cautionary tale).
- **Mitigation:** Only two producers ever write `draft-attachments/` paths (durable card state, prompt history), both enumerable in tugbank; the sweep unions both, applies a 7-day mtime grace, and touches only files directly inside `draft-attachments/`.
- **Residual risk:** A future feature that stores these paths elsewhere must add itself to the root set — noted in the sweep's docblock.

**Risk R02: Tier 1 orphans** {#r02-tier1-orphans}

- **Risk:** A user drops a file, then deletes the link (or never saves the doc); the asset file remains.
- **Mitigation:** Accepted. Assets land in user-visible, usually git-tracked space; `git status` shows them; deletion is a normal file operation.
- **Residual risk:** Clutter in long-lived `assets/` folders.

---

### Design Decisions {#design-decisions}

#### [P01] No database; attachments are plain files served by tugcast (DECIDED) {#p01-files-not-db}

**Decision:** Attachment bytes live as ordinary files on disk. No new server, no SQLite blob store, no app-scheme or localhost-URL links.

**Rationale:**
- A DB-keyed link (`:/id`, `tug://`, `http://127.0.0.1:<port>/…`) is dead outside the app; the per-instance port window makes localhost URLs wrong across launches.
- `/api/fs/blob` already streams files with ETag/Range semantics; files need no schema migrations, no `ledger_db` gateway, no `db-inspect` discipline.

**Implications:** Both tiers reduce to "where does the file go and what string does the surface hold."

#### [P02] Tier 1 home: shared sibling `assets/` folder, standard relative links (DECIDED) {#p02-shared-assets}

**Decision:** A file dropped on a Text card editing `<dir>/<doc>.md` is written to `<dir>/assets/<name>`, and the editor inserts `![<stem>](assets/<name>)` for images, `[<name>](assets/<name>)` for everything else.

**Rationale:**
- The relative-folder + standard-link pattern is the only one where GitHub, pandoc, Obsidian, and `cat` all agree on what the document means (TextBundle/Typora/Zettlr/Logseq precedent).
- Shared `assets/` (not `<doc>.assets/`) suits repo docs like `roadmap/`: less clutter, and orphan lifecycle is visible in git anyway.

**Implications:** Moving a `.md` without its `assets/` folder breaks links — accepted, standard for the pattern (see Non-goals).

#### [P03] Filename policy: original name, `-2`/`-3`… collision suffix (DECIDED) {#p03-name-suffix}

**Decision:** Assets keep their original filename; a collision appends `-N` before the extension (`photo.png` → `photo-2.png`), resolved server-side at write time. The markdown link percent-encodes characters that would break a CommonMark destination (spaces, parens).

**Rationale:** These links are meant to be read; content-hash names would make the markdown opaque. Server-side resolution makes the write atomic with the name choice.

#### [P04] Originals at rest; downsample at time of use (DECIDED) {#p04-originals-at-rest}

**Decision:** Stored bytes are always the verbatim dropped file. The downsample pipeline (2576 px / 5 MB caps) runs only when bytes are headed to a model: at drop time for the in-memory store entry (as today), and at rehydrate time when restoring a draft from disk.

**Rationale:** The caps exist for API-payload reasons; baking them into storage destroys data. A draft that survives a relaunch submits at identical quality to one that didn't.

**Implications:** In-memory `AtomBytesStore` entries stay downsampled (preview + wire path unchanged, `buildWirePayload` untouched); the disk copy is the original.

#### [P05] Tier 2 scope: images only (DECIDED) {#p05-images-only}

**Decision:** The composer's durable tier covers exactly what attaches today — images from drop and paste. Non-images continue to insert as filename text.

**Rationale:** Parity first; widening scope changes wire semantics ([Q01]).

#### [P06] Tier 2 home: `data_dir()/draft-attachments/<uuid>.<ext>` (DECIDED) {#p06-draft-attachments-dir}

**Decision:** tugcast stores composer originals under `tugcore::instance::data_dir().join("draft-attachments")`, named `<uuid>.<ext>` with the extension derived from the media type (the `attachment_extension` mapping pattern from `feeds/operator.rs`).

**Rationale:** Mirrors the proven `gazette-attachments` layout one directory over; per-instance keeps instances isolated; UUID names need no collision logic and carry no meaning (the human name never mattered for composer images — chips are labeled `image-N`).

#### [P07] Durable card state carries references, not bytes (DECIDED) {#p07-cap-maps-not-strips}

**Decision:** `AtomBytesEntry` gains an optional `path` (absolute path of the stored original). `capDurableCardState()` stops deleting `content.attachmentBytes` wholesale; instead it maps each entry to `{path, mediaType, thumbnailDataUrl}` — dropping only the base64 `content`. Entries with no `path` yet (upload still in flight, or upload failed) lose `content` and degrade exactly as today.

**Rationale:** The strip existed because entries were megabytes; a path is tens of bytes. The boot-bloat rationale evaporates while the seam (`capDurableCardState`) and its unit-test surface stay put.

**Implications:** Restore must distinguish "entry with path, no content" (rehydratable) from "entry with neither" (prune, as today).

#### [P08] Conservative startup GC for the draft tier (DECIDED) {#p08-gc}

**Decision:** At tugcast startup, sweep `draft-attachments/`: delete a file only if (a) its absolute path appears in no value of tugbank domain `dev.tugtool.deck.cardstate` and no value of `dev.tugtool.prompt.history`, and (b) its mtime is older than 7 days.

**Rationale:** Closed-world root set (only those two producers exist), grace period per the git-gc / Joplin lesson: never delete eagerly on unlink.

**Implications:** Reference check is a substring scan over the domains' JSON values — crude but sound (absolute UUID paths cannot false-negative; a false positive merely retains a file).

#### [P09] Two upload routes, raw-bytes bodies (DECIDED) {#p09-two-routes}

**Decision:** `POST /api/attachments` (Tier 2: server picks the location per [P06], returns `{path}`) and `POST /api/fs/attach` (Tier 1: caller names the document and desired filename; server creates the sibling `assets/` dir, resolves collisions per [P03], returns `{path, relativePath}`). Both take the file's raw bytes as the request body (media type via header/query), not base64-in-JSON.

**Rationale:** Two policies (server-located vs. document-sibling) are cleaner as two small routes than one route with modes. Raw bodies avoid the 1.33× base64 + JSON-escape inflation that forced `fs_write`'s 6× body ceiling.

#### [P10] Text card stays raw-source; ⌘-click opens assets (DECIDED) {#p10-raw-source}

**Decision:** No widgets, no inline rendering. The inserted link gets the editor's existing markdown token styling; ⌘-click on a relative asset link resolves it against the document's directory and opens viewable extensions in the existing file-view card.

**Rationale:** The Text card's doctrine is "syntax never hidden" (its docblock excludes widgets deliberately); the anchor-links extension (`tug-text-card-editor/anchor-links.ts`) already owns the ⌘-click gesture for intra-doc anchors — asset links extend that grammar.

---

### Deep Dives {#deep-dives}

#### Current composer attachment flow, and exactly what changes {#composer-flow}

Today (all paths verified in source):

1. Drop lands in `tugDropExtension`'s `onDrop` (`tugdeck/src/components/tugways/tug-text-editor/drop-extension.ts`); paste lands in `handlePaste` branch 1 (`tug-text-editor/clipboard-filters.ts`). Both call `processAttachmentFiles(view, files, insertPos, bytesStore, onError)` (exported from `drop-extension.ts`).
2. `processAttachmentFiles` preflights via `resolveDroppedFile` → `downsampleImage(file)`, mints a UUID per surviving image, `bytesStore.put(id, {content, mediaType, thumbnailDataUrl})`, then one `insertMixedAt` transaction inserts `U+FFFC` chips labeled `image-N`.
3. The prompt entry's `onSave` returns `{route, draft, attachmentBytes: attachmentBytesStore.snapshot()}` into the card-state bag; `putCardState` → `capDurableCardState` deletes `attachmentBytes`; restore → `coerceRestorePayload` → `pruneOrphanedImageAtoms` removes chips whose bytes are gone (`tug-prompt-entry.tsx`).
4. Submit: `CodeSessionStore.send` → `buildWirePayload(text, atoms, bytesStore)` emits interleaved `{type:"image", source:{type:"base64",…}}` blocks; entries with empty `content` (thumbnail-only re-seeds) fall through to a mention marker.

What changes, minimally:

- Step 2 additionally fires a background `POST /api/attachments` with the **original** `File` bytes; on success it re-`put`s the entry with `path` added. The chip is never pending on this — the downsampled bytes are already in hand; `path` arrives whenever it arrives. If the app quits before the upload lands, the entry persists pathless and degrades as today.
- Step 3's cap maps instead of strips ([P07]). Restore keeps path-bearing atoms and fires rehydration: `GET /api/fs/blob?path=…` → `downsampleImage` on the fetched blob ([P04]) → `put` full entry. The fetch-decode-put shape is exactly `hydrateGazetteAttachments` (`tugdeck/src/lib/gazette-attachment-bytes.ts`), including its chunked `toBase64` helper and in-flight interlock — extract the shared pieces rather than copying them.
- Step 4 is untouched.
- Prompt history: `SerializedAtom` (`tugdeck/src/lib/prompt-history-store.ts`) gains `path?: string` alongside its existing `id`/`thumbnailDataUrl`; recall re-seeds the store entry with `{content:"", mediaType, thumbnailDataUrl, path}` and triggers the same rehydration, making recalled prompts resubmittable. History entries are size-trimmed against `MAX_PROMPT_HISTORY_BYTES` (192 KiB, `settings-api.ts`) — a path string is negligible there.

#### Text card drop mechanics {#text-card-drop}

The Text card editor (`tug-text-card-editor.tsx`) installs no drop handling; `tugDropExtension` lives in the composer substrate's module but its drop-caret primitives are already exported (`dropOffsetAtCoords`, `paintDropCaret`, `clearDropCaret` in `drop-extension.ts`). The Text card gets its own small extension (new file `tugdeck/src/components/tugways/tug-text-card-editor/file-drop.ts`) that reuses those primitives for the caret/ring affordance and, on drop:

1. For each `File`: read `arrayBuffer()`, `POST /api/fs/attach?doc=<abs doc path>&name=<file.name>` with raw bytes and `Content-Type: <file.type or application/octet-stream>`.
2. Insert one CM6 transaction at the drop offset with the returned links, space-separated: `![stem](assets/name.png)` for image media types, `[name](assets/name.zip)` otherwise, destination percent-encoded per [P03]. The insertion is a normal edit — dirty-state, manual/automatic save, aside crash-safety, and undo all apply unchanged (one undo removes the links; the asset files remain, per Risk R02).
3. A failed upload inserts nothing for that file and surfaces the error through the card's existing banner/sheet vocabulary.

The doc's absolute path is available on the store (`text-card-store.ts` owns it); an **untitled buffer has no directory yet** — drops on an unsaved untitled buffer are refused with a notice ("Save the file first"), the one guard this needs.

#### Route specifications {#route-specs}

**Spec S01: `POST /api/fs/attach`** {#s01-fs-attach}

- Query: `doc` (absolute path of the markdown file being edited; guarded by `guard_absolute_path` + secret denylist), `name` (desired filename; reject path separators, `..`, empty, and leading dots).
- Body: raw file bytes. `DefaultBodyLimit`: 64 MiB.
- Behavior: `create_dir_all(parent(doc)/assets)`; resolve collisions by appending `-2`, `-3`, … before the extension until a name is free; write atomically (temp + fsync + rename, same discipline as `fs_write`); loopback-only.
- Response 200: `{"path": "<abs>", "relativePath": "assets/<final-name>"}`. Errors carry the shared `{"error": …}` body.

**Spec S02: `POST /api/attachments`** {#s02-attachments}

- Query: `mediaType` (RFC 6838 string; the extension is derived from it via the `attachment_extension` mapping, which moves from `feeds/operator.rs` into a shared module so both callers use one table).
- Body: raw file bytes. `DefaultBodyLimit`: 64 MiB.
- Behavior: `create_dir_all(data_dir()/draft-attachments)`; write `<uuid>.<ext>` atomically; loopback-only.
- Response 200: `{"path": "<abs>"}`.

#### State Zone Mapping {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| `AtomBytesEntry.path` | external store data | `AtomBytesStore` entry field; no render dependency (read at save/rehydrate/submit) | [L02] |
| Rehydration in-flight set | external store data | module-level `Set` + store `put` on completion (gazette pattern) | [L02] |
| Chip pending appearance | appearance | existing `data-pending` DOM attribute via store subscription — unchanged | [L06] |
| Text card drop-active ring/caret | appearance | `data-drop-active` attribute + caret DOM element (reused primitives) | [L06] |
| Text card upload-failure notice | structure | existing card banner/sheet vocabulary | [L02] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/attachments.rs` | Shared storage helpers (`attachment_extension`, atomic write, collision resolution) + both route handlers (Spec S01, S02) |
| `tugrust/crates/tugcast/src/draft_gc.rs` | Startup sweep of `draft-attachments/` ([P08]) |
| `tugdeck/src/lib/attachment-upload.ts` | Deck client for both routes + shared rehydration (`fetch /api/fs/blob` → `downsampleImage` → `put`), extracted `toBase64` |
| `tugdeck/src/components/tugways/tug-text-card-editor/file-drop.ts` | Text card drop extension (Deep Dive #text-card-drop) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `AtomBytesEntry.path` | field | `tugdeck/src/lib/atom-bytes-store.ts` | optional; `snapshot`/`restore` round-trip it |
| `capDurableCardState` | fn | `tugdeck/src/settings-api.ts` | map entries to `{path, mediaType, thumbnailDataUrl}` instead of deleting the bag ([P07]) |
| `pruneOrphanedImageAtoms` | fn | `tugdeck/src/components/tugways/tug-prompt-entry.tsx` | keep path-bearing atoms; trigger rehydration |
| `processAttachmentFiles` | fn | `tugdeck/src/components/tugways/tug-text-editor/drop-extension.ts` | background original-upload after `put` |
| `SerializedAtom.path` | field | `tugdeck/src/lib/prompt-history-store.ts` | recall re-seeds with path |
| `attachment_extension` | fn | move `feeds/operator.rs` → `attachments.rs` | one MIME↔ext table for gazette + drafts |
| `build_app` | fn | `tugrust/crates/tugcast/src/server.rs` | register the two routes with body limits |

---

### Test Plan Concepts {#test-plan-concepts}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Rust unit** | collision suffixing, extension mapping, GC root-set/grace logic, filename validation | `attachments.rs`, `draft_gc.rs` — pure fns tested directly, `cargo nextest run` |
| **Deck unit (bun)** | `capDurableCardState` mapping, `AtomBytesEntry.path` snapshot round-trip | existing `__tests__` pattern next to the modules |
| **App-test** | real drop → relaunch-shaped restore → resubmit; Text card drop → file on disk + link in doc | new `*.test.ts` with `@covers` for the touched sources; run via `just app-test-changed` |

#### What stays out of tests {#test-non-goals}

- No mocked-fetch or jsdom render tests — banned pattern; the app-tests drive the real routes on real bytes.
- No full-corpus app-test sweeps — selection via `@covers` only.
- GC is not app-tested (it runs at tugcast startup, before any test's first assertion) — covered at the Rust layer with a temp `draft-attachments/` fixture.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Applies to every step.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | tugcast attachment storage + `POST /api/attachments` | pending | — |
| #step-2 | `POST /api/fs/attach` (document-sibling assets) | pending | — |
| #step-3 | `AtomBytesEntry.path` + original upload on drop/paste | pending | — |
| #step-4 | Durable card state maps references; restore rehydrates | pending | — |
| #step-5 | Prompt-history recall becomes resubmittable | pending | — |
| #step-6 | Draft-attachments GC at tugcast startup | pending | — |
| #step-7 | Text card file drop → assets + markdown links | pending | — |
| #step-8 | ⌘-click asset links open a viewer card | pending | — |
| #step-9 | Integration checkpoint | pending | — |

#### Step 1: tugcast attachment storage + `POST /api/attachments` {#step-1}

**Commit:** `tugcast(attachments): draft-attachment storage and upload route`

**References:** [P01] files not DB, [P06] draft-attachments dir, [P09] two routes, Spec S02, (#route-specs, #composer-flow)

**Artifacts:**
- `tugrust/crates/tugcast/src/attachments.rs`: `attachment_extension` (moved from `feeds/operator.rs`, which now imports it), atomic raw-bytes write helper (temp + fsync + rename, per `fs_write`'s discipline), `post_attachments` handler per Spec S02.
- Route registered in `server.rs::build_app` with a 64 MiB `DefaultBodyLimit`.

**Tasks:**
- [ ] Create `attachments.rs`; relocate `attachment_extension`; keep `feeds/operator.rs` compiling against the shared fn.
- [ ] Implement `post_attachments`: loopback guard (same pattern as `jots.rs`), `create_dir_all(data_dir()/draft-attachments)`, `<uuid>.<ext>` atomic write, `{"path": …}` response.
- [ ] Register the route.

**Tests:**
- [ ] Unit: extension mapping for the downsample-producible set + `img` fallback; write helper produces the exact bytes; response path is absolute and inside `draft-attachments/`.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 2: `POST /api/fs/attach` (document-sibling assets) {#step-2}

**Depends on:** #step-1

**Commit:** `tugcast(attachments): document-sibling assets upload with collision suffixing`

**References:** [P02] shared assets, [P03] name suffix, [P09] two routes, Spec S01, (#route-specs, #text-card-drop)

**Artifacts:**
- `post_fs_attach` in `attachments.rs`; route registered with its own body limit.
- Pure `resolve_collision_name(dir, name) -> String` helper.

**Tasks:**
- [ ] Validate `name` (no separators, no `..`, non-empty, no leading dot); guard `doc` via `guard_absolute_path` + secret denylist.
- [ ] `create_dir_all(parent(doc)/assets)`; resolve `-N` suffix against existing entries; atomic write; `{"path", "relativePath"}` response.

**Tests:**
- [ ] Unit: collision suffixing (`photo.png` → `photo-2.png` → `photo-3.png`; extensionless names; dotfiles rejected); name validation rejections; relativePath shape.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 3: `AtomBytesEntry.path` + original upload on drop/paste {#step-3}

**Depends on:** #step-1

**Commit:** `tugdeck(attachments): upload dropped originals and carry the stored path on bytes-store entries`

**References:** [P04] originals at rest, [P05] images only, [P07] references not bytes, Spec S02, (#composer-flow, #state-zone-mapping)

**Artifacts:**
- `AtomBytesEntry.path?` in `atom-bytes-store.ts` (`snapshot`/`restore` round-trip it; `restore`'s field filter admits it).
- `tugdeck/src/lib/attachment-upload.ts`: `uploadDraftAttachment(file): Promise<string>` posting raw bytes to `/api/attachments`.
- `processAttachmentFiles` (and the paste path, which shares it) fires the background upload per surviving image and re-`put`s with `path` on success; failure logs to `tugDevLogStore` and leaves the entry pathless.

**Tasks:**
- [ ] Extend the entry type + store round-trip.
- [ ] Wire the upload into `processAttachmentFiles` after the synchronous `put` (chip stays never-pending; the original `File` is still in scope there).
- [ ] `bunx vite build` clean.

**Tests:**
- [ ] Deck unit: snapshot/restore round-trips `path`; malformed-snapshot filter still admits path-less entries.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/lib/__tests__/atom-bytes-store.test.ts && bunx vite build`

---

#### Step 4: Durable card state maps references; restore rehydrates {#step-4}

**Depends on:** #step-3

**Commit:** `tugdeck(attachments): persist attachment references in card state and rehydrate on restore`

**References:** [P04] downsample at time of use, [P07] cap maps not strips, (#composer-flow, #state-zone-mapping), Risk R01

**Artifacts:**
- `capDurableCardState` strip 1 becomes a map: each `attachmentBytes` entry → `{path, mediaType, thumbnailDataUrl}` (drop `content`; entries with no `path` keep only `mediaType`/`thumbnailDataUrl`, degrading as today).
- `pruneOrphanedImageAtoms` keeps atoms whose entry carries a `path`; a new `rehydrateDraftAttachments(entries, store)` in `attachment-upload.ts` (gazette pattern: in-flight interlock, `GET /api/fs/blob`, `downsampleImage` on the fetched blob, `put` full entry incl. `path`).
- The prompt entry's restore path (`coerceRestorePayload` caller) invokes rehydration fire-and-forget.

**Tasks:**
- [ ] Rewrite cap strip 1 + its docblock (the ~18 MB rationale updates to "references only").
- [ ] Restore-side keep/rehydrate/prune split.
- [ ] Extract chunked `toBase64` from `gazette-attachment-bytes.ts` into the shared module; gazette imports it.
- [ ] `bunx vite build` clean.

**Tests:**
- [ ] Deck unit: `capDurableCardState` maps path-bearing entries, degrades pathless ones, leaves other bag fields alone.
- [ ] App-test (`@covers` prompt entry, drop-extension, settings-api): drop a real image, force a durable save + cold restore, assert the chip returns and submit ships a real image block.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 5: Prompt-history recall becomes resubmittable {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck(attachments): prompt-history entries carry attachment paths; recall rehydrates`

**References:** [P07] references not bytes, (#composer-flow)

**Artifacts:**
- `SerializedAtom.path?`; capture at submit (the serializer already reads the store entry for `thumbnailDataUrl` — read `path` alongside).
- The recall re-seed in `tug-prompt-entry.tsx` (the `{content:"", mediaType:"", thumbnailDataUrl}` seeding site) includes `path` and triggers `rehydrateDraftAttachments`.

**Tasks:**
- [ ] Field + capture + re-seed + rehydrate call.
- [ ] `bunx vite build` clean.

**Tests:**
- [ ] App-test: submit with an image, recall via ↑ after a cold-restore-shaped reset, resubmit; assert a real image block (not a mention-marker fallthrough).

**Checkpoint:**
- [ ] `just app-test-changed`

---

#### Step 6: Draft-attachments GC at tugcast startup {#step-6}

**Depends on:** #step-1

**Commit:** `tugcast(attachments): conservative startup sweep of draft-attachments`

**References:** [P08] GC, Risk R01, (#route-specs)

**Artifacts:**
- `draft_gc.rs`: `sweep_draft_attachments(dir, root_json_values: &[String], grace: Duration)` — pure core taking the concatenated JSON values of `dev.tugtool.deck.cardstate` and `dev.tugtool.prompt.history`; startup call site in `main.rs` after the tugbank open (tugbank is fatal-if-absent per [D15], so the roots are always readable).

**Tasks:**
- [ ] Pure sweep fn: files directly inside the dir, substring-match absolute path against roots, mtime > 7 days → remove.
- [ ] Wire into startup; docblock names the root-set contract (any future producer of these paths must add itself — Risk R01 residual).

**Tests:**
- [ ] Unit: temp-dir fixture — referenced+old kept, unreferenced+young kept, unreferenced+old removed; subdirectories untouched.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 7: Text card file drop → assets + markdown links {#step-7}

**Depends on:** #step-2

**Commit:** `tugdeck(text-card): file drops write sibling assets and insert markdown links`

**References:** [P02] shared assets, [P03] name suffix, [P10] raw source, Spec S01, (#text-card-drop, #state-zone-mapping), Risk R02

**Artifacts:**
- `tug-text-card-editor/file-drop.ts`: drag ring + drop caret via the exported primitives (`dropOffsetAtCoords`, `paintDropCaret`, `clearDropCaret`), upload via `uploadDocAttachment(docPath, file)` (new fn in `attachment-upload.ts`), one insertion transaction with the returned links per the [P02]/[P03] link forms.
- Wired into `tug-text-card-editor.tsx`'s extension list; its "deliberately NOT here" docblock updates (drop is now here; atoms/completion still are not).
- Untitled-buffer guard: refuse with the card's notice vocabulary.

**Tasks:**
- [ ] Extension + wiring + link formatting (percent-encode destinations; image vs plain link by media type).
- [ ] Upload-failure notice through the card's existing banner path.
- [ ] `bunx vite build` clean.

**Tests:**
- [ ] App-test (`@covers` text-card, tug-text-card-editor, file-drop): drop a fixture PNG on a Text card over a temp `.md`; assert the asset file's bytes are identical to the fixture, the doc contains the expected link, and a second drop of the same name yields `-2`.

**Checkpoint:**
- [ ] `just app-test-changed`

---

#### Step 8: ⌘-click asset links open a viewer card {#step-8}

**Depends on:** #step-7

**Commit:** `tugdeck(text-card): cmd-click relative asset links opens the file viewer`

**References:** [P10] raw source, (#text-card-drop)

**Artifacts:**
- `anchor-links.ts` grammar extended: a markdown link whose destination is relative and non-`#` resolves against the document's directory; viewable extensions (the `/api/fs/blob` MIME table's set) open via the existing open-file-in-card path (`tugdeck/src/lib/open-file-in-card.ts`); others no-op.

**Tasks:**
- [ ] Grammar + resolution + open call; decode percent-encoding before resolving.
- [ ] `bunx vite build` clean.

**Tests:**
- [ ] App-test: ⌘-click the link inserted in Step 7's fixture doc; assert a file-view card opens on the asset path.

**Checkpoint:**
- [ ] `just app-test-changed`

---

#### Step 9: Integration checkpoint {#step-9}

**Depends on:** #step-4, #step-5, #step-6, #step-7, #step-8

**Commit:** `N/A (verification only)`

**References:** (#success-criteria)

**Tasks:**
- [ ] Walk every Success Criterion end to end on a dash or debug build.
- [ ] `just app-test-covers-check` (every new test declares `@covers`).

**Tests:**
- [ ] Full selected suite green.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test-changed`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Durable attachment handling on both markdown-editing surfaces — Text card drops produce portable `assets/` files with standard links; prompt-entry image attachments survive relaunch and history recall as resubmittable originals — with no database, two small tugcast routes, and a conservative GC.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All six Success Criteria verified (#success-criteria).
- [ ] `cargo nextest run` and `bunx vite build` clean; selected app-tests green.
- [ ] `capDurableCardState` docblock and `tug-text-card-editor.tsx` docblock reflect the new reality (no stale "can't be re-resolved" / "drop deliberately not here" claims).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] [Q01] durable non-image composer attachments.
- [ ] [Q02] attachment affordances for Jots / other editor hosts.
- [ ] Optional orphan-report tooling for Tier 1 `assets/` folders.
