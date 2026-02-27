import Foundation

/// Restart decision for the supervisor loop
enum RestartDecision {
    case pending
    case restart
    case restartWithBackoff
    case doNotRestart
}

/// Manages the tugcast server process lifecycle with supervisor loop
class ProcessManager {
    private var process: Process?
    private var viteProcess: Process?
    private var sourceTree: String?

    /// Control socket infrastructure
    private var controlListener: ControlSocketListener?
    private var controlConnection: ControlSocketConnection?
    private var controlSocketPath: String {
        NSTemporaryDirectory() + "tugcast-ctl-55255.sock"
    }
    private var childPID: Int32 = 0
    private var restartDecision: RestartDecision = .pending
    private var backoffSeconds: TimeInterval = 0

    /// Callback for ready message (UDS-based): passes auth URL and actual tugcast port
    var onReady: ((String, Int) -> Void)?

    /// Callback for dev_mode_result message
    var onDevModeResult: ((Bool) -> Void)?

    /// Callback for dev_mode errors
    var onDevModeError: ((String) -> Void)?

    /// Resolve the user's login shell PATH so child processes can find tools like tmux.
    /// Mac apps inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) — this gets the real one
    /// by launching the user's actual login shell (from /etc/passwd via dscl) in login-interactive
    /// mode and asking it to print $PATH.
    static let shellPATH: String = {
        // Step 1: Find the user's login shell via Directory Services
        var loginShell = "/bin/zsh" // sensible default
        let dscl = Process()
        dscl.executableURL = URL(fileURLWithPath: "/usr/bin/dscl")
        dscl.arguments = [".", "-read", "/Users/\(NSUserName())", "UserShell"]
        let dsclPipe = Pipe()
        dscl.standardOutput = dsclPipe
        dscl.standardError = Pipe()
        do {
            try dscl.run()
            dscl.waitUntilExit()
            let data = dsclPipe.fileHandleForReading.readDataToEndOfFile()
            if let output = String(data: data, encoding: .utf8) {
                // Output is "UserShell: /bin/zsh\n"
                let parts = output.split(separator: ":", maxSplits: 1)
                if parts.count == 2 {
                    let shell = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
                    if FileManager.default.isExecutableFile(atPath: shell) {
                        loginShell = shell
                    }
                }
            }
        } catch {}

        // Step 2: Launch that shell in login-interactive mode to get the fully-configured PATH.
        // -l = login shell (reads profile/rc files), -i = interactive (reads .bashrc/.zshrc),
        // -c = execute command. This picks up PATH modifications from .zprofile, .bash_profile,
        // .zshrc, .bashrc, /etc/paths, /etc/paths.d/*, path_helper, nix, homebrew, etc.
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: loginShell)
        proc.arguments = ["-lic", "printf '%s' \"$PATH\""]
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = Pipe()
        do {
            try proc.run()
            proc.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            if let path = String(data: data, encoding: .utf8), !path.isEmpty {
                return path
            }
        } catch {}

        // Step 3: Last resort — use whatever the app inherited
        return ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
    }()

    /// Check if tmux is available using the user's shell PATH
    static func checkTmux() -> Bool {
        return which("tmux") != nil
    }

    /// Find a binary on the user's shell PATH
    static func which(_ name: String) -> String? {
        for dir in shellPATH.components(separatedBy: ":") {
            let path = (dir as NSString).appendingPathComponent(name)
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }
        return nil
    }

    /// Resolve tugcast binary path from bundle
    private func resolveTugcastPath() -> URL? {
        guard let executableURL = Bundle.main.executableURL else { return nil }
        let tugcastURL = executableURL.deletingLastPathComponent().appendingPathComponent("tugcast")
        return FileManager.default.fileExists(atPath: tugcastURL.path) ? tugcastURL : nil
    }

    /// Spawn the Vite dev server with the given source tree and tugcast port.
    ///
    /// Vite persists across tugcast restarts — call this only once from the onReady callback.
    /// Uses `--strictPort` so Vite fails fast if port 5173 is occupied rather than
    /// silently binding elsewhere (which would break the auth URL rewrite).
    /// Passes `TUGCAST_PORT` so `vite.config.ts` can proxy `/auth`, `/api`, `/ws` to tugcast.
    func spawnViteDevServer(sourceTree: String, tugcastPort: Int) {
        // Duplication guard: skip if Vite is already running (prevents duplicate dev servers on tugcast restarts)
        if viteProcess?.isRunning == true {
            NSLog("ProcessManager: vite dev server already running, skipping spawn")
            return
        }

        let viteBinaryPath = (sourceTree as NSString).appendingPathComponent("tugdeck/node_modules/.bin/vite")
        guard FileManager.default.isExecutableFile(atPath: viteBinaryPath) else {
            NSLog("ProcessManager: vite binary not found at %@; HMR disabled", viteBinaryPath)
            return
        }

        let viteProc = Process()
        viteProc.executableURL = URL(fileURLWithPath: viteBinaryPath)
        viteProc.arguments = ["--host", "127.0.0.1", "--strictPort"]
        viteProc.currentDirectoryURL = URL(fileURLWithPath: (sourceTree as NSString).appendingPathComponent("tugdeck"))

        var viteEnv = ProcessInfo.processInfo.environment
        viteEnv["PATH"] = ProcessManager.shellPATH
        viteEnv["TUGCAST_PORT"] = String(tugcastPort)
        viteProc.environment = viteEnv

        viteProc.standardOutput = FileHandle.standardOutput
        viteProc.standardError = FileHandle.standardError

        // Handle Vite exit: log warning but do not auto-restart (per risk R01)
        viteProc.terminationHandler = { process in
            NSLog("ProcessManager: vite dev server exited with code %d", process.terminationStatus)
        }

        do {
            try viteProc.run()
            self.viteProcess = viteProc
            NSLog("ProcessManager: vite dev server started (pid %d)", viteProc.processIdentifier)
        } catch {
            NSLog("ProcessManager: failed to start vite dev server: %@", error.localizedDescription)
        }
    }

    /// Poll port 5173 until a TCP connection succeeds, the Vite process exits, or timeout expires.
    ///
    /// Runs the polling loop on a background queue and calls the completion handler
    /// on the main queue with `true` if the port became reachable, `false` on timeout
    /// or if the Vite process died before the port became ready.
    func waitForViteReady(timeout: TimeInterval = 10, completion: @escaping (Bool) -> Void) {
        let viteProc = self.viteProcess
        DispatchQueue.global(qos: .userInitiated).async {
            let deadline = Date().addingTimeInterval(timeout)
            var ready = false
            while Date() < deadline {
                // Abort early if the Vite process already exited (e.g. port conflict with --strictPort)
                if let proc = viteProc, !proc.isRunning {
                    NSLog("ProcessManager: waitForViteReady aborting, vite process exited")
                    break
                }
                var addr = sockaddr_in()
                addr.sin_family = sa_family_t(AF_INET)
                addr.sin_port = UInt16(5173).bigEndian
                addr.sin_addr.s_addr = inet_addr("127.0.0.1")
                let sock = socket(AF_INET, SOCK_STREAM, 0)
                if sock >= 0 {
                    let result = withUnsafePointer(to: &addr) {
                        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                            connect(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                        }
                    }
                    close(sock)
                    if result == 0 { ready = true; break }
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            DispatchQueue.main.async { completion(ready) }
        }
    }

    /// Start tugcast
    func start(sourceTree: String?) {
        self.sourceTree = sourceTree

        // Create control socket listener (persists across child restarts)
        if controlListener == nil {
            do {
                let listener = try ControlSocketListener(path: controlSocketPath)
                listener.onConnection = { [weak self] connection in
                    DispatchQueue.main.async {
                        self?.handleNewConnection(connection)
                    }
                }
                self.controlListener = listener
            } catch {
                NSLog("ProcessManager: failed to create control socket listener: %@", error.localizedDescription)
            }
        }

        startProcess()
    }

    /// Handle new UDS connection from child
    private func handleNewConnection(_ connection: ControlSocketConnection) {
        // Close previous connection (exactly-one-connection policy)
        controlConnection?.close()
        controlConnection = connection

        connection.onMessage = { [weak self] msg in
            self?.handleControlMessage(msg)
        }
        connection.onDisconnect = { [weak self] in
            self?.handleDisconnect()
        }
    }

    /// Handle control message from child
    private func handleControlMessage(_ msg: ControlMessage) {
        // Validate PID
        if let pid = msg.data["pid"] as? Int, Int32(pid) != childPID {
            NSLog("ProcessManager: ignoring message from unknown pid %d (expected %d)", pid, childPID)
            return
        }

        switch msg.type {
        case "ready":
            guard let authURL = msg.data["auth_url"] as? String else {
                NSLog("ProcessManager: ready message missing auth_url")
                return
            }
            let port = msg.data["port"] as? Int ?? 55255
            // Reset backoff on successful ready
            backoffSeconds = 0
            NSLog("ProcessManager: ready (auth_url=%@, port=%d)", authURL, port)
            onReady?(authURL, port)
        case "dev_mode_result":
            let success = msg.data["success"] as? Bool ?? false
            onDevModeResult?(success)
            if !success {
                let errorMessage = msg.data["error"] as? String ?? "Unknown error"
                onDevModeError?(errorMessage)
            }
        case "shutdown":
            guard restartDecision == .pending else {
                NSLog("ProcessManager: ignoring duplicate shutdown signal (decision already set)")
                return
            }
            let reason = msg.data["reason"] as? String ?? "unknown"
            switch reason {
            case "restart", "reset":
                NSLog("ProcessManager: shutdown reason=%@, will restart", reason)
                copyBinaryFromSourceTree()
                restartDecision = .restart
            case "relaunch":
                NSLog("ProcessManager: shutdown reason=relaunch, tugrelaunch handles restart")
                // Stop vite dev server before app exit
                if let proc = viteProcess, proc.isRunning {
                    NSLog("ProcessManager: terminating vite dev server before relaunch")
                    proc.terminate()
                    proc.waitUntilExit()
                }
                viteProcess = nil
                restartDecision = .doNotRestart
            case "error":
                let message = msg.data["message"] as? String ?? ""
                NSLog("ProcessManager: shutdown reason=error, message=%@, will not restart", message)
                restartDecision = .doNotRestart
            default:
                NSLog("ProcessManager: shutdown reason=%@, will not restart", reason)
                restartDecision = .doNotRestart
            }
        default:
            NSLog("ProcessManager: unknown control message type: %@", msg.type)
        }
    }

    /// Handle UDS disconnect
    private func handleDisconnect() {
        if restartDecision == .pending {
            NSLog("ProcessManager: control socket EOF without shutdown message (unexpected death)")
            restartDecision = .restartWithBackoff
        }
    }

    /// Send a control command to tugcast via UDS
    func sendControl(_ action: String, params: [String: Any] = [:]) {
        guard let connection = controlConnection else {
            NSLog("ProcessManager: sendControl skipped, no control connection (action: %@)", action)
            return
        }
        var msg: [String: Any] = ["type": "tell", "action": action]
        for (key, value) in params {
            msg[key] = value
        }
        connection.send(msg)
    }

    /// Send dev_mode control message to tugcast via UDS
    func sendDevMode(enabled: Bool, sourceTree: String?) {
        guard let connection = controlConnection else {
            NSLog("ProcessManager: sendDevMode skipped, no control connection")
            return
        }
        var msg: [String: Any] = ["type": "dev_mode", "enabled": enabled]
        if let path = sourceTree {
            msg["source_tree"] = path
        }
        connection.send(msg)
    }

    /// Stop the tugcast process
    func stop() {
        // Stop vite dev server first
        if let proc = viteProcess, proc.isRunning {
            proc.terminate()
            proc.waitUntilExit()
        }
        viteProcess = nil

        // Graceful shutdown: send shutdown over UDS first
        if let connection = controlConnection {
            connection.send(["type": "shutdown"])
        }

        // Wait up to 5 seconds for process exit
        if let proc = process, proc.isRunning {
            let deadline = Date().addingTimeInterval(5)
            while proc.isRunning && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.1)
            }
            // SIGTERM if still running
            if proc.isRunning {
                proc.terminate()
                let termDeadline = Date().addingTimeInterval(2)
                while proc.isRunning && Date() < termDeadline {
                    Thread.sleep(forTimeInterval: 0.1)
                }
                // SIGKILL if still running
                if proc.isRunning {
                    kill(proc.processIdentifier, SIGKILL)
                    proc.waitUntilExit()
                }
            }
        }
        process = nil

        // Close control connection but keep listener (for potential restart)
        controlConnection?.close()
        controlConnection = nil
    }

    /// Restart tugcast with current settings
    func restart() {
        stop()
        startProcess()
    }

    /// Copy the new tugcast binary from the source tree into the app bundle.
    /// Called during restart to copy the latest built binary into the app bundle.
    /// On failure, logs error and continues (restart proceeds with existing binary).
    private func copyBinaryFromSourceTree() {
        // Read source tree path from UserDefaults
        guard let sourceTreePath = UserDefaults.standard.string(forKey: TugConfig.keySourceTreePath) else {
            NSLog("ProcessManager: copyBinaryFromSourceTree failed: no source tree path in UserDefaults")
            return
        }

        // Source: <sourceTree>/tugcode/target/debug/tugcast
        let sourcePath = (sourceTreePath as NSString)
            .appendingPathComponent("tugcode/target/debug/tugcast")

        // Destination: app bundle's Contents/MacOS/tugcast
        guard let executableURL = Bundle.main.executableURL else {
            NSLog("ProcessManager: copyBinaryFromSourceTree failed: cannot determine bundle executable path")
            return
        }
        let destPath = executableURL.deletingLastPathComponent()
            .appendingPathComponent("tugcast")
            .path

        let fileManager = FileManager.default

        // Verify source exists
        guard fileManager.fileExists(atPath: sourcePath) else {
            NSLog("ProcessManager: copyBinaryFromSourceTree failed: source binary not found at %@", sourcePath)
            return
        }

        do {
            // Remove existing destination if present
            if fileManager.fileExists(atPath: destPath) {
                try fileManager.removeItem(atPath: destPath)
            }

            // Copy new binary
            try fileManager.copyItem(atPath: sourcePath, toPath: destPath)
            NSLog("ProcessManager: copied new tugcast binary from %@ to %@", sourcePath, destPath)
        } catch {
            NSLog("ProcessManager: copyBinaryFromSourceTree failed: %@", error.localizedDescription)
        }
    }

    /// Internal: Start the process and supervise
    private func startProcess() {
        guard let tugcastURL = resolveTugcastPath() else {
            NSLog("ProcessManager: tugcast binary not found in app bundle")
            return
        }

        // Reset restart decision for new spawn
        restartDecision = .pending

        let proc = Process()
        proc.executableURL = tugcastURL

        // Pass the user's full shell PATH so tugcast can find tmux, etc.
        // Mac apps inherit a minimal PATH that doesn't include Homebrew, nix, etc.
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = ProcessManager.shellPATH
        proc.environment = env

        // Build args: only pass flags we have explicit values for.
        // Tugcast has its own CLI defaults (session=cc0, port=55255, dir=.)
        // so we don't duplicate them here.
        var args: [String] = []
        if let dir = sourceTree {
            args += ["--dir", dir]
        }
        args += ["--control-socket", controlSocketPath]
        proc.arguments = args

        proc.standardOutput = FileHandle.standardOutput
        proc.standardError = FileHandle.standardError

        do {
            try proc.run()
            self.process = proc
            self.childPID = proc.processIdentifier

            // Supervisor loop in background
            DispatchQueue.global(qos: .background).async { [weak self] in
                proc.waitUntilExit()
                let exitCode = proc.terminationStatus

                DispatchQueue.main.async {
                    guard let self = self else { return }

                    // If no UDS signal arrived, treat as unexpected death
                    if self.restartDecision == .pending {
                        self.restartDecision = .restartWithBackoff
                    }

                    switch self.restartDecision {
                    case .restart:
                        NSLog("ProcessManager: restarting (immediate)")
                        self.startProcess()
                    case .restartWithBackoff:
                        self.backoffSeconds = self.backoffSeconds == 0 ? 1 : min(self.backoffSeconds * 2, 30)
                        NSLog("ProcessManager: restarting with %.0fs backoff", self.backoffSeconds)
                        DispatchQueue.main.asyncAfter(deadline: .now() + self.backoffSeconds) { [weak self] in
                            self?.startProcess()
                        }
                    case .doNotRestart:
                        NSLog("ProcessManager: tugcast exited with code %d, not restarting", exitCode)
                        self.process = nil
                    case .pending:
                        // Should not happen, but treat as doNotRestart
                        NSLog("ProcessManager: tugcast exited with code %d (no decision)", exitCode)
                        self.process = nil
                    }
                }
            }
        } catch {
            NSLog("ProcessManager: failed to start tugcast: %@", error.localizedDescription)
        }
    }
}
