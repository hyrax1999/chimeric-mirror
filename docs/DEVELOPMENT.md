# Development guide

## Commands

```sh
bun install --frozen-lockfile --ignore-scripts
bun test
bun tools/build-runtime.ts SOURCE DESTINATION
python3 tools/recover_runtime.py BINARY DESTINATION
python3 tools/build-macos-app.py --runtime RUNTIME --binary BINARY --out OUTPUT
python3 tools/build-portable.py --runtime RUNTIME --binary BINARY --out OUTPUT
python3 tools/release_check.py
python3 tools/prepare-release.py --out OUTPUT
```

The packagers require a verified platform-matching binary. Keep `BINARY` outside the source tree. Build output is disposable and must not contain a private profile.

`release.manifest.json` is the positive source allowlist. `release_check.py` scans that boundary, known credential patterns, and local Markdown links. `prepare-release.py` builds an atomic source-only export from the allowlist. The checker reports open release gates, and `--ship` remains unavailable while the development gates are open.

## Test layers

The tests cover catalog construction, localization, local-gate behavior, native process handling, protocol translation, provider mutations, subscriptions, and voice. Live checks are still needed for a packaged launcher, a real browser, each provider transport, credentials, files, restore, and platform sandboxes.

When documenting a result, separate a test-harness pass from runtime reachability, artifact contents, and independent verification. Preserve known failures and the conditions that make them informative.

## Frontend and localization

The native UI is served from the integrated runtime. Keep the Chimeric DNA and animated atom, reduced-motion and forced-colors behavior, browser-language fallback, and Japanese strings coherent. Language is a General preference and is intentionally separate from Connections. A language change reloads the page.

## Runtime compatibility

Runtime patching is revision-specific. Unsupported source hashes, assets, module layouts, or platform combinations must fail before output is presented as a build. Do not bypass native process guards, remove PID locks, or mutate host sandbox policy to force a local test through.
