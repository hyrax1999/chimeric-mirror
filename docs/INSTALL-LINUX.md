# Linux installation

This preview has a checked Linux x64 export and a signed Linux x64 runtime binary. It is a technical preview for amd64 (`x86_64`) Linux. Linux arm64 has no supplied binary. The complete Linux harness, runtime sandbox isolation, and Docker path remain unverified, so this guide does not present Docker or a privileged-container fallback as a supported install.

## Requirements

Install these on the host that will run the workspace:

- Linux x86_64 with a compatible glibc.
- Python 3.
- `socat`.
- `bubblewrap` (`bwrap`) 0.8 or newer.
- Kernel and host policy that permit the user namespaces required by bubblewrap.

On Debian or Ubuntu, the package names are:

```sh
sudo apt update
sudo apt install -y python3 socat bubblewrap
uname -m
bwrap --version
ldd --version
```

The architecture check must report `x86_64`, and `bwrap --version` must be at least `0.8`. The package manager's glibc must be compatible with the supplied runtime. A future `tools/doctor.py --platform linux` preflight is planned; do not assume that command exists in this export.

Bubblewrap relies on Linux user namespaces and constructs a mount namespace with explicitly selected filesystem visibility. Read the [bubblewrap documentation](https://github.com/containers/bubblewrap/blob/main/README.md) before changing host policy. On Ubuntu 24.04, AppArmor can restrict unprivileged user namespaces. Read Ubuntu's [Ubuntu 24.04 release notes](https://documentation.ubuntu.com/release-notes/24.04/) and [AppArmor user-namespace documentation](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/) for the host-specific policy. Do not disable AppArmor restrictions globally, lower a system-wide `sysctl`, use a privileged container, or select an insecure no-sandbox fallback.

## Install a supplied Linux export

Obtain the private-preview Linux x64 export and its build record from the supplier. The GitHub source tree intentionally does not contain recovered vendor binaries. Verify the supplied checksum and runtime revision before using it.

Choose a private profile location on the Linux filesystem. An explicit profile makes backups and recovery unambiguous:

```sh
install -d -m 700 "$HOME/.local/share/chimeric"
./dist/linux-x64/chimeric version
./dist/linux-x64/chimeric open \
  --profile "$HOME/.local/share/chimeric" \
  --port 18868
```

The launcher uses port `18868` for the workspace and `18869` for its sandbox unless an explicit port is supplied. `open` starts the local workspace when needed and asks `xdg-open` to open the native one-use authentication link. For a headless host, use `url` to print a one-use URL with a privacy hint, then open it in a browser that can safely reach the same loopback service:

```sh
./dist/linux-x64/chimeric url \
  --profile "$HOME/.local/share/chimeric" \
  --port 18868
```

Use only the URL produced by the native CLI; never construct or reuse a nonce URL manually. Browser automation and the full Linux harness are not release-gate evidence in this preview.

Use the same profile for status and an intentional stop:

```sh
./dist/linux-x64/chimeric status --profile "$HOME/.local/share/chimeric"
./dist/linux-x64/chimeric stop --profile "$HOME/.local/share/chimeric"
```

Closing a browser window does not describe the backend lifecycle. Use **Stop Workspace** or the packaged `stop` command when you intend to end the workspace. A complete close/quit preservation test remains part of the open native-window and Linux runtime gates.

## Build the Linux export from source

Source builds require Bun 1.4.3, Python 3, frozen dependencies, and an externally supplied compatible Linux x64 runtime binary. Keep the binary outside the source staging tree:

```sh
bun install --frozen-lockfile --ignore-scripts
export CHIMERIC_RUNTIME_BINARY=/path/to/chimeric-linux-x64
python3 tools/recover_runtime.py "$CHIMERIC_RUNTIME_BINARY" build/original-linux
bun tools/build-runtime.ts build/original-linux build/runtime-linux-x64
python3 tools/build-portable.py \
  --runtime build/runtime-linux-x64 \
  --binary "$CHIMERIC_RUNTIME_BINARY" \
  --out dist/linux-x64
```

The export record currently sets `executionVerified: false`. That records the state of this preview; it is not a successful Linux harness claim. Do not publish the output as a completed Docker image, Linux arm64 package, or production sandbox until the corresponding gates in [RELEASE-READINESS.md](RELEASE-READINESS.md) have independent runtime evidence.

## Backup and recovery

Stop the workspace before copying its profile. Back up the complete profile, including `local-auth`, the workspace database, projects, artifacts, provider configuration, model selection, and audit records, to protected storage with permissions preserved. Record the build and runtime revision beside the backup, outside the profile. Never commit profiles, API keys, one-use URLs, private provider URLs, or research data.

For recovery, install the target export, stop any old workspace, restore into a new explicit profile directory, inspect projects and artifacts, verify model and provider status, and send a harmless test request. Fresh-install and restore remain open release gates.
