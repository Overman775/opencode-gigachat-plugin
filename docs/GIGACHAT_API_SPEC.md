# Спецификация API GigaChat (GigaChat API Reference)

Этот документ описывает эндпоинты, заголовки, форматы входящих запросов и ответов API GigaChat от Сбера, с которыми работает сетевой перехватчик плагина.

---

## 1. Базовые эндпоинты

Плагин использует два официальных семейства endpoint-ов:

*   **OAuth Авторизация (Получение токенов)**:
    `POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth`
*   **Генерация ответов модели (Chat Completions, legacy v1 contract)**:
    `POST https://gigachat.devices.sberbank.ru/api/v1/chat/completions`
*   **Загрузка файлов (Vision/Вложения)**:
    `POST https://ngw.devices.sberbank.ru:9443/api/v2/files`

> Важно: в рабочем SDK из `gigacode_temp` есть primary v2 chat contract (`/api/v2/chat/completions`) с другой схемой (`tools`, `tools_state_id`, `model_options`, multipart `content[]`). Этот плагин сейчас использует legacy v1 contract, потому что его OpenAI-адаптер построен вокруг `messages`, `functions`, `function_call` и `functions_state_id`. Нельзя просто заменить URL на v2 без полной миграции транслятора.

---

## 2. Заголовки запросов (Required Headers)

Для каждого запроса к API GigaChat (кроме `/oauth`) плагин автоматически генерирует и прикрепляет следующие заголовки:

*   `Content-Type: application/json`
*   `Authorization: Bearer <JWT_access_token>`
*   `RqUID: <UUIDv4>` — уникальный идентификатор запроса (защита от повторной отправки транзакций).

Для запроса `/oauth` используются заголовки:
*   `Content-Type: application/x-www-form-urlencoded`
*   `Authorization: Basic <Base64_credentials>`
*   `RqUID: <UUIDv4>`

---

## 3. Спецификация Chat Completions

### Формат запроса (Request Body):

```json
{
  "model": "GigaChat-Max",
  "messages": [
    {
      "role": "user",
      "content": "Привет! Как дела?"
    }
  ],
  "temperature": 0.7,
  "top_p": 1.0,
  "max_tokens": 1024,
  "stream": true,
}
```

### Важные ограничения схемы запроса GigaChat:
1. **Единственное системное сообщение**: В массиве `messages` может присутствовать ровно одно сообщение с ролью `system` (или `developer`). Наличие нескольких системных сообщений приведет к ошибке `422 Unprocessable Entity` от API.
2. **Позиция системного сообщения**: Системное сообщение должно располагаться на самом первом месте в массиве `messages` (индекс 0). Любое другое расположение приведет к ошибке `422`.
3. **Исключение неподдерживаемых параметров**: API GigaChat не поддерживает стандартные параметры OpenAI, такие как `n` (число вариантов ответа), `presence_penalty`, `frequency_penalty`, `reasoning_effort` и `thinking`. Передача данных параметров вызывает ошибку `400 Bad Request` или `422 Unprocessable Entity`. Плагин автоматически очищает и транслирует JSON-тело перед отправкой.
4. **Валидный JSON в результатах функций**: Для сообщений с ролью `function` (результаты работы инструментов) поле `content` обязано быть валидной JSON-строкой. Если инструмент возвращает обычный текст (например, вывод bash-команды или список файлов), плагин автоматически экранирует его в JSON-строку, чтобы избежать ошибки `422 Unprocessable Entity` (`invalid function result json string`).
5. **Санитайзинг JSON Schema**: В схемах параметров функций плагин удаляет `additionalProperties`, `$schema` и `nullable`, потому что legacy GigaChat function calling отклоняет эти поля.


### Формат ответов (Response Body):

#### Обычный режим (Non-streaming):
```json
{
  "id": "chatcmp-uuid",
  "object": "chat.completion",
  "created": 1717616800,
  "model": "GigaChat-Max",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Привет! Я готов помочь тебе с программированием."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 20,
    "total_tokens": 35
  }
}
```

#### Потоковый режим (Streaming - SSE):
Сервер возвращает поток с типом контента `text/event-stream`. Каждая строка с полезными данными начинается с префикса `data: `:

```text
data: {"id":"chatcmp-uuid","created":1717616800,"model":"GigaChat-Max","choices":[{"index":0,"delta":{"role":"assistant","content":"Привет"},"finish_reason":null}]}

data: {"id":"chatcmp-uuid","created":1717616800,"model":"GigaChat-Max","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: [DONE]
```

Если потоковый chunk содержит `delta.function_call`, плагин конвертирует его в OpenAI-compatible `delta.tool_calls`. Для одного и того же вызова внутри stream сохраняется стабильный `tool_call.id`; `functions_state_id` пробрасывается в delta, если он пришел от GigaChat.

---

## 4. Загрузка вложений (Multipart Files API)

Для передачи мультимедиа-вложений плагин отправляет запрос на эндпоинт `/files` со следующей структурой тела (Multipart Form):

*   `file` — бинарные данные изображения.
*   `purpose` — строка назначения файла, плагин использует `"general"`.

Ответ сервера содержит идентификатор файла:
```json
{
  "id": "sber-file-id-uuid-12345",
  "bytes": 45120,
  "created_at": 1717616800,
  "filename": "upload_1717616800.png",
  "purpose": "general"
}
```

Этот `id` передается в массиве строк `attachments` на верхнем уровне объекта сообщения:

```json
{
  "role": "user",
  "content": "Посмотри на картинку",
  "attachments": ["sber-file-id-uuid-12345"]
}
```
