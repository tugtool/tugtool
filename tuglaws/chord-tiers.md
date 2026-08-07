# Chord Tiers

*Chord assignment is an algebra, not a list. Two base tiers and two operators generate every modifier set Tug uses, so every chord's shape is explainable in one sentence — and a chord whose shape cannot be derived is a chord that was assigned by whoever got there first.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [tuglaws.md](tuglaws.md). Authoring contract: [commands.md](commands.md). Menu projection and the generated chord table: [menus.md](menus.md). Naming: [action-naming.md](action-naming.md).*

---

## Why an algebra

[L30] made every chord a registry fact, which fixed *where* chords live without saying anything about *which* chord a command should get. So the chords themselves accreted: a command took whatever was free near a mnemonic letter, and the modifier stack grew by one whenever plain ⌘ was already taken. The result read as a list of memorized facts, and a list is unexplainable by construction — a user cannot predict an unfamiliar chord, and an author cannot tell a good grant from a bad one.

The algebra replaces the list. Each modifier set has a meaning, meanings compose, and a proposed chord is checked by deriving it rather than by scanning for a collision. Collision-checking still happens (`lintChordCollisions`), but it answers a different question: the lint says the chord is *available*, the algebra says the chord is *right*.

The algebra was already half-latent in shipped bindings — ⌘V → ⌥⌘V → ⌥⇧⌘V, ⌘Z → ⇧⌘Z, ⌘W → ⌥⌘W — which is the argument for adopting it rather than inventing something. Writing it down moved nine chords ([D126]) and explained the rest.

---

## The two base tiers

**⌘ — the universal tier.** Verbs any Mac user already knows (Save, Find, Copy, Close, Quit) plus the highest-frequency Tug verbs (Focus Prompt ⌘K, Reveal Stack ⌘R). Digits are places: ⌘1–9 are slots, ⌘0 is actual size.

**⌃⌘ — the Tug tier.** Tug's own machinery: surfaces, shades, modes, themes, app-specific features. This is where Tug gets to be Tug without colliding with thirty years of ⌘ convention. ⌃⌘F Full Screen is the macOS-conventional resident that anchors the tier and proves ⌃⌘ letters reach the web view intact.

## The two operators

Each operator adds one modifier and keeps the key.

**⇧ — the counterpart.** Reverse, widen, or undo the base command: ⌘Z → ⇧⌘Z Redo, ⌘G → ⇧⌘G Find Previous, ⌘S → ⇧⌘S Save As, ⌃⌘A Claim All → ⌃⇧⌘A Disclaim All.

**⌥ — the variant.** Same verb, altered object or form: ⌘W Close → ⌥⌘W Close All, ⌘V Paste → ⌥⌘V Paste as Quote, ⌘N New Session → ⌥⌘N New Text File, ⌘H Hide → ⌥⌘H Hide Others.

## The composed sets

Composed sets are never assigned fresh — each one *means* its composition, and a chord that lands in one without a base to compose from is a chord in the wrong tier.

| Set | Reading |
|---|---|
| ⌥⇧⌘ | Both twists at once. "…as Plain Text" is always ⌥⇧⌘ (⌥⇧⌘C, ⌥⇧⌘V — the latter matching macOS "Paste and Match Style" exactly). First/Last Turn ⌥⇧⌘↑/↓ are the ⇧-extremes of Previous/Next Turn ⌥⌘↑/↓. |
| ⌃⇧⌘ | The counterpart of a Tug-tier command. Debut resident: Disclaim All ⌃⇧⌘A, the counterpart of Claim All ⌃⌘A. |
| ⌃⌥⌘ | The variant or advanced form of a Tug-tier command — the "super-advanced" tier. Debut resident: Cycle Permission Mode ⌃⌥⌘P, since permission modes govern agent autonomy, the quintessential expert feature. |

## The closed sets

**Plain ⌥ letters are closed forever.** They type glyphs — ⌥e is é, ⌥n is ñ — and a binding there breaks text entry for anyone who uses the option layer as designed.

**Plain ⌃ letters are closed forever.** They belong to the text caret: the emacs set, of which ⌃U and ⌃W are declared substrate currency in `ACTIONS_OUTSIDE_THE_TABLE` ([commands.md](commands.md), "What is not a command").

One non-printing exception is grandfathered, and grandfathered is the whole justification — it would not be granted today: **⌥⇥** Cycle Focus Mode. (⌃` Cycle Panes was the other, until the Window-menu rework ([D129]) retired the command and returned the chord to the closed set.)

---

## The rules

**R1 — The pairing rule.** A ⇧- or ⌥-composed chord must share its key with the base command it twists. If a proposed chord has no base to vary, it is either a plain-⌘ candidate or a ⌃⌘ Tug-tier command. The modifier stack is never climbed merely because plain ⌘ was taken; that is exactly the accretion the algebra exists to stop.

**R2 — The arrows exemption.** Arrow chords are exempt from R1. ⌘↑/↓ is text and history currency in the composer, so the ⌥⌘↑/↓ turn-navigation family has no ⌘ base to pair with. ⇧ still means "to the extreme" on arrows, which is how ⌥⇧⌘↑/↓ reads as First/Last Turn.

**R3 — The scarcity rule.** Plain ⌘'s remaining free slots go only to commands a user hits many times an hour. Everything else enters through its semantic tier. A plain-⌘ grant spends a finite resource, so the frequency claim is part of the grant, not an afterthought.

**R4 — Closed sets stay closed.** Plain ⌥ letters and plain ⌃ letters are not a pool. A command that "really wants" one wants a different chord.

**R5 — ⌘. parity.** Wherever ⎋ *dismisses a surface or backs out of a mode* — alerts, sheets, popovers, placards, context menus, overlays, lightboxes, completion popups — ⌘. does the same thing. This is a law of the app, not a per-component choice, and it is satisfied by the shared registry-backed matcher `isCancelChordEvent` (`keymap-registry.ts`), never by a hand-authored `metaKey && key === "."` test. The line has one exclusion: ⎋ that *reverts an in-field edit* (the filter field, the value input, the slider's in-flight scrub) stays Escape-only. That ⎋ is form-control currency inside a typing surface — it edits the value rather than leaving the surface — and ⌘. there would be both surprising and outside macOS convention.

**R6 — Menu placement is a chord decision.** A menu-eligible chord resolves at the native menu layer before any scoped binding ([commands.md](commands.md), four-layer resolution), so a chord grant records both its tier justification *and* its `menuEligible`/`scope` choice. One decision, not two: choosing the menu is choosing to preempt every scoped binding regardless of focus.

---

## The free pool

Plain ⌘, for future grants under R3.

| Slot | Standing |
|---|---|
| ⌘D, ⌘Y | Safest — weak conventions elsewhere. |
| ⌘E | Claimable with honest use: Find-adjacent. |
| ⌘B, ⌘U | Hold in reserve — bold/underline, and Tug renders markdown. |
| ⌘P | Hold in reserve — the print reflex is strong. The only accepted repurposing is a command palette. |
| ⌘' ⌘; ⌘\ | Free punctuation. |
| ⌘[ ⌘] | Reserved for any future back/forward navigation concept. |

Digits are fully spent: ⌘1–9 are slots, ⌘0 is actual size.

**Freed by [D126]** and returned to the pool: ⇧⌘P, ⇧⌘C, ⇧⌘H, ⇧⌘M, ⌥⌘T, ⌘I.

---

## macOS reserved — never bind

⌘Space, ⌘⇥, ⌘` · ⌃↑ ⌃↓ ⌃← ⌃→, ⌃Space · ⌃⌘Q (lock screen), ⌃⌘D (dictionary), ⌃⌘Space (emoji) · ⇧⌘3 ⇧⌘4 ⇧⌘5 (screenshots), ⇧⌘Q (log out), ⇧⌘/ (Help search) · ⌥⌘⎋ (force quit).

---

## Worked example: the nine moves of [D126]

The algebra's first application. Each row's rationale is a derivation, not a preference.

| Command | Was | Is | Derivation |
|---|---|---|---|
| `select-composer-route:prompt` | ⇧⌘P | **⌃⌘P** | Route selection is Tug machinery — Tug tier. ⇧ was carrying nothing; there is no ⌘P base for Prompt to be the counterpart of. |
| `cycle-permission-mode` | ⌃⌘P | **⌃⌥⌘P** | The advanced form of a Tug-tier command, and the tier's debut resident. Vacating ⌃⌘P is what lets Prompt Route land on its own tier. |
| `toggle-changes-view` | ⇧⌘C | **⌃⌘C** | A shade toggle is Tug machinery. |
| `toggle-history-view` | ⇧⌘H | **⌃⌘H** | The twin of Changes; it moves with it. |
| `commit-auto-message` | ⇧⌘M | **⌃⌘M** | Joins the Changes cluster on one tier: ⌃⌘C the shade, ⌃⌘M the message, ⌃⌘A the claim. Stays composer-scoped. |
| `claim-all-changes` | — | **⌃⌘A** | New. One mnemonic neighborhood with ⌃⌘C and ⌃⌘M. |
| `disclaim-all-changes` | — | **⌃⇧⌘A** | New. R1: the ⇧-counterpart of ⌃⌘A, sharing its key, one finger from its pair. |
| `next-theme` | ⌥⌘T | **⌃⌘T** | Themes are Tug machinery. ⌥ was carrying nothing — there is no ⌘T base of which Next Theme is a variant. |
| `insert-file` | ⌘I | **⌃⌘I** | Inserting a file reference into the composer is Tug machinery, not a many-times-an-hour universal verb (R3), and the move frees ⌘I from its italic baggage. |

**⌃⌘A and ⌃⇧⌘A are not an inverse on one set.** ⌃⌘A acts on what is *not yet* this session's — the unattributed and orphaned buckets together — and ⌃⇧⌘A on what *is*. ⇧-as-counterpart is carrying "the opposite bulk verb of this shade", not "the same set, reversed". R1 promises a shared key and an opposite sense; it does not promise set inversion, and this pair is the reason to say so out loud.

**Ratified unchanged:** ⌥⌘/ Show DevTools against ⌘/ Command Picker; the ⌥⌘↑/↓ + ⌥⇧⌘↑/↓ turn family (R2).

---

## The sidebar-toggle grammar

⌃⌘⟨letter⟩ names a sidebar card, and toggling one shows or hides its rail. Two residents:

| Command | Was | Is | Derivation |
|---|---|---|---|
| `toggle-lens` | ⌥⌘L | **⌃⌘L** | A rail toggle is Tug machinery — Tug tier. ⌥ was carrying nothing: ⌘L is Focus Lens, and showing a rail is not a *variant* of moving focus into it, so R1 gave the composed chord no base to twist. |
| `toggle-jots` | — | **⌃⌘J** | New, by the grammar above: the sidebar's letter on the Tug tier. |
| `new-jot` | — | **⌘J** | Plain-⌘ under R3: capture is reached mid-thought, many times a day, and a jot you must open a card to write is a jot you don't write. Claims ⌘J out of the free pool — an honest use, though not the jump/go-to one the pool's annotation anticipated. |

The grammar is the point. One toggle would not have justified moving Show Lens; a *pair* makes each chord teach the other, and it leaves room for a third sidebar card to arrive already knowing its chord. All three are `menuEligible` with **empty** Swift key equivalents, so `applyCommandChords` writes them and every one stays rebindable — see the shade-toggle anomaly below for what the alternative costs.

---

## Known anomalies

Recorded so a reader takes them as debt rather than as precedent.

*(Resolved: Cascade ⌃⌥C and Tile ⌃⌥T once sat here — ⌃⌥ with no ⌘, a set the algebra does not generate, invisible to the keymap pane. The menu-by-menu audit resolved the anomaly by deletion: both commands were removed with the Window-menu rework ([D129]), the Layouts system being how Tug arranges the deck.)*

**⌥⌘/ Show DevTools is a wink, not a derivation.** ⌘/ opens the command picker and ⌥⌘/ opens DevTools; DevTools is not a "variant" of the picker in any sense R1 recognizes. It is ratified because the pairing reads as a joke a developer gets, and because the Maker menu is debug-only.

**⌘T is a plain-⌘ grant that only exists in debug builds** (`maker.newCardInPane`, New Card in Active Pane). It would not survive R3 in a release menu; it survives because the Maker menu is not in one.

**The shade toggles' menu claim cannot be detached.** `toggle-changes-view` and `toggle-history-view` each carry a registry binding that is *not* `menuEligible` **and** a Swift construction literal on their menu item. So `menuChords()` never claims `session.toggleChanges` / `session.toggleHistory`, and therefore never publishes the `null` that would detach the construction literal. A user who rebinds either command leaves the old chord standing on the menu item, where AppKit keeps eating it before the web view sees a keydown — the rebind appears to do nothing. This is pre-existing and not introduced by [D126], but it is the one place where "every chord is the user's to move" is not yet true end to end, so it is named here rather than left for a reader to infer.

---

## Cross-References

- [L30] — every user-invocable command is a registry entry; every emitter goes through the two funnels
- [D126] — the adoption of this algebra and the nine moves it drove
- [commands.md](commands.md) — the authoring contract: the entry shape, "Adding a command", the four-layer chord resolution order, the lints
- [menus.md](menus.md) — the menuState wire contract and the generated chord table
- `tugdeck/src/components/tugways/command-registry.ts` — the table and `lintChordCollisions`
- `tugdeck/src/components/tugways/keymap-registry.ts` — `resolveChord`, `commandShortcut`, `isCancelChordEvent`
- `tugdeck/src/components/tugways/chord-format.ts` — chord identity (`chordMatchesEvent`), display (`formatChord`), and the Swift key-equivalent conversion
