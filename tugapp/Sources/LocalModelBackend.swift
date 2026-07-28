import Foundation
import MLX
import MLXLLM
import MLXLMCommon

// MARK: - Vocabulary

/// One unit of local-model work. Both transports — the WKWebView bridge and
/// the tugcast control socket — decode into this same type.
struct LocalModelRequest {
    enum Kind {
        case classify(text: String, labels: [String])
        case summarize(prompt: String)
        case generate(prompt: String, maxTokens: Int?)
        case availability
        case prewarm
    }

    let requestId: String
    let kind: Kind
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

    static func installed(id: String) -> InstalledModel? {
        read(directory: modelsDirectory.appendingPathComponent(id, isDirectory: true))
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

    private var container: ModelContainer?
    private var residentModel: InstalledModel?
    private var lastUse = Date.distantPast
    private var idleTimer: Task<Void, Never>?

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
        guard container != nil || residentModel != nil else { return }
        container = nil
        residentModel = nil
        MLX.GPU.clearCache()
    }

    func generate(_ job: LocalModelJob) async throws -> String {
        guard let container = container else { throw LocalModelError.noModelInstalled }
        let parameters = GenerateParameters(maxTokens: job.maxTokens, temperature: job.temperature)
        lastUse = Date()
        defer { scheduleIdleUnload() }

        do {
            return try await container.perform { context in
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
        } catch {
            throw LocalModelError.generationFailed(String(describing: error))
        }
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
