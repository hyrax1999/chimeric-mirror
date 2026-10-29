# Release readiness

## Verified development evidence

- The reviewed source export passed source-boundary checks, staged-tree checks, and the source-license check. It is a private research preview handoff.
- macOS arm64 app packaging, native launcher, relative resource paths, local ad-hoc signature, Chimeric identity, and animated atom behavior have been exercised.
- Provider discovery, manual model IDs, Completions and Responses transports, reasoning settings, vision probes, concurrent edits, failed rollback, credential pinning, and local SSE updates have live evidence.
- ChatGPT subscription connection is separate from ordinary provider settings.
- General language preference supports System, English, and Japanese, with browser-language negotiation and English fallback.
- The current Mac test evidence is 41 tests and 208 assertions on Bun 1.4.3 and Python 3.14.7.

## Open gates

| Gate | Current state | Release evidence required |
| --- | --- | --- |
| Fresh install and restore | Open | New profile, migration, backup, restore, artifact, credential, and selected-model checks |
| Source export and private-file exclusion | Passed | Reviewed final source export and strict staged-tree checks recorded in `docs/SOURCE-VERIFICATION.json`; runtime private-file isolation remains separate |
| Runtime sandbox isolation | Open | Independent OS-level test proving research tools cannot read provider keys or other private authentication material |
| Managed converters | Open | Isolated portable PDF, Office, OCR, and image tools with bounded resources and clear missing-tool status |
| Linux full harness and Docker | Open | Real execution and artifact checks; current portable manifest records `executionVerified: false` |
| Linux arm64 | Open | A supported binary and package test |
| Runtime distribution rights | Review required | [docs/DISTRIBUTION.md](DISTRIBUTION.md) records the unresolved rights assessment for the preserved runtime and bundled components |
| New-source license | Passed | `LICENSE` selects Apache License 2.0 for eligible new Chimeric source; it does not license upstream material |
| Final release audit | Open | Independent review of source staging, manifests, notices, private paths, and user-facing claims |

The temporary Linux namespace probe is evidence about one host-policy condition. It is not proof of the complete Linux harness, Docker image, or portable release. Source-export exclusion and runtime sandbox isolation are separate gates: a clean package can omit private files while the running research harness still needs an independent OS-level denial test.
