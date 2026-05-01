# Техническое задание MVP

## Цель

Разработать MVP Telegram-бота, который автоматически собирает новости про AI и нейросети из RSS-источников, фильтрует их через OpenAI, сохраняет результаты в SQLite и публикует лучшие материалы в Telegram-канал.

## Актуальный стек

| Компонент | Технология | Версия в проекте |
| --- | --- | --- |
| Runtime | Node.js | 22.x |
| Язык | TypeScript | 5.9.x |
| Фреймворк | NestJS | 11.x |
| Конфигурация | @nestjs/config | 4.x |
| Расписание | @nestjs/schedule | 6.x |
| HTTP-клиент | @nestjs/axios | 4.x |
| База данных | SQLite / better-sqlite3 | 12.x |
| Telegram-бот | nestjs-telegraf / telegraf | 2.x / 4.x |
| RSS | rss-parser | 3.x |
| AI | OpenAI SDK | 6.x |

Примечания по версиям:

- Используем свежий совместимый стек, а не версии из исходного черновика ТЗ.
- `nestjs-telegraf` актуален в npm как `2.9.x`; версии `8.x` для этого пакета нет.
- `better-sqlite3` используется в версии `12.x`, потому что она совместима с Node 22 и не требует ручной сборки в текущем окружении.
- TypeScript остаётся на `5.x`, так как это стабильная совместимая ветка для текущего набора NestJS/Telegraf-пакетов.

## Структура проекта

```text
ai-news-bot/
├── docs/
│   └── technical-spec.md
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   └── configuration.ts
│   ├── database/
│   │   ├── database.module.ts
│   │   ├── database.service.ts
│   │   └── entities/
│   │       └── news.entity.ts
│   ├── news/
│   │   ├── news.module.ts
│   │   ├── news.service.ts
│   │   └── parsers/
│   │       ├── rss.parser.ts
│   │       └── sources.config.ts
│   ├── ai/
│   │   ├── ai.module.ts
│   │   ├── ai.service.ts
│   │   └── prompts/
│   │       └── filter.prompt.ts
│   ├── telegram/
│   │   ├── telegram.module.ts
│   │   ├── telegram.update.ts
│   │   └── telegram.service.ts
│   └── scheduler/
│       ├── scheduler.module.ts
│       └── scheduler.service.ts
├── .env.example
├── package.json
├── tsconfig.json
└── nest-cli.json
```

На текущем этапе создан каркас проекта и реализован SQLite-слой. Остальные доменные сервисы будут добавляться поэтапно.

## Переменные окружения

```env
# Telegram
BOT_TOKEN=0000000000:replace_with_bot_token
CHANNEL_ID=@your_channel_name

# OpenAI
OPENAI_API_KEY=sk-proj-replace_with_api_key

# Database
DB_PATH=./data/news.db

# Runtime settings
MIN_HYPE_SCORE=6
FETCH_INTERVAL_MINUTES=180
NEWS_PER_DAY_LIMIT=15
ADMIN_USER_IDS=
```

Файл `.env` не должен попадать в репозиторий. В проекте хранится только `.env.example`.

Числовые настройки парсятся как целые числа с безопасными границами:

- `MIN_HYPE_SCORE`: от `0` до `10`, по умолчанию `6`
- `FETCH_INTERVAL_MINUTES`: от `1`, по умолчанию `180`
- `NEWS_PER_DAY_LIMIT`: от `1`, по умолчанию `15`

## RSS-источники

В `src/news/parsers/sources.config.ts` используются 10 источников:

```ts
export const RSS_SOURCES = [
  { name: 'The Decoder', url: 'https://the-decoder.com/rss/', category: 'news' },
  { name: 'Marktechpost', url: 'https://marktechpost.com/feed/', category: 'research' },
  { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss', category: 'official' },
  { name: 'DeepLearning.ai', url: 'https://www.deeplearning.ai/feed/', category: 'education' },
  { name: 'MIT News AI', url: 'http://news.mit.edu/rss/topic/artificial-intelligence2', category: 'research' },
  { name: 'Google AI Blog', url: 'https://feeds.feedburner.com/GoogleAIBlog', category: 'official' },
  { name: 'Meta AI', url: 'https://ai.meta.com/blog/feed/', category: 'official' },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', category: 'opensource' },
  { name: 'Towards Data Science', url: 'https://towardsdatascience.com/feed/tagged/ai', category: 'articles' },
  { name: 'Analytics Vidhya', url: 'https://www.analyticsvidhya.com/feed/', category: 'articles' },
];
```

Каждый источник должен обрабатываться изолированно: ошибка одного RSS не должна останавливать общий цикл.

## Команды бота

| Команда | Описание | Доступ |
| --- | --- | --- |
| `/start` | Приветствие, описание канала и базовые кнопки | Все пользователи |
| `/latest` | Последние 5 сохранённых/одобренных новостей | Все пользователи |
| `/help` | Список команд | Все пользователи |
| `/stats` | Статистика по базе и публикациям | Только `ADMIN_USER_IDS` |

## Основной цикл

1. По расписанию запускается сбор новостей.
2. RSS-парсер обходит все источники и нормализует элементы.
3. Новые URL сохраняются в SQLite, дубли игнорируются на уровне уникального индекса.
4. Непроверенные новости отправляются в OpenAI.
5. AI возвращает JSON с `hypeScore`, `newTitle`, `summary`.
6. Новости с `hypeScore >= MIN_HYPE_SCORE` считаются одобренными.
7. `NewsService` выбирает топ по `hype_score`, учитывает `NEWS_PER_DAY_LIMIT` и публикует через `TelegramService`.
8. После успешной публикации новость помечается как опубликованная.

Если OpenAI временно недоступен, новость остаётся непроверенной и будет обработана в следующем цикле. Публиковать новости без AI-одобрения не нужно, чтобы сохранить правило `hypeScore >= 6`.

## Формат поста в Telegram

```text
{hypeScore >= 9 ? '🔥' : '🤖'} {новый_заголовок}

{краткое_содержание_2_предложения}

🔗 Читать полностью: {url}

🏷️ #{категория} #AI #News
```

Под постом должны быть inline-кнопки:

- `👍 Полезно`
- `👎 Не очень`

Кнопку обсуждения можно добавить позже, когда будет известна ссылка на чат или политика комментариев канала.

## Схема базы данных

```sql
CREATE TABLE news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    original_title TEXT,
    summary TEXT,
    source TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    category TEXT,
    published_at INTEGER,
    hype_score INTEGER CHECK (hype_score IS NULL OR (hype_score >= 0 AND hype_score <= 10)),
    is_posted BOOLEAN DEFAULT 0,
    posted_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    feedback_type TEXT NOT NULL CHECK (feedback_type IN ('like', 'dislike')),
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (news_id) REFERENCES news(id)
);

CREATE UNIQUE INDEX idx_url ON news(url);
CREATE INDEX idx_posted ON news(is_posted, hype_score);
CREATE INDEX idx_created ON news(created_at);
CREATE UNIQUE INDEX idx_feedback_news_user ON feedback(news_id, user_id);
```

`hype_score = NULL` означает, что новость ещё не проверена AI. `hype_score = 0` означает, что новость отклонена. Feedback идемпотентен: повторное нажатие пользователем обновляет его реакцию к новости, а не создаёт бесконечные дубли.

## Промпт AI-фильтрации

В `src/ai/prompts/filter.prompt.ts` используется шкала:

- `0-3`: не про AI, реклама, кликбейт
- `4-5`: слабо связано с AI, неинтересно
- `6-8`: полезно, хорошая новость
- `9-10`: прорыв, срочная новость, эксклюзив

Модель должна вернуть только JSON:

```json
{
  "hypeScore": 8,
  "newTitle": "строка",
  "summary": "строка"
}
```

Если новость не про AI или оценка ниже 6, `hypeScore` должен быть `0`.

## Критерии готовности MVP

| # | Критерий |
| --- | --- |
| 1 | Проект собирается через `npm run build` |
| 2 | Бот запускается через `npm run start:dev` при наличии валидного `.env` |
| 3 | Бот отвечает на `/start`, `/latest`, `/help` |
| 4 | `/stats` доступна только администраторам из `ADMIN_USER_IDS` |
| 5 | Парсинг минимум 5 RSS-источников возвращает новости |
| 6 | GPT-фильтрация успешно получает и парсит JSON |
| 7 | В канал уходят только новости с `hypeScore >= MIN_HYPE_SCORE` |
| 8 | SQLite сохраняет все новые новости |
| 9 | Дубли по URL не сохраняются и не публикуются повторно |
| 10 | Под постом есть кнопки `👍` и `👎` |
| 11 | Планировщик запускает цикл по `FETCH_INTERVAL_MINUTES` |
| 12 | Между публикациями есть пауза минимум 3 секунды |
| 13 | Ключевые действия и ошибки логируются через NestJS `Logger` |

## Проверки

- `npm run build`
- `npm run typecheck`
- `npm audit --audit-level=moderate`
- Smoke-проверка RSS без Telegram/OpenAI-секретов
- Интеграционная проверка Telegram/OpenAI только с реальными значениями `.env`
