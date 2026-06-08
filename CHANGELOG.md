# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-08

### Added

- Initial release of the OpenCode GigaChat Plugin (`opencode-gigachat-plugin`).
- **OpenAI to GigaChat Translation**: Intercepts completions calls for `api.gigachat.local` and `ngw.devices.sberbank.ru` and translates body payload dynamically.
- **Hybrid TLS CA Fallback**: Dynamically loads embedded Russian National trusted CA certificates (MinTsifry) combined with standard system certificates, preventing SSL handshake failures.
- **TLS Connection Pooling**: Implemented caching for `https.Agent` with `keepAlive: true` to optimize socket usage and avoid descriptor leaks under high completions load.
- **Secure Error Sanitization**: Added a `sanitizeError` helper ensuring sensitive OAuth client secrets or authorization tokens are stripped from thrown network errors before logging.
- **Vision Support**: Uploads base64 images via Multipart Form data to Sber's files API, returning and injecting `file_id` attachment blocks.
- **Reasoning mapping**: Translates OpenAI `reasoning_effort` and `thinking` budget tokens to GigaChat prompt directives via system prompt injection.
- **Tool History Mapping**: Added mapping for `tool_calls`, `tool_call_id`, and `name` parameters, enabling full multi-turn assistant function calling history.
- **Streaming Tool Calls**: Added support for streaming tool call chunks in SSE translations.
- **Developer Role Mapping**: Maps OpenAI's new `developer` role to GigaChat's supported `system` role.
- **Stop Sequences & tool_choice**: Passes custom stop sequences and coerces object-type `tool_choice` inputs to `"auto"`.
- **Robust Binary Proxy**: Allowed the global fetch interceptor to proxy binary files API requests (like `/files`) directly without trying to parse JSON payloads.
- **Vitest Suite**: Colocated unit tests verifying translations, models fallback, TLS options, and tool call history mappings.
- **GitHub Releases CI/CD Pipeline**: Release pipeline that compiles the plugin and uploads `gigachat-plugin.js` directly to GitHub Releases upon tag (`v*`) push (replacing NPM publishing).
- **Private Package Safeguard**: Configured `"private": true` in `package.json` to prevent accidental publishing of the plugin to the public NPM registry.
- **Documentation Relative Paths**: Updated internal markdown links to use repository-relative paths, ensuring links open correctly on GitHub without local system dependencies.
- **VS Code Settings**: Tab spacing (2 spaces), LF eol, and debug launch config for Vitest.
- **Inline credentials**: Credentials (`credentials` and `scope`) configured directly inside `opencode.json` under `provider.gigacode.options`.
- **Environment variables fallback**: Checking `GIGACHAT_CREDENTIALS` and `GIGACHAT_SCOPE` environment variables as fallback if parameters are not configured in `opencode.json`.
- **Interactive CLI script**: Interactive credentials generator script (`npm run encode-creds`) to encode Client ID & Client Secret in Base64 and output setup instructions for `opencode.json` provider options block.
- **Legacy v1 contract documentation**: Documented why the plugin currently targets the legacy-compatible `api/v1/chat/completions` contract instead of partially switching to the primary v2 `tools/tools_state_id` contract.
- **Safer host detection**: Documented strict host-based interception to avoid attaching Bearer tokens to unrelated URLs that only mention a GigaChat host in their path or query string.
- **Streaming tool-call state**: Documented stable streaming `tool_call.id` handling and `functions_state_id` passthrough for multi-turn tool roundtrips.
- **Schema sanitization**: Documented removal of `nullable` alongside `additionalProperties` and `$schema` from function parameter JSON schemas.
