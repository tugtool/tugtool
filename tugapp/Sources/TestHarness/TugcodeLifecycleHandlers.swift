#if DEBUG
import Foundation

// MARK: - TugcodeLifecycleHandlers
//
// DEBUG-only handlers for the harness-owned tugcode subprocess
// (parent harness plan #step-5; selection plan Pass 7A). Spawns and
// terminates a single tugcode child process that the in-app test
// harness controls directly — separate from production's
// tugcast → tugcode-per-AI-session spawn path.
//
// ## Why a harness-owned tugcode
//
// In production, tugcast spawns a fresh tugcode per AI session with
// stream-json piped through stdin/stdout. Tests need a deterministic
// spawn point so they can:
//
//   1. Verify EM-card lifecycle paths run end-to-end against a real
//      tugcode (Step 7's `_smoke-em.test.ts`).
//   2. Drive the stream-json transcript via a controlled pipe (Step
//      6's `--stub-transcript=<fd>` mode).
//
// Production tugcast continues to spawn tugcode on session-start as
// today; the harness-owned process is independent of that path. The
// two never overlap because tests don't initiate AI sessions —
// tugcast's per-session spawn never fires under the harness.
//
// ## Lifecycle
//
// `start(...)` reads the binary path from opts.binaryPath OR the
// `TUGAPP_TUGCODE_BINARY` env var, spawns it via `Process` with a
// held-open stdin pipe (tugcode shuts down on stdin EOF — see
// `tugcode/src/main.ts`'s "stdin closed, shutting down" path), and
// routes stdout/stderr to the supplied log file (default
// `/dev/null`). Returns `{ pid }` on success.
//
// `stop()` sends SIGTERM, waits up to 2000ms for graceful exit,
// SIGKILL on timeout. Idempotent — calling on a non-running handler
// is a no-op.
//
// At most one tugcode child per harness connection. The
// `TestHarnessConnection.close()` call invokes `stop()` so a
// disconnect (or Tug.app graceful quit) doesn't leak a zombie.
//
// ## Step 5 scope
//
// This file lands the spawn/kill plumbing only. The
// `--stub-transcript=<fd>` flag and the harness-side
// `seedTugcodeTranscript` fd write are Step 6 work; the wire
// already accepts a `mode: "stub" | "live"` opt for forward
// compatibility, but in Step 5 both modes spawn the same way (no
// extra flags passed to tugcode). The Step 6 commit will add the
// flag-construction branch on `mode`.

// MARK: - Errors

enum TugcodeLifecycleError: Error, CustomStringConvertible {
    case alreadyRunning
    case missingBinaryPath
    case binaryNotFound(String)
    case spawnFailed(String)
    case logOpenFailed(String, String)

    var description: String {
        switch self {
        case .alreadyRunning:
            return "tugcode subprocess is already running; call stopTugcode() first"
        case .missingBinaryPath:
            return "no tugcode binary path supplied (opts.binaryPath unset and TUGAPP_TUGCODE_BINARY env var unset)"
        case .binaryNotFound(let path):
            return "tugcode binary not found at \"\(path)\""
        case .spawnFailed(let reason):
            return "tugcode subprocess spawn failed: \(reason)"
        case .logOpenFailed(let path, let reason):
            return "tugcode log file at \"\(path)\" could not be opened: \(reason)"
        }
    }

    /// The error `name` reported over the RPC wire. Matched client-
    /// side in `tests/in-app/_harness/rpc.ts`'s `translateError`.
    var wireName: String {
        switch self {
        case .alreadyRunning, .missingBinaryPath, .binaryNotFound,
             .spawnFailed, .logOpenFailed:
            return "TugcodeLaunchError"
        }
    }
}

// MARK: - Handler

final class TugcodeLifecycleHandlers {

    /// Default grace window between SIGTERM and SIGKILL on `stop()`.
    /// Mirrors the harness plan's `[D04]` teardown contract.
    private static let terminateGraceMs: Int = 2000

    /// The currently-running tugcode subprocess, or nil when no
    /// child is alive. At most one per handler instance (and the
    /// handler is per-connection).
    private var process: Process?

    /// Pipe whose write-end we hold so tugcode's stdin stays open.
    /// tugcode treats stdin EOF as a shutdown signal (see
    /// `tugcode/src/main.ts` "stdin closed, shutting down"). Step
    /// 6 will write transcript bytes through this pipe; Step 5
    /// just holds it open.
    private var stdinPipe: Pipe?

    /// File handle for stdout/stderr capture. Closed during `stop()`.
    private var logFileHandle: FileHandle?

    /// Spawn a tugcode subprocess.
    ///
    /// - Parameters:
    ///   - mode: "stub" or "live". In Step 5 both modes spawn the
    ///     same way (no extra flags). Step 6 adds the
    ///     `--stub-transcript=<fd>` branch on `mode == "stub"`.
    ///   - binaryPath: absolute path to the tugcode executable.
    ///     When nil, falls back to `TUGAPP_TUGCODE_BINARY` env var.
    ///   - logFilePath: absolute path that tugcode's stdout +
    ///     stderr stream into. When nil, output goes to `/dev/null`.
    /// - Returns: pid of the spawned process.
    /// - Throws: `TugcodeLifecycleError` on any failure.
    func start(
        mode: String,
        binaryPath: String?,
        logFilePath: String?,
    ) throws -> Int32 {
        if process != nil {
            throw TugcodeLifecycleError.alreadyRunning
        }

        let resolvedPath = binaryPath
            ?? ProcessInfo.processInfo.environment["TUGAPP_TUGCODE_BINARY"]
        guard let binPath = resolvedPath, !binPath.isEmpty else {
            throw TugcodeLifecycleError.missingBinaryPath
        }
        guard FileManager.default.fileExists(atPath: binPath) else {
            throw TugcodeLifecycleError.binaryNotFound(binPath)
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: binPath)
        // Args: empty in Step 5. Step 6 will compose
        // `["--stub-transcript=\(fd)"]` when mode == "stub".
        _ = mode
        proc.arguments = []

        // Hold tugcode's stdin open. The Pipe's writeFileHandle
        // stays in our struct — when we eventually drop it (via
        // stop()), tugcode receives EOF and shuts down. Without
        // this, tugcode would inherit the harness process's stdin
        // (the launchd session's null stdin) and exit immediately.
        let stdin = Pipe()
        proc.standardInput = stdin

        // stdout/stderr → log file or /dev/null. Use one shared
        // FileHandle for both streams so they interleave in source
        // order.
        let logHandle: FileHandle
        if let logPath = logFilePath, !logPath.isEmpty {
            // Truncate-on-open per parity with `pumpToLog` in the
            // TS harness.
            FileManager.default.createFile(atPath: logPath, contents: nil)
            do {
                logHandle = try FileHandle(forWritingTo: URL(fileURLWithPath: logPath))
            } catch {
                throw TugcodeLifecycleError.logOpenFailed(logPath, "\(error)")
            }
        } else {
            // Open /dev/null. Foundation does not expose
            // FileHandle(forWritingAtPath:), so synthesize one via
            // open(2).
            let fd = open("/dev/null", O_WRONLY)
            if fd < 0 {
                throw TugcodeLifecycleError.logOpenFailed("/dev/null", "open() returned \(fd)")
            }
            logHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        }
        proc.standardOutput = logHandle
        proc.standardError = logHandle

        do {
            try proc.run()
        } catch {
            // Best-effort: close the log handle we just opened.
            try? logHandle.close()
            throw TugcodeLifecycleError.spawnFailed("\(error)")
        }

        self.process = proc
        self.stdinPipe = stdin
        self.logFileHandle = logHandle

        return proc.processIdentifier
    }

    /// Terminate the currently-running tugcode subprocess. Idempotent —
    /// safe to call when no process is running.
    func stop() {
        guard let proc = process else { return }

        // Closing the stdin pipe write-end gives tugcode a clean
        // shutdown opportunity (its main loop notices stdin EOF
        // and exits gracefully). SIGTERM is the harder backup;
        // both happen so even a non-cooperative build dies.
        if let pipe = stdinPipe {
            try? pipe.fileHandleForWriting.close()
        }

        if proc.isRunning {
            proc.terminate()
            // Poll for graceful exit up to terminateGraceMs.
            let deadline = Date().addingTimeInterval(
                Double(Self.terminateGraceMs) / 1000.0,
            )
            while proc.isRunning && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.01)
            }
            if proc.isRunning {
                // SIGKILL bypass — Process doesn't expose this
                // directly, so use the underlying pid.
                kill(proc.processIdentifier, SIGKILL)
                proc.waitUntilExit()
            }
        }

        try? logFileHandle?.close()

        self.process = nil
        self.stdinPipe = nil
        self.logFileHandle = nil
    }
}
#endif
