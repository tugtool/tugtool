# Homebrew formula for tug
#
# To install:
#   brew tap specks-dev/tug https://github.com/specks-dev/tug
#   brew install tug
#
# This formula downloads prebuilt binaries from GitHub Releases.
# The version and checksums are automatically updated by CI on each release.

class Tug < Formula
  desc "From ideas to implementation via multi-agent orchestration"
  homepage "https://github.com/specks-dev/tug"
  version "0.2.29"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/specks-dev/tug/releases/download/v#{version}/tug-#{version}-macos-arm64.tar.gz"
      # SHA256 ARM64: 668921106e9261853d4e7339fb27b73681148a4dcf64c6234dfc49e9ade457f8
      sha256 "668921106e9261853d4e7339fb27b73681148a4dcf64c6234dfc49e9ade457f8"
    else
      url "https://github.com/specks-dev/tug/releases/download/v#{version}/tug-#{version}-macos-x86_64.tar.gz"
      # SHA256 X86_64: bc17c3b9fe2637ca99415acbaba72de1beba9d4bdfccb1245f300a40421b2d2d
      sha256 "bc17c3b9fe2637ca99415acbaba72de1beba9d4bdfccb1245f300a40421b2d2d"
    end
  end

  def install
    bin.install "bin/tug"

    # Install skills to share directory
    # Skills end up at #{HOMEBREW_PREFIX}/share/tug/skills/
    (share/"tug").install "share/tug/skills"

    # Install agents to share directory
    # Agents end up at #{HOMEBREW_PREFIX}/share/tug/agents/
    (share/"tug").install "share/tug/agents"
  end

  def caveats
    <<~EOS
      Tug agents have been installed to:
        #{HOMEBREW_PREFIX}/share/tug/agents/

      Claude Code skills have been installed to:
        #{HOMEBREW_PREFIX}/share/tug/skills/

      To use /tugtool:planner and /tugtool:implementer in your projects, run:
        tugtool setup claude

      This will copy the skills to your project's .claude/skills/ directory.
      You can also run this during `tugtool init` for new projects.
    EOS
  end

  test do
    system "#{bin}/tug", "--version"
    system "#{bin}/tug", "setup", "claude", "--check"
  end
end
