# Коннектор-плагин OpenCode к GigaCode / GigaChat

[![Лицензия: MIT](https://img.shields.io/badge/Лицензия-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/Язык-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Совместимость с OpenCode](https://img.shields.io/badge/OpenCode-Совместим-green.svg)](https://github.com/anomalyco/opencode)
[![СБЕР GigaChat](https://img.shields.io/badge/СБЕР-GigaChat-00C853.svg)](https://developers.sber.ru/docs/ru/gigachat/overview)

[English version here](README.en.md)

Открытый плагин для консольного AI-ассистента **OpenCode** ([anomalyco/opencode](https://github.com/anomalyco/opencode)), обеспечивающий бесшовную интеграцию, трансляцию протоколов и прямое подключение моделей из экосистемы **GigaCode** / **GigaChat** от Сбера.

Плагин решает проблемы несовместимости протоколов OpenAI и GigaChat, берет на себя управление сетевой безопасностью в российских TLS-сетях, поддерживает мультимедиа-вложения и упрощает настройку авторизации, сохраняя учетные данные прямо в файле конфигурации или переменных окружения.

---

## Что вы получаете (Особенности)

* **Локальный транслятор протоколов (OpenAI $\leftrightarrow$ GigaChat)**: На лету перехватывает и адаптирует запросы к API GigaChat, вырезая несовместимые параметры, автоматически преобразуя параметры рассуждений (`reasoning_effort` / `thinking`) и приводя схемы вызовов функций (MCP-инструментов) к строгому стандарту Сбера. Подробнее см. в [Архитектуре плагина](docs/ARCHITECTURE.md) и [Спецификации GigaChat API](docs/GIGACHAT_API_SPEC.md).
* **Гибридный обход TLS (Встроенный CA-сертификат)**:
    > [!IMPORTANT]
    > **Работает из коробки!** Плагин реализует гибридный подход к сетевой безопасности: он сканирует систему на наличие сертификатов Минцифры РФ (Russian National CA). В случае их отсутствия плагин автоматически использует встроенный в код PEM-бандл доверенных корневых и выпускающих сертификатов Минцифры во внутренном `https.Agent` для всех OAuth и API-запросов. Вам больше не нужно отключать проверку SSL (`rejectUnauthorized: false`) или вручную устанавливать сертификаты.
* **Загрузка мультимедиа-вложений (Vision/Multimodal)**: Перехватывает base64-вложения (`image_url` в формате OpenAI), автоматически упаковывает их в Multipart Form Data и загружает на защищенные сервера Сбера через API `/files`. Полученный `file_id` встраивается как `attachment` в запрос перед отправкой в GigaChat.
* **Автоматическое обновление токенов OAuth**: Плагин полностью инкапсулирует логику авторизации по протоколу OAuth 2.0. Он кэширует полученный JWT-токен и превентивно обновляет его за 5 минут до истечения 30-минутного лимита. Семафорные блокировки предотвращают параллельные холостые запросы обновления при высокой нагрузке.
* **Конфигурация без лишних файлов (Single Account)**: Не требует создания вспомогательных файлов учетных записей. Ключи авторизации и тарифные планы задаются непосредственно в глобальном файле `opencode.json` в настройках провайдера или передаются через стандартные переменные окружения.
* **Адаптация инструментов (1-Tool Constraint)**: Учитывает жесткое ограничение API GigaChat — поддержка запуска строго одной функции за запрос. Плагин оптимизирует массив `tools`, позволяя OpenCode выполнять сложные многошаговые сценарии последовательно.
* **Предупреждения о размере запроса**: Встроенный анализатор объема данных предупреждает пользователя, если размер сообщения превышает 400 КБ, предотвращая падение запросов из-за переполнения контекстного окна (128K токенов).

---

## Установка и сборка

### Вариант А: Установка готового файла сборки из GitHub Releases (Рекомендуется)

1. Скачайте последнюю версию скомпилированного плагина `gigachat-plugin.js` со страницы [GitHub Releases](https://github.com/Overman775/opencode-gigachat-plugin/releases).
2. Скопируйте скачанный файл в папку плагинов OpenCode:

   ```bash
   mkdir -p "$HOME/.opencode/plugins"
   # Переместите загруженный файл gigachat-plugin.js в созданную папку
   cp path/to/downloaded/gigachat-plugin.js "$HOME/.opencode/plugins/gigachat-plugin.js"
   ```

3. Добавьте путь к файлу плагина в массив `plugin` в вашем конфигурационном файле `~/.config/opencode/opencode.json`:

   ```json
   {
     "plugin": [
       "./.opencode/plugins/gigachat-plugin.js"
     ]
   }
   ```

### Вариант Б: Быстрая установка с помощью LLM-ассистента

(Если вы хотите установить и скомпилировать локальную версию)
Просто вставьте этот промпт в любой LLM-агент (Claude Code, OpenCode, Cursor и т.д.) в корне вашего проекта OpenCode:

```text
Собери плагин opencode-gigachat-plugin и настроить его конфигурацию в ~/.config/opencode/opencode.json по инструкции из репозитория.
```

### Вариант В: Ручная сборка из исходников (Для разработчиков)

1. **Клонирование и сборка плагина**:

    ```bash
    git clone https://github.com/Overman775/opencode-gigachat-plugin.git
    cd opencode-gigachat-plugin
    npm install
    npm run build
    ```

    Скомпилированный JavaScript-файл плагина будет сохранен в `dist/index.js`.

2. **Копирование в директорию плагинов OpenCode**:

    ```bash
    mkdir -p "$HOME/.opencode/plugins"
    cp dist/index.js "$HOME/.opencode/plugins/gigachat-plugin.js"
    ```

    И укажите путь к нему в `opencode.json`:

    ```json
    {
      "plugin": [
        "./.opencode/plugins/gigachat-plugin.js"
      ]
    }
    ```

---

## Модели и параметры рассуждения (Thinking/Reasoning)

### Справочник моделей GigaChat

Добавьте эти модели в ваш `opencode.json`. Все модели поддерживают контекстное окно размером до 128 000 токенов.

| Идентификатор модели | Коммерческое имя | Поддержка Vision | Описание |
| :--- | :--- | :---: | :--- |
| `GigaChat` | GigaChat Classic (Text) | Нет | Классическая текстовая модель GigaChat. |
| `GigaChat-2` | GigaChat 2 (Text) | Нет | Новое поколение быстрой текстовой модели. |
| `GigaChat-2-Lite` | GigaChat 2 Lite (Alias) | Нет | Альянс-совместимый алиас для модели GigaChat-2. |
| `GigaChat-Plus` | GigaChat Plus (Text) | Нет | Расширенная текстовая модель GigaChat. |
| `GigaChat-Pro` | GigaChat Pro (Multimodal) | **Да** | Мультимодальная модель GigaChat. |
| `GigaChat-2-Pro` | GigaChat 2 Pro (Multimodal) | **Да** | Новое поколение мультимодальной модели GigaChat 2. |
| `GigaChat-Max` | GigaChat Max (Multimodal) | **Да** | Флагманская модель GigaChat с поддержкой мультимодальности. |
| `GigaChat-2-Max` | GigaChat 2 Max (Reasoning) | **Да** | Флагманская модель GigaChat 2 с улучшенными рассуждениями. |

### Поддержка рассуждений (Thinking Budget)

Поскольку официальный API GigaChat не поддерживает параметры `reasoning_effort` или `thinking` на уровне JSON-схемы запроса, плагин автоматически транслирует их в текстовые системные инструкции для модели, вырезая сами параметры из сетевого пакета во избежание ошибок:

* Параметр OpenAI `reasoning_effort` (`low`, `medium`, `high`) или объект `thinking` преобразуются в соответствующий пошаговый системный промпт (Chain-of-Thought):
  * `high` (или `budget_tokens` $>$ 1024 токенов) $\rightarrow$ добавляет в системный промпт требование детального анализа и глубоких рассуждений перед ответом.
  * `medium` (или `budget_tokens` $\le$ 1024 токенов) $\rightarrow$ добавляет требование пошагового рассуждения.
  * `low` $\rightarrow$ не добавляет дополнительных инструкций (обычный быстрый режим ответа).

---

## Настройка конфигурации

### Шаг 1. Настройка глобального `opencode.json`

Добавьте провайдера `GigaChat (Sberbank)` и зарегистрируйте локальный JS-файл плагина в глобальном конфигурационном файле OpenCode (обычно расположен по пути `~/.config/opencode/opencode.json`):

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
> Базовый URL `https://api.gigachat.local/v1` является виртуальным адресом по умолчанию. Chat-запросы к нему транслируются в legacy-compatible endpoint `https://gigachat.devices.sberbank.ru/api/v1/chat/completions`, потому что текущий адаптер использует контракт `messages/functions/function_call`.
> Плагин также поддерживает кастомные адреса корпоративных прокси-серверов (например, `https://gigachat-proxy.company.ru/v1`). Перехват включается только для известных host-ов или запросов с marker header, поэтому Bearer-токен не отправляется на сторонний URL, где `api.gigachat.local` просто встречается в path/query.

### Шаг 2. Настройка TLS/SSL сертификатов и обход проверки

В связи с тем, что API GigaChat использует сертификаты Минцифры РФ, при подключении в Node.js может возникнуть ошибка `CERT_SIGNATURE_FAILURE` или `unable to verify the first certificate`. У вас есть два пути решения:

#### Способ 1: Отключение проверки SSL в opencode.json

Для быстрого обхода проблем с сертификатами (особенно при работе за прокси/VPN) просто добавьте флаг `"verifySSL": false` в параметры провайдера внутри `opencode.json`:

```json
"provider": {
  "GigaChat (Sberbank)": {
    "options": {
      "baseURL": "https://api.gigachat.local/v1",
      "credentials": "...",
      "verifySSL": false
    }
  }
}
```

*(Альтернативно, вы можете запустить OpenCode с переменной окружения `GIGACHAT_VERIFY_SSL="false"`)*

#### Способ 2: Установка сертификатов Минцифры РФ (Для безопасного соединения)

Чтобы Node.js доверял полной цепочке сертификатов шлюза Сбера, скачайте и объедините корневой и выпускающий сертификаты Минцифры:

```bash
mkdir -p "$HOME/.config/opencode/certs"
curl -sSL -k -o "$HOME/.config/opencode/certs/root.crt" https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
curl -sSL -k -o "$HOME/.config/opencode/certs/sub.crt" https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
cat "$HOME/.config/opencode/certs/root.crt" "$HOME/.config/opencode/certs/sub.crt" > "$HOME/.config/opencode/certs/russian_trusted_root_ca.pem"
rm "$HOME/.config/opencode/certs/root.crt" "$HOME/.config/opencode/certs/sub.crt"
```

После этого плагин автоматически подхватит файл по пути по умолчанию (`~/.config/opencode/certs/russian_trusted_root_ca.pem`). При необходимости вы можете явно указать путь через переменную окружения `GIGACHAT_CA_BUNDLE_FILE`.

---

## Переменные окружения

Вы можете настраивать поведение плагина с помощью следующих переменных окружения (в качестве резерва при отсутствии настроек в `opencode.json`):

| Переменная окружения | Обязательная | Значение по умолчанию | Описание |
| :--- | :---: | :--- | :--- |
| `GIGACHAT_CREDENTIALS` | Нет | Нет | Базовые учетные данные GigaChat (Base64 строка Client ID:Client Secret). |
| `GIGACHAT_SCOPE` | Нет | `GIGACHAT_API_PERS` | Область авторизации API для ключа из переменной окружения (`GIGACHAT_API_PERS` / `GIGACHAT_API_CORP` / `GIGACHAT_API_B2B`). |
| `GIGACHAT_CA_BUNDLE_FILE` | Нет | `~/.config/opencode/certs/russian_trusted_root_ca.pem` | Путь к собственному PEM-файлу корневых сертификатов Минцифры РФ. |
| `GIGACHAT_VERIFY_SSL` | Нет | `true` | Если установить в `false`, проверка TLS-сертификатов будет отключена (используйте только для отладки). |

---

## Решение проблем (Troubleshooting)

### 1. Ошибки сертификатов TLS (Self-signed certificate in chain / UNABLE_TO_VERIFY_LEAF_SIGNATURE)

* **Причина**: Ваша среда выполнения Node.js не доверяет шлюзу Сбера `ngw.devices.sberbank.ru`, так как он подписан государственным CA.
* **Решение**:
    1. Убедитесь, что вы не переопределили переменную `GIGACHAT_VERIFY_SSL="true"` при отсутствии валидного файла сертификата.
    2. По умолчанию плагин автоматически применяет встроенные сертификаты. Если вы получаете эту ошибку, проверьте, доступна ли папка `~/.config/opencode/certs/` на чтение, или временно очистите переменную `GIGACHAT_CA_BUNDLE_FILE`, чтобы принудительно использовать встроенный PEM-бандл.
    3. В крайнем случае, для корпоративных VPN-сетей с собственными прокси, установите `GIGACHAT_VERIFY_SSL="false"`.

### 2. Ошибка "GigaChat credentials are not configured"

* **Причина**: Ключ credentials не настроен ни в `opencode.json`, ни в переменных окружения.
* **Решение**:
    1. Проверьте правильность заполнения ключа `credentials` и `scope` в `opencode.json` в секции `provider.gigachat.options`.
    2. Убедитесь, что скоуп (`scope`) соответствует типу вашего кабинета на портале Сбер Салют (например, физические лица используют только `GIGACHAT_API_PERS`).
    3. Проверьте правильность экспорта переменных окружения `GIGACHAT_CREDENTIALS` в вашей терминальной сессии.

### 3. Ошибка "Payload Too Large" (HTTP 413) или некорректный ответ

* **Причина**: Вы передаете слишком много кода или тяжелые файлы в контекст запроса. Лимит одного сетевого пакета GigaChat API составляет около 10 МБ.
* **Решение**:
    1. Обратите внимание на предупреждения плагина в консоли: `[GigaCode-Plugin] WARNING: Content size is large`.
    2. Исключите тяжелые бинарные файлы или папки с зависимостями (например, `node_modules`, `.git`, `dist`) из контекста отправки с помощью файла `.opencodeignore`.

---

## Документация

* [Архитектура плагина](docs/ARCHITECTURE.md) — внутреннее устройство и жизненный цикл событий.
* [Настройка конфигурации](docs/CONFIGURATION.md) — подробные параметры настроек и файлов конфигурации.
* [Варианты моделей и рассуждения](docs/MODEL-VARIANTS.md) — глубина мыслей и бюджетирование токенов.
* [Решение проблем](docs/TROUBLESHOOTING.md) — руководство по устранению сетевых сбоев и ошибок авторизации.
* [Спецификация API GigaChat](docs/GIGACHAT_API_SPEC.md) — форматы обмена данными и API-эндпоинты Сбера.

---

## Лицензия

Этот проект распространяется под свободной лицензией MIT. Подробности читайте в файле [LICENSE](LICENSE).

---

### Дисклеймер

* Этот проект является экспериментальной разработкой, созданной исключительно в рамках исследования и в качестве Proof of Concept (PoC). Дальнейшая поддержка или развитие проекта не планируются. Если вам крайне необходимо связаться по поводу исправлений или доработок проекта, пишите в Telegram (контакты автора можно найти в его профиле на GitHub).
* При проектировании трансляционного слоя и логики вызова функций (Function Calling) я во многом опирался на технические решения и код официальных клиентов из репозитория [ai-forever/gigachat](https://github.com/ai-forever/gigachat).
* Проект является независимым решением с открытым исходным кодом и не аффилирован со Сбербанком или командой разработки GigaChat.
* Названия "GigaChat", "GigaCode" и "Сбер" являются зарегистрированными товарными знаками ПАО Сбербанк.
