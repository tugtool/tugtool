# Homebrew formula for tugcode
#
# To install:
#   brew tap tugtool/tugtool https://github.com/tugtool/tugtool
#   brew install tugcode
#
# This formula downloads prebuilt binaries from GitHub Releases.
# The version and checksums are automatically updated by CI on each release.

class Tugcode < Formula
  desc "From ideas to implementation via multi-agent orchestration"
  homepage "https://github.com/tugtool/tugtool"
  version "0.5.20"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugcode-#{version}-macos-arm64.tar.gz"
      # SHA256 ARM64: be94e660f5bcd3db67ad1051d251f85075201d446b8018045e280d5f4f7ce12a
      sha256 "be94e660f5bcd3db67ad1051d251f85075201d446b8018045e280d5f4f7ce12a"
    else
      url "https://github.com/tugtool/tugtool/releases/download/v#{version}/tugcode-#{version}-macos-x86_64.tar.gz"
      # SHA256 X86_64: 0eacca8b18da02b2f6b64f2ad004e6269bc8d52079dec90ab64cc8d2449af4cb
      sha256 "0eacca8b18da02b2f6b64f2ad004e6269bc8d52079dec90ab64cc8d2449af4cb"
    end
  end

  def install
    bin.install "bin/tugcode"

    # Install skills to share directory
    # Skills end up at #{HOMEBREW_PREFIX}/share/tugplug/skills/
    (share/"tugplug").install "share/tugplug/skills"

    # Install agents to share directory
    # Agents end up at #{HOMEBREW_PREFIX}/share/tugplug/agents/
    (share/"tugplug").install "share/tugplug/agents"
  end

  def caveats
    <<~EOS
      Tugcode agents have been installed to:
        #{HOMEBREW_PREFIX}/share/tugplug/agents/

      Claude Code skills have been installed to:
        #{HOMEBREW_PREFIX}/share/tugplug/skills/

      To use the plugin with Claude Code:
        cd /path/to/your-project
        claude --plugin-dir #{HOMEBREW_PREFIX}/share/tugplug

      Then use the skills:
        /tugplug:plan "your idea"
        /tugplug:implement .tugtool/tugplan-N.md
        /tugplug:merge .tugtool/tugplan-N.md
    EOS
  end

  test do
    system "#{bin}/tugcode", "--version"
  end
end
