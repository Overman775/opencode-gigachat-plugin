# GigaChat plugin for OpenCode

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![OpenCode Compatibility](https://img.shields.io/badge/OpenCode-Compatible-green.svg)](https://github.com/anomalyco/opencode)
[![SBER GigaChat](https://img.shields.io/badge/SBER-GigaChat-00C853.svg)](https://developers.sber.ru/docs/ru/gigachat/overview)

[Русский](README.md)

This plugin connects GigaChat / GigaCode to [OpenCode](https://github.com/anomalyco/opencode).
It converts requests and responses between OpenAI and GigaChat API v1 formats.

The plugin supports text, tool calls, response streams, and image uploads.
It obtains an OAuth token and verifies TLS certificates for requests to Sber.

## Installation and Build

You need OpenCode to install the plugin. You need Node.js 18 or later to build it from source.

### Install the ZIP

Use `gigachat-plugin.zip`. The archive contains separate modules and bundled dependencies.

> The published `v1.0.0` release contains an incomplete three-line JS file.
> Use a release with the ZIP asset, or build the current sources below.

1. Download `gigachat-plugin.zip` from [GitHub Releases](https://github.com/Overman775/opencode-gigachat-plugin/releases).
2. Close OpenCode.
3. Open a terminal in the directory that contains the archive.
4. Create the plugins directory:

   ```bash
   mkdir -p "$HOME/.config/opencode/plugins"
   ```

5. Extract the entire archive:

   ```bash
   unzip -o gigachat-plugin.zip -d "$HOME/.config/opencode/plugins"
   ```

The installed files must have this structure:

```text
~/.config/opencode/plugins/
├── README.md
├── README.en.md
├── LICENSE
├── docs/
├── gigachat-plugin.js
└── gigachat-plugin/
    ├── index.js
    ├── plugin.js
    ├── plugin/       # requests, messages, tools and streams
    ├── gigacode/     # authentication, certificates and logs
    └── vendor/       # dependencies and licenses
```

Keep `gigachat-plugin.js` next to the `gigachat-plugin/` directory.
OpenCode loads the entry file at startup. You do not need to run `npm install` for the release.

If the `plugin` array contains a previous GigaChat plugin, remove that entry.
Keep the entries for other plugins.

### Configuration Setup

1. Open `~/.config/opencode/opencode.json`. If the file does not exist, create it.
2. Add the `GigaChat (Sberbank)` entry to the `provider` section.

Minimal configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "GigaChat (Sberbank)": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.gigachat.local/v1",
        "verifySSL": true
      },
      "models": {
        "GigaChat": {
          "name": "GigaChat",
          "limit": { "context": 32000, "output": 4096 },
          "modalities": { "input": ["text"], "output": ["text"] }
        }
      }
    }
  }
}
```

If the file contains other settings, keep them. Add only the provider entry.

`https://api.gigachat.local/v1` is a virtual address.
The plugin sends requests from this address to `https://api.giga.chat/v1`.

For all model entries and provider options, see [Configuration](docs/CONFIGURATION.md).
You can set a corporate address in `options.baseURL`.

### Log in

1. Run this command:

   ```bash
   opencode providers login --provider "GigaChat (Sberbank)"
   ```

2. Select the scope for your account:

   | Scope | Account type |
   | --- | --- |
   | `GIGACHAT_API_PERS` | Individual |
   | `GIGACHAT_API_B2B` | Business |
   | `GIGACHAT_API_CORP` | Corporate API |

3. Paste the GigaChat authorization key into the `API key` field.

Use the Base64 key from Sber Developers. A temporary `access_token` does not work as the login key.
OpenCode stores the key and scope in its authentication store.

If you have separate Client ID and Client Secret values, run `npm run encode-creds` in a cloned repository.
The command creates the `Base64(Client_ID:Client_Secret)` string.

The plugin validates OAuth on the first model request.
You can also use `GIGACHAT_CREDENTIALS` and `GIGACHAT_SCOPE` instead of the login command.

### Start and test

1. Open a terminal in your project directory.
2. Start OpenCode:

   ```bash
   opencode --model "GigaChat (Sberbank)/GigaChat"
   ```

3. Ask for a one-word response: “Reply with one word: works”.
4. Test a tool call: “List the files in the current project”.

Add `--print-logs` to the start command to show logs.
If the request fails, see [Troubleshooting](docs/TROUBLESHOOTING.md).

### Update

1. Close OpenCode.
2. Extract the entire new ZIP over the previous installation.
3. Start OpenCode.

The plugin files are separate from the stored key and configuration. Both READMEs are in the archive.

### Install one JS file

The separate `gigachat-plugin.js` release asset contains all modules and dependencies.

1. Create the plugins directory:

   ```bash
   mkdir -p "$HOME/.config/opencode/plugins"
   ```

2. Copy the file in place of the ZIP entry file:

   ```bash
   cp gigachat-plugin.js "$HOME/.config/opencode/plugins/gigachat-plugin.js"
   ```

3. Configure the provider and log in with the instructions above.

The build generates the file without minification and includes source module paths.
Use the ZIP to read separate modules. Edit `src/` for development.

### Build from source

1. Clone the repository:

   ```bash
   git clone https://github.com/Overman775/opencode-gigachat-plugin.git
   ```

2. Open the repository directory:

   ```bash
   cd opencode-gigachat-plugin
   ```

3. Install dependencies:

   ```bash
   npm ci
   ```

4. Build the plugin:

   ```bash
   npm run build:release
   ```

5. Test the code and release files:

   ```bash
   npm test
   npm run test:release
   ```

| Output | Purpose |
| --- | --- |
| `dist/gigachat-plugin.zip` | Modular archive for installation |
| `dist/gigachat-plugin.js` | Single file for installation |
| `dist/release/` | Extracted archive |
| `dist/index.js` | Development entry; requires the other `dist/` modules and npm dependencies |

Builds and updates replace changes to generated files.

## Features and limits

- The plugin uses one account. You can store the key through OpenCode, in the configuration, or in environment variables.
- If the OAuth token expires in less than 5 minutes, the next request refreshes it. The server supplies the expiration time; tokens normally last 30 minutes.
- Concurrent requests share one token refresh request.
- The plugin converts `tools` to `functions` and sends one function call from a message.
- The plugin uploads Base64 images through `/files`, then sends their IDs in `attachments`.
- The plugin converts `reasoning_effort` and `thinking` to system instructions. See [Reasoning parameters](docs/MODEL-VARIANTS.md).
- The plugin shows a warning for each text part larger than 400 KB. It does not reduce the size of that part.

Model IDs: `GigaChat`, `GigaChat-2`, `GigaChat-2-Lite`, `GigaChat-Plus`, `GigaChat-Pro`, `GigaChat-2-Pro`, `GigaChat-Max`, `GigaChat-2-Max`.
The plugin maps `GigaChat-2-Lite` to `GigaChat-2`.

Set context limits, output limits, and image support with the [configuration example](docs/CONFIGURATION.md).
For reasoning parameters, see [Model variants](docs/MODEL-VARIANTS.md).

## Certificates

TLS verification is on by default.
The plugin reads the configured CA bundle file. If the file does not exist, it uses the embedded Russian Ministry certificates.

If you need another bundle, set its path in `options.caBundle` or `GIGACHAT_CA_BUNDLE_FILE`.
For a corporate proxy, add its CA certificate to the bundle with the Russian Ministry certificates.

You can create the Russian Ministry bundle with these commands:

```bash
mkdir -p "$HOME/.config/opencode/certs"
curl --fail --show-error --location -o "$HOME/.config/opencode/certs/root.crt" https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
curl --fail --show-error --location -o "$HOME/.config/opencode/certs/sub.crt" https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
cat "$HOME/.config/opencode/certs/root.crt" "$HOME/.config/opencode/certs/sub.crt" > "$HOME/.config/opencode/certs/russian_trusted_root_ca.pem"
rm "$HOME/.config/opencode/certs/root.crt" "$HOME/.config/opencode/certs/sub.crt"
```

This is the default path.
`verifySSL: false` disables TLS verification. Use it only for temporary diagnostics, then set it to `true`.

If the configuration does not set `verifySSL`, you can use `GIGACHAT_VERIFY_SSL=false` for temporary diagnostics.

## Environment variables

Provider settings and the stored OpenCode key take precedence over environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GIGACHAT_CREDENTIALS` | None | `Base64(Client_ID:Client_Secret)` key |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` | Scope for the environment key |
| `GIGACHAT_CA_BUNDLE_FILE` | `~/.config/opencode/certs/russian_trusted_root_ca.pem` | CA bundle path |
| `GIGACHAT_VERIFY_SSL` | `true` | TLS verification; `false` only for diagnostics |

## Documentation

- [Configuration](docs/CONFIGURATION.md): provider options, models, and login methods.
- [Reasoning parameters](docs/MODEL-VARIANTS.md): model variants and response fields.
- [Troubleshooting](docs/TROUBLESHOOTING.md): causes and actions.
- [Architecture](docs/ARCHITECTURE.md): modules, requests, tools, and builds.
- [API](docs/GIGACHAT_API_SPEC.md): addresses, headers, and message examples.
- [Author’s article](docs/HABR-ARTICLE.md): experience with GigaChat in OpenCode.

## License and project status

License: [MIT](LICENSE).

The project is a research prototype. Further maintenance and development are not planned.
For fixes, contact the author through Telegram in the [GitHub profile](https://github.com/Overman775).

The author used designs from [ai-forever/gigachat](https://github.com/ai-forever/gigachat) for request conversion and function calls.
The project is independent of Sberbank and the GigaChat team.
“GigaChat”, “GigaCode”, and “Sber” are registered trademarks of PJSC Sberbank.
