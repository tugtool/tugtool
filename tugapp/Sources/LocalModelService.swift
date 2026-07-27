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
enum LocalModelPrompts {
    static let classify = """
    You classify what a developer typed into a dev tool. Reply with exactly one \
    word and nothing else: SHELL if the line is a command to run in a terminal \
    shell, or PROMPT if it is a natural-language request to an AI assistant.
    """

    static let summarize = """
    You are the status strip for a live coding session. In ONE short line of at \
    most 12 words, describe what the session is working on overall — the \
    high-level goal, not the latest single action. Output only that line: no \
    preamble, no quotes, no explanation.
    """

    static let generate = """
    You are a concise assistant embedded in a developer tool. Answer directly \
    and briefly, with no preamble.
    """

    static let classifyMaxTokens = 8
    static let summarizeMaxTokens = 48
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
