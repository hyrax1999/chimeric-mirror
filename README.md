# Chimeric

[日本語版 README](README.ja.md)

Chimeric is a local research workspace that keeps the original research runtime and harness while adding a provider-neutral model layer, a native Chimeric launcher, local credential handling, model discovery, reasoning controls, vision input, a static DNA mark, and an animated atom identity. The public integration source is [sammanalili/chimeric](https://github.com/sammanalili/chimeric).

The public source contains the Chimeric integration, build tools, tests, and documentation. The original runtime remains a versioned integration dependency with its original provenance, and recovered runtime binaries, packaged runtime previews, private profiles, API keys, and personal research data are supplied separately.

## Current readiness

The macOS arm64 development app, AppKit/WKWebView native window, provider bridge, ChatGPT subscription connection, language preference, and live reload paths have been exercised. The current source evidence is 60 Bun tests and 246 assertions across 11 files, plus 15 Python publication tests. Final package verification remains pending.

The source-boundary and source-license gates have passed on the reviewed export. Verification remains in progress for a fresh-install and restore test, runtime sandbox isolation, managed portable converters, the complete Linux harness and Docker path, Linux arm64 packaging, voice portability, the final brand and locale audit, and redistribution review for the preserved runtime and bundled components. New Chimeric source is selected for Apache License 2.0; that selection does not license upstream material. These gates are recorded in [docs/RELEASE-READINESS.md](docs/RELEASE-READINESS.md). The packaged runtime remains a private technical preview while those gates are open.

## Platform installation

- [macOS installation](docs/INSTALL-MAC.md) for the Apple Silicon native app and AppKit/WKWebView window.
- [Linux installation](docs/INSTALL-LINUX.md) for the checked Linux x64 technical preview.
- [WSL2 installation](docs/INSTALL-WSL.md) for Ubuntu on Windows.

## Quick start from source

The source tree expects a compatible Chimeric runtime binary supplied separately. Keep that binary outside the source staging tree.

Required tooling is Bun 1.4.3, Python 3, macOS with Xcode Command Line Tools, and Swift for the native app entry point. Install JavaScript dependencies without running package lifecycle scripts:

```sh
bun install --frozen-lockfile --ignore-scripts
```

```sh
export CHIMERIC_RUNTIME_BINARY=/path/to/chimeric-runtime-binary
python3 tools/recover_runtime.py "$CHIMERIC_RUNTIME_BINARY" build/original
bun tools/build-runtime.ts build/original build/runtime
python3 tools/build-macos-app.py \
  --runtime build/runtime \
  --binary "$CHIMERIC_RUNTIME_BINARY" \
  --out dist/macos-arm64
open dist/macos-arm64/Chimeric.app
```

`recover_runtime.py` refuses unsupported Bun module layouts and never modifies the input binary. `build-runtime.ts` checks the supported runtime revision, asset archive hash, and source boundaries before applying the integration patches. The macOS packager creates `Chimeric.app`, a native Swift entry point, a Bun runtime, relative resource references, and a local ad-hoc signature.

The native app is the primary macOS launch path. The bundled CLI also accepts `open`, `serve`, `url`, `status`, `stop`, and `version`, with `--profile DIRECTORY` and `--port PORT`; use the helper in [INSTALL-MAC.md](docs/INSTALL-MAC.md) because the embedded Bun binary must be invoked through `launcher.mjs`. Closing the native window or shell leaves the backend running. Use **Stop Workspace** or the native **Quit** action when you intend to stop it. `CHIMERIC_DATA_DIR` and `CHIMERIC_PORT` provide equivalent environment overrides. A fresh install uses a neutral per-user data directory. Do not copy a development profile into a package.

For the checked Linux x64 export, inspect the portable builder and its output record:

```sh
python3 tools/build-portable.py \
  --runtime build/runtime-linux-x64 \
  --binary /path/to/chimeric-linux-x64 \
  --out dist/linux-x64
```

The Linux export records `executionVerified: false`. Docker, Linux harness execution, and Linux arm64 packaging are not documented as completed workflows.

## Configure model connections

Open **Settings → General → Language** to choose System, English, or 日本語. System follows the browser's preferred language. Unsupported browser languages fall back to English. Applying a language change reloads the page, so save drafts and connection edits first.

Open **Settings → Connections** to add a provider. A connection has a name, an API base URL, an API type, and an optional API key. Supported API types are `openai-completions` and `openai-responses`. `openai-completions` sends `POST /chat/completions`; the legacy `/completions` path is not supported. `openai-responses` sends the provider's Responses request. The URL may include the provider's path prefix, such as `/v1`. Remote connections require HTTPS. HTTP is accepted for loopback or when the connection explicitly enables insecure HTTP.

Discovery requests the provider's `/models` endpoint. If discovery is unavailable, choose manual registration and enter exact model IDs. Manual capabilities describe the model's image and reasoning support; they are not a substitute for a live capability test. Model IDs are qualified as `provider-id::model-id`, so identical IDs from separate providers remain distinct. Pin models for the selector and assign optional `small`, `medium`, and `large` background roles. Saved connection changes publish through a local SSE event stream and do not require a restart.

Reasoning effort is selected per model. Supported levels are provider-specific subsets of `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. The bridge translates the selected level into the configured transport format and preserves a request's model and credential snapshot while settings change.

The ChatGPT subscription is a separate connection. Use its own sign-in controls, then disconnect it from the same controls. It uses the fixed ChatGPT backend destination and the Codex Responses transport. It is not edited as an ordinary API provider.

## Files, vision, and local operations

Text and image content are sent to the selected model endpoint. Image input requires a model with verified image capability. Public document URLs are fetched only over HTTP or HTTPS, reject Anthropic destinations and private-network resolutions, follow at most three redirects, and cap downloads at 50 MiB. PDF text and page images use local converters with a 60-second process limit and a 100-page visual-input limit.

The broader managed-converter pipeline is still a release gate. The current source has a PDF path and local speech integration, while Office, OCR, and portable converter provisioning remain incomplete. Voice configuration points to a local Python and Whisper runtime; missing dependencies fail explicitly.

Conversation data, projects, artifacts, provider configuration, model selection, audit records, and encrypted credentials live in the selected private profile. Backup and restore guidance is in [docs/OPERATIONS.md](docs/OPERATIONS.md). No profile is included in this repository.

## Architecture and security

The browser talks to the original local app. Chimeric installs a local provider bridge and catalog manager inside that process. The registry discovers or validates models, the bridge converts native messages into OpenAI-compatible Completions, Responses, or ChatGPT Responses calls, and the protocol layer converts streamed results back into native messages and tool events. The original workspace database, approvals, project store, artifacts, and research harness remain the system of record.

API keys are kept in the profile's private `local-auth` directory, encrypted with an authenticated local key. Keys are never returned by the settings API. Provider URLs reject embedded credentials, query strings, fragments, and Anthropic destinations. Local provider routes require the bootstrap session token and use CSRF-protected connection mutation routes. See [SECURITY.md](SECURITY.md) for reporting and the security boundary.

Privacy and telemetry boundaries are documented in [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

Install the declared JavaScript dependencies, then run the focused test suite:

```sh
bun install --frozen-lockfile --ignore-scripts
bun test
```

Build the runtime with `bun tools/build-runtime.ts SOURCE DESTINATION`. Build scripts are intentionally explicit about the recovered binary and output directory. See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

The source release boundary is declared in `release.manifest.json`. Run `python3 tools/release_check.py` for source, credential-pattern, and local-link checks. `tools/prepare-release.py --out DESTINATION` creates an atomic source-only export from the manifest. The reviewed export passed its source checks, while the remaining gates still require runtime evidence and rights review. CI repeats the source checks and Bun test on the pinned development toolchain.

## Provenance and licensing

New Chimeric source is selected for the Apache License 2.0 in [LICENSE](LICENSE). The original runtime and bundled components retain their original provenance and license notices. Runtime redistribution remains under review in [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). The Apache selection does not relicense upstream material. See [NOTICE.md](NOTICE.md) for the scope of the grant.
