# Provider configuration

## Connection fields

The settings UI accepts a provider name, base URL, API type, optional key, discovery or manual mode, request timeout, and optional image and reasoning capabilities for manual models. `openai-completions` sends Chat Completions requests. `openai-responses` sends Responses requests. The ChatGPT subscription uses a separate fixed `openai-codex-responses` connection and is not editable here.

Remote URLs require HTTPS. Loopback HTTP is allowed for local services; other HTTP requires an explicit insecure-HTTP choice. URLs with userinfo, query, or fragment components and Anthropic destinations are rejected.

## Discovery and manual IDs

Discovery calls the provider's `/models` endpoint with the configured credential. A provider can instead list model IDs in manual mode. Each model receives a qualified ID in the form `provider-id::model-id`. The model catalog records mode, text or image input, reasoning support, effort levels, context limits, and whether capabilities were verified.

## Runtime behavior

Each request uses a model and credential snapshot. Streaming uses server-sent events. Tool calls can invoke the local research server tools, including configured search adapters. Reasoning effort is passed using the provider's configured compatibility format. A provider failure is returned to the workspace as an error.

## Configuration files

The managed configuration is stored in the private profile as `provider-config.json`. Optional external environment and credential-reference files can provide keys during development. UI-entered keys are stored encrypted under `local-auth`; the settings API reports only whether a credential exists. Do not place keys in this repository or in a checked-in JSON example.
