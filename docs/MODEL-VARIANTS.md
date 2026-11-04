# Модели и параметры рассуждений

Плагин поддерживает два режима для `reasoning_effort` и `thinking`.

* **Без инструментов** плагин передаёт флаг в GigaChat нативно. Цепочка рассуждений возвращается в `reasoning_content` и передаётся клиенту.
* **С инструментами** нативный флаг использовать нельзя: GigaChat отвечает `500`, если в запросе одновременно есть `functions` и `reasoning_effort`. В этом режиме плагин добавляет системную инструкцию.

## Нативный режим

| Параметр запроса | Поле запроса GigaChat |
| --- | --- |
| `reasoning_effort: "high"` | `reasoning_effort: "high"` |
| `reasoning_effort: "medium"` | `reasoning_effort: "medium"` |
| `reasoning_effort: "low"` | `reasoning_effort: "low"` |
| `reasoning_effort: "minimal"` | `reasoning_effort: "low"` |
| `thinking.budget_tokens > 1024` | `reasoning_effort: "high"` |
| `thinking.budget_tokens <= 1024` | `reasoning_effort: "medium"` |

Если запрос содержит оба параметра, плагин использует `reasoning_effort`.

## Режим с инструментами

| Параметр запроса | Действие плагина |
| --- | --- |
| `reasoning_effort: "high"` | Добавляет инструкцию подробного анализа |
| `reasoning_effort: "medium"` | Добавляет инструкцию пошагового рассуждения |
| `reasoning_effort: "low"` | Не добавляет инструкцию рассуждения |
| `thinking.budget_tokens > 1024` | Выбирает подробный анализ |
| `thinking.budget_tokens <= 1024` | Выбирает пошаговое рассуждение |

Инструкция добавляется к сообщению `system`.
Если системного сообщения нет, плагин создаёт его.

Тексты инструкций из кода:

```text
high:
\n[Системное руководство: Проанализируй задачу очень подробно, составь детальный пошаговый план решения и проведи глубокие рассуждения (Chain-of-Thought) перед тем, как выдать финальный ответ.]

medium:
\n[Системное руководство: Подумай пошагово перед тем, как выдать итоговый ответ.]
```

Это текстовые инструкции. Плагин не задаёт модели обязательный бюджет вычислений.

Агентские сессии OpenCode всегда передают инструменты, поэтому используют второй режим.
Первый режим включается в обычном чате без инструментов.

## Варианты в конфиге

1. Откройте `opencode.json`.
2. Добавьте `variants` к модели `GigaChat-2-Max` в разделе `provider["GigaChat (Sberbank)"].models`.

Пример записи модели:

```json
{
  "name": "GigaCode Max (Flagship)",
  "limit": { "context": 128000, "output": 8192 },
  "modalities": { "input": ["text", "image"], "output": ["text"] },
  "variants": {
    "low": { "reasoning_effort": "low" },
    "max": { "reasoning_effort": "high" }
  }
}
```

3. Запустите модель с вариантом `max`:

   ```bash
   opencode run "Напиши сложный алгоритм сортировки" --model "GigaChat (Sberbank)/GigaChat-2-Max" --variant=max
   ```

Вариант `max` задаёт `reasoning_effort: "high"`.
Плагин преобразует это поле, если OpenCode передаёт его в тело запроса.
Полный конфиг моделей приведён в [конфигурации](CONFIGURATION.md).

## Поле рассуждений в ответе

Если GigaChat возвращает `reasoning_content`, плагин сохраняет его в ответе для клиента.
Это относится к ответам `GigaChat-2-Max`, описанной в этом репозитории как модель с рассуждениями.

| Режим | Поле ответа |
| --- | --- |
| Обычный ответ | `choices[0].message.reasoning_content` |
| Поток SSE | `choices[0].delta.reasoning_content` |

Клиент может использовать это поле для вывода рассуждений.
Наличие поля зависит от ответа модели. Оно не гарантирует отображение рассуждений в OpenCode.
