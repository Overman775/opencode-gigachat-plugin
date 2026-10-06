# API GigaChat, который использует плагин

Плагин работает с контрактом API v1: `messages`, `functions`, `function_call` и `functions_state_id`.
Этот документ описывает адреса, заголовки и форматы сообщений этого контракта.

## Адреса

| Запрос | Метод и адрес |
| --- | --- |
| Получение токена | `POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth` |
| Ответ модели | `POST https://api.giga.chat/v1/chat/completions` |
| Загрузка файла | `POST https://api.giga.chat/v1/files` |

Адреса приведены в документации Сбера: [REST API](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api) и [файлы](https://developers.sber.ru/docs/ru/gigachat/guides/working-with-files).

В SDK `gigacode_temp` также есть контракт v2 для `/api/v2/chat/completions`.
Он использует `tools`, `tools_state_id`, `model_options` и массив `content[]`.
Для перехода на v2 нужно изменить преобразование запросов, ответов и потоков.
Замена одного URL не меняет формат сообщений.

## Заголовки

| Запрос | `Content-Type` | `Authorization` |
| --- | --- | --- |
| OAuth | `application/x-www-form-urlencoded` | `Basic <Base64_credentials>` |
| Ответ модели | `application/json` | `Bearer <JWT_access_token>` |
| Загрузка файла | `multipart/form-data` с boundary | `Bearer <JWT_access_token>` |

Плагин добавляет `RqUID: <UUIDv4>` для идентификации запроса.
Для OAuth он также отправляет `Accept: application/json`.

## Запрос ответа модели

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
  "stream": true
}
```

Правила для тела запроса:

- Сообщение `system` может быть только одно. Если оно есть, оно должно быть первым в `messages`.
- Плагин объединяет входящие сообщения `system` и `developer` в одно сообщение `system`.
- Плагин не отправляет неподдерживаемые поля `n`, `presence_penalty` и `frequency_penalty`.
- Плагин преобразует `reasoning_effort` и `thinking` в системные инструкции.
- Поле `content` результата функции должно содержать JSON. Плагин преобразует обычный текст с помощью `JSON.stringify()`.
- Плагин удаляет `additionalProperties`, `$schema` и `nullable` из схемы параметров функции.

Неверный формат может вызвать HTTP 400 или 422.
Преобразование инструментов описано в [архитектуре](ARCHITECTURE.md#вызовы-инструментов).

## Обычный ответ

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

## Поток SSE

Тип ответа: `text/event-stream`.
События содержат строки `data:`. Пустая строка завершает событие.

```text
data: {"id":"chatcmp-uuid","created":1717616800,"model":"GigaChat-Max","choices":[{"index":0,"delta":{"role":"assistant","content":"Привет"},"finish_reason":null}]}

data: {"id":"chatcmp-uuid","created":1717616800,"model":"GigaChat-Max","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: [DONE]
```

Плагин преобразует `delta.function_call` в `delta.tool_calls`.
Он сохраняет один `tool_call.id` для частей одного вызова функции.
Если ответ содержит `functions_state_id`, плагин сохраняет это поле в `delta`.

## Загрузка изображения

Тело запроса `/files` имеет формат `multipart/form-data`.

| Поле | Содержимое |
| --- | --- |
| `file` | Данные изображения |
| `purpose` | Значение `general` |

Пример ответа:

```json
{
  "id": "sber-file-id-uuid-12345",
  "bytes": 45120,
  "created_at": 1717616800,
  "filename": "upload_1717616800.png",
  "purpose": "general"
}
```

Плагин передаёт значение `id` в массив `attachments` сообщения:

```json
{
  "role": "user",
  "content": "Посмотри на картинку",
  "attachments": ["sber-file-id-uuid-12345"]
}
```

При корпоративном подключении плагин использует `/files` того же базового адреса, что и запрос модели.
Если загрузка завершилась ошибкой, плагин возвращает ошибку. Он не отправляет текст без изображения.
