# Dashes in the UI — a report and proposals

The dash infrastructure is in: binding, lifecycle stages, the plan verbs, join mode, the receipts. What grew up around it in the UI is a set of per-surface improvisations — a badge here, a section there — with no shared grammar for what a dash-bound session *looks like*. This report inventories what exists, names the defects, and proposes a direction: dash identity becomes part of the session identity grammar, produced in one place and worn by every surface, the same way [D123] settled session names.

## 1. Where dash identity surfaces today

| Surface | What it shows | Where |
| --- | --- | --- |
| Session masthead (title bar) | A `TugBadge` chip with the dash name, in the title line's trailing `slots` | `session-masthead.tsx:574-594`, `session-masthead.css:423-450` |
| Lens **Dashes** section | One row per dash, account-global: phase dot / parked mark, name, stage, `step i/N`, review mark, session jump chips | `lens/sections/dashes-section.tsx` |
| Changes card | The dash changeset entry (stage, plan, review state, verbs) | `tug-changes-list.tsx` |
| Session atoms / citations | **Nothing.** The atom renders name + `project/callsign` + phase dot; a dash-bound session's atom is indistinguishable from any other | `tug-session-identity.tsx` |
| Gazette | Nothing dash-specific — session refs render the plain atom | `gazette-card.tsx` |

Two different stores answer "what dash is this?": the masthead reads the **card-keyed** binding (`cardSessionBindingStore.getBinding(cardId)?.dash`), while the Lens section reads the **account-global** aggregate (`ChangesetAllStore`, whose dash entries carry `bound_sessions`). There is no session-keyed lookup at all — which is exactly the lookup an atom, a Gazette ref, or a Lens sub-row needs, since those surfaces have a session id and no card.

## 2. The badge: two defects, one root cause each

### 2a. The clipping is a component bug, not a width choice

The chip clips *both ends* of the name with no ellipsis (`…wn-attachments-fo…` in the screenshot). The CSS at `session-masthead.css:423` asks for elision — `overflow: hidden; text-overflow: ellipsis; max-inline-size: 12ch` — but it asks the wrong element. `TugBadge`'s root is `display: inline-flex; justify-content: center` (`tug-badge.css:196-198`), and `text-overflow` is inert on a flex container: the text lives in an anonymous flex item, the ellipsis never paints, and `justify-content: center` centers the overflowing run so it clips symmetrically off both edges. This is the same trap as [reference: inline-flex cannot elide] — a flex box hands its text no elidable box.

**Fix in `TugBadge` itself, not at the call site:** the badge's label children get an inner `.tug-badge-text` span with `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. Every badge in the app then elides correctly when a mount constrains it; no call site can reproduce this bug again. (Icon and overlay children stay siblings of the text span, unaffected.)

### 2b. The placement is wrong even once it elides

The chip sits in the title line's trailing slot, which on the masthead means it floats in the dead space between the title and the pane's control cluster — it reads as a stray control, not as identity. And it is frequently redundant ink: a session working dash `markdown-attachments` very often *is named* `markdown-attachments`, so the row says the same word twice, once clipped.

The deeper problem: the dash was bolted on *beside* the identity instead of being folded *into* it. The title is already a deliberate two-run grammar — `<name> : <project>/<callsign>` with per-register elision rules (`tug-session-identity.tsx` header). A dash is a fact of the same kind as the project: it is *where the session is working*. It belongs in that grammar, not in a slot.

## 3. Proposal — dash identity joins the identity grammar

**One selector.** Add a session-keyed derived lookup over the changeset aggregate — `dashForSession(sessionId)` / `useDashForSession(sessionId)` in a small `lib/dash-session-index.ts` — built from the dash entries' `bound_sessions`, memoized per snapshot. This is the [D138] move: derived on every read from the aggregate that already exists, no second store, no new feed. Every surface below reads this one selector, so binding and unbinding repaint everywhere at once — the same liveness custom names already have.

**The title grows a third run.** `sessionTitleParts` (or a sibling) yields an optional dash run, and both tiers wear it:

- **Line tier (masthead, Lens rows, picker):** `<name> : <project>/<callsign>` gains a quiet trailing ` ⎇ <dash>` run — the lucide `git-branch` glyph at text size plus the dash name, in the callsign's muted register, *inside* the title's elision box with its own priority (name survives, dash elides before the callsign does). The trailing badge slot in the masthead is deleted. The review tint moves onto this run's glyph (caution tone for `stale`, the dashed treatment for `never-reviewed`), same tooltip text as today.
- **Chip tier (the atom — transcript, Gazette, pastes):** the pill gains the same `⎇` glyph before the dot or after the run when `dashForSession` answers, with the dash name riding the tooltip and the citation string rather than the pill's ink — the atom is a citation and stays compact. When the atom's session unbinds (join or release lands, `bound_sessions` moves), the glyph evaporates on the next snapshot — exactly how custom-name updates already behave, so this is dynamic by construction.

This makes "this session is on a dash" legible at every register with one implementation, and it removes the only badge callsite that was fighting for space with pane chrome.

## 4. Proposal — the Lens: sub-rows, not a section

Agreed that the separate **Dashes** section was a mistake. It answers "what dashes exist" in a place whose organizing principle is *cards*, forcing the reader to join two lists by eye. The dash's home in the Lens should be under the session working it.

**Mechanics.** The Cards section's row model is a flat typed list (`cards-data-source.ts` — `group-header` / `pane` / `subcard` rows rendered by kind through `TugListView`). Add a `dash-subrow` kind: when `buildCardsRows` emits a session pane row, it consults the same `dashForSession` selector and, on a hit, emits one indented sub-row keyed on the dash's owner key:

```
[dot] session-name : project/callsign        <slots>
      description…
      pulse line…                            <tape>
   ⎇  markdown-attachments   built           [stale-mark]
```

- Leading glyph: lucide `git-branch`, at the sub-row's text size — the same glyph the retired section used as its band icon, now doing its work per-row.
- Content: dash name, stage word, `step i/N` when present, the review mark. No jump chips — the jump was the section's way of getting *to* the session, and the sub-row is already under it. Activating the sub-row fronts the card (same `focus-session-card` dispatch), and a later round can make it open the Changes shade at the dash entry instead, which is the more useful landing.
- The sub-row is not reorderable and not a drag handle; it travels with its session row.
- Multiple sessions bound to one dash render the sub-row under each — the sub-row states a fact about the session above it, and each of those facts is true.

**Parked dashes** (no bound session) have no session to nest under, and burying them in the Changes card alone is not acceptable — every dash must be findable in the Lens. **Decided: the standalone Dashes section stays as the one-stop roster, and the sub-rows are added on top.** A dash therefore appears twice in the Lens when it is being worked, and that is fine because the two appearances answer different questions: the sub-row answers *"what is this session doing"* in the session's own context; the section answers *"what dashes exist and which need attention"* account-globally. The Lens already tolerates this kind of doubling — it is itself a mirror of cards that also exist on the canvas.

With the sub-rows carrying the per-session context, the section can shed the parts that duplicated it: the session jump chips become redundant (the sub-row *is* at the session), so the section can quiet down toward name + stage + review + parked mark, with its collapsed summary ("3 dashes · 1 parked") as the at-a-glance count. The [P02] ordering and the section's registration survive unchanged.

## 5. The Z4A Join route — noted, needs its own pass

The Join segment in the prompt entry's Z4A route group (`tug-prompt-entry.tsx:205-211`, `joinAvailable` / `onSelectRoute`) and the join-message prompt read as unresolved. This is a real area, but it is a *mode* design question (what the composer says while a landing is staged, what Auto-Message does, how the four-outcome face hands back), not an identity-grammar question, and it deserves its own focused discussion rather than a paragraph here. Flagged as the follow-on after the identity work.

## 6. Entry points — deferred by agreement

Getting *into* dash workflows is still slash-command archaeology (`/dash-bind`, `/dash-join`, `/tugplug:dash-implement`). Per the notes: OK for now; circle back after the above lands. One observation to carry into that round: once dashes are legible in the title bars, atoms, and Lens sub-rows, the surfaces that *show* a dash become natural places to *start* one — the affordance problem gets easier after the visibility problem is solved.

## 7. Suggested order

1. **`TugBadge` elision fix** — component-level, benefits every badge, small and standalone.
2. **`dashForSession` selector** — the shared read everything else stands on.
3. **Identity grammar: the third run** — masthead badge deleted, line + chip tiers updated, review tint folded in.
4. **Lens sub-rows** — new row kind under bound sessions; the Dashes section stays as the roster and sheds its jump chips.
5. Then the Z4A/join-mode polish pass, then entry points.

Settled: the register of the `⎇` run is glyph+name on the line tier, glyph-only on the atom (dash name in tooltip and citation); parked dashes stay visible in the retained Dashes section.
