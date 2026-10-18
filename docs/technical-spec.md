# Техническое задание MVP

## Цель

Разработать MVP Telegram-бота, который автоматически собирает новости про AI и нейросети из RSS-источников, фильтрует их через OpenAI, сохраняет результаты в PostgreSQL и публикует лучшие материалы в Telegram-канал.

## Актуальный стек

| Компонент | Технология | Версия в проекте |
| --- | --- | --- |
| Runtime | Node.js | 22.x |
| Язык | TypeScript | 5.9.x |
| Фреймворк | NestJS | 11.x |
| Конфигурация | @nestjs/config | 4.x |
| Расписание | @nestjs/schedule | 6.x |
| HTTP-клиент | @nestjs/axios | 4.x |
| База данных | PostgreSQL | 16 (docker-compose) |
| ORM и миграции | TypeORM / @nestjs/typeorm / pg | 1.x / 12.x / 8.x |
| Telegram-бот | nestjs-telegraf / telegraf | 2.x / 4.x |
| RSS | rss-parser | 3.x |
| AI | OpenAI SDK | 6.x |

Примечания по версиям:

- Используем свежий совместимый стек, а не версии из исходного черновика ТЗ.
- `nestjs-telegraf` актуален в npm как `2.9.x`; версии `8.x` для этого пакета нет.
- Работа с БД идёт через TypeORM поверх драйвера `pg`: схема описана entity-классами, изменения схемы — только через миграции (`synchronize: false`). Нативных модулей в зависимостях нет.
- Разовый импорт из старой SQLite-базы читает файл встроенным `node:sqlite` (Node ≥ 22.13), отдельный пакет для этого не нужен.
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
│   │   ├── data-source.ts          # DataSource для TypeORM CLI
│   │   ├── typeorm.options.ts      # общие опции для приложения и CLI
│   │   ├── entities/
│   │   │   ├── news.entity.ts
│   │   │   ├── feedback.entity.ts
│   │   │   └── app-state.entity.ts
│   │   ├── repositories/
│   │   │   ├── news.repository.ts
│   │   │   ├── feedback.repository.ts
│   │   │   └── app-state.repository.ts
│   │   └── migrations/
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
├── scripts/
│   └── import-sqlite.ts            # разовый импорт из старой SQLite-базы
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
└── nest-cli.json
```

Слой данных построен на PostgreSQL и TypeORM; доступ к таблицам идёт через репозитории (`NewsRepository`, `FeedbackRepository`, `AppStateRepository`), а не через общий сервис.

## Переменные окружения

```env
# Telegram: пусто = без публикации (polling не запускается)
BOT_TOKEN=
CHANNEL_ID=

# OpenAI: пусто = AI-фильтрация пропускается
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

# Database (совпадает с docker-compose.yml)
DATABASE_URL=postgres://ainews:ainews@localhost:5432/ainews
DB_SSL=false

# Runtime settings
MIN_HYPE_SCORE=6
FETCH_INTERVAL_MINUTES=180
NEWS_PER_DAY_LIMIT=15
DAY_BOUNDARY_TIMEZONE=UTC
ADMIN_USER_IDS=
```

Файл `.env` не должен попадать в репозиторий. В проекте хранится только `.env.example`.

Если `BOT_TOKEN` не задан, Telegram polling не запускается, чтобы локальные smoke-проверки могли стартовать без секретов. С реальным `BOT_TOKEN` модуль запускается через `nestjs-telegraf`.

Числовые настройки парсятся как целые числа с безопасными границами:

- `MIN_HYPE_SCORE`: от `0` до `10`, по умолчанию `6`
- `FETCH_INTERVAL_MINUTES`: от `1`, по умолчанию `180`
- `NEWS_PER_DAY_LIMIT`: от `1`, по умолчанию `15`
- `DAY_BOUNDARY_TIMEZONE`: IANA-таймзона (например `Asia/Ho_Chi_Minh`), в которой начинается «сегодня» для дневного лимита; по умолчанию `UTC`, неверное значение заменяется на `UTC`
- `DATABASE_URL`: строка подключения к PostgreSQL; `DB_SSL=true` включает TLS для управляемых баз (Neon, Supabase, Railway)

## RSS-источники

В `src/news/parsers/sources.config.ts` используются 10 источников:

```ts
export const RSS_SOURCES = [
  { name: 'The Decoder', url: 'https://the-decoder.com/feed/', category: 'news' },
  { name: 'Marktechpost', url: 'https://marktechpost.com/feed/', category: 'research' },
  { name: 'OpenAI Blog', url: 'https://openai.com/news/rss.xml', category: 'official' },
  {
    name: 'DeepLearning.ai',
    url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_the_batch.xml',
    category: 'education',
  },
  { name: 'MIT News AI', url: 'http://news.mit.edu/rss/topic/artificial-intelligence2', category: 'research' },
  { name: 'Google AI Blog', url: 'https://feeds.feedburner.com/GoogleAIBlog', category: 'official' },
  {
    name: 'Meta AI',
    url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_meta_ai.xml',
    category: 'official',
  },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', category: 'opensource' },
  {
    name: 'Towards Data Science',
    url: 'https://medium.com/feed/towards-data-science/tagged/artificial-intelligence',
    category: 'articles',
  },
  { name: 'Analytics Vidhya', url: 'https://www.analyticsvidhya.com/feed/', category: 'articles' },
];
```

Каждый источник обрабатывается изолированно: ошибка одного RSS не должна останавливать общий цикл. Парсер отправляет `User-Agent`, ограничивает обработку одним запуском до 25 элементов на источник и пробует восстановить RSS с неэкранированными `&` в XML. На текущей проверке `Marktechpost` может отдавать CAPTCHA-страницу вместо RSS; это внешний риск источника, который логируется и не валит общий сбор.

## Команды бота

| Команда | Описание | Доступ |
| --- | --- | --- |
| `/start` | Приветствие, описание канала и базовые кнопки | Все пользователи |
| `/latest` | Последние 5 сохранённых/одобренных новостей | Все пользователи |
| `/help` | Список команд | Все пользователи |
| `/stats` | Статистика по базе и публикациям | Только `ADMIN_USER_IDS` |

Команды реализуются через `nestjs-telegraf` decorators. `/latest` отдаёт последние 5 AI-одобренных новостей из PostgreSQL, `/stats` проверяет Telegram user id по `ADMIN_USER_IDS`.

## Основной цикл

1. `SchedulerService` проверяет расписание раз в минуту и запускает цикл, когда прошёл `FETCH_INTERVAL_MINUTES`. Время последнего запуска хранится в таблице `app_state` (`scheduler.last_run_at`), поэтому перезапуск или редеплой не сдвигает следующий цикл.
2. RSS-парсер обходит все источники и нормализует элементы.
3. Новые URL сохраняются в PostgreSQL, дубли игнорируются на уровне уникального ограничения (`INSERT ... ON CONFLICT DO NOTHING`).
4. Непроверенные новости последовательно отправляются в OpenAI через `AiService`.
5. AI возвращает structured JSON с `hypeScore`, `newTitle`, `summary`.
6. Новости с `hypeScore >= MIN_HYPE_SCORE` считаются одобренными.
7. `SchedulerService` выбирает топ по `hype_score`, учитывает `NEWS_PER_DAY_LIMIT` и публикует через `TelegramService`.
8. После успешной публикации новость помечается как опубликованная.

Scheduler не публикует новости сразу при старте приложения: первый автоматический запуск произойдёт только после истечения `FETCH_INTERVAL_MINUTES`. Если `OPENAI_API_KEY` не настроен, AI-фильтрация пропускается без падения приложения. Если `BOT_TOKEN` или `CHANNEL_ID` не настроены, Telegram-публикация пропускается без отметки новостей как опубликованных. Если OpenAI временно недоступен или отдельный ответ невалиден, новость остаётся непроверенной и будет обработана в следующем цикле. Публиковать новости без AI-одобрения не нужно, чтобы сохранить правило `hypeScore >= 6`.

## Формат поста в Telegram

```text
{hypeScore >= 9 ? '🔥' : '🤖'} {новый_заголовок}

{краткое_содержание_2_предложения}

🔗 Читать полностью: {url}

🏷️ #{категория} #AI #News
```

Посты отправляются в `parse_mode: HTML`; заголовок, summary и URL экранируются перед отправкой. Batch-публикация делает паузу минимум 3 секунды между постами.

Под постом должны быть inline-кнопки:

- `👍 Полезно`
- `👎 Не очень`

Callback data имеет формат `feedback:{like|dislike}:{newsId}`. Повторная реакция пользователя обновляет существующий feedback.

Кнопку обсуждения можно добавить позже, когда будет известна ссылка на чат или политика комментариев канала.

## Схема базы данных

Источник истины — entity-классы в `src/database/entities/` и миграции в `src/database/migrations/`. Ниже эквивалентный DDL PostgreSQL:

```sql
CREATE TABLE news (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    original_title TEXT,
    summary TEXT,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT,
    published_at TIMESTAMPTZ,
    hype_score SMALLINT,
    is_posted BOOLEAN NOT NULL DEFAULT false,
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_news_url UNIQUE (url),
    CONSTRAINT chk_news_hype_score CHECK (hype_score IS NULL OR (hype_score >= 0 AND hype_score <= 10))
);

CREATE TABLE feedback (
    id SERIAL PRIMARY KEY,
    news_id INTEGER NOT NULL,
    user_id BIGINT NOT NULL,
    feedback_type VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_feedback_news_user UNIQUE (news_id, user_id),
    CONSTRAINT chk_feedback_type CHECK (feedback_type IN ('like', 'dislike')),
    CONSTRAINT fk_feedback_news FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE
);

CREATE TABLE app_state (
    key VARCHAR(128) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_news_posted_hype ON news(is_posted, hype_score);
CREATE INDEX idx_news_created_at ON news(created_at);
```

`hype_score = NULL` означает, что новость ещё не проверена AI. `hype_score = 0` означает, что новость отклонена. Feedback идемпотентен: повторное нажатие пользователем обновляет его реакцию к новости (`INSERT ... ON CONFLICT DO UPDATE`), а не создаёт дубли. `user_id` хранится как `BIGINT`, потому что Telegram-идентификаторы выходят за диапазон int32. `app_state` — маленькая key-value таблица для состояния, которое должно переживать рестарты.

### Миграции

```bash
docker compose up -d                                                # локальный PostgreSQL
npm run migration:generate -- src/database/migrations/<ИмяМиграции> # сгенерировать по изменениям entity
npm run migration:run                                               # применить вручную
npm run migration:revert                                            # откатить последнюю
```

При старте приложение само применяет неприменённые миграции (`migrationsRun: true`). Одноразовый перенос данных из старой базы: `npm run import:sqlite -- [путь/к/news.db] [--dry-run]`.

## Промпт AI-фильтрации

В `src/ai/prompts/filter.prompt.ts` используется шкала:

- `0-3`: не про AI, реклама, кликбейт
- `4-5`: слабо связано с AI, неинтересно
- `6-8`: полезно, хорошая новость
- `9-10`: прорыв, срочная новость, эксклюзив

Модель задаётся через `OPENAI_MODEL`, по умолчанию `gpt-4o-mini`. Для OpenAI SDK 6 используется Responses API со structured output `json_schema`; дополнительно результат валидируется в `AiService`.

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
| 8 | PostgreSQL сохраняет все новые новости, схема создаётся миграциями |
| 9 | Дубли по URL не сохраняются и не публикуются повторно |
| 10 | Под постом есть кнопки `👍` и `👎` |
| 11 | Планировщик запускает цикл по `FETCH_INTERVAL_MINUTES` |
| 12 | Между публикациями есть пауза минимум 3 секунды |
| 13 | Ключевые действия и ошибки логируются через NestJS `Logger` |

## Проверки

- `docker compose up -d` и `npm run migration:run` на пустой базе, затем `npm run migration:revert` и повторный `migration:run`
- `npm run build`
- `npm run typecheck`
- `npm audit --audit-level=moderate`
- Smoke-проверка RSS без Telegram/OpenAI-секретов
- Интеграционная проверка Telegram/OpenAI только с реальными значениями `.env`
