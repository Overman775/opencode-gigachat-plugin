# OpenCode Connector Plugin for GigaCode / GigaChat

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![OpenCode Compatibility](https://img.shields.io/badge/OpenCode-Compatible-green.svg)](https://github.com/anomalyco/opencode)
[![SBER GigaChat](https://img.shields.io/badge/SBER-GigaChat-00C853.svg)](https://developers.sber.ru/docs/ru/gigachat/overview)

[Русская версия здесь](README.md)

An open-source connection plugin for the **OpenCode** terminal-based AI assistant ([anomalyco/opencode](https://github.com/anomalyco/opencode)), providing seamless integration, protocol translation, and direct connectivity to models in Sber's **GigaCode** / **GigaChat** ecosystem.

The plugin resolves protocol incompatibilities between OpenAI and GigaChat, manages network security handshakes in Russian TLS environments, supports multimodal media attachments, and simplifies credential management by storing options directly inside the configuration file or environment variables.

---

## Features

* **Local Protocol Translator (OpenAI $\leftrightarrow$ GigaChat)**: Intercepts and adapts requests to the GigaChat API on the fly by stripping incompatible fields, mapping reasoning parameters (`reasoning_effort` / `thinking`), and sanitizing tool call schemas (MCP tools) to match Sber's strict API validation. For details, see [Plugin Architecture](docs/ARCHITECTURE.md) and [GigaChat API Specification](docs/GIGACHAT_API_SPEC.md).
* **Hybrid TLS CA Fallback (Built-in Certificates)**:
    > [!IMPORTANT]
    > **Works out-of-the-box!** The plugin implements a hybrid approach to network security: it scans the OS for Russian National CA certificates. If they are absent, the plugin automatically mounts an embedded PEM certificate bundle of the Russian Ministry of Digital Development directly into the internal `https.Agent` for all OAuth and API requests. You no longer need to disable SSL verification (`rejectUnauthorized: false`) or manually install certificates.
* **Multimodal Attachment Uploads (Vision)**: Intercepts base64 image strings (`image_url` in OpenAI format), automatically packages them into Multipart Form Data, and uploads them to Sber's secure storage using the `/files` API. The retrieved `file_id` is then dynamically injected as an `attachment` block before forwarding the request to GigaChat.
* **Automatic OAuth Token Management**: The plugin fully encapsulates the OAuth 2.0 token acquisition lifecycle. It caches the retrieved JWT token and preemptively refreshes it 5 minutes prior to the 30-minute expiration buffer. Lock semaphores prevent parallel token renewal requests under high concurrent load.
* **Zero Footprint Single-Account Config**: No extra accounts file is required. Authorization keys and API scopes are defined directly within your global `opencode.json` provider options block, or passed via environment variables.
* **1-Tool Execution Constraint adaptation**: Resolves GigaChat's strict API limitation of running exactly one tool/function call per turn. The plugin optimizes the `tools` array, allowing OpenCode to execute complex multi-step tool calls sequentially.
* **Payload Size Warning**: Warns the user when message content exceeds 400 KB to prevent token overflow issues with the model's 128K context window.

---

## Installation and Build

### Option A: Download compiled plugin from GitHub Releases (Recommended)

1. Download the latest compiled plugin file `gigachat-plugin.js` from the [GitHub Releases](https://github.com/your-username/opencode-gigachat-plugin/releases) page.
2. Copy the downloaded file to your OpenCode plugins directory:

   ```bash
   mkdir -p "$HOME/.opencode/plugins"
   # Move the downloaded gigachat-plugin.js file to the plugins directory
   cp path/to/downloaded/gigachat-plugin.js "$HOME/.opencode/plugins/gigachat-plugin.js"
   ```

3. Register the path in your `~/.config/opencode/opencode.json` configuration file:

   ```json
   {
     "plugin": [
       "./.opencode/plugins/gigachat-plugin.js"
     ]
   }
   ```

### Option B: Fast Installation via AI Assistant

(If you want to install and compile a local copy)
Paste this prompt into your LLM coding assistant (Claude Code, Cursor, OpenCode etc.) in your project root:

```text
Build the opencode-gigachat-plugin and configure it in ~/.config/opencode/opencode.json following the repository instructions.
```

### Option C: Manual Build from Source (For Developers)

1. **Clone and build the plugin**:

    ```bash
    git clone https://github.com/your-username/opencode-gigachat-plugin.git
    cd opencode-gigachat-plugin
    npm install
    npm run build
    ```

    The compiled JavaScript file will be saved at `dist/index.js`.

2. **Copy to the OpenCode plugins folder**:

    ```bash
    mkdir -p "$HOME/.opencode/plugins"
    cp dist/index.js "$HOME/.opencode/plugins/gigachat-plugin.js"
    ```

    And register the path in your `opencode.json` configuration:

    ```json
    {
      "plugin": [
        "./.opencode/plugins/gigachat-plugin.js"
      ]
    }
    ```

---

## Models and Reasoning

### GigaChat Models Reference

Add these models to your `opencode.json`. All models support up to 128,000 tokens of context window.

| Model ID | Commercial Name | Vision Support | Description |
| :--- | :--- | :---: | :--- |
| `GigaChat` | GigaChat Classic (Text) | No | Classic GigaChat text model. |
| `GigaChat-2` | GigaChat 2 (Text) | No | Next generation fast GigaChat text model. |
| `GigaChat-2-Lite` | GigaChat 2 Lite (Alias) | No | Alias mapping compatibility model for GigaChat-2. |
| `GigaChat-Plus` | GigaChat Plus (Text) | No | Enhanced GigaChat text model. |
| `GigaChat-Pro` | GigaChat Pro (Multimodal) | **Yes** | Multimodal GigaChat Pro model. |
| `GigaChat-2-Pro` | GigaChat 2 Pro (Multimodal) | **Yes** | Next generation multimodal GigaChat 2 Pro model. |
| `GigaChat-Max` | GigaChat Max (Multimodal) | **Yes** | Flagship GigaChat Max model. |
| `GigaChat-2-Max` | GigaChat 2 Max (Reasoning) | **Yes** | Flagship GigaChat 2 Max reasoning model. |

### Thinking Budget & Reasoning Effort

Since Sber's official GigaChat API does not support `reasoning_effort` or `thinking` parameters within its JSON request payload, the plugin automatically translates them into textual system instructions (Chain-of-Thought) and strips the parameters from the final request payload to prevent validation errors:

* The OpenAI `reasoning_effort` (`low`, `medium`, `high`) parameter or `thinking` object is mapped to the corresponding step-by-step system instructions:
  * `high` (or `budget_tokens` $>$ 1024 tokens) $\rightarrow$ Appends detailed reasoning and thorough step-by-step thinking instructions to the system prompt.
  * `medium` (or `budget_tokens` $\le$ 1024 tokens) $\rightarrow$ Appends step-by-step thinking instructions to the system prompt.
  * `low` $\rightarrow$ Does not add additional instructions (standard fast generation mode).

---

## Configuration Setup

Add the `GigaChat (Sberbank)` provider and register your plugin in the global OpenCode config (typically located at `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./.opencode/plugins/gigachat-plugin.js"
  ],
  "provider": {
    "GigaChat (Sberbank)": {
      "options": {
        "baseURL": "https://api.gigachat.local/v1"
      },
      "models": {
        "GigaChat": {
          "name": "GigaChat Classic (Text)",
          "limit": { "context": 32000, "output": 4096 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "GigaChat-2": {
          "name": "GigaChat 2 (Text)",
          "limit": { "context": 128000, "output": 4096 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "GigaChat-2-Lite": {
          "name": "GigaChat 2 Lite (Alias)",
          "limit": { "context": 128000, "output": 4096 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "GigaChat-Plus": {
          "name": "GigaChat Plus (Text)",
          "limit": { "context": 128000, "output": 8192 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "GigaChat-Pro": {
          "name": "GigaChat Pro (Multimodal)",
          "limit": { "context": 128000, "output": 8192 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "GigaChat-2-Pro": {
          "name": "GigaChat 2 Pro (Multimodal)",
          "limit": { "context": 128000, "output": 8192 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "GigaChat-Max": {
          "name": "GigaChat Max (Multimodal)",
          "limit": { "context": 128000, "output": 8192 },
          "modalities": { "input": ["text", "image"], "output": ["text"] },
          "variants": {
            "low": { "reasoning_effort": "low" },
            "medium": { "reasoning_effort": "medium" },
            "high": { "reasoning_effort": "high" }
          }
        },
        "GigaChat-2-Max": {
          "name": "GigaChat 2 Max (Reasoning)",
          "limit": { "context": 128000, "output": 8192 },
          "modalities": { "input": ["text", "image"], "output": ["text"] },
          "variants": {
            "low": { "reasoning_effort": "low" },
            "medium": { "reasoning_effort": "medium" },
            "high": { "reasoning_effort": "high" }
          }
        }
      }
    }
  }
}
```

> [!NOTE]
> The `https://api.gigachat.local/v1` address is a virtual URL. Chat requests are translated to the legacy-compatible endpoint `https://gigachat.devices.sberbank.ru/api/v1/chat/completions`, because the current adapter uses the `messages/functions/function_call` contract.
> Custom corporate proxy URLs are also supported. Interception is enabled only for known hosts or requests carrying the provider marker header, so a Bearer token is not attached to an unrelated URL that merely mentions `api.gigachat.local` in its path or query string.

### Step 2. Using External Certificates (Optional)

If you prefer to override the built-in CA certificate bundle and use your own certificate files, set up the bundle manually:

```bash
mkdir -p "$HOME/.config/opencode/certs"
curl -sSL -k -o "$HOME/.config/opencode/certs/root.crt" https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
curl -sSL -k -o "$HOME/.config/opencode/certs/sub.crt" https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
cat "$HOME/.config/opencode/certs/root.crt" "$HOME/.config/opencode/certs/sub.crt" > "$HOME/.config/opencode/certs/russian_trusted_root_ca.pem"
rm "$HOME/.config/opencode/certs/root.crt" "$HOME/.config/opencode/certs/sub.crt"
```

Once generated, point the plugin to it by setting the `GIGACHAT_CA_BUNDLE_FILE` environment variable.

---

## Environment Variables

The plugin can also read credentials and TLS overrides from environment variables (acting as fallbacks if missing from `opencode.json`):

| Environment Variable | Required | Default Value | Description |
| :--- | :---: | :--- | :--- |
| `GIGACHAT_CREDENTIALS` | No | None | Base64 encoded Client ID + Client Secret authorization key. |
| `GIGACHAT_SCOPE` | No | `GIGACHAT_API_PERS` | Authorization API scope subscription (`GIGACHAT_API_PERS` / `GIGACHAT_API_CORP` / `GIGACHAT_API_B2B`). |
| `GIGACHAT_CA_BUNDLE_FILE` | No | `~/.config/opencode/certs/russian_trusted_root_ca.pem` | Path to a custom CA certificate PEM bundle override. |
| `GIGACHAT_VERIFY_SSL` | No | `true` | Set to `false` to disable SSL/TLS certificate verification (only for testing). |

---

## Troubleshooting

### 1. TLS Certificate Errors (Self-signed certificate in chain / UNABLE_TO_VERIFY_LEAF_SIGNATURE)

* **Cause**: Node.js does not natively trust Sber's gateway `ngw.devices.sberbank.ru` because its certificate is signed by the Russian National CA root, which is not part of default browser/runtime CA packages.
* **Solution**:
    1. By default, the plugin loads the built-in Ministry of Digital Development certificates. Make sure you have not overridden the `GIGACHAT_CA_BUNDLE_FILE` variable with an incorrect or empty path.
    2. If you are behind a corporate proxy/firewall, combine your corporate proxy CA certificate with the Russian National CA bundle.
    3. As a temporary workaround for offline/local debugging, set `GIGACHAT_VERIFY_SSL="false"`.

### 2. Error: "GigaChat credentials are not configured"

* **Cause**: The plugin was unable to find your authorization credentials in either `opencode.json` or the environment variables.
* **Solution**:
    1. Ensure you have added the `credentials` and `scope` fields under `provider.gigachat.options` in `opencode.json`.
    2. Check that the API scope (`scope`) matches your Sber Developer tier (e.g. individual developers use `GIGACHAT_API_PERS`).
    3. Verify that your shell environment has exported `GIGACHAT_CREDENTIALS` successfully.

### 3. Payload Too Large Error (HTTP 413)

* **Cause**: You are sending too much code context, binary attachments, or massive dependencies (like `node_modules`). GigaChat API limits single payloads to 10 MB.
* **Solution**:
    1. Check the plugin console warnings: `[GigaCode-Plugin] WARNING: Content size is large`.
    2. Add a `.opencodeignore` file to your project root to exclude directories like `node_modules/`, `.git/`, and build/dist folders.

---

## Documentation

* [Plugin Architecture](docs/ARCHITECTURE.md) — internal flow diagrams and event lifecycles.
* [Configuration Manual](docs/CONFIGURATION.md) — configuration options and environment parameters.
* [Model Guide](docs/MODEL-VARIANTS.md) — reasoning configurations and token counts.
* [Troubleshooting Guide](docs/TROUBLESHOOTING.md) — TLS issues and authentication debugging.
* [GigaChat API Reference](docs/GIGACHAT_API_SPEC.md) — API endpoints and schemas.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

### Disclaimer
* This project is an experimental proof-of-concept (PoC) created purely for research purposes. Further maintenance or active development is not planned. If you urgently need to reach out regarding critical fixes or adjustments, feel free to contact the author on Telegram (handles can be found in the GitHub profile).
* During the design of the translation layer and function calling mechanics, we referenced and drew inspiration from the official SDK structures and client implementations found in the [ai-forever/gigachat](https://github.com/ai-forever/gigachat) repository.
* This project is an independent open-source contribution and is not affiliated with Sberbank or the GigaChat development team.
* "GigaChat", "GigaCode", and "Sber" are registered trademarks of PJSC Sberbank.
