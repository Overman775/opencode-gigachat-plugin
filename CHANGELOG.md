# Changelog

This file records changes to the project.
It uses [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-10-06

### Added

- Modular installation ZIP alongside the standalone plugin file.
- Tests for authorization, request conversion, streaming, uploads, and both release formats.

### Changed

- Split plugin code into modules and updated runtime dependencies.
- Put installation and launch steps in both READMEs; simplified the other documentation.

### Fixed

- Release files now include all required modules and dependencies.
- OpenCode login, OAuth refresh races, and embedded TLS certificates.
- API routing, request cancellation, proxy uploads, and HTTP/SSE error handling.

## [1.0.0] - 2026-06-08

### Added

- Initial release of the OpenCode GigaChat plugin, `opencode-gigachat-plugin`.
- Conversion of completion requests for `api.gigachat.local` and `ngw.devices.sberbank.ru` from OpenAI to GigaChat format.
- Embedded Russian Ministry CA certificates, with standard system certificates, for TLS connections.
- Cached `https.Agent` instances with `keepAlive: true` for repeated requests.
- `sanitizeError()` to remove authorization headers and tokens from network errors before logs.
- Base64 image uploads with `multipart/form-data`. The plugin puts the returned file ID in `attachments`.
- Conversion of `reasoning_effort` and `thinking` to system instructions.
- Conversion of `tool_calls`, `tool_call_id`, and `name` in conversation history.
- Tool calls in SSE responses.
- Conversion of the `developer` role to `system`.
- Stop sequences and conversion of object-valued `tool_choice` to `"auto"`.
- Binary proxy requests for file endpoints without JSON parsing.
- Vitest tests next to source files. They cover request conversion, model fallback, TLS options, and tool history.
- A release workflow that builds and uploads `gigachat-plugin.js` when a `v*` tag is pushed. It replaces npm publication.
- `"private": true` in `package.json` to prevent publication to npm.
- Relative Markdown links for documentation on GitHub.
- VS Code settings for two-space indentation, LF line endings, and Vitest debugging.
- Inline `credentials` and `scope` in `provider.gigacode.options` in `opencode.json`.
- `GIGACHAT_CREDENTIALS` and `GIGACHAT_SCOPE` as fallback when the configuration has no key.
- `npm run encode-creds` to create `Base64(Client_ID:Client_Secret)` and show provider configuration instructions.
- Documentation of the API v1 contract and its differences from v2 `tools` and `tools_state_id`.
- Documentation of host checks that prevent token forwarding to unrelated URLs that only mention GigaChat.
- Documentation of stable `tool_call.id` values and `functions_state_id` in repeated tool calls.
- Documentation of the removal of `nullable`, `additionalProperties`, and `$schema` from function parameter schemas.
