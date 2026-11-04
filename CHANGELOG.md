# Changelog

This file records changes to the project.
It uses [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Транспорт для OpenCode 2.x: локальный HTTP-эндпоинт плагина и провайдер `gigachat`, который на него указывает (`src/v2/`).
- Тесты транспорта V2 в `src/v2/endpoint.test.ts`.
- Сборка V2: `npm run build:release:v2` создаёт `dist/gigachat-plugin-v2.js`.
- Релизная проверка V2: `npm run test:release:v2` прогоняет собранный файл с заглушкой движка и фейковым API.
- Инструкция для OpenCode 2.x в `docs/V2.md`.
- Вход в V2: провайдер объявляется в конфигурации, плагин добавляет `env`-метод в появившуюся интеграцию и читает сохранённый ключ перед каждым запросом.
- Несколько аккаунтов в V2: список ключей в `GIGACHAT_CREDENTIALS` или массив `accounts` в провайдере; ротация на `401`/`403`/`429`, повтор запроса и отдельный кэш токена на аккаунт.
- Инструмент `gigachat_generate_image`: генерация картинки встроенной функцией GigaChat и сохранение файла на диск.
- Аудио-вложения: часть `input_audio` загружается в `/files` и передаётся в `attachments`.
- Нативные `reasoning_effort` и `thinking` для запросов без инструментов; при наличии инструментов сохраняется системная инструкция.
- Пояснения к кодам ошибок `401`, `402`, `403`, `429`; причина от сервера показывается рядом.
- Очередь запросов на аккаунт: GigaChat принимает один одновременный запрос, поэтому заголовок сессии и основной запрос больше не конкурируют; лимит настраивается `GIGACHAT_MAX_CONCURRENCY`.
- Защитный тест `src/plugin/tool-schema.test.ts`: обходит схему инструмента на любой глубине и падает, если остались `type`-массив или ключи `format`, `nullable`, `additionalProperties`, `$schema`. Ловит любое поле, которое GigaChat отклонит, а не только те, что были в баг-репорте.
- Восстановление вызовов, записанных текстом: после смены модели OpenCode сжимает историю строками вида `[Assistant tool call]: edit({...})`, и GigaChat иногда имитирует этот формат текстом вместо реального вызова — сырой JSON попадал в чат, инструмент не выполнялся. Теперь такие строки распознаются в ответе (и в стриме, и в обычном режиме), превращаются обратно в настоящие `tool_calls`, а служебный текст из чата убирается. Незавершённая или невалидная запись остаётся обычным текстом.
- Повтор запроса после `429` при одном аккаунте: с паузой, если лимит всё же сработал.

### Fixed

- Ложный `429` на первом сообщении новой сессии: OpenCode отправлял заголовок сессии параллельно с основным запросом, а GigaChat разрешает только один запрос на аккаунт. Запросы теперь ждут свободный слот.
- `422 INVALID_PARAMS: every function result must have an assistant function call in history` при параллельных вызовах инструментов: OpenCode присылает несколько `tool_calls` в одном сообщении ассистента, а GigaChat допускает один `function_call` на сообщение, и лишние результаты оставались без вызова. Теперь такой ответ разворачивается в пары «assistant с вызовом → function с результатом»; проверено на GigaChat-3-Lightning, GigaChat-3-Pro, GigaChat-3-Ultra и GigaChat-2-Max.
- `422 Field '…type' is of a wrong type. Expected: stringValue, actual: arrayValue` на первом запросе с инструментами: OpenCode описывает необязательные аргументы как `type: ["string", "null"]`, а GigaChat ждёт одну строку. `sanitizeFunctionParameters` сводит такой массив к первому не-null значению и убирает `format`, который GigaChat тоже отклоняет. Исправление предложено в #7, авторство коммита сохранено.

### Security

- `npm audit` больше не находит уязвимостей: `follow-redirects` обновлён до 1.16.1 (попадает и в собранный бандл), `vitest` — до 4.x, а для dev-зависимости `@opencode-ai/plugin` версии `effect` и `zod` зафиксированы через `overrides`. Версия `effect` совпадает с той, что использует `@opencode/plugin`, поэтому `toml` из дерева зависимостей ушёл.

### Changed

- `vitest.config.ts` ограничивает прогон каталогом `src`, иначе после `npm run build` тесты запускались дважды — из `src` и из `dist`.
- Зависимости обновлены до актуальных версий: `@opencode-ai/plugin` 1.19.4, `@opencode/plugin` 2.1.4, `@types/node` 20.19.43, `vitest` 4.1.12, `typescript` 7.0.2.
- Матрица CI сужена до Node 20/22/24: Vitest 4 и Vite 8 больше не поддерживают Node 18, а сборка плагина по-прежнему нацелена на Node 18.
- Scope из сохранённого креденшела читается из `configuration` (OpenCode 2.0) или `metadata` (2.1): в 2.1 поле переименовано.
- Слой V2 использует существующие модули преобразования, потоков, инструментов и загрузки файлов без изменений.
- Каталог моделей V2: поколения «2» и «3» — `GigaChat-2`, `GigaChat-2-Pro`, `GigaChat-2-Max`, `GigaChat-3-Lightning`, `GigaChat-3-Pro`, `GigaChat-3-Ultra`; `GigaChat-2-Lite` остаётся псевдонимом `GigaChat-2`.
  Возможности проверены на живом API: инструменты работают у всех шести моделей, изображения принимают все, кроме `GigaChat-3-Lightning` (она текстовая).
- Сообщения об ошибках API дополняются причиной из ответа (например, `Can't decode 'Authorization' header`) вместо одного кода состояния.
- Запасное имя модели при отсутствии поля `model` — `GigaChat-2-Max` вместо снятого `GigaChat-Max`.
- Адрес OAuth, базовый адрес API и порт локального эндпоинта переопределяются переменными `GIGACHAT_OAUTH_URL`, `GIGACHAT_API_URL` и `GIGACHAT_ENDPOINT_PORT`.

## [1.0.2] - 2026-10-06

### Changed

- Releases now provide one ready-to-use `gigachat-plugin.js`; the installation ZIP is no longer published.
- Updated installation and upgrade instructions in both READMEs.

### Fixed

- Included project and third-party licenses in the JS file.

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
