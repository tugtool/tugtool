# Homebrew formula for tugtool
#
# To install:
#   brew tap tugtool/tugtool https://github.com/tugtool/tugtool
#   brew install tugtool
#
# This formula downloads prebuilt binaries from GitHub Releases.
# The version and checksums are automatically updated by CI on each release.

class Tugtool < Formula
  desc "From ideas to implementation via multi-agent orchestration"
  homepage "https://github.com/tugtool/tugtool"
  version "0.5.16"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugtool-#{version}-macos-arm64.tar.gz"
      # SHA256 ARM64: e7d92c07dd7ff72b4925b9fd5732632b3c90a6e04736b1392dfaeff9f54aa222
      sha256 "e7d92c07dd7ff72b4925b9fd5732632b3c90a6e04736b1392dfaeff9f54aa222"
    else
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugtool-#{version}-macos-x86_64.tar.gz"
      # SHA256 X86_64: 22d38607aaf25a0b68f6a23320f97fccc4b29e062fa5b1ea008840d32ffd6470
      sha256 "22d38607aaf25a0b68f6a23320f97fccc4b29e062fa5b1ea008840d32ffd6470"
    end
  end

  def install
    bin.install "bin/tugtool"

    # Install skills to share directory
    # Skills end up at #{HOMEBREW_PREFIX}/share/tugtool/skills/
    (share/"tugtool").install "share/tugtool/skills"

    # Install agents to share directory
    # Agents end up at #{HOMEBREW_PREFIX}/share/tugtool/agents/
    (share/"tugtool").install "share/tugtool/agents"
  end

  def caveats
    <<~EOS
      Tugtool agents have been installed to:
        #{HOMEBREW_PREFIX}/share/tugtool/agents/

      Claude Code skills have been installed to:
        #{HOMEBREW_PREFIX}/share/tugtool/skills/

      To use /tugtool:plan and /tugtool:implement in your projects, run:
        tugtool setup claude

      This will copy the skills to your project's .claude/skills/ directory.
      You can also run this during `tugtool init` for new projects.
    EOS
  end

  test do
    system "#{bin}/tugtool", "--version"
    system "#{bin}/tugtool", "setup", "claude", "--check"
  end
end
