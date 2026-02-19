import Foundation

/// Manages the tugcast server process lifecycle with supervisor loop
class ProcessManager {
    private var process: Process?
    private var sourceTree: String?
    private var devPath: String?
    private let authURLPattern = try! NSRegularExpression(pattern: "tugcast:\\s+(http://\\S+)")

    /// Callback for auth URL extraction
    var onAuthURL: ((String) -> Void)?

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
        self.devPath = devMode ? sourceTree.map { ($0 as NSString).appendingPathComponent(TugConfig.tugdeckDistRel) } : nil
        startProcess()
    }

    /// Stop the tugcast process
    func stop() {
        if let proc = process, proc.isRunning {
            proc.terminate()
            proc.waitUntilExit()
        }
        process = nil
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
                        self?.onAuthURL?(url)
                    }
                }
            }
        }

        do {
            try proc.run()
            self.process = proc

            // Supervisor loop in background
            DispatchQueue.global(qos: .background).async { [weak self] in
                proc.waitUntilExit()
                let exitCode = proc.terminationStatus

                DispatchQueue.main.async {
                    guard let self = self else { return }

                    switch exitCode {
                    case TugConfig.exitRestart:
                        NSLog("ProcessManager: restart requested (exit %d)", exitCode)
                        self.restart()
                    case TugConfig.exitReset:
                        NSLog("ProcessManager: reset requested (exit %d)", exitCode)
                        self.restart()
                    default:
                        NSLog("ProcessManager: tugcast exited with code %d", exitCode)
                        self.process = nil
                    }
                }
            }
        } catch {
            NSLog("ProcessManager: failed to start tugcast: %@", error.localizedDescription)
        }
    }
}
