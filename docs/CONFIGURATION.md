# Настройка конфигурации плагина GigaChat

Этот документ описывает все доступные параметры конфигурации, форматы файлов настроек и способы авторизации в плагине OpenCode GigaChat.

---

## 1. Глобальный файл `opencode.json`

Файл конфигурации OpenCode находится по умолчанию в папке `~/.config/opencode/opencode.json` (или в корне рабочего проекта).

### Пример конфигурации провайдера и моделей с учетными данными:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-gigachat-plugin@latest"
  ],
  "provider": {
    "GigaChat (Sberbank)": {
      "options": {
        "baseURL": "https://api.gigachat.local/v1",
        "credentials": "Base64_строка_авторизации",
        "scope": "GIGACHAT_API_PERS",
        "verifySSL": false,
        "caBundle": ""
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

### Основные параметры `options`:
*   `baseURL`: Базовый URL для запросов. По умолчанию рекомендуется использовать виртуальный адрес `https://api.gigachat.local/v1` для локального перехвата. Chat-запросы с этого виртуального хоста отправляются на `https://gigachat.devices.sberbank.ru/api/v1/chat/completions`, а файловые и служебные запросы - на `https://ngw.devices.sberbank.ru:9443/api/v2/...`.
    Также поддерживаются кастомные адреса корпоративных прокси-серверов (например, `https://gigachat-proxy.mycompany.com/v1`). Плагин регистрирует host из `baseURL` и перехватывает только запросы к известным host-ам или запросы с marker header `x-opencode-provider-marker`. Упоминание `api.gigachat.local` внутри path/query чужого URL не считается GigaChat-запросом и не получает Bearer-токен.
*   `credentials`: (Опционально) Авторизационный Base64-токен, созданный из связки Client ID и Client Secret: `Base64(Client_ID:Client_Secret)`. Его можно опустить, если используется стандартная интерактивная авторизация OpenCode (рекомендуется).
*   `scope`: Область действия API (определяет тарифный план):
    *   `GIGACHAT_API_PERS` — для личных кабинетов физических лиц (по умолчанию).
    *   `GIGACHAT_API_B2B` — для тестирования юридических лиц.
    *   `GIGACHAT_API_CORP` — для коммерческих корпоративных аккаунтов.
*   `verifySSL`: Logический флаг (`true` или `false`). Если установить в `false`, проверка TLS-сертификатов Минцифры будет полностью отключена для запросов к GigaChat API (рекомендуется для быстрой разработки и обхода ошибок вроде `CERT_SIGNATURE_FAILURE`).
*   `caBundle`: Путь к собственному PEM-файлу связки сертификатов. Переопределяет встроенные сертификаты Минцифры РФ.

---

## 2. Рекомендуемый способ: Интерактивная авторизация OpenCode

Плагин полностью поддерживает встроенный безопасный механизм авторизации OpenCode. Вы можете настроить учетные данные интерактивно при добавлении провайдера в TUI или с помощью команды в терминале:

```bash
opencode auth "GigaChat (Sberbank)"
```

OpenCode надежно зашифрует ваши Client Credentials и Scope и сохранит их в своем внутреннем безопасном хранилище ключей. При этом указывать параметры `credentials` и `scope` в файле `opencode.json` в открытом виде **не требуется**.

---

## 3. Альтернативный способ: Переменные окружения

Если вы не хотите сохранять учетные данные в `opencode.json`, вы можете настроить их через переменные окружения вашей ОС:

```bash
# 1. Base64 Client Credentials (Client ID + Client Secret)
export GIGACHAT_CREDENTIALS="YOUR_BASE64_CREDENTIALS_HERE"

# 2. Scope (опционально, по умолчанию GIGACHAT_API_PERS)
export GIGACHAT_SCOPE="GIGACHAT_API_PERS"
```

Плагин автоматически обнаружит переменные окружения `GIGACHAT_CREDENTIALS` и `GIGACHAT_SCOPE` и применит их как резервный вариант при отсутствии параметров в `opencode.json` или в хранилище OpenCode.

---

## 4. Настройки SSL и Сертификатов

Плагин поставляется со встроенными сертификатами Минцифры РФ, поэтому ручная настройка SSL не обязательна.

Однако, если вы хотите использовать внешние сертификаты, загрузите их в PEM-формате в папку `~/.config/opencode/certs/` и объедините в один файл `russian_trusted_root_ca.pem`:

```bash
cat root.crt sub.crt > ~/.config/opencode/certs/russian_trusted_root_ca.pem
```

Для переопределения путей к сертификатам используйте переменные окружения:
*   `GIGACHAT_CA_BUNDLE_FILE` — абсолютный путь к PEM-файлу сертификата.
*   `GIGACHAT_VERIFY_SSL` — установите в `false` для отключения проверки SSL (не рекомендуется для продакшена).
