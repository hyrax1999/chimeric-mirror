# Windows Subsystem for Linux (WSL2)

WSL2 can provide an Ubuntu environment for the Linux x64 technical preview. The complete Linux harness, Docker path, and WSL-specific sandbox behavior are unverified. Use WSL2 as a development or private-preview environment, not as evidence that the Linux release gate has passed.

## Install WSL2 and Ubuntu

Open PowerShell as Administrator. Microsoft documents these commands in [Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install) and [Basic commands for WSL](https://learn.microsoft.com/en-us/windows/wsl/basic-commands):

```powershell
wsl --install -d Ubuntu
```

Restart Windows if prompted. Complete the Ubuntu first-launch account setup, then confirm that the distribution uses WSL2:

```powershell
wsl --list --verbose
```

The Ubuntu row must show version `2`. If it shows `1`, convert that distribution before continuing:

```powershell
wsl --set-version Ubuntu 2
```

Keep the source tree and Chimeric profile inside the Linux filesystem, such as `~/src/chimeric` and `~/.local/share/chimeric`. Avoid `/mnt/c/...` for the profile and active workspace because Windows-mounted paths add filesystem and permission behavior that has not been part of the preview's runtime validation.

## Install Linux prerequisites inside Ubuntu

In the Ubuntu shell:

```sh
sudo apt update
sudo apt install -y python3 socat bubblewrap
uname -m
bwrap --version
ldd --version
```

The supported preview binary requires `x86_64` and a compatible glibc. `bwrap` must be version 0.8 or newer. Bubblewrap uses user namespaces and a mount namespace. Ubuntu 24.04 documents AppArmor's unprivileged-user-namespace restrictions in its [release notes](https://documentation.ubuntu.com/release-notes/24.04/) and [security documentation](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/). Do not disable AppArmor restrictions globally, change a system-wide namespace `sysctl`, run a privileged container, or use an insecure sandbox fallback to force startup. If WSL policy denies the required namespace, record the failure and stop at that gate.

## Run the Linux x64 preview

Obtain a separately supplied Linux x64 export. The source repository does not include recovered vendor binaries. From the Linux filesystem, select an explicit profile and run:

```sh
install -d -m 700 "$HOME/.local/share/chimeric"
./dist/linux-x64/chimeric version
./dist/linux-x64/chimeric open \
  --profile "$HOME/.local/share/chimeric" \
  --port 18868
```

The workspace listens on `localhost:18868` and its sandbox uses `localhost:18869` by default. WSL2 normally forwards localhost services to Windows, so a Windows browser can open the local workspace. For headless WSL, ask the native CLI to print a one-use URL with its privacy hint:

```sh
./dist/linux-x64/chimeric url \
  --profile "$HOME/.local/share/chimeric" \
  --port 18868
```

Open that URL in a Windows browser after confirming that both ports are forwarded to the intended WSL distribution. Use only the URL produced by the native CLI and never manufacture or reuse a nonce URL. The full WSL sandbox remains unverified.

Use **Stop Workspace** in the UI, or stop intentionally from the Ubuntu shell:

```sh
./dist/linux-x64/chimeric status --profile "$HOME/.local/share/chimeric"
./dist/linux-x64/chimeric stop --profile "$HOME/.local/share/chimeric"
```

Closing the Windows browser does not establish that the WSL backend has stopped. Check status and use `stop` when ending the workspace. WSL2 close/quit preservation and complete harness execution remain unverified.

## Source build in WSL2

Build tooling requires Bun 1.4.3, Python 3, frozen dependencies, and an externally supplied compatible Linux x64 runtime binary:

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

The portable export records `executionVerified: false`. This guide does not claim Docker support, a complete WSL sandbox, Linux arm64 support, or a production-ready Windows integration. Keep profiles and backups in the Linux filesystem, outside source control, and follow [OPERATIONS.md](OPERATIONS.md) for backup and restore handling.
