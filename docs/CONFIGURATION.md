# Конфигурация плагина GigaChat

Начните с [установки в README](../README.md#установка-и-сборка).
После установки OpenCode загружает плагин из папки `plugins`.

## Файл конфигурации

Глобальный файл: `~/.config/opencode/opencode.json`.
OpenCode также поддерживает конфиг в папке проекта.

1. Откройте конфиг.
2. Добавьте запись `GigaChat (Sberbank)` в раздел `provider`.
3. Сохраните остальные настройки файла.

Пример содержит все модели, которые описаны в этом репозитории:

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

Плагин из ZIP загружается автоматически. Добавлять его npm-пакет в массив `plugin` не требуется.

## Параметры провайдера

Параметры находятся в `provider["GigaChat (Sberbank)"].options`.

| Параметр | Назначение |
| --- | --- |
| `baseURL` | Базовый адрес API; для обычной установки используйте `https://api.gigachat.local/v1` |
| `credentials` | Необязательный ключ `Base64(Client_ID:Client_Secret)`; при входе через OpenCode это поле можно пропустить |
| `scope` | Scope аккаунта: `GIGACHAT_API_PERS`, `GIGACHAT_API_B2B` или `GIGACHAT_API_CORP` |
| `verifySSL` | Проверка TLS; по умолчанию `true` |
| `caBundle` | Путь к своему PEM-файлу с CA-сертификатами |

`GIGACHAT_API_PERS` используется для личных аккаунтов.
`GIGACHAT_API_B2B` используется для B2B-аккаунтов.
`GIGACHAT_API_CORP` используется для корпоративного API.
Выберите scope, который указан для вашего ключа в кабинете Сбера.

Виртуальный адрес `https://api.gigachat.local/v1` перенаправляет запросы в `https://api.giga.chat/v1`.
Плагин сохраняет путь и параметры URL, включая `/chat/completions`, `/files` и `/models`.

Если нужен корпоративный прокси, укажите его адрес в `baseURL`.
Например: `https://gigachat-proxy.mycompany.com/v1`.
Плагин регистрирует хост этого адреса для перехвата запросов.

Плагин также распознаёт официальные хосты и заголовок `x-opencode-provider-marker`.
Упоминание GigaChat в пути или параметрах постороннего URL не включает перехват.

## Вход через OpenCode

1. Выполните команду:

   ```bash
   opencode providers login --provider "GigaChat (Sberbank)"
   ```

2. Выберите scope аккаунта.
3. Вставьте ключ авторизации GigaChat в поле `API key`.

OpenCode сохранит ключ и scope в хранилище авторизации.
Поля `credentials` и `scope` в конфиге для этого способа не нужны.
Плагин проверяет OAuth при первом запросе к модели.

## Ключ в переменных окружения

Если вы используете этот способ, задайте ключ и scope в терминале:

```bash
export GIGACHAT_CREDENTIALS="YOUR_BASE64_CREDENTIALS_HERE"
export GIGACHAT_SCOPE="GIGACHAT_API_PERS"
```

Без `GIGACHAT_SCOPE` плагин использует `GIGACHAT_API_PERS`.
Настройки провайдера и ключ из хранилища OpenCode имеют приоритет над переменными окружения.

## Сертификаты

Плагин содержит сертификаты Минцифры. При обычной установке скачивать их отдельно не требуется.

Если нужен внешний бандл, сохраните сертификаты в PEM-файле.
Для пути по умолчанию объедините корневой и выпускающий сертификаты:

```bash
cat root.crt sub.crt > ~/.config/opencode/certs/russian_trusted_root_ca.pem
```

Папка `~/.config/opencode/certs/` должна существовать перед записью файла.
Команды создания папки и загрузки сертификатов приведены в [README](../README.md#сертификаты).

| Настройка | Назначение |
| --- | --- |
| `GIGACHAT_CA_BUNDLE_FILE` | Путь к своему PEM-бандлу |
| `GIGACHAT_VERIFY_SSL` | Проверка TLS; значение `false` отключает её |

Явные параметры `caBundle` и `verifySSL` в конфиге имеют приоритет над переменными окружения.
Отключение TLS влияет на OAuth, запросы API и загрузку файлов.
Используйте `false` только для временной диагностики. После проверки верните `true`.
