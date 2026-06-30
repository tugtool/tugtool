# Golden base prep (macOS VM lab)

How to build and prep the factory-fresh golden base VMs the lab clones for
install/onboarding testing. One base per supported macOS line, named
`base-<key>` (the keys in [`matrix.json`](matrix.json)): `base-sequoia`,
`base-tahoe`, `base-goldengate`.

A golden base is prepped **once** and then never used to run Tug directly —
every test boots a throwaway clone (`just lab-cycle <key>`, see the lab recipes
in the `Justfile`). Keep the bases pristine.

## Prerequisites

- [Tart](https://tart.run) (`brew install cirruslabs/cli/tart`).
- The lab disk mounted at `/Volumes/Lab-A` (override with `LAB_ROOT`).
- `TART_HOME=/Volumes/Lab-A/tart` — set inline on raw `tart` commands; the
  `scripts/lab/*` wrappers default it from `LAB_ROOT`.
- For Golden Gate: the IPSW at
  `/Volumes/Lab-A/ipsw/UniversalMac_27.0_26A5368g_Restore.ipsw`.

## 1. Acquire the base image

### Sequoia / Tahoe — Cirrus prebuilt (preferred)

Cirrus publishes prebuilt bases that are already past Setup Assistant with an
`admin`/`admin` account — ideal for repeatable onboarding tests.

```sh
export TART_HOME=/Volumes/Lab-A/tart
# Sequoia:
tart pull ghcr.io/cirruslabs/macos-sequoia-base:latest
tart clone ghcr.io/cirruslabs/macos-sequoia-base:latest base-sequoia
# Tahoe:
tart pull ghcr.io/cirruslabs/macos-tahoe-base:latest
tart clone ghcr.io/cirruslabs/macos-tahoe-base:latest base-tahoe
```

### Golden Gate (macOS 27 beta) — from the local IPSW ([P04])

No Cirrus prebuilt exists for the 27 beta, so build from the downloaded IPSW:

```sh
export TART_HOME=/Volumes/Lab-A/tart
tart create --from-ipsw /Volumes/Lab-A/ipsw/UniversalMac_27.0_26A5368g_Restore.ipsw base-goldengate
```

This restores a **fresh** OS, so the first boot lands in Setup Assistant —
complete it manually (create the `admin`/`admin` account; skip Apple ID,
Screen Time, analytics, Siri).

> **[R01] risk:** Tart may not yet virtualize the macOS 27 beta. If
> `tart create --from-ipsw` (or the first boot) fails, record the blocker, set
> `goldengate` `golden_status` to `fail` in `matrix.json`, and keep Sequoia +
> Tahoe golden. Re-try when Tart catches up to the beta.

## 2. Factory-fresh prep (apply to every base, once)

Boot the base **directly** to prep it — this edits the base in place, so clones
inherit everything:

```sh
TART_HOME=/Volumes/Lab-A/tart tart run base-<key>
```

Inside the guest:

1. **Account:** confirm/create `admin` / `admin` (Cirrus prebuilts already have
   it; the IPSW build sets it in Setup Assistant).
2. **Gatekeeper off** (so the unsigned `lab-dmg` runs without a right-click →
   Open dance):
   ```sh
   sudo spctl --master-disable
   ```
   Verify System Settings → Privacy & Security shows "Anywhere". The signed
   golden pass ([#step-12]) is what certifies the real Gatekeeper path; the
   bases stay open for fast unsigned iteration.
3. **Display resolution — 2048×1660:** System Settings → Displays → select
   **2048 × 1660** (flip on "Show all resolutions" if needed). Clones inherit
   this because `lab-new` does not randomize the VM serial, so the per-display
   preference propagates.
   - **Do NOT use `tart set --display`.** Giving a clone a different virtual
     panel than the base breaks the saved-preference match, and macOS reverts
     to its default scaled mode at login (the "starts big, then pops back to
     small" symptom). Bake the resolution into the base instead.
4. **Share path — leave the default.** The host share mounts at
   `/Volumes/My Shared Files/drop/` (the guest sees the dmg at
   `/Volumes/My Shared Files/drop/Tug.dmg`). A `/Volumes/Shared` rename was
   attempted (a custom `tag=shared` virtiofs mount + a guest LaunchDaemon) and
   **abandoned** — `/Volumes/My Shared Files` is macOS's virtiofs *automount*
   path and isn't host-renamable. Don't re-attempt unless asked.
5. **Shut down cleanly** (Apple menu → Shut Down) so clones boot from a
   quiesced, factory-fresh state.

## 3. Verify the base boots as a clone

```sh
just lab-new <key> probe && just lab-run probe   # boots run-probe in a window
just lab-wipe probe                              # clean up
```

Or run the full inner loop, which also stages the dmg:

```sh
just lab-cycle <key>
```

`TART_HOME=/Volumes/Lab-A/tart tart list` should show `base-sequoia`,
`base-tahoe`, and `base-goldengate`.

## 4. Record results in matrix.json

After building each base, set its real `macos_version` (e.g. the exact Tahoe
point release). `min_version` and `golden_status` are seeded here and finalized
by the golden runs ([#step-11], [#step-12], resolving [Q01]); a passing signed
golden run flips `golden_status` to `pass`.
