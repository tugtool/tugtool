# Session Reference Brief

Status: draft for discussion → gallery design spike
Date: 2026-08-08

## Purpose

Tug refers to sessions in at least seven forms across at least fifteen surfaces, with five near-parallel precedence rules and no shared component, no shared typography, and no doctrine entry. This brief defines one identity model, one resolver, one component family with density tiers, a text-only citation form, and a fork-lineage grammar — to be auditioned in a gallery design spike and then locked with a D-number.

## The audit, condensed

### Identifier forms and where they come from

| Form | Example | Producer | Notes |
|---|---|---|---|
| tug session UUID | `f6e43925-…` | client mint at spawn (`session-card.tsx:1799`) | routing key; diverges from claude's id on fork (`tugcode/src/session.ts:7337`) |
| 8-char short id | `ab7579ac` | render-time `slice(0,8)`, computed independently in three places (`session-name.ts:26`, `changeset.rs:737`, `changeset.rs:755`) | never stored |
| adjective-noun tag | `stocky-pixie` | client mint from 512×1024 lexicon (`session-tag.ts:65`), unique index in `sessions.db` (`session_ledger.rs:1381`) | lost on fork; silently dropped on suffix exhaustion; faked non-uniquely for external sessions via `deriveStableTag` |
| user name | `/rename` | `sessions.name` + `name_user_set` | the only user-editable form |
| auto title (incipit) | "Add animation to card resize…" | Claude Code `ai-title` JSONL records, scraped only by the external scan (`external_sessions.rs:926`) | no live capture — fresh titles lag until a scan |
| project/branch prefix | `tugtool/stocky-pixie (branch)` | `sessionCardTitleOverride` (`session-card-title.ts:36`) | derived, never persisted |
| `prior_owner_name` | Changes orphan hint | changeset feed `display_name` (`changeset.rs:755`) | a fourth naming pipeline no other surface consults |

### Five parallel precedence rules

`sessionChipDisplay` (orphaned since the Z4B diet), `sessionRowTitle` (picker), `sessionEntryTitle` (heuristic hash-equality sniff), Rust `session_row_title` (no tag arm), Rust `session_display_name`. No two identical.

### Surface divergences

- **Picker** leads with the incipit; tag is buried in a metadata line typographically identical to the timestamp; external sessions show a synthesized tag that exists nowhere else.
- **Title bar** (`tugtool/stocky-pixie`) and the **picker row** for the same session share no substring at all.
- **Lens** rows match the title bar, but the filter-match projection passes `branch: null` (`cards-data-source.ts:290`) while the rendered row passes the real branch.
- **Gazette** ref chips print the full 36-char UUID — the label rule is a path-shaped `split("/").pop()` that is a no-op on a UUID (`gazette-card.tsx:112`). `post.sessionId` is loaded and discarded.
- **Tab strip** shows the literal registry title "Session" for a stacked Session card (`tug-tab-bar.tsx:441`) — the [D123] drift failure, still live in one surface.
- **Changes card** names sessions with its own vocabulary and renders no identifier; the owner id sits unpainted in a DOM attribute.
- **Commit messages / History card** render the `Tug-Session:` trailer as a truncated prompt incipit plus the **full UUID** — the only user-facing full-UUID display besides the Gazette chip, and the incipit half is frequently ambiguous.
- **Typography:** tag, title, and UUID are undifferentiated plain text at four uncoordinated sizes (picker `md`, Lens `sm`, title bar `sm`, Gazette chip `2xs`).

Root cause: [D123] ("a name is one string produced in one place") exists for pane titles but was never extended to session identity. The canonical formatter is dead code; the doctrine entry does not exist.

## The model

### One role per form — forms never swap jobs

- **Tag = the callsign.** The stable, typable, distinguishing handle; answers *which one?* Appears on every surface, always in the same visual treatment, always the lead identifier. Immutable — no `/retag`. Becomes addressable: the deferred `tag → session_id` resolver and `/resume <tag>` land as part of this work.
- **Title = the description.** User name, else live-captured auto-title, else prompt incipit; answers *what's it about?* Always subordinate to the callsign — the incipit never leads on any surface. (Field experience: incipits are too samey and ambiguous to scan by.)
- **Project/branch = the context.** Shown when the surrounding surface doesn't already establish it: omitted inside a project-scoped picker, mandatory on app-wide surfaces (Gazette, Window menu, slot-stack picker).
- **UUID = plumbing.** Machine fields, tooltips, and a copy affordance (`TugCopyBadge`, whose docstring already names session ids as its use case). Never a primary label, never a display fallback — the fallback is always the tag, which every session can have.

### One resolver

`resolveSessionIdentity(sessionId) → { project, branch, tag, lineage, title, state, liveness }` — a structured object, grown from `session-card-title.ts`, absorbing and deleting `sessionChipDisplay`, `sessionRowTitle`, `sessionEntryTitle`, and the client-side hash sniff. The Rust feed grows its tag arm so the client never re-derives ([R02]). Every surface consumes the resolver; no surface composes identity strings itself. This is the session-identity analog of [D123]'s `composePaneTitleBarText`.

### One component family — density tiers

**`TugSessionIdentity`**, composing existing Tug components ([feedback: never hand-roll], TugBadge two-line doctrine at `component-authoring.md:961`). Surfaces choose a *tier*, never a *format*:

| Tier | Contents | Consumers |
|---|---|---|
| **Chip** | callsign on a tinted `TugBadge`-based chip; hover → full identity via `TugPlacard`; click → raise/open | Gazette refs, Changes orphan hint, inline mentions |
| **Line** | `project/callsign` + optional truncated title | tab strip, slot-stack picker, Window menu |
| **Row** | callsign lead, title beneath, pulse/activity/telemetry — `TugSessionRow` adopted everywhere (picker moves off hand-assembled `TugListRow`) | picker, `/resume` sheet, Lens Sessions group |
| **Masthead** | expanded card chrome — see below | Session card title bar |

**Typography convention:** the tag gets one distinct, recognizable treatment everywhere it appears — it is the one identifier that is never prose.

**Tint:** a deterministic per-session tint, hashed **from the tag**, applied to the chip and the pulse-dot, giving sessions glanceable visual identity alongside the lexical one. Hashing the tag rather than the session id means the tint is stable across machines for the same callsign, travels with a citation, and is reproducible by anything that can read the tag — including surfaces that never see a session id. Lineage forks derive from their full suffixed tag, so `stocky-pixie-A1` is visibly its own session rather than a shade of its root. Hue selection must be theme-aware and pass the `brio` contrast budget in all six themes (`bun run audit:theme-contrast`); the gallery auditions the palette quantization.

### The masthead — the title bar grows up

One-line 36px title bars are a vestige of pixel-starved UIs displaying file names. The Session card's chrome becomes a two-to-three-line **masthead**:

- Lead line: callsign + project/branch + the pane controls.
- Second line: the descriptive title.
- Trailing affordance: a small pulse/info widget — hover or click opens a `TugPlacard` with the telemetry at a glance (state, activity line, turns, created/compacted stamps, sparkline). The masthead itself stays **identity-only**; telemetry is one gesture away, not resident.

Architecture: chrome remains the Pane's ([L09]/[L25]). `cardTitleStore`'s override evolves from a string to a structured identity payload; `TugPane` renders masthead density when a card publishes one and keeps the one-line bar otherwise. The load-control bar's "Session created …" line is an absorption candidate. The mechanism generalizes: any card with real content identity (a file card's path + dirty state) can publish a masthead later.

**Height: a fixed second tier.** `--tug-chrome-height` (36px, declared identically in all six themes) gains a sibling `--tug-masthead-height` — one fixed value, not content-driven. Every masthead card is therefore the same height as every other, geometry stays computable without measurement, and the existing invariant that JS mirrors the chrome height as a constant (`CARD_TITLE_BAR_HEIGHT = 36`, `tug-pane.tsx:87`) extends unchanged rather than becoming a measurement problem. Identity that overflows the fixed box truncates (middle-truncation via `TugLabel`) and the placard carries the full text; the masthead never reflows to fit its content. The gallery decides the value by auditioning two-line and three-line compositions, but the outcome is one number.

### The citation — text-only form

Prose, commit messages, exports, and logs need a canonical plain-text reference. The **citation** is:

```
stocky-pixie (f6e43925)
```

— callsign plus parenthesized 8-char short id. The short id makes the citation durable beyond one machine's ledger (tags are machine-local; git history is forever) and disambiguates any future tag reuse across machines. With project context when the context doesn't supply it: `tugtool/stocky-pixie (f6e43925)`.

Applications:

- **`Tug-Session:` commit trailer** becomes the citation, replacing the truncated-prompt-plus-full-UUID form (`changes-route-controller.ts:278`).
- **Transcript export filename** becomes `tug-session-<tag>-<shortid>` instead of the bare hash.
- Anywhere else a session must be named in flat text (dev log, diagnostics, Gazette export).

#### Commit trailers: two lines, human and machine

The commit carries **both** — full disambiguation is worth one extra line:

```
Tug-Session: stocky-pixie (f6e43925)
Tug-Session-Id: f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f
```

The citation trailer is what a human reads and what the History card renders. The id trailer is the machine key — it is what `changes.db` joins on (that table is keyed by the full tug session id), what survives short-id ambiguity across machines, and what any future tooling resolves against. It is never displayed.

#### Resolution: structured-first, pattern-match later

Tug has two mechanisms for making an identifier interactive, and this work uses them in sequence.

**Phase 1 — structured field (this brief).** tugcast parses the trailers out of the commit body server-side into typed fields on `GitLogCommit`, exactly as `Tug-Dash:` is already parsed into `tug_dash` (`tugcast-core/src/types.rs:193`, rendered as a badge at `tug-history-list.tsx:344`). The History card renders the citation at chip tier on the commit's identity line beside the SHA and dash badge, resolving to a live chip when the session is known to the local ledger and a static citation when it is not. **The trailer lines are stripped from the displayed body** — today they are raw text dumped through `TugMarkdownText` (a syntax styler, not a renderer), which is what produces the wrapped UUID and truncated incipit in the current History card. `Tug-Session:` is the last of our trailers with no structured field; this closes that gap.

**Phase 2 — pattern match (deferred).** Citations appearing in free prose — a Gazette post, a typed message, a plan doc, a commit Tug did not author — light up through the content annotator, which already has a registry built for exactly this extension (`lib/annotator/registry.ts:99`: "a detector plus an entry here, with no edit to any transcript, cell, or menu surface"). Two prerequisites, both real:

- **Hex collision.** The 8-char short id is 8 lowercase hex characters with at least one digit, which is precisely what `scanCommitShas` matches (`detect-commit-sha.ts:54`, 7–40 hex with a digit). A bare short id in annotated text would be claimed by the commit-SHA detector and sent to the git resolver. The session detector must therefore match the **whole citation** (`<tag> (<hex>)`) and claim the run before the SHA scanner reaches the parenthesized part.
- **Scope.** The History card sits outside any `AnnotationScope` (mounted only by the transcript, `session-card-transcript.tsx:418`), so the annotator is inert there until one is mounted.

Phase 1 is unblocked by neither and fixes the commit display on its own; Phase 2 is the general mechanism and is where the Gazette's prose references eventually land.

### Fork lineage grammar

A fork inherits visible lineage: **`<root-tag>-<Letter><Number>`**, e.g. `stocky-pixie-A1`.

- The **letter** identifies the branch *point* in the root session: first rewind point forked from is `A`, a fork taken from a different point is `B`, and so on.
- The **number** sequences forks from the same point: second fork from point `A` is `stocky-pixie-A2`.
- A fork of a fork extends: `stocky-pixie-A1-B2`. Display may middle-truncate deep chains; the chip tooltip carries the full lineage.
- Storage: the fork records its root tag + lineage segments; the display string is derived by the resolver.

Grammar note: the ledger's current mint-collision suffix is a bare `-N` (`tag_base` at `session_ledger.rs:4760` permits exactly one numeric suffix). That grammar must yield: with the reroll cap, natural mint collisions are vanishingly rare, so the bare-`-N` backstop is retired (or replaced with a full reroll against the ledger) and `-<Letter><Number>` becomes the only sanctioned suffix, reserved for lineage. Fork today silently mints an unrelated fresh tag (`session.ts:7337` — the ledger row and tag stay behind on the old id); the fork path instead carries the lineage-suffixed tag through the spawn.

### Tag space

Verdict: **the space is sufficient; keep two words.**

- 512 adjectives × 1024 nouns = 524,288 combinations against a per-machine ledger that realistically accumulates thousands of rows — mint collisions under the reroll cap are already rare and get rarer with lexicon growth.
- The scarce resource is not combinations but *human distinctiveness within the working set* — a dozen concurrent sessions that must not blur. More or longer words hurt that (three-word tags scan and type worse). The remedies are the typographic convention and the tint, not a bigger namespace.
- Grow the lexicon opportunistically (more 4–5-letter nouns are the cheap axis; nouns dominate the product), never structurally.
- **Never recycle a tag.** Uniqueness holds against every row the ledger has ever held, including trashed sessions — a Gazette post or commit citation from last month must never come to mean a different session.
- The lineage grammar is the structured extension of the space: every root tag fans out into its own `-A1…` subspace for free.
- External sessions get **real minted tags backfilled at scan time**, retiring the non-unique `deriveStableTag` display path entirely.

## Data-layer repairs (needed regardless of visual outcome)

1. **Live `ai-title` capture** — the bridge forwards `ai-title` records into the ledger as they stream; today a fresh title waits for an external scan (`external_sessions.rs:926`).
2. **Tag arm in the Rust title rule** — `session_row_title` (`changeset.rs:724`) carries the tag so `prior_owner_name` and the changeset feed speak the same language; the client hash-equality sniff (`session-name.ts:98`) is deleted.
3. **Backfilled tags for external sessions** — minted and persisted at scan time; `deriveStableTag` retires from production.
4. **Fork carries lineage** — the fork spawn threads the suffixed tag; no more silent fresh mint.
5. **Suffix-exhaustion fix** — a mint that exhausts the bare-`-N` backstop currently lands a NULL tag silently (`session_ledger.rs:2366`); with the backstop retired this becomes a full reroll, never a tagless row.
6. **Tab strip reads the pane title** — `tug-tab-bar.tsx:441` drops its `componentId === "text"` gate and goes through `paneTitleBarTextFor` like every other surface.
7. **Gazette chip resolves identity** — `RefChip` gains a session case that calls the resolver; the raw-UUID label dies.
8. **Changes card adopts the chip tier** — the orphan hint and (where useful) bucket headers render `TugSessionIdentity` chips instead of ad-hoc feed strings.
9. **Commit trailers parsed server-side** — `Tug-Session:` and `Tug-Session-Id:` become typed fields on `GitLogCommit` alongside `tug_dash` (`tugcast-core/src/types.rs:193`), and both lines are stripped from the body the History card renders. The writer side (`tugdash-core/src/ops.rs:812`, `changes-route-controller.ts:278`) emits the citation plus id pair.

## Doctrine

The outcome gets a **D-number**: session identity is one structured record produced by one resolver; every surface renders it through `TugSessionIdentity` at a declared density tier; the tag is the immutable callsign and always leads; the UUID never leads; the citation is the only sanctioned flat-text form. Companion updates: the masthead amendment to the pane-chrome sections of `pane-model.md`, and the lineage/suffix grammar recorded beside the tag machinery.

## The gallery spike

A gallery page auditioning, over live fixtures:

1. The four tiers side by side — chip, line, row, masthead — for the same set of sessions (named, unnamed, external, forked, live, terminal, failed).
2. Tag typography candidates, with and without the deterministic tint.
3. The masthead: two-line vs three-line, telemetry placard open and closed, against the current one-line bar.
4. The picker re-skinned on `TugSessionRow` with callsign-first rows, incipit demoted to the support line.
5. The Gazette post with resolved chips; the History card commit with the citation and resolved chip.
6. Fork lineage rendering: `-A1` chains at each tier, including deep-chain truncation.

## Resolved questions

- **Fork lineage:** visible, `<Letter><Number>` suffixes (`stocky-pixie-A1`), letter = branch point, number = sequence within it.
- **Tag mutability:** immutable; no `/retag`.
- **Masthead telemetry:** identity-only chrome; telemetry one hover/click away via a placard widget.
- **Incipit leading:** never — callsign leads on every surface; incipit is support text.
- **Tag space:** two words, opportunistic lexicon growth, no recycling, lineage as the structured extension.
- **Citation resolution:** structured-first — trailers parsed server-side into typed fields and rendered as chrome, following the `Tug-Dash:` precedent. Annotator pattern-matching for citations in free prose is a deferred second phase, gated on the hex-collision fix and an `AnnotationScope` in History.
- **Commit trailers:** both — a human `Tug-Session:` citation and a machine `Tug-Session-Id:` full UUID. Full disambiguation is worth the extra line; `changes.db` keys on the full id.
- **Masthead height:** a fixed second tier (`--tug-masthead-height`), not content-driven. Overflow truncates; the placard carries the full text.
- **Tint derivation:** hashed from the tag, so it is stable across machines, travels with a citation, and is reproducible anywhere the callsign is known.

## Open questions

None outstanding. The gallery spike settles the visual parameters (masthead line count and height value, tint palette quantization, tag typography) within the model above.
