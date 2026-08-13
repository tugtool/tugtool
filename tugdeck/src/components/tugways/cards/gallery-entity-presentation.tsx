/**
 * gallery-entity-presentation.tsx — the reference-presentation design surface.
 *
 * **TEMPORARY.** This card exists to answer one question before any of it
 * ships: *what does `roadmap/entity-presentation.md` actually look like?* It
 * paints the same real content twice — as the app renders it **today**, and
 * as [P01]–[P08] would render it — so the two can be compared with the eye
 * rather than argued about in prose. When the brief lands (or is rejected),
 * this card and its CSS die with it.
 *
 * **What is real here.** Almost all of it, deliberately. Every frame mounts
 * the shipping {@link TugMarkdownBlock} in static mode, inside a real
 * {@link AnnotationScope} whose resolvers are the app's own —
 * `pathResolutionStore`, `fileNameResolverFor`, `commitResolverFor` — pointed
 * at a real project directory with a real browse workspace hold. So a path in
 * the sample prose is marked because it **stats**, and a sha because git can
 * show it; nothing below is a drawing of a resolved reference. Point the card
 * at a directory that is not this repo and most of the marks correctly
 * vanish, which is itself the demonstration that the gate is real.
 *
 * The exceptions are named where they appear, and all of them are
 * hand-stamped for the same reason — they must read identically in every
 * theme with no project bound, which a resolver-gated run cannot promise:
 * the standalone Mention drawings, the two-channel matrix, the stress
 * paragraph in the calibration section, and the commit atom W5 has not yet
 * widened `ToolFileRef` to produce.
 *
 * **The two-channel section answers the question the bench provoked.** Why
 * does `annotate-content.ts` read green while `registry.ts` does not, when
 * both are actionable? Because the code tone is markdown's own emphasis —
 * the author's backticks, exactly as `*` drives italic — and the rule is the
 * resolver's verdict. Independent channels. The four cells are the proof,
 * and [P04] in the brief is the decision that keeps them independent.
 *
 * **How the two columns differ.** Only in the two things the brief changes:
 *
 *  1. The **annotation context**. The `today` column mirrors the Session
 *     card's — `proseCitesPaths` unset, so a bare filename in a sentence is
 *     licensed only by {@link isUnambiguousInProse}. The `proposed` column
 *     sets it, which is [P03]. The Gazette pair is the control: it already
 *     ships with the flag on, so its two columns differ *only* by the resting
 *     underline — the Gazette proved the detection half already.
 *  2. The **scope class**. `.gep-proposed` adds [P05]'s resting underline.
 *     Nothing else on the page is scoped, so anything that looks different
 *     between the columns is one of those two changes and not a third.
 *
 * **The tint is dead; do not re-propose it.** An earlier round of this card
 * proposed a resting COLOUR step instead. It failed on contact — colour is
 * not an affordance, a hue shift says "different category of thing" (which
 * the code tone already says), and the reader was left inferring *clickable*
 * from two levels of one channel. The reasoning is kept in the CSS beside
 * the rule that replaced it.
 *
 * Laws: [L02] workspace readiness and every resolver verdict enter through
 *       one `useSyncExternalStore`, exactly as `useGazetteRefRoots` does it.
 *       [L03] the workspace hold is requested in a layout effect, before the
 *       lookups that wait on it. [L06] the whole today/proposed difference is
 *       a class and a context value; no React state paints anything.
 *
 * @module components/tugways/cards/gallery-entity-presentation
 */

import "./gallery-entity-presentation.css";

import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { GitCommit } from "lucide-react";

import { AnnotationScope } from "@/components/tugways/annotation-scope";
import { ToolFileRef } from "@/components/tugways/blocks/tool-file-ref";
import { CommitShaText } from "@/components/tugways/commit-sha-text";
import { TugInput } from "@/components/tugways/tug-input";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugSeparator } from "@/components/tugways/tug-separator";
import {
  commitResolverFor,
  NO_COMMIT_VERDICT,
} from "@/lib/annotator/commit-resolution";
import { COMMIT_LABEL_LENGTH } from "@/lib/commit-format";
import { fileNameResolverFor } from "@/lib/annotator/file-name-resolution";
import { pathResolutionStore } from "@/lib/annotator/path-resolution";
import { makeReferenceResolver } from "@/lib/annotator/resolve-reference";
import { VerdictBatcher } from "@/lib/annotator/verdict-batching";
import type { AnnotationContext } from "@/lib/annotator/types";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import {
  acquireWorkspace,
  getWorkspace,
  subscribeWorkspaces,
} from "@/lib/default-workspace-store";
import { TugAtomChip } from "@/lib/tug-atom-chip";

// ---------------------------------------------------------------------------
// Sample content
// ---------------------------------------------------------------------------

/**
 * The chip size the Gazette sizes its trailing refs at, mirrored from
 * `gazette-card.tsx` (which holds it as a module const, not an export). The
 * value matters: an unsized chip stands a full step above the sentence that
 * named the file, and this card exists to judge that seam.
 */
const GAZETTE_CHIP_FONT_SIZE = 12;

/**
 * A Session-card assistant paragraph, written to hold every case the brief
 * argues about, all of them naming things that really exist in this repo:
 *
 *  - `annotate-content.ts` — a backticked bare filename. Marked today only
 *    because it is backticked (`inCode` licenses it).
 *  - `registry.ts` — the SAME kind of token, unbackticked. Dead text today.
 *  - `AnnotationContext` / `classifyInlineCode` — backticked identifiers that
 *    resolve to nothing. Today they are pixel-identical to the filename above
 *    them; under [P04] they stay plain code while the filename takes a rule,
 *    which is the single clearest before/after on this card.
 *  - an absolute path — licensed in prose today by `isUnambiguousInProse`, so
 *    it is the control that must look the same in both columns.
 *  - a line citation and a real sha — same role.
 */
const TRANSCRIPT_SAMPLE = [
  "The detection gate lives in `annotate-content.ts`, and what a mark then",
  "*does* is decided in registry.ts — one delegated listener, nine kinds,",
  "no per-surface wiring. The two are joined by `AnnotationContext`, whose",
  "`resolvePath` is the only thing standing between a permissive scan and a",
  "field of speculative links.",
  "",
  "Inline code takes a different road: `classifyInlineCode` reads the whole",
  "span, so a backticked path is marked by *being backticked* rather than by",
  "surviving the prose rules. Compare the split-out run in",
  "tugdeck/src/lib/annotator/wrap-matches.ts:41 against the same token",
  "written bare, and the asymmetry is the whole complaint.",
].join("\n");

/**
 * A Reporter post in the Gazette's own voice, on the shape the screenshot
 * that provoked the brief had: prose naming some of its files, plus a
 * trailing ref list holding the ones the sentence never got to.
 */
const GAZETTE_SAMPLE = [
  "Investigating how a reference decides its own appearance, tracing the",
  "detection gate in annotate-content.ts through `classifyInlineCode` and",
  "the split-run wrapper in wrap-matches.ts, then checking what the Gazette",
  "does differently in gazette-card.tsx — where `proseCitesPaths` is set and",
  "the trailing refs are minted as placed atoms…",
].join("\n");

/**
 * The refs the sample post lists — provenance its prose never named, which is
 * exactly what `unmentionedRefs` leaves for the trailing row. Real paths, so
 * they resolve; the sha is this repo's own.
 */
const GAZETTE_REFS: ReadonlyArray<{
  kind: "file" | "commit";
  target: string;
}> = [
  { kind: "file", target: "tugdeck/src/components/tugways/blocks/tool-file-ref.tsx" },
  { kind: "file", target: "tugdeck/src/lib/annotator/registry.ts" },
  { kind: "commit", target: "227a8eb9854d982e42718f26e627c59463fab499" },
];

/** The file both forms in the vocabulary section name, so they compare. */
const VOCABULARY_PATH = "tugdeck/src/lib/annotator/annotate-content.ts";

/**
 * Six marks in one paragraph — the density resting-plain was written to
 * prevent, which is exactly the case a resting signal has to survive.
 *
 * Hand-stamped rather than annotated, and deliberately so: the calibration
 * has to read identically in every theme and with no project bound, and it
 * must show the same six marks whether or not a probe has landed. The
 * columns above are where the real annotator is judged.
 */
const STRESS_RUNS: readonly string[] = [
  "annotate-content.ts",
  "registry.ts",
  "wrap-matches.ts",
  "detect-path-reference.ts",
  "path-resolution.ts",
  "tool-file-ref.tsx",
];

// ---------------------------------------------------------------------------
// Live annotator inputs
// ---------------------------------------------------------------------------

/**
 * The project directory the card resolves against: whichever project a card
 * in this deck is already bound to, so the samples resolve the moment the
 * card opens without anyone typing a path. The field below overrides it.
 */
function useBoundProjectDir(): string | null {
  const bindings = useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    cardSessionBindingStore.getSnapshot,
  );
  return useMemo(() => {
    for (const binding of bindings.values()) return binding.projectDir;
    return null;
  }, [bindings]);
}

/**
 * A browse hold on `projectDir` plus the re-render tick its verdicts arrive
 * on — `useGazetteRefRoots`'s shape for a single directory. Returns the
 * workspace key once the hold lands, `null` while it is in flight.
 *
 * The version sum is what makes an asynchronous answer repaint ink already
 * on screen: a probe lands, a store's version moves, the sum moves, the
 * frames re-render and the annotator's `subscribe` re-marks them.
 */
function useWorkspaceHold(projectDir: string | null): string | null {
  useLayoutEffect(() => {
    if (projectDir !== null) acquireWorkspace(projectDir);
  }, [projectDir]);

  const ready = projectDir !== null && getWorkspace(projectDir) !== null;
  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      const unsubs = [
        subscribeWorkspaces(listener),
        pathResolutionStore.subscribe(listener),
      ];
      const ws = projectDir === null ? null : getWorkspace(projectDir);
      if (ws !== null) {
        const names = fileNameResolverFor(ws.projectDir, ws.workspaceKey);
        if (names !== null) unsubs.push(names.subscribe(listener));
        const commits = commitResolverFor(ws.projectDir, ws.workspaceKey);
        if (commits !== null) unsubs.push(commits.subscribe(listener));
      }
      return () => {
        for (const unsub of unsubs) unsub();
      };
    },
    // `ready` is in the deps because a workspace ARRIVING mints that
    // project's resolvers, and the subscription has to reach them.
    [projectDir, ready], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const getSnapshot = useCallback((): number => {
    let sum = pathResolutionStore.version();
    const ws = projectDir === null ? null : getWorkspace(projectDir);
    if (ws !== null) {
      sum += 1;
      sum += fileNameResolverFor(ws.projectDir, ws.workspaceKey)?.version() ?? 0;
      sum += commitResolverFor(ws.projectDir, ws.workspaceKey)?.version() ?? 0;
    }
    return sum;
  }, [projectDir]);
  useSyncExternalStore(subscribe, getSnapshot);

  const ws = projectDir === null ? null : getWorkspace(projectDir);
  return ws?.workspaceKey ?? null;
}

/**
 * The annotator's inputs for one column — the Gazette's `useGazetteAnnotation`
 * with `proseCitesPaths` lifted to a parameter, which is the entire difference
 * [P03] proposes. No command catalog: there is no live session behind this
 * card, so an unconfirmable command stays plain text, which is the right
 * answer rather than a missing one.
 *
 * Sessions are deliberately not scanned (`resolveSession` absent). They are
 * the one kind that already has a single form everywhere, so they have
 * nothing to contribute to a before/after and would only add a ledger
 * dependency to a card that otherwise needs none.
 */
function useSampleAnnotation(
  projectDir: string | null,
  workspaceKey: string | null,
  proseCitesPaths: boolean,
): AnnotationContext {
  const names = fileNameResolverFor(projectDir, workspaceKey);
  const commits = commitResolverFor(projectDir, workspaceKey);
  const resolvePath = useMemo(
    () =>
      makeReferenceResolver({
        paths: pathResolutionStore,
        names,
        cwd: projectDir,
      }),
    [names, projectDir],
  );
  const resolveCommit = useMemo(
    () => (sha: string) => commits?.lookup(sha) ?? NO_COMMIT_VERDICT,
    [commits],
  );
  const subscribe = useMemo(() => {
    const sources = [pathResolutionStore, names, commits].filter(
      (source): source is NonNullable<typeof source> => source !== null,
    );
    return new VerdictBatcher(sources).subscribe;
  }, [names, commits]);
  return useMemo(
    () => ({
      isKnownSlashCommand: () => false,
      resolvePath,
      resolveCommit,
      commitRoot: projectDir,
      proseCitesPaths,
      subscribe,
    }),
    [resolvePath, resolveCommit, projectDir, proseCitesPaths, subscribe],
  );
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/**
 * One column: a titled frame holding real annotated markdown, plus whatever
 * trailing row the caller hangs under it.
 *
 * `proposed` does two things and only two: it scopes [P05]'s resting
 * underline and it turns on [P03]'s detection. Keeping both on one prop is
 * what lets the caption under each pair name the difference honestly.
 */
function Column({
  title,
  caption,
  proposed,
  body,
  projectDir,
  workspaceKey,
  citesPaths,
  children,
}: {
  title: string;
  caption: string;
  proposed: boolean;
  body: string;
  projectDir: string | null;
  workspaceKey: string | null;
  /** `proseCitesPaths` for this column. The Gazette pair passes `true` for
   *  both, which is what makes it the underline-only control. */
  citesPaths: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  const context = useSampleAnnotation(projectDir, workspaceKey, citesPaths);
  return (
    <div className="gep-column">
      <div className="gep-column-head">
        <TugLabel size="sm">{title}</TugLabel>
        <span className="gep-column-caption">{caption}</span>
      </div>
      <div className={proposed ? "gep-frame gep-proposed" : "gep-frame"}>
        <AnnotationScope value={context}>
          {/* Static mode: the sample never changes, and the annotator's
              re-mark path is driven by the context's own subscription. The
              key pins the block to the column so a project-dir change
              remounts it rather than re-marking stale DOM. */}
          <TugMarkdownBlock
            key={`${title}:${projectDir ?? ""}`}
            initialText={body}
          />
          {children}
        </AnnotationScope>
      </div>
    </div>
  );
}

/** The Gazette's trailing refs as they ship: the boxed {@link TugAtomChip}. */
function RefsToday(): React.ReactElement {
  return (
    <div className="gep-refs">
      {GAZETTE_REFS.map((ref) => (
        <TugAtomChip
          key={ref.target}
          className="tug-atom-chip"
          fontSize={GAZETTE_CHIP_FONT_SIZE}
          type={ref.kind === "commit" ? "commit" : "file"}
          label={
            ref.kind === "commit"
              ? `Commit: ${ref.target.slice(0, COMMIT_LABEL_LENGTH)}`
              : (ref.target.split("/").pop() ?? ref.target)
          }
          value={ref.target}
        />
      ))}
    </div>
  );
}

/**
 * The same refs under [P06]. They stay ATOMS — a post's `refs` array is a
 * placed list, which is what [P01] keys on — and take the read-only skin:
 * glyph + label, no box, because nothing here can be selected or deleted in
 * place. That skin is `ToolFileRef`, already shipping in tool headers.
 *
 * Each label is a NAME rather than the raw value ([P09]): the file atoms
 * show their basename, which `ToolFileRef` already does, and the commit atom
 * says `Commit <short>` — see {@link CommitAtomDrawing}. The file refs are
 * the real component and do open; the commit is a drawing.
 */
function RefsProposed(): React.ReactElement {
  return (
    <div className="gep-refs gep-refs-unboxed">
      {GAZETTE_REFS.map((ref) =>
        ref.kind === "commit" ? (
          <CommitAtomDrawing key={ref.target} sha={ref.target} />
        ) : (
          <ToolFileRef key={ref.target} path={ref.target} />
        ),
      )}
    </div>
  );
}

/**
 * The stress paragraph at one candidate weight — six Mentions in running
 * prose, which is the density the resting signal has to survive.
 *
 * `weightClass` is empty for the today reading, which is the honest baseline:
 * six actionable references and not one of them says so.
 */
function StressParagraph({
  label,
  caption,
  weightClass,
}: {
  label: string;
  caption: string;
  weightClass: string | null;
}): React.ReactElement {
  const scope =
    weightClass === null ? "gep-stress" : `gep-stress gep-proposed ${weightClass}`;
  return (
    <div className="gep-weight">
      <div className="gep-column-head">
        <TugLabel size="sm">{label}</TugLabel>
        <span className="gep-column-caption">{caption}</span>
      </div>
      <p className={scope}>
        The pass begins in <Run text={STRESS_RUNS[0]!} />, which walks the
        block and hands each run to the detectors —{" "}
        <Run text={STRESS_RUNS[3]!} /> for paths, and its siblings for shas
        and sessions — before <Run text={STRESS_RUNS[2]!} /> splits the
        confirmed ones out of the surrounding text. Resolution is
        asynchronous, so <Run text={STRESS_RUNS[4]!} /> answers{" "}
        <em>pending</em> first and the batch brings the verdict back later;
        what a mark then <em>does</em> comes from{" "}
        <Run text={STRESS_RUNS[1]!} />, and the read-only display form lives
        in <Run text={STRESS_RUNS[5]!} />.
      </p>
    </div>
  );
}

/** One hand-stamped Mention run — the annotation contract's own attributes. */
function Run({ text }: { text: string }): React.ReactElement {
  return (
    <span data-tugx-wrapped="" data-tug-annotation="file-path">
      {text}
    </span>
  );
}

/**
 * The read-only atom skin for a commit — [P07] + [P09]. A **drawing**:
 * `ToolFileRef` only speaks `file-path` today, so W5's widening is mimed
 * with its class. Inert on purpose (no annotation dataset, no pointer), so
 * nothing here can be mistaken for shipped behaviour.
 *
 * The label carries the word. Eight hex characters do not announce
 * themselves, and the glyph was never going to rescue them — an atom stands
 * with no sentence around it, so the sentence's work moves into the label.
 */
function CommitAtomDrawing({ sha }: { sha: string }): React.ReactElement {
  return (
    <span className="tool-file-ref gep-ref-drawing">
      <span className="tool-file-ref-icon" aria-hidden="true">
        <GitCommit />
      </span>
      {`Commit ${sha.slice(0, COMMIT_LABEL_LENGTH)}`}
    </span>
  );
}

/**
 * One cell of the two-channel matrix — [P04] made visible.
 *
 * `code` puts the run in an inline `<code>`, which is the author's backticks
 * and drives the code tone; `resolves` stamps the annotation, which is the
 * resolver's verdict and drives the rule. The two are independent, and the
 * four cells are the proof: nothing about the tone predicts the rule, and
 * nothing about the rule predicts the tone.
 *
 * Hand-stamped so all four read the same in every theme with no project
 * bound. The columns above are where the real annotator is judged.
 */
function ChannelCell({
  label,
  text,
  code,
  resolves,
}: {
  label: string;
  text: string;
  code: boolean;
  resolves: boolean;
}): React.ReactElement {
  const marks = resolves
    ? { "data-tugx-wrapped": "", "data-tug-annotation": "file-path" }
    : {};
  return (
    <div className="gep-cell">
      <span className="gep-cell-label">{label}</span>
      <div className="gep-cell-body gep-proposed">
        {code ? (
          <code className="gep-cell-code" {...marks}>
            {text}
          </code>
        ) : (
          <span {...marks}>{text}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function GalleryEntityPresentation(): React.ReactElement {
  const bound = useBoundProjectDir();
  const [typed, setTyped] = useState<string | null>(null);
  const projectDir = typed ?? bound;
  const workspaceKey = useWorkspaceHold(projectDir);

  const ready = projectDir !== null && workspaceKey !== null;

  return (
    <div className="gep-root">
      <p className="gep-blurb">
        The rule is <strong>placed versus written</strong>: an atom is
        something someone placed (an <code>@</code>-mention, a tool&rsquo;s{" "}
        <code>file_path</code>, an entry in a post&rsquo;s <code>refs</code>{" "}
        array), a mention is something someone wrote. The two columns below
        differ in exactly two ways — the <code>proseCitesPaths</code> gate
        ([P03]) and a scope class carrying the resting underline ([P05]).
        Everything else is the shipping path. Brief:{" "}
        <code>roadmap/entity-presentation.md</code>.
      </p>

      <div className="gep-root-row">
        <TugLabel size="sm">Project</TugLabel>
        <TugInput
          size="sm"
          className="gep-root-input"
          value={projectDir ?? ""}
          placeholder="/absolute/path/to/a/repo"
          onChange={(event) => setTyped(event.currentTarget.value)}
          spellCheck={false}
        />
        <span className="gep-root-state" data-ready={ready ? "" : undefined}>
          {projectDir === null
            ? "no project — open a Session card, or type a path"
            : ready
              ? "workspace held — references resolve live"
              : "acquiring workspace…"}
        </span>
      </div>
      <p className="gep-note">
        Every mark in the two column pairs is earned: a path is marked because
        it stats in this directory and a sha because git can show it. Point
        the field at another repo and most of them correctly go quiet.
      </p>

      <TugSeparator />

      <section className="gep-section">
        <TugLabel>Session transcript — assistant prose</TugLabel>
        <p className="gep-note">
          The detection change is the visible one here.{" "}
          <code>registry.ts</code> and the bare{" "}
          <code>wrap-matches.ts:41</code> citation are dead text on the left
          and live references on the right, while the backticked{" "}
          <code>annotate-content.ts</code> is already live on both — that
          asymmetry, decided by whether the model reached for backticks, is
          [P03]&rsquo;s whole subject. On the right, note that{" "}
          <code>AnnotationContext</code> and <code>classifyInlineCode</code>{" "}
          take no rule: they resolve to nothing, and [P04] is what finally
          makes <em>actionable</em> visible as its own axis rather than as a
          second reading of the code tone.
        </p>
        <div className="gep-pair">
          <Column
            title="Today"
            caption="Session card — proseCitesPaths unset"
            proposed={false}
            citesPaths={false}
            body={TRANSCRIPT_SAMPLE}
            projectDir={projectDir}
            workspaceKey={workspaceKey}
          />
          <Column
            title="Proposed"
            caption="[P03] one gate · [P04] resolved ≠ code · [P05] rule at rest"
            proposed
            citesPaths
            body={TRANSCRIPT_SAMPLE}
            projectDir={projectDir}
            workspaceKey={workspaceKey}
          />
        </div>
      </section>

      <TugSeparator />

      <section className="gep-section">
        <TugLabel>Gazette — Reporter post</TugLabel>
        <p className="gep-note">
          The Gazette already sets <code>proseCitesPaths</code>, so this pair
          is the control: the bodies differ only by the resting underline. The
          trailing row stays <em>atoms</em> in both columns — a post&rsquo;s{" "}
          <code>refs</code> is a placed array, and that was never the bug. What
          changes is the skin ([P06]): read-only ink drops the box, because
          nothing there can be selected or deleted in place. The real fix to
          the screenshot that started this is above the row, where the prose
          mentions finally say they are actionable.
        </p>
        <div className="gep-pair">
          <Column
            title="Today"
            caption="boxed atoms; prose says nothing"
            proposed={false}
            citesPaths
            body={GAZETTE_SAMPLE}
            projectDir={projectDir}
            workspaceKey={workspaceKey}
          >
            <RefsToday />
          </Column>
          <Column
            title="Proposed"
            caption="[P06] read-only skin · [P05] rule at rest"
            proposed
            citesPaths
            body={GAZETTE_SAMPLE}
            projectDir={projectDir}
            workspaceKey={workspaceKey}
          >
            <RefsProposed />
          </Column>
        </div>
      </section>

      <TugSeparator />

      <section className="gep-section">
        <TugLabel>[P04] — two channels, not one</TugLabel>
        <p className="gep-note">
          Why does <code>annotate-content.ts</code> read green above while{" "}
          <code>registry.ts</code> does not, when both are actionable? Because
          they answer <em>different questions</em>. The green is markdown&rsquo;s
          own code tone — the author&rsquo;s backticks, exactly as{" "}
          <code>*</code> drives italic — and it says nothing about whether a
          thing responds. The rule is the resolver&rsquo;s verdict and says
          nothing about how the author formatted it. Independent channels,
          four combinations, all legible:
        </p>
        <div className="gep-cells">
          <ChannelCell
            label="backticked · resolves"
            text="annotate-content.ts"
            code
            resolves
          />
          <ChannelCell
            label="bare · resolves"
            text="registry.ts"
            code={false}
            resolves
          />
          <ChannelCell
            label="backticked · resolves to nothing"
            text="AnnotationContext"
            code
            resolves={false}
          />
          <ChannelCell
            label="bare · resolves to nothing"
            text="the detection gate"
            code={false}
            resolves={false}
          />
        </div>
        <p className="gep-note">
          Read down the column: tone never predicts the rule. Read across: the
          rule never predicts the tone. That is the whole of [P04] — and it is
          why the code tone <em>stays</em>. Stripping it from a resolved path
          would be us overriding what the author wrote, which is the same
          fidelity violation [P01] refuses when it declines to replace prose
          with a box.
        </p>
      </section>

      <TugSeparator />

      <section className="gep-section">
        <TugLabel>The two forms, one file</TugLabel>
        <p className="gep-note">
          [P01] side by side, both naming <code>annotate-content.ts</code>.
          Placed things are atoms; written things are mentions. The box is not
          a third form — it is the atom&rsquo;s editable skin, and it appears
          only where the object can be manipulated in place.
        </p>
        <div className="gep-forms">
          <div className="gep-form">
            <TugLabel size="sm">Atom — editable skin</TugLabel>
            <div className="gep-form-body">
              <TugAtomChip
                type="file"
                label="annotate-content.ts"
                value={VOCABULARY_PATH}
              />
            </div>
            <span className="gep-form-note">
              The composer, and its echo in the submitted message. The box is
              honest here — the token can be selected and deleted, and
              [P02]&rsquo;s round-trip promise is that what you placed comes
              back as what you placed.
            </span>
          </div>
          <div className="gep-form">
            <TugLabel size="sm">Atom — read-only skin</TugLabel>
            <div className="gep-form-body gep-form-mono">
              <ToolFileRef path={VOCABULARY_PATH} />
            </div>
            <span className="gep-form-note">
              A tool header&rsquo;s identity, a list row, the Gazette&rsquo;s
              trailing refs. Same atom, no box. Already shipping as{" "}
              <code>ToolFileRef</code> — [P06] is the recognition that we built
              this component twice.
            </span>
          </div>
          <div className="gep-form">
            <TugLabel size="sm">Mention</TugLabel>
            <div className="gep-form-body gep-proposed">
              <span className="gep-mention-demo">
                …the gate lives in <Run text="annotate-content.ts" />, and what
                a mark does…
              </span>
            </div>
            <span className="gep-form-note">
              Somebody wrote these characters, so the characters are what
              shows — plus a rule saying they respond to a click. Backticked or
              bare makes no difference ([P04]). The run here is hand-stamped so
              the form reads with no project bound.
            </span>
          </div>
        </div>
      </section>

      <TugSeparator />

      <section className="gep-section">
        <TugLabel>[P05] — calibrating the resting rule</TugLabel>
        <p className="gep-note">
          <strong>Settled: medium.</strong> The other readings are kept as the
          record of what it was chosen against, not as live options. Six
          mentions in one paragraph is the density resting-plain was written to
          prevent, and therefore the case a resting signal had to survive; the
          top reading is the honest baseline — six actionable references and
          not one of them says so. Colour is untouched throughout; only the
          rule varies.
        </p>
        <div className="gep-weights">
          <StressParagraph
            label="Today"
            caption="resting-plain — the signal appears only under the pointer"
            weightClass={null}
          />
          <StressParagraph
            label="Faint"
            caption="1px solid, currentColor at 28%"
            weightClass="gep-weight-faint"
          />
          <StressParagraph
            label="Medium — APPROVED"
            caption="1px solid, currentColor at 45% — the settled weight"
            weightClass="gep-weight-medium"
          />
          <StressParagraph
            label="Dotted"
            caption="1px dotted, currentColor at 70% — actionable, not a navigation link"
            weightClass="gep-weight-dotted"
          />
        </div>
        <p className="gep-note">
          Hover any of them: the full link treatment is unchanged and still
          owned by <code>tug-annotation.css</code>. The resting rule is an
          addition, not a replacement — which is also why it costs no layout
          metric, and why a verdict landing late can add it without reflowing a
          streaming transcript.
        </p>
      </section>

      <TugSeparator />

      <section className="gep-section">
        <TugLabel>Commit sha — [P07]</TugLabel>
        <p className="gep-note">
          A sha in a receipt header or a History row arrives in a{" "}
          <em>field</em> of a commit record — it was placed, not written — so
          [P01] makes it an atom, not a Mention. And [P09] settles the label:
          eight bare hex characters name nothing a reader can act on, and a
          small glyph does not rescue them. A sha <em>in prose</em> needs no
          help because the sentence supplies the word; a sha standing alone has
          no sentence, so the word moves into the label.
        </p>
        <div className="gep-forms">
          <div className="gep-form">
            <TugLabel size="sm">Today — receipt / History</TugLabel>
            <div className="gep-form-body">
              <CommitShaText sha={GAZETTE_REFS[2]!.target} />
            </div>
          </div>
          <div className="gep-form">
            <TugLabel size="sm">Today — Gazette ref</TugLabel>
            <div className="gep-form-body">
              <TugAtomChip
                fontSize={GAZETTE_CHIP_FONT_SIZE}
                type="commit"
                label={`Commit: ${GAZETTE_REFS[2]!.target.slice(0, COMMIT_LABEL_LENGTH)}`}
                value={GAZETTE_REFS[2]!.target}
              />
            </div>
          </div>
          <div className="gep-form">
            <TugLabel size="sm">Proposed — the atom, labelled</TugLabel>
            <div className="gep-form-body gep-form-mono">
              <CommitAtomDrawing sha={GAZETTE_REFS[2]!.target} />
            </div>
            <span className="gep-form-note">
              One form for both of today&rsquo;s placed positions — the receipt
              header, the History row, the Gazette ref. A drawing until W5
              widens the read-only skin past <code>file-path</code>.
            </span>
          </div>
          <div className="gep-form">
            <TugLabel size="sm">Proposed — the same sha, written</TugLabel>
            <div className="gep-form-body gep-proposed">
              <span className="gep-mention-demo">
                …landed as commit{" "}
                <span data-tugx-wrapped="" data-tug-annotation="commit-sha">
                  {GAZETTE_REFS[2]!.target.slice(0, COMMIT_LABEL_LENGTH)}
                </span>{" "}
                on Tuesday…
              </span>
            </div>
            <span className="gep-form-note">
              Written in a sentence, so it stays a Mention and adds no word —
              the prose already said &ldquo;commit.&rdquo; This is the pair
              [P09] is about: the same value, labelled by the sentence in one
              position and by itself in the other.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
