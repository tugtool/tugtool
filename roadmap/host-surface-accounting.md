# Host-side surface accounting — the 2.4GB nobody was measuring {#host-surface-accounting}

A working brief for the investigation that opens where `scrolling-memory-diet.md` closed. That program brought the *web engine's* graphics floor down and stopped there, because every instrument it built — the at9996 tile ledger, the probe-A hide/reveal A/B, the purge-pair recovery read — pointed at the **WebContent** process. This brief is about the other process. Tug's Swift host holds more graphics memory than everything that program measured, combined, and no meter has ever been aimed at it.

Like the diet brief, this is a brief and not a devise plan: the work is diagnostic, it proceeds against the user's live release instance, and the shape of the fix is unknown until the cause is named.

## The reading that opened it (2026-08-03) {#opening-read}

Activity Monitor showed `Tug` at **2.54 GB** — the largest process on a 128GB machine, above WindowServer. That number is the **host** process (the Swift app), not the deck.

`footprint` on the host, by category:

| Category | Dirty |
|---|---|
| **IOAccelerator (graphics)** | **2,419 MB** |
| all malloc zones combined | ~145 MB |
| everything else | ~35 MB |

**95% of the process is GPU surface memory.** The app's own data — every Swift object, every ledger cache, every bridge buffer — is ~145MB and is not the story.

The processes the diet program did move, measured in the same instant:

| Process | Footprint | Note |
|---|---|---|
| WebContent (the deck) | **727 MB** | graphics 410MB; well under the ~1.27GB purge threshold |
| WebKit GPU process | 334 MB | |
| **Tug host** | **2,599 MB** | 2,419MB of it graphics |

So the diet worked where it was aimed, and the aim was incomplete. WebContent's headroom against the purge threshold is real and is the standing explanation for the typing lag staying away; this brief does not disturb that finding, it opens a second front.

## Why this is anomalous, not a cost of doing business {#anomaly}

Safari, running on the same machine at the same moment, is the control. The whole `IOAccelerator (graphics)` row, whose columns are `VIRTUAL RESIDENT DIRTY SWAPPED VOLATILE NONVOL EMPTY COUNT`:

| UI process | virtual | resident | dirty | volatile | regions |
|---|---|---|---|---|---|
| Safari | 192.3 MB | 3.2 MB | 3.2 MB | **0 K** | 69 |
| Tug | 2.5 GB | 2.4 GB | 2.4 GB | **0 K** | 1,183 |

The difference is **residency and region count**, and it is not purgeability. Safari maps 192MB of graphics address space and keeps 2% of it resident; Tug maps 2.5GB and keeps ~96%.

Grouping each process's graphics regions by purge state settles the point:

| | `PURGE=V` regions | resident in V | `PURGE=N` regions | resident in N |
|---|---|---|---|---|
| Safari | 52 | **0 MB** | 17 | **3.2 MB** |
| Tug | 176 | **0 MB** | 984 | **2,423.5 MB** |

Both apps keep exactly zero resident bytes in volatile regions and hold everything they have in nonvolatile ones. The purge *structure* is identical; Tug simply has 58× more nonvolatile regions and they are far larger. There is no purgeability policy difference to exploit.

> **A misreading worth recording.** The first pass read only the row's `DIRTY` column and reported Safari as having "187MB reclaimable" — that figure was `VIRTUAL − DIRTY`, i.e. mapped-but-not-resident address space, not purgeable memory. Reading one column of an eight-column row invented a difference that does not exist, and it pointed a whole question (G7-3) at a mechanism neither app uses. Any process read from `vmmap --summary` should capture the whole row.

## Region census {#region-census}

`vmmap 67000`, `IOAccelerator (graphics)` regions grouped by size:

| count | size | subtotal |
|---|---|---|
| 108 | 11.9 MB | ~1,285 MB |
| 1 | 185.5 MB | 186 MB |
| 216 | 768 KB | 162 MB |
| 72 | 5,120 KB | 360 MB |
| 18 | 8,192 KB | 144 MB |
| 9 | 9,728 KB | 87 MB |
| 72 | 1,280 KB | 90 MB |
| 144 | 320 KB | 45 MB |
| 24 | 2,048 KB | 48 MB |
| 227 | 32 KB | 7 MB |
| 144 | 80 KB | 11 MB |

The display is 5120×2880 Retina. Two arithmetic notes to carry forward, both unconfirmed and both falsifiable:

- **11.9 MB = 12,451,840 B = 3,112,960 px at 4 B/px.** That factors as 2048×1520 — a plausible tile or layer backing size. 108 of them is the single biggest line in the process.
- **185.5 MB** ≈ three full-screen 5K buffers (5120×2880×4 B = 59 MB each), consistent with a triple-buffered full-screen window surface.

### The census has a signature: 36 identical units {#thirty-six-units}

Restricting the census to the `PURGE=N` regions — the 984 that hold the entire 2.4 GB — nearly every count is a multiple of **36**:

| per unit | × 36 | subtotal |
|---|---|---|
| 3 × 11.9 MB | 108 | 1,285 MB |
| 6 × 768 KB | 216 | 162 MB |
| 2 × 5,120 KB | 72 | 360 MB |
| 2 × 1,280 KB | 72 | 90 MB |
| 4 × 320 KB | 144 | 45 MB |
| 4 × 80 KB | 144 | 11 MB |

That is **36 copies of one ~54 MB structure** (~1.95 GB), plus the 185.5 MB singleton and a tail of stragglers — the whole 2.4 GB. The floor is not diffuse and it is not the sum of many unrelated things. Naming what there are 36 of names the defect.

Two properties of the repeating unit are worth carrying forward: the largest class is **triple-buffered** (3 × 11.9 MB), and the 5,120 / 1,280 / 320 / 80 KB classes fall in an exact **factor-of-four chain**, which is the shape a downsample or mip chain takes.

## The idle churn {#idle-churn}

The number is not a static floor and not a monotone leak. Sampling `footprint` and the region count every ~10s, on a deck nobody was touching:

```
09:52:34  2599 MB   regions=1090      ← floor
09:52:46  3270 MB   regions=1253
09:52:57  2599 MB   regions=1090
09:53:08  3497 MB   regions=1365      ← +898 MB over floor
09:53:20  2600 MB   regions=1170
09:53:31  2781 MB   regions=1185
09:53:42  2600 MB   regions=1181
09:53:53  3299 MB   regions=1369
```

**A hard floor at ~2,600 MB, plus ~700–900 MB of surfaces allocated and released on a cycle of seconds, while idle.** Region count swings by ~280 across the same cycle. `phys_footprint_peak` reached **8.9 GB** within 11 minutes of launch.

Two separate problems live in that trace and they should not be conflated:

- **The floor (~2.6 GB)** — resting cost. Sized by the region census above.
- **The churn (~0.9 GB, cyclic)** — live work on an idle deck. This is the more diagnosable of the two and the more likely to be an outright defect rather than an accounting artifact, which is why it is taken first.

## G7-2, first pass: the architecture, and a partial refutation {#g7-2-first-pass}

### The host holds the deck's layer tree {#uiside-compositing}

`sample` on the host process during a burst names the machinery outright:

```
WebKit::RemoteLayerTreeDrawingAreaProxy::commitLayerTree(…, BufferSetBackendHandle …)
  WebKit::RemoteLayerTreeHost::updateLayerTree(…)
    WebKit::RemoteLayerTreePropertyApplier::applyProperties(…, LayerContentsType)
      CA::Layer::set_sublayers(…)
```

macOS WebKit uses **UI-side compositing**: WebContent produces a layer tree, and the **app process** hosts the actual `CALayer`s and maps every layer's buffer set. So the deck's composited backing is charged to the host, not to WebContent.

**This reframes the entire graphics program.** G1, G2, G4 and G6 all measured `owned unmapped memory` in WebContent — a real number, but the smaller share. The larger share was always in the app process and was never on any meter. G1's measured −110–125MB for two buried panes stands (it was a causal same-instance A/B), but the *denominator* it was measured against was wrong.

### The churn is episodic, not a metronome {#churn-refuted}

The "idle churn" framing in [#idle-churn](#idle-churn) is **half wrong** and the correction matters.

Sampling the host at 1 Hz alongside a temporary `MutationObserver` installed on the live deck:

- Bursts are **+550–800MB for 2–3 seconds**, then a two-step decay back to a floor that is stable to the megabyte (2601–2603 MB every time).
- During a burst, **host CPU jumps from ~2% to 15–20% while the GPU process stays flat** at 3–5%. The work is layer-tree work in the app process.
- **Not metronomic.** Onsets over three windows: ~10s apart for a minute, then a 73s gap; later 20/19/7/12/15s. One window of 90s contained a single small burst. This rules out the ~30s WebContent purge clock as the driver — a real relief, since it would have re-opened S9.
- **Not driven by the visible DOM churn.** Through one 90s window the deck mutated at a flat 6 mutations/s, all `characterData` — an elapsed-time counter ticking. Bursts did not track it.
- The bursts ride **episodic deck activity** (turns arriving, cards updating). During this investigation the deck was never idle: it was rendering the very session doing the measuring. Calling it an "idle burn" was a mis-framing on my part.

What a burst most likely *is*, mechanically: a population of layers gets new backing while the old backing is still mapped, so the host transiently holds both — a partial double of the resting set, released a beat later. That is a plausible cost of doing business, not obviously a defect.

### So the floor is the target, and the floor is extraordinary {#floor-is-the-target}

With the churn demoted, what is left is the number that never moves:

- **2,601 MB resting**, repeatable to ±2MB across every window sampled.
- Deck at the time of the read: **4 panes, 5,801 DOM nodes, 3 scrollers**, viewport 2879×1599 CSS at dpr 2 (**5758×3198 device px**).
- One full-window layer at 4 B/px is **70.2 MB**. The floor is therefore **≈ 37 full-window layers** — for a deck holding 5,800 nodes.

The 5,801-node figure is itself worth recording: it is the transcript DOM eviction work landing. Node count is no longer the problem. Layer backing is.

Region geometry does not resolve from outside the process — the sizes cluster on allocator classes (exact 1/2/4/5/8 MB steps) rather than pixel-exact surface sizes, so no layer geometry can be read off them. Naming what those 37 window-equivalents *are* requires a controlled deck, which is why the next step is an instrument rather than more sampling.

### The instrument that was missing {#host-ledger-cell}

Added `AT9996_HOST_SURFACES=1` to `tests/app-test/at9996-anim-island-lab.test.ts` — the first cell in the corpus that reads the **app** process. It samples the host's whole `IOAccelerator (graphics)` row (virtual / resident / dirty / volatile / region count), host footprint, and WebContent graphics together across five deck states (`empty` / `one` heavy card / `all` heavy / all panes `hidden` / `revealed`), and reports in **window-equivalents** so a lab window compares against the user's 5K release instance. The host pid comes from the app over RPC (`App.hostPid`); WebContent is identified by arrival, since it is launchd-parented.

Its verdict on itself is that it cannot see this phenomenon — see [#lab-negative](#lab-negative). It remains the right instrument for the WebContent side, and the whole-row capture is what proved the host side was out of range.

### The lab result: the app-test lab is a null instrument {#lab-negative}

Re-run of the cell with the full-row instrument, on a Debug `Tug-apptest` launch, window 1986×1257 at dpr 2 (one full-window layer = 38.1 MB), 150 turns per session card:

| phase | host virtual | host resident | host dirty | host regions | host footprint | WebContent graphics |
|---|---|---|---|---|---|---|
| empty | 1 MB | 0 MB | 0 MB | **3** | 25 MB | 172 MB |
| one heavy card | 1 MB | 0 MB | 0 MB | **3** | 29 MB | 196 MB |
| all heavy | 1 MB | 0 MB | 0 MB | **3** | 30 MB | 329 MB |
| panes hidden | 1 MB | 0 MB | 0 MB | **3** | 30 MB | 138 MB |
| revealed | 1 MB | 0 MB | 0 MB | **3** | 30 MB | 354 MB |

WebContent behaves exactly as the diet program characterized it — 172 → 329 MB with content, dropping to 138 when the panes are hidden and recovering on reveal — so the cell's causal A/B genuinely works. But the host reads **3 regions and 1 MB of address space in every phase**, and never moves.

**That is not a fresh app declining to accumulate surfaces. It is an app whose host never hosts a layer tree at all.** Three points of comparison make the state unambiguous: live Tug maps 1,183 regions, Safari maps 69, the lab maps 3. The lab is not a low reading on the same scale — it is off the instrument.

So the app-test lab **cannot reproduce this phenomenon** and cannot be used to bisect it. Any A/B run there would read zero in both arms and conclude whatever the experimenter hoped. What differs is not deck content: the harness launches a Debug bundle with restore and persistence disabled in test mode, and the divergence is somewhere in that set, not in what the deck holds.

The first pass read this table as "a fresh app with three heavy transcripts maps zero UI-side surfaces" and concluded the 2.4 GB was **acquired, not structural**. That conclusion was drawn from an instrument reading zero because it was disconnected, and it is withdrawn.

### What the live instance's own clock says {#live-growth}

| live instance uptime | host graphics | host footprint |
|---|---|---|
| 11 minutes | 2,419 MB | 2,599 MB |
| 1 h 36 min | 2,508 MB | 2,700 MB |

It reaches ~2.4GB **within the first 11 minutes** and then creeps by ~90MB over the next 85. So this is not a slow accumulation over a working day: it is minted early and then held. `phys_footprint_peak` of 8.9GB was also set inside that first window.

### The restart reading: full size in three minutes {#restart-reading}

A user-initiated restart supplied a clean `t=0` that no probe could buy — a genuinely fresh live release instance, observed without disturbing anything:

| | uptime | host graphics | regions | footprint | peak |
|---|---|---|---|---|---|
| prior instance | 3 h 20 min | 2.4 GB | 1,183 | 2.5 GB | 8.7 GB |
| **restarted instance** | **3 min 25 s** | **2.4 GB** | **1,186** | **2.5 GB** | **8.7 GB** |

Full size, full region count, and the same 8.7 GB peak — **inside three and a half minutes.** And the [36-unit signature](#thirty-six-units) reproduces exactly: 216 × 768 KB, 144 × 320 KB, 144 × 80 KB, 108 × 11.9 MB, 72 × 5,120 KB, 72 × 1,280 KB, identical counts on both instances.

That kills the accumulation framing outright. A structure whose region counts are *identical* between a three-minute-old process and a three-hour-old one is not something that builds up — it is allocated once, at a fixed size, near launch. The ~90 MB of creep over 85 minutes is a rounding error on top of a constant.

This also demotes restore as the suspect. Restore was hypothesized because the floor appeared "early", but "early" has now resolved to "immediately and at full size", and the deck's own content varies between these two observations while the counts do not.

### Where G7-2 lands {#g7-2-verdict}

- The **churn** is characterized and demoted: episodic, activity-driven, host-CPU-bound, not a metronome, plausibly the normal cost of re-buffering a layer population. **Not the defect.**
- The **floor** is the defect. It is **fixed and allocated at startup** — 36 identical ~54 MB units, at full count within three minutes of launch, unchanged after three hours.
- The question changes from *"why does compositing cost so much?"* to **"what are there 36 of?"**

### Instrument gotchas paid for in this pass {#g7-2-gotchas}

Recorded because each cost a full run:

- **`pgrep` cannot see Tug's GUI process at all** — not `-f` against its argv (which `ps` prints in full), not `-x Tug` against its name. Worse, `pgrep -f Tug.app` *does* return the tugcast/tugcode helpers that carry the bundle path in their arguments, so the naive pattern returns a confident wrong answer. The app reports its own pid over RPC (`getHostPid`); `App.hostPid` is now public and is the only sound way to address it.
- **`vmmap` takes a corpse of its target, which suspends it.** Sampling the app on a 5s cadence while the harness waited on it starved `awaitEngineReady` past its fixed 20s deadline. Reading WebContent never had this problem because WebContent is not on the harness's critical path.
- **`isEngineReady` answers by walking the deck-trace ring**, so a cell that has not called `enableDeckTrace(true)` can only ever time out waiting for readiness.
- **The app-test build is a different bundle** (`Tug-apptest.app/Contents/MacOS/Tug-apptest`), so any match anchored on the release product name finds nothing.
- **A magnitude assertion encoded a wrong assumption.** A gate of "the GUI app is never a few tens of MB" failed against the truth — a fresh app really is ~25MB with no surfaces. The cell now records magnitude and asserts only that a reading exists.

## Standing caveat: shared pages {#shared-pages-caveat}

Every large region reads `SM=SHM` — shared memory. IOSurfaces are shared by construction between the app, the GPU process, and WindowServer, and `phys_footprint` charges a process for shared-owned pages. WindowServer is itself at 1.86 GB on this machine. **Some fraction of Tug's 2.4 GB may be the same physical pages WindowServer is also counting.** Until that is settled, 2.4 GB is an upper bound on unique RAM, not a measured prize. No fix should be sized against it, and no victory should be declared from it.

## System impact today {#system-impact}

None observed. 128 GB installed, **zero swap in use**, no memory-pressure events, and this pool is *not* the named typing-lag mechanism — that one is WebContent crossing ~1.27 GB, and WebContent is at 727 MB. This work is therefore not urgent-by-symptom. It is worth doing because a 2.4 GB non-purgeable pool that churns while idle is either a defect or a thing we do not understand, and both are worth closing on a tool meant to sit open all day on machines smaller than this one.

## The questions, in order {#questions}

**G7-1 — Are those pages unique, or double-counted with WindowServer?** Settles whether the prize is 2.4 GB or a fraction of it. Everything downstream is sized by this answer.

**G7-2 — What is the ~900 MB churn?** *(answered — see [#g7-2-verdict](#g7-2-verdict). Episodic and activity-driven, not idle and not a metronome; demoted. The floor is the defect, and it is acquired rather than structural.)*

**G7-4 — What are there 36 of?** The main line, and now a much sharper question than the one it replaced. The floor is 36 copies of a fixed ~54 MB structure, allocated near launch and never released, identical across instances and independent of session age. It is not restore, not accumulation, and not deck content. The unit's own shape is the best evidence available: the largest class is triple-buffered and the smaller classes descend in an exact factor-of-four chain.

Next moves, in order:

1. **Count layers, not bytes.** Enumerate the host's `CALayer` tree at rest (36 backing stores implies ~36 layers with backing, or 12 triple-buffered ones) and compare that count against the deck's composited-layer count on the WebContent side. The two numbers either match — making this a straightforward per-layer cost — or they don't, which makes it a retention bug.
2. **Vary one thing and re-read the count.** Window size, display, and pane count are each a one-variable change on a probe instance; the region *count* (not the byte total) is the sensitive readout.
3. **Do not use the app-test lab.** It is [off the instrument](#lab-negative) for this measurement, and any A/B there will read zero in both arms.

**G7-3 — Why are Tug's surfaces non-purgeable when Safari's are not?** *(refuted — see [#anomaly](#anomaly). The premise was a column-reading error: both apps hold zero resident bytes in volatile regions and everything in nonvolatile ones. The purge structure is identical and there is no cheap purgeability fix. Folded into G7-4.)*

## Discipline {#discipline}

Carried unchanged from the diet program:

- **The user's live release instance is the only success surface.** Lab cells gate diffs; they never declare victory.
- **Forced-purge numbers do not count.** `notifyutil -p org.WebKit.lowMemory` floors are not steady state.
- **Never disturb the live deck** to take a reading — no restarts, no resizes, no rearrangement, no `just app-release` — unless the user asks for it.
- **Never launch a second release-identity `Tug.app`.** `open -n` against the release bundle does *not* give you an isolated probe instance beside the running one — it **terminates the user's live instance**, which is exactly what happened on 2026-08-03. A fresh `TUG_INSTANCE_ID` isolates the data directory, not the app identity. A probe instance that must not disturb the live one belongs on a **dash worktree with its own build**, and the reading it produces is only trustworthy if no takeover occurred.
- **`osascript` activation loops are banned as methodology**, for any test, ever.
- Motion designs are FIXED; pixel identity is FIXED; no FOUC.
- Only the user commits.

## Status {#status}

- **2026-08-03** — brief opened from the live 2.54 GB read.
- **2026-08-03** — **G7-2 closed.** Architecture named (UI-side compositing; the app process holds the deck's layer tree, so the whole graphics program had been measuring the smaller share). Churn characterized and demoted — episodic, not idle, not metronomic, not the defect. Lab instrument built (`AT9996_HOST_SURFACES=1`). G7-1 and G7-3 still stated and not started; **G7-4 opened** as the main line.
- **2026-08-03, second pass** — **two conclusions from the first pass withdrawn, and the floor characterized.**
  - **G7-3 refuted.** The purgeability difference was a column-reading error; both apps have identical purge structure. Folded into G7-4.
  - **The lab negative withdrawn.** With the instrument capturing the whole `vmmap` row, the app-test lab reads **3 regions / 1 MB in every phase** — it never hosts a layer tree at all, so it is off the instrument rather than a control. "Acquired, not structural" was concluded from a disconnected meter.
  - **The floor is a fixed startup allocation.** A user-initiated restart gave a clean `t=0`: **2.4 GB across 1,186 regions at 3 min 25 s**, matching a 3 h 20 min instance region-for-region, with the same 8.7 GB peak. Region counts identical across both instances rules out accumulation and demotes restore.
  - **The floor has a signature: 36 identical ~54 MB units** (108 × 11.9 MB triple-buffered, plus a factor-of-four chain at 5,120 / 1,280 / 320 / 80 KB). G7-4 sharpens to **"what are there 36 of?"**
  - **Discipline paid for in cash:** `open -n` on the release bundle terminated the user's live instance. Recorded in [#discipline](#discipline).
