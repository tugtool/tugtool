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

Safari, running on the same machine at the same moment, is the control:

| UI process | total footprint | graphics dirty | graphics reclaimable |
|---|---|---|---|
| Safari | 137 MB | **3 MB** | 187 MB |
| Tug | 2,599 MB | **2,419 MB** | 149 MB |

Two differences, and the second one matters more than the first:

1. **Magnitude** — three orders of magnitude apart for two apps hosting a WKWebView.
2. **Purgeability** — Safari's surfaces are overwhelmingly *reclaimable* (marked volatile: the OS may take them back under pressure and the app re-renders). Tug's are **pinned non-purgeable**: 2,419MB dirty against 149MB reclaimable. Under real memory pressure the kernel cannot take a single page of ours. Region-level confirmation from `vmmap`: the large regions all carry `PURGE=N`; only 174 of ~1,180 regions carry `PURGE=V`.

If purgeability turns out to be a window/layer configuration we control, that alone changes the character of the number — from a pool the system cannot manage to one it can.

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

Added `AT9996_HOST_SURFACES=1` to `tests/app-test/at9996-anim-island-lab.test.ts` — the first cell in the corpus that reads the **app** process. It samples host `IOAccelerator (graphics)` dirty, host footprint, and WebContent graphics together across five deck states (`empty` / `one` heavy card / `all` heavy / all panes `hidden` / `revealed`), and reports in **window-equivalents** so a lab window compares against the user's 5K release instance. Host and WebContent pids are both identified by arrival, since neither is parented by the test runner.

### The lab result: a fresh app maps nothing {#lab-negative}

First run of the new cell, on a Debug `Tug-apptest` launch, window 1986×1257 at dpr 2 (one full-window layer = 38.1 MB), 60 turns per session card:

| phase | host graphics | host footprint | WebContent graphics |
|---|---|---|---|
| empty | **0 MB** | 25 MB | 184 MB |
| one heavy card | **0 MB** | 28 MB | 225 MB |
| all heavy | **0 MB** | 29 MB | 327 MB |
| panes hidden | **0 MB** | 29 MB | 119 MB |
| revealed | **0 MB** | 29 MB | 351 MB |

**A fresh app with three heavy transcripts maps zero UI-side surfaces.** Its whole footprint is 29MB. Meanwhile WebContent behaves exactly as the diet program characterized it — 184 → 327 MB with content, dropping to 119 when the panes are hidden and recovering on reveal, which also confirms the cell's causal A/B works.

So the 2.4GB is **not a structural cost of UI-side compositing**. If it were, the lab would show it. Something the live instance does — and a fresh one does not — mints and retains those surfaces.

### What the live instance's own clock says {#live-growth}

| live instance uptime | host graphics | host footprint |
|---|---|---|
| 11 minutes | 2,419 MB | 2,599 MB |
| 1 h 36 min | 2,508 MB | 2,700 MB |

It reaches ~2.4GB **within the first 11 minutes** and then creeps by ~90MB over the next 85. So this is not a slow accumulation over a working day: it is minted early and then held. `phys_footprint_peak` of 8.9GB was also set inside that first window.

Early minting plus permanent retention points at **restore** — the one thing the live instance does at launch that the lab does not, and the thing that already owns a known ~550MB of churn on the WebContent side ([aug01-perf-brief.md] §S9). It is not proof; it is the first place to look.

### Where G7-2 lands {#g7-2-verdict}

- The **churn** is characterized and demoted: episodic, activity-driven, host-CPU-bound, not a metronome, plausibly the normal cost of re-buffering a layer population. **Not the defect.**
- The **floor** is the defect, and it is now known to be **acquired, not structural** — the lab proves a fresh app of the same shape costs nothing.
- The question changes from *"why does compositing cost so much?"* to **"what does the live instance map at startup and never release?"**

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

**G7-4 — What does the live instance map at startup and never release?** The successor question G7-2 produced, and now the main line. Restore is the first suspect: it is what the live instance does that the lab does not, it lands inside the 11-minute window where the floor is minted, and it already owns known churn on the WebContent side. Next moves: bisect by launching a release-identity app against a **restore-free** deck and then a restored one, and read the same ledger; if restore is convicted, the question becomes which mapped surfaces survive it.

**G7-3 — Why are Tug's surfaces non-purgeable when Safari's are not?** If this is window or layer configuration we own, it is the cheapest structural fix available and it changes the floor's character without changing a byte of the deck.

## Discipline {#discipline}

Carried unchanged from the diet program:

- **The user's live release instance is the only success surface.** Lab cells gate diffs; they never declare victory.
- **Forced-purge numbers do not count.** `notifyutil -p org.WebKit.lowMemory` floors are not steady state.
- **Never disturb the live deck** to take a reading — no restarts, no resizes, no rearrangement, no `just app-release` — unless the user asks for it.
- **`osascript` activation loops are banned as methodology**, for any test, ever.
- Motion designs are FIXED; pixel identity is FIXED; no FOUC.
- Only the user commits.

## Status {#status}

- **2026-08-03** — brief opened from the live 2.54 GB read.
- **2026-08-03** — **G7-2 closed.** Architecture named (UI-side compositing; the app process holds the deck's layer tree, so the whole graphics program had been measuring the smaller share). Churn characterized and demoted — episodic, not idle, not metronomic, not the defect. Lab instrument built (`AT9996_HOST_SURFACES=1`) and it returns a decisive negative: **a fresh app with three heavy transcripts maps zero UI-side surfaces**. The floor is therefore acquired, not structural. G7-1 and G7-3 still stated and not started; **G7-4 opened** as the main line.
