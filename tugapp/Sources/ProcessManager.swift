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
    private var bunProcess: Process?
    private var sourceTree: String?
    private var devPath: String?
    private let authURLPattern = try! NSRegularExpression(pattern: "tugcast:\\s+(http://\\S+)")

    /// Control socket infrastructure
    private var controlListener: ControlSocketListener?
    private var controlConnection: ControlSocketConnection?
    private var controlSocketPath: String {
        NSTemporaryDirectory() + "tugcast-ctl-7890.sock"
    }
    private var childPID: Int32 = 0
    private var restartDecision: RestartDecision = .pending
    private var backoffSeconds: TimeInterval = 0

    /// Callback for ready message (UDS-based)
    var onReady: ((String) -> Void)?

    /// Resolve the user's login shell PATH so child processes can find tools like tmux and bun.
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

    /// Start tugcast with optional dev mode
    func start(devMode: Bool, sourceTree: String?) {
        self.sourceTree = sourceTree
        self.devPath = devMode ? sourceTree : nil

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
            // Reset backoff on successful ready
            backoffSeconds = 0
            NSLog("ProcessManager: ready (auth_url=%@)", authURL)
            onReady?(authURL)
        case "shutdown":
            guard restartDecision == .pending else {
                NSLog("ProcessManager: ignoring duplicate shutdown signal (decision already set)")
                return
            }
            let reason = msg.data["reason"] as? String ?? "unknown"
            switch reason {
            case "restart", "reset":
                NSLog("ProcessManager: shutdown reason=%@, will restart", reason)
                restartDecision = .restart
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

    /// Stop the tugcast process
    func stop() {
        // Stop bun first
        if let proc = bunProcess, proc.isRunning {
            proc.terminate()
            proc.waitUntilExit()
        }
        bunProcess = nil

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

        // Pass the user's full shell PATH so tugcast can find tmux, bun, etc.
        // Mac apps inherit a minimal PATH that doesn't include Homebrew, nix, etc.
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = ProcessManager.shellPATH
        proc.environment = env

        // Build args: only pass flags we have explicit values for.
        // Tugcast has its own CLI defaults (session=cc0, port=7890, dir=.)
        // so we don't duplicate them here.
        var args: [String] = []
        if let dir = sourceTree {
            args += ["--dir", dir]
        }
        if let devPath = devPath {
            args += ["--dev", devPath]
        }
        args += ["--control-socket", controlSocketPath]
        proc.arguments = args

        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = FileHandle.standardError

        // Read stdout for auth URL
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }

            if let line = String(data: data, encoding: .utf8) {
                // Forward to stdout
                print(line, terminator: "")

                // Check for auth URL
                if let match = self?.authURLPattern.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
                   let urlRange = Range(match.range(at: 1), in: line) {
                    let url = String(line[urlRange])
                    DispatchQueue.main.async {
                        self?.onReady?(url)
                    }
                }
            }
        }

        do {
            try proc.run()
            self.process = proc
            self.childPID = proc.processIdentifier

            // Start bun build --watch if in dev mode
            if let sourceTree = self.sourceTree, self.devPath != nil {
                if let bunPath = ProcessManager.which("bun") {
                    let bunProc = Process()
                    bunProc.executableURL = URL(fileURLWithPath: bunPath)
                    bunProc.arguments = ["build", "src/main.ts", "--outfile=dist/app.js", "--watch"]
                    bunProc.currentDirectoryURL = URL(fileURLWithPath: (sourceTree as NSString).appendingPathComponent("tugdeck"))

                    // Pass same environment with shell PATH
                    var bunEnv = ProcessInfo.processInfo.environment
                    bunEnv["PATH"] = ProcessManager.shellPATH
                    bunProc.environment = bunEnv

                    bunProc.standardOutput = FileHandle.standardOutput
                    bunProc.standardError = FileHandle.standardError

                    // Handle bun exit: log but do not crash
                    bunProc.terminationHandler = { process in
                        NSLog("ProcessManager: bun build --watch exited with code %d", process.terminationStatus)
                    }

                    do {
                        try bunProc.run()
                        self.bunProcess = bunProc
                        NSLog("ProcessManager: bun build --watch started (pid %d)", bunProc.processIdentifier)
                    } catch {
                        NSLog("ProcessManager: failed to start bun build --watch: %@", error.localizedDescription)
                    }
                } else {
                    NSLog("ProcessManager: bun not found on PATH; JS hot-reload disabled")
                }
            }

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
