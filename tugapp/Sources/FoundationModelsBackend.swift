import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// The system language model, where the OS has one.
///
/// This is the only file in the app that knows macOS 26 exists. Everything
/// upstream — the service, tugcast, the deck — talks to `LocalModelBackend`
/// and gets an availability answer, so no other layer carries a version
/// annotation or an `#if`. On Sequoia, `makeIfSupported` returns nil and the
/// backend simply isn't in the list.
enum SystemLanguageModelBackend {
    /// The backend, or nil when this OS has no system model at all.
    static func makeIfSupported() -> LocalModelBackend? {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return FoundationModelsBackend()
        }
        #endif
        return nil
    }
}

#if canImport(FoundationModels)

@available(macOS 26.0, *)
actor FoundationModelsBackend: LocalModelBackend {
    nonisolated var backendId: String { "foundation-models" }

    func availability() async -> LocalModelAvailability {
        switch SystemLanguageModel.default.availability {
        case .available:
            return LocalModelAvailability(ready: true, backend: backendId, reason: nil)
        case .unavailable(let reason):
            // Some of these clear on their own — assets still downloading,
            // for one — so this is re-read per request rather than cached.
            return .unavailable(Self.describe(reason))
        @unknown default:
            return .unavailable("system model unavailable")
        }
    }

    func prewarm() async {
        guard case .available = SystemLanguageModel.default.availability else { return }
        LanguageModelSession().prewarm()
    }

    func generate(_ job: LocalModelJob) async throws -> String {
        guard case .available = SystemLanguageModel.default.availability else {
            throw LocalModelError.noModelInstalled
        }
        let session = LanguageModelSession(instructions: job.instructions)
        do {
            let response = try await session.respond(
                to: job.input,
                options: GenerationOptions(
                    temperature: Double(job.temperature),
                    maximumResponseTokens: job.maxTokens))
            return response.content
        } catch {
            // A guardrail refusal is an ordinary outcome here, not an
            // incident: the caller degrades to whatever it did before.
            throw LocalModelError.generationFailed(String(describing: error))
        }
    }

    private static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason)
        -> String
    {
        switch reason {
        case .deviceNotEligible:
            return "this Mac does not support the system model"
        case .appleIntelligenceNotEnabled:
            return "Apple Intelligence is turned off"
        case .modelNotReady:
            return "the system model is still downloading"
        @unknown default:
            return "system model unavailable"
        }
    }
}

#endif
