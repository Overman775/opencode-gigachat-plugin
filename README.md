# Плагин GigaChat для OpenCode

[![Лицензия: MIT](https://img.shields.io/badge/Лицензия-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/Язык-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Совместимость с OpenCode](https://img.shields.io/badge/OpenCode-Совместим-green.svg)](https://github.com/anomalyco/opencode)
[![СБЕР GigaChat](https://img.shields.io/badge/СБЕР-GigaChat-00C853.svg)](https://developers.sber.ru/docs/ru/gigachat/overview)

[English](README.en.md)

Плагин подключает GigaChat / GigaCode к [OpenCode](https://github.com/anomalyco/opencode).
Он преобразует запросы и ответы между форматами OpenAI и GigaChat API v1.

Плагин поддерживает текст, вызовы инструментов, потоковые ответы и загрузку изображений.
Он получает OAuth-токен и проверяет TLS-сертификаты при запросах к Сберу.

## Установка и сборка

Для установки нужен OpenCode. Для сборки из исходников нужен Node.js 18 или новее.

### Установка ZIP

Рекомендуемый формат: `gigachat-plugin.zip`. Архив содержит отдельные модули и готовые зависимости.

> Релиз `v1.0.0` содержит неполный JS-файл из трёх строк.
> Используйте `v1.0.1` или новее.

1. Скачайте `gigachat-plugin.zip` из [релиза v1.0.1](https://github.com/Overman775/opencode-gigachat-plugin/releases/tag/v1.0.1).
2. Закройте OpenCode.
3. Откройте терминал в папке со скачанным архивом.
4. Создайте папку плагинов:

   ```bash
   mkdir -p "$HOME/.config/opencode/plugins"
   ```

5. Распакуйте весь архив:

   ```bash
   unzip -o gigachat-plugin.zip -d "$HOME/.config/opencode/plugins"
   ```

После распаковки структура должна быть такой:

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
    ├── plugin/       # запросы, сообщения, инструменты и потоки
    ├── gigacode/     # авторизация, сертификаты и журнал
    └── vendor/       # зависимости и лицензии
```

Сохраняйте `gigachat-plugin.js` рядом с папкой `gigachat-plugin/`.
OpenCode загружает входной файл при запуске. Устанавливать зависимости через `npm install` не требуется.

Если в массиве `plugin` есть прежняя копия GigaChat-плагина, удалите её запись.
Сохраните записи остальных плагинов.

### Настройка конфигурации

1. Откройте `~/.config/opencode/opencode.json`. Если файла нет, создайте его.
2. Добавьте провайдера `GigaChat (Sberbank)` в раздел `provider`.

Минимальный конфиг:

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

Если в файле уже есть настройки, сохраните их. Добавьте только запись провайдера.

`https://api.gigachat.local/v1` служит виртуальным адресом.
Плагин отправляет запросы с этого адреса в `https://api.giga.chat/v1`.

Полный список моделей и параметры провайдера: [конфигурация](docs/CONFIGURATION.md).
Корпоративный адрес можно задать в `options.baseURL`.

### Вход

1. Запустите команду:

   ```bash
   opencode providers login --provider "GigaChat (Sberbank)"
   ```

2. Выберите scope своего аккаунта:

   | Scope | Тип аккаунта |
   | --- | --- |
   | `GIGACHAT_API_PERS` | Физическое лицо |
   | `GIGACHAT_API_B2B` | Бизнес |
   | `GIGACHAT_API_CORP` | Корпоративный API |

3. Вставьте ключ авторизации GigaChat в поле `API key`.

Используйте ключ Base64 из кабинета Sber Developers. Временный `access_token` для входа не подходит.
OpenCode сохранит ключ и scope в своём хранилище авторизации.

Если у вас отдельно Client ID и Client Secret, выполните `npm run encode-creds` в клонированном репозитории.
Команда создаст строку `Base64(Client_ID:Client_Secret)`.

Плагин проверяет OAuth при первом запросе к модели.
Альтернатива входу: переменные `GIGACHAT_CREDENTIALS` и `GIGACHAT_SCOPE`.

### Запуск и проверка

1. Откройте терминал в папке своего проекта.
2. Запустите OpenCode:

   ```bash
   opencode --model "GigaChat (Sberbank)/GigaChat"
   ```

3. Отправьте запрос: «Ответь одним словом: работает».
4. Проверьте инструмент запросом: «Покажи файлы текущего проекта».

Для вывода журнала добавьте `--print-logs` к команде запуска.
Если запрос завершился ошибкой, откройте [руководство по ошибкам](docs/TROUBLESHOOTING.md).

### Обновление

1. Закройте OpenCode.
2. Распакуйте новый ZIP целиком поверх прежней установки.
3. Запустите OpenCode.

Ключ и конфиг хранятся отдельно от файлов плагина. Этот README входит в архив.

### Установка одним JS-файлом

Отдельный файл `gigachat-plugin.js` из релиза содержит все модули и зависимости.

1. Создайте папку плагинов:

   ```bash
   mkdir -p "$HOME/.config/opencode/plugins"
   ```

2. Скопируйте файл вместо входного файла из ZIP:

   ```bash
   cp gigachat-plugin.js "$HOME/.config/opencode/plugins/gigachat-plugin.js"
   ```

3. Настройте провайдера и выполните вход по инструкции выше.

Одиночный файл генерируется без минификации и содержит пути исходных модулей.
Для чтения отдельных модулей используйте ZIP. Для разработки изменяйте `src/`.

### Сборка из исходников

1. Клонируйте репозиторий:

   ```bash
   git clone https://github.com/Overman775/opencode-gigachat-plugin.git
   ```

2. Откройте папку репозитория:

   ```bash
   cd opencode-gigachat-plugin
   ```

3. Установите зависимости:

   ```bash
   npm ci
   ```

4. Соберите плагин:

   ```bash
   npm run build:release
   ```

5. Проверьте код и готовые сборки:

   ```bash
   npm test
   npm run test:release
   ```

| Результат | Назначение |
| --- | --- |
| `dist/gigachat-plugin.zip` | Архив с модулями для установки |
| `dist/gigachat-plugin.js` | Одиночный файл для установки |
| `dist/release/` | Распакованная версия архива |
| `dist/index.js` | Входной файл для разработки; требует остальные модули `dist/` и npm-зависимости |

Сборка и обновление заменяют изменения в готовых файлах.

## Возможности и ограничения

- Плагин использует один аккаунт. Ключ можно сохранить через OpenCode, в конфиге или в переменных окружения.
- Если до истечения OAuth-токена осталось меньше 5 минут, следующий запрос обновляет токен. Срок возвращает сервер; обычно токен действует 30 минут.
- Одновременные запросы используют один запрос обновления токена.
- Плагин преобразует `tools` в `functions` и передаёт один вызов функции из сообщения.
- Плагин загружает изображения Base64 через `/files`, затем передаёт их идентификаторы в `attachments`.
- Плагин преобразует параметры `reasoning_effort` и `thinking` в системные инструкции. Подробнее: [параметры рассуждений](docs/MODEL-VARIANTS.md).
- При размере отдельной текстовой части сообщения больше 400 КБ плагин выводит предупреждение. Он не уменьшает эту часть автоматически.

Идентификаторы моделей: `GigaChat`, `GigaChat-2`, `GigaChat-2-Lite`, `GigaChat-Plus`, `GigaChat-Pro`, `GigaChat-2-Pro`, `GigaChat-Max`, `GigaChat-2-Max`.
Плагин заменяет `GigaChat-2-Lite` на `GigaChat-2`.

Лимиты контекста, ответа и поддержку изображений задавайте по [примеру конфигурации](docs/CONFIGURATION.md).
Для параметров рассуждений используйте [варианты моделей](docs/MODEL-VARIANTS.md).

## Сертификаты

Проверка TLS включена по умолчанию.
Плагин читает CA-бандл по заданному пути. Если файла нет, он использует встроенные сертификаты Минцифры.

Если нужен другой бандл, задайте путь в `options.caBundle` или `GIGACHAT_CA_BUNDLE_FILE`.
Для корпоративного прокси включите его CA-сертификат в бандл вместе с сертификатами Минцифры.

Бандл Минцифры можно подготовить командами:

```bash
mkdir -p "$HOME/.config/opencode/certs"
curl --fail --show-error --location -o "$HOME/.config/opencode/certs/root.crt" https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
curl --fail --show-error --location -o "$HOME/.config/opencode/certs/sub.crt" https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
cat "$HOME/.config/opencode/certs/root.crt" "$HOME/.config/opencode/certs/sub.crt" > "$HOME/.config/opencode/certs/russian_trusted_root_ca.pem"
rm "$HOME/.config/opencode/certs/root.crt" "$HOME/.config/opencode/certs/sub.crt"
```

Этот путь используется по умолчанию.
`verifySSL: false` отключает проверку TLS. Используйте это значение только для временной диагностики, затем верните `true`.

Если `verifySSL` не задан в конфиге, проверку можно временно отключить через `GIGACHAT_VERIFY_SSL=false`.

## Переменные окружения

Настройки провайдера и ключ из хранилища OpenCode имеют приоритет над переменными окружения.

| Переменная | Значение по умолчанию | Назначение |
| --- | --- | --- |
| `GIGACHAT_CREDENTIALS` | Нет | Ключ `Base64(Client_ID:Client_Secret)` |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` | Scope ключа из переменной окружения |
| `GIGACHAT_CA_BUNDLE_FILE` | `~/.config/opencode/certs/russian_trusted_root_ca.pem` | Путь к CA-бандлу |
| `GIGACHAT_VERIFY_SSL` | `true` | Проверка TLS; `false` только для диагностики |

## Документация

- [Конфигурация](docs/CONFIGURATION.md): параметры провайдера, модели и способы входа.
- [Параметры рассуждений](docs/MODEL-VARIANTS.md): варианты модели и поля ответа.
- [Ошибки](docs/TROUBLESHOOTING.md): причины и действия для проверки.
- [Архитектура](docs/ARCHITECTURE.md): модули, запросы, инструменты и сборка.
- [API](docs/GIGACHAT_API_SPEC.md): адреса, заголовки и примеры сообщений.
- [Статья автора](docs/HABR-ARTICLE.md): опыт подключения GigaChat к OpenCode.

## Лицензия и статус проекта

Лицензия: [MIT](LICENSE).

Проект создан как исследовательский прототип. Дальнейшая поддержка и развитие не планируются.
Для связи по исправлениям используйте Telegram из [профиля автора](https://github.com/Overman775).

При работе над преобразованием запросов и вызовами функций автор использовал решения из [ai-forever/gigachat](https://github.com/ai-forever/gigachat).
Проект независим от Сбербанка и команды GigaChat.
«GigaChat», «GigaCode» и «Сбер» зарегистрированы как товарные знаки ПАО Сбербанк.
