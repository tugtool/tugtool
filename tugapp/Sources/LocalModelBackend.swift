import Foundation
import MLX
import MLXLLM
import MLXLMCommon

// MARK: - Vocabulary

/// One unit of local-model work. Both transports — the WKWebView bridge and
/// the tugcast control socket — decode into this same type.
struct LocalModelRequest {
    enum Kind {
        /// `grammar` is the program's own condensed documentation, supplied by
        /// the command-grammar grader when it could not confirm the line
        /// against it. Present selects the documentation-bearing prompt;
        /// absent is the base classify prompt, unchanged.
        case classify(text: String, labels: [String], grammar: String?)
        case summarize(prompt: String)
        /// A settled session's retrospective — the same digest shape answered in
        /// the past tense, once the stretch of work has come to rest.
        case summarizeDone(prompt: String)
        case generate(prompt: String, maxTokens: Int?)
        case availability
        case prewarm

        /// The task name the instrumentation records.
        var task: String {
            switch self {
            case .classify: return "classify"
            case .summarize: return "summarize"
            case .summarizeDone: return "summarize_done"
            case .generate: return "generate"
            case .availability: return "availability"
            case .prewarm: return "prewarm"
            }
        }

        /// Whether this kind answers from a prompt profile. `availability` and
        /// `prewarm` perform no inference and carry no instructions, and
        /// resolving a profile for them would put a route lookup on the path
        /// that fires on every window focus.
        var usesInstructions: Bool {
            switch self {
            case .classify, .summarize, .summarizeDone, .generate: return true
            case .availability, .prewarm: return false
            }
        }

        /// How much text the model was given, which is the input side of any
        /// turnaround the logs later show.
        var inputChars: Int {
            switch self {
            case .classify(let text, _, let grammar): return text.count + (grammar?.count ?? 0)
            case .summarize(let prompt), .summarizeDone(let prompt): return prompt.count
            case .generate(let prompt, _): return prompt.count
            case .availability, .prewarm: return 0
            }
        }
    }

    /// How the request reached the service.
    ///
    /// The request itself cannot know this and the caller can, so it is set at
    /// the call site. It is the fact that makes the deck's shell-routing
    /// classify visible at all: that traffic goes over the WebKit bridge
    /// straight into Swift and never touches tugcast, so tugcast's own logs can
    /// never account for it.
    enum Transport: String {
        /// The deck's `localModel` `WKScriptMessageHandler` (`MainWindow`).
        case bridge
        /// tugcast's control socket (`ProcessManager`).
        case socket
        /// The app asking itself — the launch prewarm has no caller waiting.
        case local
    }

    let requestId: String
    let kind: Kind
    var transport: Transport = .local
}

/// The answer to a `LocalModelRequest`, shaped so either transport can
/// serialize it directly.
struct LocalModelReply {
    var ok: Bool
    var verdict: String?
    var text: String?
    var availability: LocalModelAvailability?
    var error: String?

    static func failure(_ message: String) -> LocalModelReply {
        LocalModelReply(ok: false, error: message)
    }

    init(ok: Bool,
         verdict: String? = nil,
         text: String? = nil,
         availability: LocalModelAvailability? = nil,
         error: String? = nil) {
        self.ok = ok
        self.verdict = verdict
        self.text = text
        self.availability = availability
        self.error = error
    }
}

/// Whether on-device inference can answer right now, and by what route.
struct LocalModelAvailability {
    var ready: Bool
    var backend: String?
    var reason: String?

    static func unavailable(_ reason: String) -> LocalModelAvailability {
        LocalModelAvailability(ready: false, backend: nil, reason: reason)
    }
}

/// A single generation, already resolved to instructions + input + caps.
/// Backends receive this rather than the task-shaped request so they carry
/// no knowledge of what a task means.
struct LocalModelJob {
    var instructions: String
    var input: String
    var maxTokens: Int
    var temperature: Float
}

enum LocalModelError: Error, CustomStringConvertible {
    case noModelInstalled
    case loadFailed(String)
    case generationFailed(String)

    var description: String {
        switch self {
        case .noModelInstalled:
            return "no local model installed"
        case .loadFailed(let detail):
            return "model load failed: \(detail)"
        case .generationFailed(let detail):
            return "generation failed: \(detail)"
        }
    }
}

// MARK: - Backend protocol

/// A source of on-device inference.
///
/// Backends differ in what they need before they can answer: MLX loads a
/// downloaded pack from disk, FoundationModels talks to a system model that
/// is either there or isn't. The protocol carries both shapes; the defaults
/// below let a backend with nothing to load ignore the residency calls.
protocol LocalModelBackend: AnyObject {
    /// Wire identifier: `"mlx"` or `"foundation-models"`.
    var backendId: String { get }

    func availability() async -> LocalModelAvailability
    func load(model: InstalledModel) async throws
    func unload() async
    func prewarm() async
    func generate(_ job: LocalModelJob) async throws -> String
}

extension LocalModelBackend {
    func load(model: InstalledModel) async throws {}
    func unload() async {}
    func prewarm() async {}
}

// MARK: - Installed packs

/// A model pack on disk, as described by its `tug-manifest.json` stamp.
struct InstalledModel: Equatable {
    let id: String
    let directory: URL
    let backendId: String
    let catalogRank: Int
    let contextWindow: Int
    let revision: String
}

/// Reads the models directory tugcast writes into.
///
/// The stamp is the presence probe: a directory without a readable
/// `tug-manifest.json` is a partial download, not an installed model. The
/// catalog itself lives in tugcast and is never mirrored here — `catalogRank`
/// travels in the stamp precisely so this side can order models without it.
enum LocalModelStore {
    static let stampName = "tug-manifest.json"

    static var modelsDirectory: URL {
        InstanceConfig.sharedDataDir.appendingPathComponent("models", isDirectory: true)
    }

    /// Every installed pack, ordered by catalog rank (0 first).
    static func installed() -> [InstalledModel] {
        let root = modelsDirectory
        let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        return names
            .filter { !$0.hasPrefix(".") }
            .compactMap { read(directory: root.appendingPathComponent($0, isDirectory: true)) }
            .sorted { ($0.catalogRank, $0.id) < ($1.catalogRank, $1.id) }
    }

    private static func read(directory: URL) -> InstalledModel? {
        let stamp = directory.appendingPathComponent(stampName)
        guard let data = try? Data(contentsOf: stamp),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = object["id"] as? String, !id.isEmpty
        else { return nil }
        return InstalledModel(
            id: id,
            directory: directory,
            backendId: (object["backend"] as? String) ?? "mlx",
            catalogRank: (object["catalog_rank"] as? Int) ?? Int.max,
            contextWindow: (object["context_window"] as? Int) ?? 0,
            revision: (object["hf_revision"] as? String) ?? "")
    }
}

// MARK: - MLX backend

/// Runs downloaded MLX packs through stock MLXLLM.
///
/// An actor because residency is single-flight by design: one model resident,
/// one generation at a time, loads serialized against requests. Concurrent
/// callers queue rather than racing two multi-gigabyte loads.
actor MLXLocalModelBackend: LocalModelBackend {
    nonisolated var backendId: String { "mlx" }

    /// How long a resident model survives with no requests before its weights
    /// are released.
    private static let idleUnloadSeconds: TimeInterval = 300

    /// Upper bound on MLX's freed-buffer cache. MLX's cache limit defaults to
    /// the device memory limit, so without an explicit bound every buffer MLX
    /// frees — including the outgoing pack's full weights on a model swap —
    /// stays resident in the process indefinitely.
    private static let gpuCacheLimitBytes = 256 * 1024 * 1024

    private var container: ModelContainer?
    private var residentModel: InstalledModel?
    private var lastUse = Date.distantPast
    private var idleTimer: Task<Void, Never>?
    /// The in-flight generation, if any. `unload()` drains it: the running
    /// generation holds a strong reference to the outgoing container, and
    /// swapping models under it would keep two packs' weights alive at once.
    private var inflight: Task<String, Error>?

    init() {
        MLX.GPU.set(cacheLimit: Self.gpuCacheLimitBytes)
    }

    /// Disk is the authority, even when a model is already resident: a pack
    /// deleted under a loaded container must read as gone immediately, not stay
    /// "ready" on the strength of weights that no longer have a stamp behind
    /// them.
    func availability() async -> LocalModelAvailability {
        guard !LocalModelStore.installed().isEmpty else {
            await unload()
            return .unavailable("no local model installed")
        }
        return LocalModelAvailability(ready: true, backend: backendId, reason: nil)
    }

    /// The pack whose weights are in memory right now, or nil.
    ///
    /// Residency is not the same question as availability: a pack can be
    /// installed, selected, and still take seconds to answer because nothing
    /// has paged it in yet. Callers on a deadline ask this first.
    func residentId() -> String? {
        container == nil ? nil : residentModel?.id
    }

    /// Begin loading without waiting for it. For callers who cannot block on a
    /// load but want the next request to find the weights already there.
    func loadInBackground(model: InstalledModel) {
        Task { try? await self.load(model: model) }
    }

    func load(model: InstalledModel) async throws {
        if residentModel == model, container != nil { return }
        // Switching models releases the outgoing weights first — two packs
        // resident at once would double a multi-gigabyte footprint for the
        // duration of the load.
        if container != nil { await unload() }
        do {
            container = try await loadModelContainer(directory: model.directory)
            residentModel = model
            lastUse = Date()
            // Arm the idle unload here, not only after a generation. The launch
            // prewarm loads the pack without generating, so a session that
            // never reaches the model would otherwise hold its weights — a
            // multi-gigabyte resident set — for the life of the process.
            scheduleIdleUnload()
            Self.logGpu("loaded \(model.id)")
        } catch {
            container = nil
            residentModel = nil
            throw LocalModelError.loadFailed(String(describing: error))
        }
    }

    /// Release the resident weights. Called on every request that resolves to
    /// no pack, so the nothing-loaded case returns before touching the GPU
    /// cache.
    func unload() async {
        idleTimer?.cancel()
        idleTimer = nil
        // Drain any in-flight generation before releasing: it holds the
        // outgoing container, so unloading under it would let a subsequent
        // load bring a second pack's weights up while the first is still
        // alive. Draining also means the weights actually deallocate before
        // `clearCache()` runs, instead of landing in the cache after it.
        if let inflight = inflight {
            _ = try? await inflight.value
        }
        guard container != nil || residentModel != nil else { return }
        container = nil
        residentModel = nil
        MLX.GPU.clearCache()
        Self.logGpu("unload")
    }

    func generate(_ job: LocalModelJob) async throws -> String {
        guard let container = container else { throw LocalModelError.noModelInstalled }
        let parameters = GenerateParameters(maxTokens: job.maxTokens, temperature: job.temperature)
        lastUse = Date()

        let work = Task {
            try await container.perform { context in
                // `enable_thinking` goes to every pack's chat template, not
                // just the hybrid-reasoning ones — templates that don't
                // declare it ignore it, and it is what stops a reasoning pack
                // from spending its whole token cap inside `<think>`.
                let input = try await context.processor.prepare(
                    input: UserInput(
                        chat: [.system(job.instructions), .user(job.input)],
                        additionalContext: ["enable_thinking": false]))
                let cache = context.model.newCache(parameters: parameters)
                var output = ""
                for await item in try MLXLMCommon.generate(
                    input: input, cache: cache, parameters: parameters, context: context)
                {
                    if let chunk = item.chunk { output += chunk }
                }
                Stream.gpu.synchronize()
                return output
            }
        }
        inflight = work
        defer {
            if inflight == work { inflight = nil }
            scheduleIdleUnload()
        }
        do {
            return try await work.value
        } catch {
            throw LocalModelError.generationFailed(String(describing: error))
        }
    }

    /// One-line GPU memory report, for attributing host footprint.
    private static func logGpu(_ label: String) {
        let s = MLX.GPU.snapshot()
        NSLog(
            "MLXLocalModelBackend: %@ — active %.1f MB, cache %.1f MB, peak %.1f MB",
            label,
            Double(s.activeMemory) / 1_048_576,
            Double(s.cacheMemory) / 1_048_576,
            Double(s.peakMemory) / 1_048_576)
    }

    /// Release the weights once the model has gone unused for long enough.
    private func scheduleIdleUnload() {
        idleTimer?.cancel()
        let deadline = Self.idleUnloadSeconds
        idleTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(deadline * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.unloadIfIdle()
        }
    }

    private func unloadIfIdle() async {
        guard Date().timeIntervalSince(lastUse) >= Self.idleUnloadSeconds else { return }
        await unload()
    }
}
