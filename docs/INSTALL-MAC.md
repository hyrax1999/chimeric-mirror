# macOS installation

Chimeric's packaged macOS target is an Apple Silicon (arm64) technical preview. The package contains a native launcher, the matching Bun runtime, the Chimeric integration, and the local DNA application identity. It is ad-hoc signed and not notarized. Redistribution and the preserved upstream runtime remain under review; see [DISTRIBUTION.md](DISTRIBUTION.md).

The packaged app has been exercised on macOS arm64 with the provider bridge, ChatGPT subscription connection, language preference, and live reload paths. Fresh-install, restore, sandbox, converter, and final native-window gates remain open. Treat this guide as a private research-preview procedure, not a production-release claim.

## Requirements

- Apple Silicon Mac. There is no supported macOS Intel package in this preview.
- macOS with permission to copy an application into `/Applications`.
- A separate compatible Chimeric runtime binary is required for a source build. The source repository does not contain recovered vendor binaries.

## Install a packaged app

1. Obtain the private-preview `Chimeric.app` package from the person who supplied it. Verify the build and runtime revision supplied with the package.
2. Copy `Chimeric.app` to `/Applications`. Keep the application bundle intact; do not move its `Contents/Resources` files into a separate system directory.
3. On the first launch, open `/Applications/Chimeric.app` from Finder or with:

   ```sh
   open /Applications/Chimeric.app
   ```

   The local workspace uses loopback ports by default: `18868` for the workspace and `18869` for its sandbox. If either port is occupied, choose an explicit port when launching the app.

4. If macOS presents an identity or provenance warning, stop and verify the package source with the supplier. Do not disable Gatekeeper or apply a system-wide security bypass to run this preview.

The native app is the normal Finder launch surface. The `bin/chimeric` file inside the bundle is the embedded Bun executable, so it must be invoked through `launcher.mjs` with `BUN_BE_BUN=1`. Define a shell helper for CLI status, version, and stop operations:

```sh
chimeric() {
  BUN_BE_BUN=1 \
    /Applications/Chimeric.app/Contents/Resources/bin/chimeric \
    /Applications/Chimeric.app/Contents/Resources/launcher.mjs "$@"
}
chimeric version
```

For a deterministic test profile, launch the native app with explicit arguments. Do not point a fresh package at a private development profile until it has been backed up:

```sh
open -na /Applications/Chimeric.app --args \
  --profile "$HOME/Library/Application Support/Chimeric" \
  --port 18868
```

The default per-user profile is intended to live at `~/Library/Application Support/Chimeric`. A supplied `--profile` or `CHIMERIC_DATA_DIR` value takes precedence. Profiles contain conversations, projects, artifacts, model selection, provider configuration, audit records, and encrypted credentials. The package does not include a profile.

## First launch and settings

Open **Settings → General → Language** to choose System, English, or 日本語. System follows the browser's preferred language and unsupported languages fall back to English. Applying a language change reloads the page, so save connection edits and drafts first.

Open **Settings → Connections** to add a provider. Enter a connection name, API base URL, API type, and optional key. The supported API types are `openai-completions` and `openai-responses`. Discovery uses the provider's `/models` endpoint. When discovery is unavailable, use manual registration with exact model IDs and record capabilities conservatively. A manual capability declaration is not a live capability test.

The ChatGPT subscription is managed by its own sign-in controls. It is not edited as an ordinary API provider. Connection changes are live through the local event stream and do not require a restart.

## Files, downloads, and profile safety

Text and image attachments are sent to the selected model endpoint. Generated files appear in the workspace Files area and can be downloaded from there. Local PDF conversion is bounded; Office, OCR, and the broader managed-converter pipeline remain release gates. Missing converter dependencies must be treated as an installation status, not silently replaced with an unsafe fallback.

Before an update, use **Stop Workspace** and back up the complete profile, including `local-auth`, the workspace database, projects, artifacts, provider configuration, model selection, and audit data. Preserve permissions and record the Chimeric build and runtime revision beside the backup, outside the profile. Never put a profile, credentials, one-use URL, or private provider URL in source control.

The native window is implemented and compiles, while runtime visibility remains a verification gate. Closing a window or quitting the app is intended to preserve the backend; **Stop Workspace** is the explicit action that ends it. Verify that behavior against the build's release notes before relying on it for recovery or unattended work. If a workspace is stuck, use the helper above for `status`, then `stop` only when you intend to end that workspace:

```sh
chimeric status --profile "$HOME/Library/Application Support/Chimeric"
chimeric stop --profile "$HOME/Library/Application Support/Chimeric"
```

For restore, install the target app, stop any running workspace, restore into a new explicit profile directory, inspect projects and artifacts, verify the selected model and provider status, and send a harmless test request. Fresh restore remains an open release gate.

## Build from source

Source builds require Bun 1.4.3, Python 3, Xcode Command Line Tools, Swift, locked JavaScript dependencies, and an externally supplied compatible runtime binary. Keep the binary outside the source tree:

```sh
bun install --frozen-lockfile --ignore-scripts
export CHIMERIC_RUNTIME_BINARY=/path/to/chimeric-runtime-binary
python3 tools/recover_runtime.py "$CHIMERIC_RUNTIME_BINARY" build/original
bun tools/build-runtime.ts build/original build/runtime
python3 tools/build-macos-app.py \
  --runtime build/runtime \
  --binary "$CHIMERIC_RUNTIME_BINARY" \
  --out dist/macos-arm64
```

The packager checks the supported runtime revision and writes a local ad-hoc signature. It does not notarize the app or grant redistribution rights to upstream material. See [DEVELOPMENT.md](DEVELOPMENT.md), [OPERATIONS.md](OPERATIONS.md), and [RELEASE-READINESS.md](RELEASE-READINESS.md) before treating a build as shareable.
