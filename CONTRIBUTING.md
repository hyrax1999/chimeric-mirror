# Contributing to Chimeric

Contributions should preserve the local-first research workflow, the original runtime boundary, and the product identity. Read the architecture and security documents before changing provider, launcher, packaging, or profile behavior.

## Local setup

Use Bun for TypeScript tests and runtime builds. Use Python 3 for recovery and packaging scripts. Keep a compatible runtime binary and provider credentials outside the repository. Never commit a profile, `local-auth`, API key, recovered executable, private endpoint, or research artifact.

```sh
bun install
bun test
```

For a runtime build, use explicit paths and retain the source and binary hashes produced by the build tools. Do not change the original runtime in place.

## Change expectations

Trace inputs, state, storage, and output across the native app, local bridge, provider registry, and profile. Update tests for normal, malformed, concurrent, and failure paths. Provider changes must preserve model and credential snapshots for active requests, revision checks for concurrent settings edits, and encrypted secret handling.

UI changes should keep the Chimeric DNA and animated atom, keyboard and reduced-motion behavior, English and Japanese strings, and General-language placement. The original runtime's permissions and approvals remain part of the boundary.

## Verification

Run `bun test` and exercise the relevant live path when a change crosses the browser, native launcher, provider endpoint, profile, or packager boundary. Report the runtime, platform, commands, artifact paths, and known untested gates. A passing unit suite does not establish portable, fresh-install, restore, Docker, or distribution readiness.

## Pull requests

New Chimeric source contributions are selected for the Apache License 2.0 in `LICENSE`. That selection does not grant rights to the preserved runtime, bundled assets, or upstream excerpts. Use the repository pull-request template. Describe the user-visible outcome, affected interfaces, migration or backup needs, security implications, provenance and license implications, and the exact verification evidence. Keep unrelated historical evidence and private setup out of the patch.
