import Foundation

/// Configuration keys for on-device inference, mirrored in
/// `tugrust/crates/tugcast/src/local_model.rs` and
/// `tugdeck/src/lib/local-model-store.ts`.
enum LocalModelConfig {
    static let domain = "dev.tugtool.local-model"
    static let modelKey = "model"

    /// The model the user picked: a catalog id, `"auto"`, or `""` (declined).
    /// Absent reads as `"auto"`.
    static let auto = "auto"
    static let declined = ""

    static func selection() -> String {
        guard let value = TugbankClient.shared?.getString(domain: domain, key: modelKey) else {
            return auto
        }
        return value
    }

    /// The per-feature kill switches, mirrored from
    /// `SHELL_ROUTING_KEY` / `PULSE_OVERVIEW_KEY` in `local-model-store.ts`.
    static let shellRoutingKey = "shell-routing"
    static let pulseOverviewKey = "pulse-overview"

    /// A tenant kill switch. Absent — and any non-bool — reads as enabled,
    /// matching `readTenantEnabled` on the deck side. `getBool` alone would
    /// read an absent switch as *off*, which is the opposite default.
    static func tenantEnabled(_ key: String) -> Bool {
        guard let value = TugbankClient.shared?.get(domain: domain, key: key) else {
            return true
        }
        if case .bool(let on) = value { return on }
        return true
    }

    /// Whether any feature would use the model, and so whether its weights are
    /// worth holding resident.
    static func anyTenantEnabled() -> Bool {
        tenantEnabled(shellRoutingKey) || tenantEnabled(pulseOverviewKey)
    }
}

/// One pack's instruction text, for every task that has any.
///
/// Prompts live per pack because packs differ in what they can follow. A 1.2B
/// pack and a 4B pack read the same instructions differently, and a rule that
/// rescues one can cost the other — so the shape of the ruling is "this pack
/// under this profile", not "this pack". Budgets stay shared statics: a token
/// ceiling is a fact about the strip, not about the model.
///
/// The table ships empty. A profile is earned by measurement (a candidate that
/// fails the default in a way a smaller prompt plausibly rescues), never
/// authored on a hunch, because every profile added is another axis the
/// bake-off has to hold fixed.
struct PromptProfile {
    /// Logged as `profile=<name>` so a scored run can be read back to the exact
    /// wording that produced it.
    let name: String
    let classify: String
    let classifyWithGrammar: String
    let summarize: String
    let summarizeRetrospective: String
}

/// The instruction text every task ships with.
///
/// **The freeze rule.** These strings are frozen against a *bake-off*, not
/// forever. A comparison is only a comparison if every pack in it was scored on
/// identical wording, the same corpus, the same normalizer — so editing any
/// string here invalidates the standing bake-off and obliges re-running it.
/// That is what makes the edit a deliberate act rather than a drive-by. What it
/// freezes is a **(pack, profile) pair**: a pack scored under one profile says
/// nothing about the same pack under another, and a profile authored for one
/// pack invalidates nothing scored under a different one.
///
/// It does not protect the scores in `CatalogEntry.notes`. Those refer to
/// wordings several rewrites old and are stale beyond repair; the ruling in
/// force lives in the roadmap plan that produced it.
///
/// **What each prompt is for, and what it learned the hard way.**
///
/// `classify` and `classifyWithGrammar` are one designed pair over a shared
/// core, not a prompt and an appendix. The core carries the asymmetry that
/// decides every close call: a wrong SHELL executes a command nobody asked for
/// and cannot be taken back, a wrong PROMPT costs one keystroke, so doubt
/// resolves to PROMPT. Both teach by paired examples — the same opener labeled
/// both ways — because small quantized models form first-word priors from
/// unpaired ones. The grammar variant is built around the synopsis as primary
/// evidence, because it runs only on the grader's `maybe` band, where the
/// opener is already known to resolve and only the tail is in question.
///
/// `summarize` asks for a headline, and every rule in it is scar tissue. Asking
/// for the session's *goal* produced a constant headline (47 inferences over
/// two live sessions yielded 16 distinct lines), so it asks for the current
/// stretch of work read against the ask, and says the headline is expected to
/// move. Omitting "start with a verb" produced *labels* — noun phrases, which
/// is the failure newspaper headline register exists to prevent. The examples
/// are paired with the digests they answer because an unpaired block of eight
/// bare headlines reads to a model as available content: 85% of 1123 real
/// headlines opened with `Fix`, and 13% returned a string out of the block
/// itself — including the label the block held up as the failure to avoid.
///
/// `summarizeRetrospective` is the settled-stretch lane. Same register, past
/// tense, because the strip gives an intent and a retrospective the same pixels
/// and the tense is the only thing telling a reader the work stopped.
///
/// **Keep every example disjoint from `tests/model-eval/corpus`** — both the
/// `*.digest.txt` and the `*.done.txt` fixtures. This is load-bearing twice
/// over. It is what lets `run.py` call a match a lift, and it is what lets
/// `ground_headline` catch a lifted example with no copy of this list in Rust:
/// disjoint means a lifted example's words are absent from the digest, which
/// the grounding rule already rejects. An example drawn from the corpus is an
/// answer key, not a demonstration. `run.py` refuses to score rather than warn
/// when it finds one.
///
enum LocalModelPrompts {
    /// What both classify prompts share: the task, the one fact the caller has
    /// already verified, and the asymmetry that decides every close call.
    ///
    /// Shared as a constant rather than duplicated because the two variants must
    /// answer the same question — a drift between them would show up as a band
    /// difference in the bake-off and be read as a fact about the grader.
    private static let classifyCore = """
    You label one line a developer typed into a dev tool. Answer with exactly \
    one word and nothing else: SHELL or PROMPT.

    The first word of the line ALWAYS names a real program installed on this \
    machine. The question is never whether the program exists — only whether \
    the person meant to RUN it, or was writing a sentence to an AI assistant \
    that happens to begin with that word.

    SHELL — they meant to run the program. Anything after the first word is an \
    argument to it: a file name, a directory, a flag, a path, or a subcommand.

    PROMPT — they were writing to the assistant. The line reads as English \
    prose: it contains an article ("the", "a"), a pronoun ("it", "me", "this"), \
    a preposition ("for", "about", "in"), or it asks a question.

    The two mistakes are not equal. A wrong SHELL runs a command nobody asked \
    for and cannot be taken back. A wrong PROMPT costs one keystroke to \
    retype. When the line could be read either way, answer PROMPT.
    """

    static let classify = classifyCore + """


    Decide by what follows the first word. A bare word that could name a file \
    or a directory means SHELL. An English phrase means PROMPT. Most shell \
    commands are one to three plain words.

    pwd => SHELL
    cd tugrust => SHELL
    which cargo => SHELL
    rg TODO src => SHELL
    kill 4821 => SHELL
    head config.log => SHELL
    open index.html => SHELL
    sort data.csv => SHELL
    make clean => SHELL
    npm install => SHELL
    head over to the docs => PROMPT
    open an issue for this bug => PROMPT
    sort the imports in this file for me => PROMPT
    make this function faster => PROMPT
    build the project for me => PROMPT
    explain this error => PROMPT
    why is the test failing => PROMPT
    read the config and tell me what changed => PROMPT
    """

    /// The same question, asked with the program's own documentation in hand.
    ///
    /// This is the `maybe` band of the command-grammar grader, and the band is
    /// what the prompt is built around: the grader has already confirmed the
    /// first word names a real program, and has already failed to account for
    /// what follows against the grammar it knows. So the open question is
    /// narrow and factual — do those trailing words read as arguments this
    /// documentation would accept? Checking a line against a document is
    /// evidence-checking rather than judgement, which is the task shape a small
    /// on-device pack is demonstrably better at, and it is why this variant
    /// leads with the documentation instead of appending it to a prompt about
    /// English prose.
    ///
    /// The contrast pair is the load-bearing example. A real command wearing a
    /// flag this documentation happens not to list is still a command; an
    /// English sentence whose words the documentation gives no meaning to is
    /// not. Nothing else in either prompt teaches that difference, and it is
    /// the entire population of the band.
    ///
    /// `{{GRAMMAR}}` is substituted with the synopsis at call time.
    static let classifyWithGrammar = classifyCore + """


    Here is that program's own documentation, from this machine:

    {{GRAMMAR}}

    Read the rest of the line against this documentation.

    If the words after the first read as arguments — a subcommand it lists, a \
    flag, a file, a path, a value — answer SHELL. Documentation is never \
    complete: a flag or subcommand that is missing from it, or spelled a little \
    wrong, is still someone running the program. Judge the SHAPE of what \
    follows, not whether every token appears above.

    If the words after the first read as English about the program — a request, \
    a question, a description of what to do — answer PROMPT. The giveaway is \
    that the documentation gives those words no meaning at all: they are not \
    flags, not subcommands, not filenames, just sentence.

    curl -sS --compressed https://example.com/api => SHELL
    curl the config down from the staging box => PROMPT
    docker compose up --detach --wait => SHELL
    docker the worker into a smaller image => PROMPT
    sed -i '' 's/warn/error/g' notes.txt => SHELL
    sed the license header out of every file => PROMPT
    """

    /// The placeholder [`classifyWithGrammar`] substitutes the synopsis into.
    static let grammarPlaceholder = "{{GRAMMAR}}"

    static let summarize = """
    You write the headline for a live coding session. The digest comes in \
    labeled sections.

    "The current ask" is what the person most recently asked for, and it names \
    the subject: headline the work being done about THAT. "The standing goal" \
    is the older, wider aim — background, not the subject, unless it is the \
    only ask there is. "What it is doing right now" says how the ask is being \
    advanced, and it is what makes the headline move: the subject holds while \
    the machinery works, and the headline changes as the work does.

    Newspaper headline style. The rules are strict:

    START WITH A VERB, in the plain command form: Fix, Author, Draft, Wire, \
    Trace, Port, Audit, Bundle, Salvage, Explain. Pick the verb that fits the \
    work. Not "Fixing", not "Building" — Fix, Build.
    ROOM FOR ABOUT 64 CHARACTERS — one short line. Say the work in as many \
    words as that takes and no more. Shorter is better when it is not vaguer.
    NO "the", "a", "an". NO "and" — use a comma, or cut the second half.
    NO trailing detail. Name the work, not the parts it is made of.
    SENTENCE CASE, like a sentence: only the first word is capitalized. \
    Proper names keep their capitals — Lens, Finder, Keychain, CodeMirror.
    No period. No quotes.

    EVERY WORD MUST COME FROM THE DIGEST YOU WERE GIVEN. Never name a tool — \
    Bash, Edit, Read, Write, Grep — and never write a path or a file's \
    location. Those say which command ran; the headline says what the work is \
    for.

    A headline with no verb is a label, and a label is a failure. \
    "Ligature fallback for monospace fonts" is a label. \
    "Repair ligature fallback in monospace" is a headline.

    Below are digests and the headline each one earns. Read the pairing: the \
    headline uses that digest's own words, and no others.

    DIGEST:
    The standing goal:
    - the keyboard shortcuts are fighting each other, sort it out
    What it is doing right now:
    - Read(keymap.ts)
    - Edit(keymap.ts)
    HEADLINE:
    Resolve keymap shortcut conflicts

    DIGEST:
    The standing goal:
    - make the editor feel quicker on big files
    The current ask:
    - forget that, undo is coalescing far too much
    What it is doing right now:
    - Read(undo-stack.ts)
    - Edit(undo-stack.ts)
    HEADLINE:
    Tighten undo coalescing

    DIGEST:
    The standing goal:
    - dropped sockets are hammering the server on reconnect
    What the session has been doing:
    - Read(reconnect.ts)
    - said: Every dropped socket retries at once, so the server sees a storm.
    What it is doing right now:
    - Edit(reconnect.ts)
    HEADLINE:
    Throttle websocket reconnect storm

    DIGEST:
    The standing goal:
    - the badge count stays wrong after things are marked read
    What the session has been doing:
    - Read(notification-badge.ts)
    What it is doing right now:
    - Bash(bun test notification-badge)
    - Edit(notification-badge.ts)
    HEADLINE:
    Fix stale notification badge count from cached list

    DIGEST:
    The standing goal:
    - make the renderer stop stuttering when the window resizes
    What the session has been doing:
    - Read(/opt/render/glyph-atlas/atlas.rs)
    - said: The atlas reallocates on every resize instead of reusing pages.
    What it is doing right now:
    - Edit(/opt/render/glyph-atlas/atlas.rs)
    HEADLINE:
    Prune glyph atlas reallocation on resize

    DIGEST:
    The standing goal:
    - walk me through how oauth refresh tokens rotate
    What it is doing right now:
    - said: A refresh token is exchanged once and replaced, so replay fails.
    HEADLINE:
    Explain oauth refresh token rotation

    Output only the headline.
    """

    /// The settled-stretch counterpart to [`summarize`]. Same register, one
    /// difference that carries the whole meaning: the tense. The strip gives an
    /// intent and a retrospective the same pixels, so past tense is the only
    /// thing telling a reader that the work stopped rather than continued.
    static let summarizeRetrospective = """
    You write one line saying what a coding session accomplished. The work has \
    stopped. The digest comes in labeled sections; the section labeled "What \
    the session did" holds everything that happened, and the other sections \
    say what it was for. Say what was accomplished — not the last thing that \
    ran, and not every step in order.

    Newspaper headline style, in the PAST TENSE. The rules are strict:

    START WITH A PAST-TENSE VERB: Fixed, Authored, Drafted, Wired, Traced, \
    Ported, Audited, Bundled, Salvaged, Explained. Pick the verb that fits \
    what was done. Not "Fixing", not "Has fixed" — Fixed, Wired.
    NO "the", "a", "an". NO "and" — use a comma, or cut the second half.
    NO trailing detail. Name what was accomplished, not the parts it took.
    SENTENCE CASE, like a sentence: only the first word is capitalized. \
    Proper names keep their capitals — Lens, Finder, Keychain, CodeMirror.
    No period. No quotes.

    EVERY WORD MUST COME FROM THE DIGEST YOU WERE GIVEN. Never name a tool — \
    Bash, Edit, Read, Write, Grep — and never write a path or a file's \
    location. Never restate one line of the digest; say what the lines add up \
    to.

    Below are digests and the line each one earns.

    DIGEST:
    The standing goal:
    - the keyboard shortcuts are fighting each other, sort it out
    What the session did:
    - Read(keymap.ts)
    - Edit(keymap.ts)
    - Bash(bun test keymap)
    HEADLINE:
    Resolved keymap shortcut conflicts

    DIGEST:
    The standing goal:
    - the badge count stays wrong after things are marked read
    What the session did:
    - Read(notification-badge.ts)
    - Edit(notification-badge.ts)
    - said: The count read a cached list, so marking read never lowered it.
    HEADLINE:
    Fixed stale notification badge count

    DIGEST:
    The standing goal:
    - walk me through how oauth refresh tokens rotate
    What the session did:
    - said: A refresh token is exchanged once and replaced, so replay fails.
    HEADLINE:
    Explained oauth refresh token rotation

    Output only the line.
    """

    static let generate = """
    You are a concise assistant embedded in a developer tool. Answer directly \
    and briefly, with no preamble.
    """

    static let classifyMaxTokens = 8
    /// A headline budget, not a sentence budget. The strip clips at 64
    /// characters (`MAX_HEADLINE_CHARS` in `session_overview.rs`), and 40
    /// tokens comfortably covers that — enough that a legal headline is never
    /// truncated mid-word, few enough that the model cannot spend latency
    /// generating text the strip will immediately discard.
    static let summarizeMaxTokens = 40
    static let generateMaxTokens = 256

    /// The shared, small-model-conscious wording every pack gets unless it has
    /// earned its own.
    static let defaultProfile = PromptProfile(
        name: "default",
        classify: classify,
        classifyWithGrammar: classifyWithGrammar,
        summarize: summarize,
        summarizeRetrospective: summarizeRetrospective)

    /// Per-pack wording, first prefix match wins. Keyed on an id *prefix* so a
    /// requant of one family can share a profile without listing every id.
    ///
    /// Empty, and empty on evidence rather than for want of trying. One profile
    /// was authored and scored during the bake-off: a compressed classify pair
    /// for a 1.2B pack which, on the shared wording, called SHELL on fourteen
    /// lines that all opened with a token also naming a program — a model
    /// reading the first word and stopping. Leading with the decisive test and
    /// stacking minimal pairs that share an opener made it worse, not better:
    /// the pack's own false SHELL count went to thirty-six, because putting the
    /// SHELL rule and the SHELL half of every pair first taught it that SHELL
    /// is the default answer. It was removed rather than retuned, since a
    /// second and third variant is tuning until the number looks good, and the
    /// pack it was written for is no longer in the catalog at all.
    ///
    /// The lesson for whoever adds the first entry: a small pack over-reads
    /// whatever the prompt puts first, so compression alone is not a strategy —
    /// what leads has to be what you want over-read.
    static let overrides: [(idPrefix: String, profile: PromptProfile)] = []

    /// The profile a pack answers under. An absent id — the system backend, or
    /// no pack resolved — gets the default, which is also what every pack gets
    /// while the table is empty.
    static func profile(forModelId id: String?) -> PromptProfile {
        guard let id else { return defaultProfile }
        for entry in overrides where id.hasPrefix(entry.idPrefix) {
            return entry.profile
        }
        return defaultProfile
    }
}

/// The one place that answers local-model requests, whichever transport they
/// arrived on.
///
/// Everything OS- and runtime-specific stops here: the service owns the
/// availability matrix, so neither tugcast nor the deck ever branches on macOS
/// version or on which backend answered.
final class LocalModelService {

    static let shared = LocalModelService()

    /// Whether this process is one of the app-test harness's app launches.
    /// Same signal `AppDelegate` reads; see `resolveRoute`.
    static let isAppTestHarness = ProcessInfo.processInfo.environment["TUGAPP_APP_TEST"] == "1"

    private let mlx = MLXLocalModelBackend()
    private let backends: [LocalModelBackend]

    private init() {
        // Downloaded packs come first; the system model, where the OS has
        // one, backstops them ([P08] — this list is the whole availability
        // matrix, and nothing above it branches on OS version).
        var list: [LocalModelBackend] = [mlx]
        if let system = SystemLanguageModelBackend.makeIfSupported() {
            list.append(system)
        }
        backends = list
    }

    // MARK: Requests

    /// Answer one request, and record what it cost.
    ///
    /// This is the only seam that sees both transports, so it is where the
    /// measurement goes: instrumenting tugcast's requester instead would leave
    /// the deck's shell-routing classify — the task with a person waiting on it
    /// — permanently unmeasured. Being a wrapper rather than a scatter of
    /// inline timers is what makes it impossible to miss a return path.
    ///
    /// The line is emitted **after** the reply exists and its write is
    /// dispatched to a background queue, so measurement never joins the
    /// latency it measures.
    func handle(_ request: LocalModelRequest) async -> LocalModelReply {
        let started = DispatchTime.now()
        // Resolved once, here, so the wording that answered and the wording the
        // log names can never be two different things.
        let profile = request.kind.usesInstructions
            ? LocalModelPrompts.profile(forModelId: await resolveRoute()?.model?.id)
            : nil
        let reply = await perform(request, profile: profile ?? LocalModelPrompts.defaultProfile)
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000

        let task = request.kind.task
        var fields = [
            TugLog.field("task", task),
            TugLog.field("transport", request.transport.rawValue),
            TugLog.field("outcome", Self.outcome(of: reply)),
            TugLog.field("elapsed_ms", Int(elapsed.rounded())),
            TugLog.field("input_chars", request.kind.inputChars),
            TugLog.field("output_chars", reply.ok ? (reply.text ?? reply.verdict ?? "").count : 0),
            TugLog.field("model", await mlx.residentId() ?? "none"),
        ]
        // Which classify prompt ran. The two variants ask different questions
        // and are not comparable, so an eval reading these lines has to be able
        // to tell them apart.
        if case .classify(_, _, let grammar) = request.kind {
            fields.append(TugLog.field("grammar", grammar != nil))
        }
        // Which wording answered. A score is a fact about a (pack, profile)
        // pair, so a run that cannot name the profile cannot be compared to
        // anything.
        if let profile {
            fields.append(TugLog.field("profile", profile.name))
        }
        if let threshold = Self.slowThresholdMs[task], elapsed > threshold {
            fields.append(TugLog.field("slow", true))
        }
        // Availability fires on every window focus and performs no inference,
        // so it would drown the file at `info`.
        if case .availability = request.kind {
            TugLog.debug("local_model", "local model request", fields)
        } else {
            TugLog.info("local_model", "local model request", fields)
        }
        return reply
    }

    /// Turnaround past which a task is worth a second look, keyed by task name.
    ///
    /// These are *slow thresholds*, not ceilings: nothing is cancelled here.
    /// The ceilings live on the caller's side in `local_model.rs`, which is the
    /// only side that can observe having given up. Provisional numbers, to be
    /// set from accumulated data.
    private static let slowThresholdMs: [String: Double] = [
        "classify": 1_000,
        "summarize": 3_000,
    ]

    /// What became of a request, in the four shapes the reply can carry.
    ///
    /// `not_resident` is classify's deliberate fast-fail on a cold model and is
    /// not an error; counting it as one would make a working feature look
    /// broken on its first line of every session.
    private static func outcome(of reply: LocalModelReply) -> String {
        if reply.ok { return "ok" }
        switch reply.error {
        case "local model not resident": return "not_resident"
        case "classification did not name a label": return "refused"
        default: return "error"
        }
    }

    private func perform(
        _ request: LocalModelRequest, profile: PromptProfile
    ) async -> LocalModelReply {
        switch request.kind {
        case .availability:
            return LocalModelReply(ok: true, availability: await availability())

        case .prewarm:
            guard let route = await resolveRoute() else {
                return LocalModelReply(ok: true, availability: await availability())
            }
            // Prewarming loads the *assigned* pack, not whichever one happens
            // to rank first — otherwise a user who picked the second model
            // would pay the load twice.
            if let model = route.model {
                try? await route.backend.load(model: model)
            }
            await route.backend.prewarm()
            return LocalModelReply(ok: true, availability: await availability())

        case .classify(let text, let labels, let grammar):
            // Classify runs between Return and the line going somewhere, so it
            // is the one task that must never block on a load. Loading weights
            // takes seconds; the caller's whole budget is smaller than that, so
            // a cold classify cannot produce a usable answer however long it
            // waits — it can only make the person watch a spinner before
            // getting the fallback they were always going to get. Answer "no"
            // at once and start the load, so the wait is spent in the
            // background and the *next* line is right.
            if let model = await resolveRoute()?.model,
               await mlx.residentId() != model.id {
                await mlx.loadInBackground(model: model)
                return .failure("local model not resident")
            }
            // The grammar-bearing variant is chosen by the presence of the
            // documentation, not by a flag: the grader attaches a synopsis
            // exactly when it wants the model to read one. The output budget is
            // unchanged — this adds input tokens only, and bounded ones.
            let instructions = grammar.map {
                profile.classifyWithGrammar.replacingOccurrences(
                    of: LocalModelPrompts.grammarPlaceholder, with: $0)
            } ?? profile.classify
            let job = LocalModelJob(
                instructions: instructions,
                input: text,
                maxTokens: LocalModelPrompts.classifyMaxTokens,
                temperature: 0)
            switch await run(job) {
            case .success(let output):
                guard let verdict = Self.verdict(from: output, labels: labels) else {
                    return .failure("classification did not name a label")
                }
                return LocalModelReply(ok: true, verdict: verdict)
            case .failure(let error):
                return .failure(String(describing: error))
            }

        // The two summarize lanes differ only in their instructions: a live
        // intent in the present tense, a settled stretch in the past.
        case .summarize(let prompt), .summarizeDone(let prompt):
            let retrospective = if case .summarizeDone = request.kind { true } else { false }
            let job = LocalModelJob(
                instructions: retrospective
                    ? profile.summarizeRetrospective
                    : profile.summarize,
                input: prompt,
                maxTokens: LocalModelPrompts.summarizeMaxTokens,
                temperature: 0)
            switch await run(job) {
            case .success(let output):
                return LocalModelReply(ok: true, text: Self.firstLine(output))
            case .failure(let error):
                return .failure(String(describing: error))
            }

        case .generate(let prompt, let maxTokens):
            let job = LocalModelJob(
                instructions: LocalModelPrompts.generate,
                input: prompt,
                maxTokens: maxTokens ?? LocalModelPrompts.generateMaxTokens,
                temperature: 0)
            switch await run(job) {
            case .success(let output):
                return LocalModelReply(ok: true, text: output)
            case .failure(let error):
                return .failure(String(describing: error))
            }
        }
    }

    /// Begin loading the assigned pack now, off the launch path.
    ///
    /// Shell routing answers between Return and the line going somewhere, on a
    /// deadline measured in seconds while a cold load costs more than that. A
    /// model that is merely installed therefore cannot answer the first request
    /// of a session — only a resident one can, and nothing about waiting for
    /// the user to type makes the load any faster. So the load starts at launch
    /// rather than on demand, gated on a feature actually wanting it: with
    /// every switch off, nothing is read from disk.
    func prewarmIfWanted() {
        guard LocalModelConfig.anyTenantEnabled() else { return }
        Task { _ = await handle(LocalModelRequest(requestId: "launch-prewarm", kind: .prewarm)) }
    }

    func availability() async -> LocalModelAvailability {
        if LocalModelConfig.selection() == LocalModelConfig.declined {
            return .unavailable("on-device inference declined")
        }
        guard let route = await resolveRoute() else {
            return .unavailable("no local model available")
        }
        return await route.backend.availability()
    }

    // MARK: Routing

    private struct Route {
        let backend: LocalModelBackend
        let model: InstalledModel?
    }

    /// Pick the backend (and pack, where one applies) that should answer.
    ///
    /// Both halves of the assignment are re-read per request rather than
    /// cached: the selection comes from a live tugbank query, and the pack from
    /// its `tug-manifest.json` on disk. So a selection written by the deck takes
    /// effect on the very next request with no relaunch, and a model deleted out
    /// from under a resident backend stops being chosen immediately instead of
    /// answering indefinitely from memory.
    ///
    /// Every path that resolves to no MLX pack also releases whatever MLX is
    /// holding. Without that, a delete or a switch away would leave multiple
    /// gigabytes of weights resident until the idle timer happened to fire.
    private func resolveRoute() async -> Route? {
        // The app-test harness never has a local model, whatever this machine
        // happens to hold. Each test launches its own app against a fresh empty
        // tugbank, so the selection reads as `auto` and would resolve to an
        // installed pack — several gigabytes of weights into a process that
        // lives for a few seconds, once per test file, and `classify` starts
        // that load in the background even when it answers `not resident`.
        //
        // Answering "no model" is not a special case invented for tests. It is
        // the ordinary state of a machine that has not opted into the download,
        // it is the contract `at0280-local-model-absent` pins, and no app-test
        // can depend on anything else.
        guard !Self.isAppTestHarness else { return nil }

        let selection = LocalModelConfig.selection()
        guard selection != LocalModelConfig.declined else {
            await mlx.unload()
            return nil
        }

        if selection != LocalModelConfig.auto {
            // An explicit pick is honored literally. If that pack isn't on disk
            // — deleted, or still downloading — the answer is "no local model",
            // never a substitute the user didn't choose: with strict
            // enhancement, silence is always safe and a surprise substitution
            // isn't.
            guard let picked = LocalModelStore.installed(id: selection) else {
                await mlx.unload()
                return nil
            }
            return Route(backend: mlx, model: picked)
        }

        // `auto`: installed packs win by catalog rank, and the system model
        // backstops them.
        if let best = LocalModelStore.installed().first {
            return Route(backend: mlx, model: best)
        }
        await mlx.unload()
        for backend in backends where backend !== mlx {
            if await backend.availability().ready {
                return Route(backend: backend, model: nil)
            }
        }
        return nil
    }

    private func run(_ job: LocalModelJob) async -> Result<String, Error> {
        guard let route = await resolveRoute() else {
            return .failure(LocalModelError.noModelInstalled)
        }
        do {
            if let model = route.model {
                try await route.backend.load(model: model)
            }
            return .success(try await route.backend.generate(job))
        } catch {
            return .failure(error)
        }
    }

    // MARK: Output shaping

    /// Match the model's answer to one of the labels the caller asked for.
    ///
    /// The classify contract is prompt-and-parse, not constrained decoding, so
    /// an answer that names no label is a failure rather than a guess — the
    /// caller degrades instead of acting on a coin flip.
    ///
    /// A label matches only as a whole token: the answer is split on everything
    /// that is not a letter or a digit and each piece is compared
    /// case-insensitively. An answer naming two different labels is a failure
    /// too, because nothing in the answer prefers one of them over the other.
    static func verdict(from output: String, labels: [String]) -> String? {
        let wanted = Set(labels.map { $0.lowercased() })
        var found: String?
        for piece in output.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }) {
            let token = String(piece)
            guard wanted.contains(token) else { continue }
            if let found, found != token { return nil }
            found = token
        }
        guard let found else { return nil }
        return labels.first { $0.lowercased() == found }
    }

    static func firstLine(_ text: String) -> String {
        text.split(whereSeparator: \.isNewline).first
            .map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
    }
}
