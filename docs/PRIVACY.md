# Privacy and network boundaries

Chimeric is a local workspace, with explicit network paths for user-selected model providers, connectors, and scientific resources. The privacy controls below describe the current integration source and packaged preview. They are not a claim that every remote provider or MCP server is safe or private.

## Local telemetry and update controls

The local runtime sets `settings.disable_telemetry=true` and keeps automatic updates disabled with `settings.update.auto_update=false`. Native analytics are hard-disabled. Sentry reporting and science-profile synchronization are disabled in the integrated runtime. Analytics queues and callbacks are replaced with an inactive provider. The current runtime does not write local event-batch logs.

The integration guards the vendor Sentry and Google Cloud updater paths at both fetch and `node-http` boundaries. A conditional Sentry-enabled capability remains in preserved upstream code, so the guard is an implementation boundary rather than evidence that every possible remote component is controlled. Current runtime checks observed no Sentry send.

The relevant source controls are in [src/local-runtime.ts](../src/local-runtime.ts), [tools/build-runtime.ts](../tools/build-runtime.ts), and the tested runtime boundary manifest. These controls do not disable network access selected by the user.

## Network paths that remain available

The following paths can use the network when configured or invoked:

- User-configured model providers and the ChatGPT subscription connection.
- User-configured connectors and MCP servers.
- Public scientific resources and web search tools.
- Public document URLs accepted by the bounded content reader.

Provider requests contain the conversation or attachment data required by the selected model operation. Provider terms, retention, routing, and logging remain outside Chimeric's control. The local URL policy rejects credentials embedded in URLs, private-network document resolutions, and disallowed destinations, while it does not make a remote endpoint private.

## Credentials and local workspace data

API keys and ChatGPT credentials are stored in the selected profile's private `local-auth` directory with authenticated local encryption. The settings API reports credential presence, not the key value. Conversations, projects, artifacts, provider configuration, model selection, audit records, and encrypted credentials remain in the selected profile. Do not put a profile, one-use session URL, API key, or private provider URL in source control.

Manual feedback is stored locally. Diagnostic archives are created on request; sharing an archive requires a separate action. Review an export before sharing it because workspace text, file names, provider identifiers, or error details can be present.

## Scope and limitations

These guards are not a firewall. They cannot control what a user-configured provider, connector, MCP server, browser, operating system component, or external research service does after receiving a request. Chimeric therefore does not make a categorical no-egress claim. Use a network firewall, restricted account, or isolated host when the research protocol requires an independent egress boundary.

The public integration source is at [sammanalili/chimeric](https://github.com/sammanalili/chimeric). The public source does not include recovered runtime binaries, private profiles, API keys, or personal research data. Packaged runtime redistribution and the complete sandbox verification remain separate release gates; see [RELEASE-READINESS.md](RELEASE-READINESS.md) and [DISTRIBUTION.md](DISTRIBUTION.md).
