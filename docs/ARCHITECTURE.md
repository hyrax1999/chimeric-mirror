# Architecture

## System boundary

The original local application remains the workspace owner. It stores projects, conversations, artifacts, approvals, and research-harness state. Chimeric adds local services inside that process and supplies a native launcher around a packaged Bun runtime.

```text
Browser
  -> original local app and session/CSRF boundary
  -> Chimeric catalog and settings routes
  -> provider bridge
  -> OpenAI Chat Completions | OpenAI Responses | ChatGPT Responses
  -> streamed native message and tool events
```

## Provider path

`Registry` parses configuration, resolves credentials, validates destinations, discovers `/models`, loads optional metadata, and keeps qualified model IDs. `ProviderManager` serializes settings mutations, checks expected revisions, validates candidate connections before commit, writes `provider-config.json`, and publishes SSE revisions. Active requests retain model and credential snapshots, so a settings edit does not change a request already in flight.

`bridge.ts` authenticates local provider requests, normalizes native context, selects the configured transport, maps reasoning effort and tool choice, streams events, runs local server tools, records an audit trail, and converts the final result through `protocol.ts`. Provider errors remain visible; the selected model is not silently replaced.

## Profile state

The launcher chooses a neutral per-user profile unless `--profile`, `CHIMERIC_DATA_DIR`, or a packaged local configuration supplies another directory. The profile contains the original workspace data plus Chimeric state such as `provider-config.json`, `model-selection.json`, `models.last-good.json`, provider audit and replay data, and the private `local-auth` directory. Profiles are runtime state and never belong in source or release archives.

## Content and voice

`ContentReader` accepts inline text, base64 input, and public URLs. It rejects private-network document fetches and boundedly processes PDF text and page images. Image content is passed only to models with verified image input. The current converter path is local and platform-specific, so portable converter management remains unfinished. Voice uses a configured local Python Whisper worker and fails explicitly when the runtime is absent.

## Packaging

`recover_runtime.py` extracts a supported Bun module graph into a new directory. `build-runtime.ts` applies revision-specific source patches and writes manifests. `build-macos-app.py` packages the named runtime, assets, Bun binary, launcher, Swift entry point, icon, and relative manifest. `build-portable.py` exports Linux x64 files and records `executionVerified: false`.

## Tradeoffs and open boundaries

Keeping the original runtime preserves its mature harness and saved-data format, while the revision-specific patch boundary makes unsupported upstream binaries fail early. Provider independence improves local control, while each endpoint's capabilities and data policy remain external. The current design intentionally leaves Linux sandbox execution, managed converters, Docker, fresh restore, and distribution licensing as explicit gates instead of hiding them behind a generic fallback.
