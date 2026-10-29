# Operations

## Start and stop

Use the packaged `chimeric` command or the app launcher. `open` starts a local workspace if needed and opens a one-use browser session. `serve` keeps the service attached to the terminal. `status` and `stop` use the same packaged native runtime. The launcher filters bootstrap nonces and bearer tokens from its log.

Use `--profile DIRECTORY` for an explicit profile during testing. Choose a new directory for a fresh-install test. Do not point a release build at a private development profile without a deliberate backup.

## Backup

Stop the workspace before copying its profile. Copy the complete profile, including the workspace database, projects, artifacts, provider configuration, model selection, audit data, and the private `local-auth` directory, to protected storage. Preserve file permissions and record the Chimeric build and runtime revision beside the backup, outside the profile. Never put the backup in source control or attach it to a bug report.

## Restore

Install the target build, stop any running instance, and restore the profile into a new explicit profile directory. Start with that directory, inspect projects and artifacts, verify that the selected model and provider status are expected, then send a harmless test request. Credential restoration should be treated as sensitive. If credentials cannot be decrypted, reconnect them in Settings rather than copying keys into configuration files.

Fresh-install and restore behavior remains an open release gate. Record the profile contents, migration result, selected model, provider status, and artifact checks without recording secrets or private conversation text.

## Provider maintenance

Connection edits are revision checked. If another window changed the list, reload before saving. Changing a provider URL requires a new key or explicit confirmation to reuse the saved key at the new destination. Before removing a provider, choose a replacement for its selected model and any background roles. Its headline entries are removed with the connection.

If discovery fails, use manual model registration only with exact IDs and documented capabilities. A manual capability declaration does not prove live support.

## Incident response

Stop the affected workspace, preserve redacted logs and build manifests, identify the provider and model revision, and avoid retry loops that can duplicate research actions. Rotate a provider key at the provider if exposure is suspected, then remove and reconnect it through the UI. Do not publish profiles, tokens, nonces, or private URLs.
