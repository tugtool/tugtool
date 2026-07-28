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
}

/// The instruction text every task ships with.
///
/// These strings are frozen: they are the exact text the candidate models were
/// scored against in the bring-up spike (`~/bonsai-eval/mlxspike/Sources/mlxspike/main.swift`),
/// and a model earns its place in the catalog by clearing the bars with *this*
/// wording rather than wording tuned to itself. Changing a line here invalidates
/// those scores for every catalog entry at once.
///
/// `summarize` was rewritten from a sentence prompt to a headline prompt when
/// the PULSE strip promoted the overview to its bright leading run. The
/// catalog's recorded overview scores therefore refer to the *previous*
/// wording, and are not being refreshed: scoring a summary against a fixed
/// corpus says nothing about whether the strip works, and there is no ground
/// truth for "what is this session working on" to score against. What the
/// feature is actually held to is the `headline_register` normalizer in
/// `session_overview.rs`, which guarantees the form in Rust whatever the model
/// answers, plus liveness and turnaround (`roadmap/local-model-liveness-brief.md`).
///
/// The freeze rule above still holds and is doing a different job: it keeps
/// catalog entries comparable on identical wording, and it makes editing one of
/// these strings a deliberate act rather than a drive-by.
enum LocalModelPrompts {
    static let classify = """
    You label one line a developer typed into a dev tool. Answer with exactly \
    one word and nothing else: SHELL or PROMPT.

    The person is working at a developer's command line. They run shell \
    commands constantly, and most of those are short — one to three words, \
    often with no flags or punctuation at all. They also ask an AI assistant \
    for help, writing in ordinary English sentences.

    The first word of the line is ALWAYS the name of a real program installed \
    on this machine. You are never being asked whether the program exists. You \
    are being asked whether the person meant to RUN it, or was writing a \
    sentence that happens to begin with that word.

    SHELL — they meant to run the program. Anything after the first word is an \
    argument to it: a file name, a directory, a flag, a path, or a subcommand. \
    A bare argument with no punctuation is still an argument. Lines of one or \
    two words are the most common kind of shell command.

    PROMPT — they were writing to the assistant. The line reads as English \
    prose: it contains an article ("the", "a"), a pronoun ("it", "me", "this"), \
    a preposition ("for", "about", "in"), or it asks a question. It describes \
    work to be done rather than naming a program and its argument.

    Decide by what follows the first word. One bare word that could name a file \
    or a directory means SHELL. Several words forming an English phrase mean \
    PROMPT.

    pwd => SHELL
    cd tugrust => SHELL
    rg TODO src => SHELL
    kill 4821 => SHELL
    wc report => SHELL
    du node_modules => SHELL
    npm run build => SHELL
    build the project for me => PROMPT
    explain this error => PROMPT
    why is the test failing => PROMPT
    add a dark mode toggle => PROMPT
    read the config and tell me what changed => PROMPT
    """

    static let summarize = """
    You write the headline for a live coding session. Name what the session is \
    working on overall — the high-level goal, not the latest single action — \
    in newspaper headline style. Rules: at most 8 words; no "the", "a", or \
    "an"; never begin with "Working on", "Trying to", "Currently", or any \
    other filler; no trailing period; no quotes. Name the work, do not describe \
    the act of working on it. Examples: "Hunting focus drift in Lens", \
    "Wiring overview cadence gate", "Fixing download resume restart-from-zero". \
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

    func handle(_ request: LocalModelRequest) async -> LocalModelReply {
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
    static func verdict(from output: String, labels: [String]) -> String? {
        let upper = output.uppercased()
        for label in labels where upper.contains(label.uppercased()) {
            return label
        }
        return nil
    }

    static func firstLine(_ text: String) -> String {
        text.split(whereSeparator: \.isNewline).first
            .map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
    }
}
