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

/// The instruction text every task ships with.
///
/// These strings are frozen: they are the exact text the candidate models were
/// scored against in the bring-up spike (`~/bonsai-eval/mlxspike/Sources/mlxspike/main.swift`),
/// and a model earns its place in the catalog by clearing the bars with *this*
/// wording rather than wording tuned to itself. Changing a line here invalidates
/// those scores for every catalog entry at once.
///
/// `classify` was retuned after the routing feature adopted an asymmetric
/// error budget: a wrong SHELL executes a command the user never asked for,
/// so the prompt resolves doubt toward PROMPT, hands the model the one fact
/// the caller has verified (the first word names an installed program), and
/// teaches by paired examples — the same opener labeled both ways — because
/// small quantized models form first-word priors from unpaired examples.
/// The catalog's recorded classify scores refer to the previous wording.
///
/// `summarize` was rewritten three times: first from a sentence prompt to a
/// headline prompt when the PULSE strip promoted the overview to its bright
/// leading run; then again when the headlines that produced turned out to be
/// *labels* — noun phrases with no verb, which is the failure newspaper
/// headline register exists to prevent — which is where the rule the first
/// version never stated came from: start with a verb, in the plain command
/// form. The third rewrite changed the subject rather than the register. The
/// second version asked for the session's overall goal and explicitly not the
/// latest action; a goal is constant, so the headline it produced was constant
/// too — 47 inferences over two live sessions yielded 16 distinct headlines.
/// The current wording asks for the current stretch of work, read against the
/// goal, and says the headline is expected to move. Everything below the
/// opening sentences — the register rules and all eight examples — is
/// byte-identical across the second and third. The catalog's recorded overview
/// scores refer to a wording older than all three.
///
/// The fourth pass changed only the example block, and for a reason that has
/// nothing to do with register: six of the eight examples, and the negative
/// example, described entries in `tests/model-eval/corpus` — they had been
/// drafted from it. Five of the twelve digests therefore had their expected
/// answer sitting verbatim in the instructions, so a model could score the
/// register harness by copying and did: `Author command-line calculator`,
/// `Fix download resume restart` and `Explain Maxwell's equations` came back
/// against exactly the digests they were drawn from, and the label the block
/// held up as the failure to avoid was emitted as an answer. Every example and
/// every proper name here is now absent from every digest, which is the
/// property that makes a score mean something. Keep it that way: an example
/// drawn from the corpus is an answer key, not a demonstration.
///
/// The fifth pass paired the examples with the digests they answer, the shape
/// `classify` had used since its own retune. The unpaired block that preceded it
/// showed eight bare headlines and no inputs, and what a model reads in a list of
/// answers with no questions is available content: 85% of 1123 real headlines
/// opened with `Fix`, and 13% returned a string out of the block itself — the
/// label held up as the failure to avoid among them. Every example now carries a
/// miniature digest in the real section headings and the real `Name(target)`
/// activity form, so the pairing is visible. Two of them exist for particular
/// failures: one whose *right now* section is a tool line, answered by naming
/// what the work is for rather than which command ran; and one whose *right now*
/// section is the newest ask verbatim, which is what `compose_digest` synthesizes
/// when a session has been re-aimed but has not acted yet.
///
/// Those scores are not being refreshed, because a fixed-corpus summary score
/// says nothing about whether the strip works — there is no ground truth for
/// "what is this session working on". What the feature is held to instead:
/// `headline_register_report` in `session_overview.rs`, which imposes the form in
/// Rust whatever the model answers; `ground_headline` beside it, which refuses a
/// headline the digest does not support and is the only check that reads the
/// answer against its own evidence; `tests/model-eval` (`just model-eval`), which
/// scores the register of real headlines against a live instance; and liveness
/// and turnaround (`roadmap/archive/local-model-liveness-brief.md`).
///
/// The freeze rule above still holds, doing a narrower job than it used to claim.
/// It no longer protects the scores recorded in `CatalogEntry.notes` — those refer
/// to wordings four rewrites old and are stale beyond repair. What it protects is
/// that a comparison is a comparison: every pack in one bake-off is scored on
/// identical wording, the same corpus, the same normalizer. Editing one of these
/// strings invalidates the current bake-off and obliges re-running it, which is
/// what makes the edit a deliberate act rather than a drive-by.
///
/// Keeping every example disjoint from `tests/model-eval/corpus` is now load
/// bearing twice over. It is what lets `run.py` call a match a lift, and it is
/// what lets `ground_headline` catch a lifted example with no copy of this list
/// in Rust: disjoint means a lifted example's words are absent from the digest,
/// which the grounding rule already rejects. A rule stated in two places drifts;
/// this way it is stated once, here.
enum LocalModelPrompts {
    static let classify = """
    You label one line a developer typed into a dev tool. Answer with exactly \
    one word and nothing else: SHELL or PROMPT.

    The first word of the line ALWAYS names a real program installed on this \
    machine. The question is never whether the program exists — only whether \
    the person meant to RUN it, or was writing a sentence to an AI assistant \
    that happens to begin with that word.

    SHELL — they meant to run the program. Anything after the first word is an \
    argument to it: a file name, a directory, a flag, a path, or a subcommand. \
    Most shell commands are one to three plain words.

    PROMPT — they were writing to the assistant. The line reads as English \
    prose: it contains an article ("the", "a"), a pronoun ("it", "me", "this"), \
    a preposition ("for", "about", "in"), or it asks a question.

    Decide by what follows the first word. A bare word that could name a file \
    or a directory means SHELL. An English phrase means PROMPT. A wrong SHELL \
    runs a command the person never asked for; a wrong PROMPT costs one \
    keystroke. When in doubt, answer PROMPT.

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
    sort these imports alphabetically => PROMPT
    make this function faster => PROMPT
    build the project for me => PROMPT
    explain this error => PROMPT
    why is the test failing => PROMPT
    read the config and tell me what changed => PROMPT
    """

    static let summarize = """
    You write the headline for a live coding session. The digest comes in \
    labeled sections. Headline the section labeled "What it is doing right \
    now", reading the other sections as context rather than as the subject. \
    If there is no such section, headline the most recent work shown. The \
    work moves on and the headline moves with it.

    Newspaper headline style. The rules are strict:

    START WITH A VERB, in the plain command form: Fix, Author, Draft, Wire, \
    Trace, Port, Audit, Bundle, Salvage, Explain. Pick the verb that fits the \
    work. Not "Fixing", not "Building" — Fix, Build.
    SIX WORDS MAXIMUM. Four is better than six.
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
    What the user asked for:
    - the keyboard shortcuts are fighting each other, sort it out
    What it is doing right now:
    - Read(keymap.ts)
    - Edit(keymap.ts)
    HEADLINE:
    Resolve keymap shortcut conflicts

    DIGEST:
    What the session has been doing:
    - Read(reconnect.ts)
    - said: Every dropped socket retries at once, so the server sees a storm.
    What it is doing right now:
    - Edit(reconnect.ts)
    HEADLINE:
    Throttle websocket reconnect storm

    DIGEST:
    What the user asked for:
    - the badge count stays wrong after things are marked read
    What it is doing right now:
    - Bash(bun test notification-badge)
    HEADLINE:
    Fix stale notification badge count

    DIGEST:
    What the session has been doing:
    - Read(/opt/render/glyph-atlas/atlas.rs)
    - said: The atlas reallocates on every resize instead of reusing pages.
    What it is doing right now:
    - Edit(/opt/render/glyph-atlas/atlas.rs)
    HEADLINE:
    Prune glyph atlas reallocation

    DIGEST:
    What the user asked for:
    - add the image paste path
    - forget that, undo is coalescing far too much
    What it is doing right now:
    - forget that, undo is coalescing far too much
    HEADLINE:
    Tighten undo coalescing

    DIGEST:
    What the user asked for:
    - walk me through how oauth refresh tokens rotate
    What it is doing right now:
    - said: A refresh token is exchanged once and replaced, so replay fails.
    HEADLINE:
    Explain oauth refresh token rotation

    Output only the headline.
    """

    static let generate = """
    You are a concise assistant embedded in a developer tool. Answer directly \
    and briefly, with no preamble.
    """

    static let classifyMaxTokens = 8
    /// A headline budget, not a sentence budget. The strip clips at 56
    /// characters (`MAX_HEADLINE_CHARS` in `session_overview.rs`), and 24
    /// tokens comfortably covers that — enough that a legal headline is never
    /// truncated mid-word, few enough that the model cannot spend latency
    /// generating text the strip will immediately discard.
    static let summarizeMaxTokens = 24
    static let generateMaxTokens = 256
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
        let reply = await perform(request)
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

    private func perform(_ request: LocalModelRequest) async -> LocalModelReply {
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

        case .classify(let text, let labels):
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
            let job = LocalModelJob(
                instructions: LocalModelPrompts.classify,
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

        case .summarize(let prompt):
            let job = LocalModelJob(
                instructions: LocalModelPrompts.summarize,
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
