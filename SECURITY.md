# Security policy

Chimeric is a local research application that sends conversation and attachment content to the model endpoint selected by the user. The endpoint's terms, retention, and usage limits apply. The application does not make an external billing or privacy guarantee.

New Chimeric source is selected for Apache License 2.0. That license selection does not grant rights to the preserved runtime, bundled assets, or upstream excerpts. Runtime redistribution remains a separate open gate.

## Security boundary

The local app uses a bootstrap session and CSRF protection for local provider routes. Provider keys are encrypted under the private profile's `local-auth` directory and are not returned by the settings API. Provider configuration rejects embedded URL credentials, query strings, fragments, Anthropic destinations, and remote HTTP unless explicitly enabled. Public document fetches reject private-network DNS results and cap size, redirects, and process time.

The original research harness controls permissions for Python, R, terminal, files, network, projects, and artifacts. Review code and destinations before approving tools. The current release does not claim a completed Linux sandbox or Docker security boundary.

## Reporting

Do not open a public issue with credentials, private URLs, profile files, conversation data, or recovered runtime contents. Report suspected security defects privately to the project maintainers through the release channel available for the distribution, including a minimal reproduction, affected version or source revision, impact, and whether the issue requires local access.

Do not test third-party endpoints or accounts without permission. Do not weaken host quotas, AppArmor, sandbox, or network policy to make a test pass.

## Release caveat

Private-file denial, fresh-install, restore, complete Linux harness, Docker, and portable converter gates remain open. Until those gates close, treat a development package as a controlled test artifact rather than a general production release.
