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
  version "0.5.18"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugtool-#{version}-macos-arm64.tar.gz"
      # SHA256 ARM64: d9c39155ee924c6dc39a91b313d78dcc813d8a62f85c5c70ffcbd98fd998e65a
      sha256 "d9c39155ee924c6dc39a91b313d78dcc813d8a62f85c5c70ffcbd98fd998e65a"
    else
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugtool-#{version}-macos-x86_64.tar.gz"
      # SHA256 X86_64: e4362e8c8850483e7b703f1905e1b68970a5c11301bf9ebba4c942ff584892ba
      sha256 "e4362e8c8850483e7b703f1905e1b68970a5c11301bf9ebba4c942ff584892ba"
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
