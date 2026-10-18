# AI News Bot

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/node-%3E%3D22.13-339933?logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)

A Telegram bot that collects AI news from RSS feeds, lets OpenAI score and rewrite each item, and publishes
the best ones to a channel, with like/dislike buttons under every post.

The bot is built as a NestJS modular monolith on PostgreSQL and TypeORM. Channel content (rewritten headlines
and summaries) is in Russian.

> **Status:** the bot works end to end locally. Automated tests, a hosted deployment, an admin REST API with
> JWT auth and a Next.js admin panel are planned (see the [Roadmap](#roadmap)).

## What it does

```mermaid
flowchart LR
  RSS["10 RSS feeds"] --> Parser["RssParser"]
  Parser -->|"normalize, dedupe by URL"| DB[("PostgreSQL")]
  DB -->|"unreviewed items"| AI["AiService (OpenAI)"]
  AI -->|"score, new title, summary"| DB
  DB -->|"top by score, daily limit"| TG["TelegramService"]
  TG --> Channel["Telegram channel"]
  Channel -->|"like / dislike"| Update["TelegramUpdate"]
  Update --> DB
  Scheduler["SchedulerService"] -.->|"every FETCH_INTERVAL_MINUTES"| Parser
```

1. **Collect.** The scheduler fetches 10 AI-related RSS feeds. Each source is isolated, so one broken feed
   never stops the cycle. New items are stored; duplicates are dropped by URL.
2. **Filter.** Every unreviewed item goes to OpenAI, which returns a score from 0 to 10, a short headline and a
   two-sentence summary. Anything scored below 6 is rejected.
3. **Publish.** The top-scored approved items are posted to the channel, up to a daily limit, with a pause between
   posts. Readers react with 👍 / 👎, and the reaction is stored per user.

## Tech stack

| Area | Technology |
| --- | --- |
| Framework | NestJS 11 (modules, DI, `@nestjs/config`, `@nestjs/schedule`) |
| Language | TypeScript 5.9, Node.js 22 |
| Database | PostgreSQL 16, TypeORM 1.x with migrations, `pg` driver |
| AI | OpenAI Responses API with strict `json_schema` structured output |
| Telegram | Telegraf via `nestjs-telegraf` |
| Feeds | `rss-parser` |
| Local infra | Docker Compose (PostgreSQL) |

## Architecture

| Module | Responsibility |
| --- | --- |
| `SchedulerModule` | Runs the collect → filter → publish cycle on an interval and persists the last run time |
| `NewsModule` | RSS ingestion (`RssParser`) and the filtering workflow (`NewsService`) |
| `AiModule` | OpenAI client, scoring prompt, response validation |
| `TelegramModule` | Channel publishing, bot commands, feedback buttons |
| `DatabaseModule` | TypeORM connection, entities, migrations and one repository per aggregate |

Design decisions worth knowing:

- **Idempotent writes.** News is inserted with `INSERT … ON CONFLICT DO NOTHING`, and feedback is an upsert on
  `(news_id, user_id)`, so retries and repeated clicks never create duplicates.
- **Validated AI output.** The model is asked for strict JSON via `json_schema`, and the response is validated
  again in code before anything is saved. If OpenAI fails, the item stays unreviewed and is retried next cycle.
- **State that survives restarts.** The time of the last cycle lives in the `app_state` table, so a redeploy does
  not postpone the next run by a full interval.
- **Timezone-aware daily limit.** "Today" starts at midnight in `DAY_BOUNDARY_TIMEZONE`, not in the server's zone.
- **Telegram ids are `bigint`.** User ids exceed the 32-bit range, and the entity maps them back to numbers.
- **Schema only through migrations.** `synchronize` is off. Pending migrations run on startup, and the TypeORM
  CLI shares its options with the app.
- **Runs without secrets.** Without `BOT_TOKEN` the bot does not start polling, and without `OPENAI_API_KEY` AI
  filtering is skipped. RSS collection still works, which makes local runs easy.

## Data model

```mermaid
erDiagram
  NEWS ||--o{ FEEDBACK : "rated by"
  NEWS {
    int id PK
    text title
    text original_title
    text summary
    text source
    text url UK
    text category
    timestamptz published_at
    smallint hype_score "NULL = not reviewed, 0 = rejected"
    boolean is_posted
    timestamptz posted_at
    timestamptz created_at
  }
  FEEDBACK {
    int id PK
    int news_id FK
    bigint user_id
    varchar feedback_type "like or dislike"
    timestamptz created_at
  }
  APP_STATE {
    varchar key PK
    text value
    timestamptz updated_at
  }
```

## Getting started

**Requirements:** Node.js 22.13 or newer and Docker.

```bash
git clone https://github.com/a1lexandrv/news-tg-bot.git
cd news-tg-bot
npm install
cp .env.example .env
docker compose up -d      # PostgreSQL on localhost:5432
npm run start:dev         # migrations are applied on startup
```

With the default `.env.example` values the app starts without Telegram or OpenAI credentials. To see it work
quickly, set `FETCH_INTERVAL_MINUTES=1` in `.env`: after about a minute the scheduler collects the RSS feeds and
logs how many items were fetched and stored. The first cycle always waits one full interval after the very first
start, so nothing is published the moment the app boots.

To publish for real, create a bot with [@BotFather](https://t.me/BotFather), add it as an administrator of your
channel, and fill in `BOT_TOKEN`, `CHANNEL_ID` and `OPENAI_API_KEY`.

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `BOT_TOKEN` | – | Telegram bot token. Without it polling is disabled |
| `CHANNEL_ID` | – | Channel to publish to, for example `@my_channel` |
| `OPENAI_API_KEY` | – | Without it AI filtering is skipped |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model used for scoring and rewriting |
| `DATABASE_URL` | `postgres://ainews:ainews@localhost:5432/ainews` | PostgreSQL connection string (matches `docker-compose.yml`) |
| `DB_SSL` | `false` | Enable TLS for managed PostgreSQL |
| `MIN_HYPE_SCORE` | `6` | Minimum score (0–10) to publish |
| `FETCH_INTERVAL_MINUTES` | `180` | Time between cycles |
| `NEWS_PER_DAY_LIMIT` | `15` | Maximum posts per day |
| `DAY_BOUNDARY_TIMEZONE` | `UTC` | IANA timezone that decides when a "day" starts, for example `Asia/Ho_Chi_Minh` |
| `ADMIN_USER_IDS` | – | Comma-separated Telegram ids allowed to use `/stats` |
| `PORT` | `3000` | HTTP port. The app has no HTTP routes yet |

The docker-compose credentials (`ainews` / `ainews`) are for local development only.

### Bot commands

| Command | Description | Access |
| --- | --- | --- |
| `/start` | Greeting and short description | Everyone |
| `/latest` | The 5 most recent approved items | Everyone |
| `/help` | List of commands | Everyone |
| `/stats` | Database and publishing statistics | `ADMIN_USER_IDS` only |

## Database and migrations

```bash
npm run migration:generate -- src/database/migrations/<Name>   # from entity changes
npm run migration:run                                          # apply pending migrations
npm run migration:revert                                       # undo the last one
```

The project started on SQLite. To move an old `data/news.db` into PostgreSQL once, run
`npm run import:sqlite -- [path/to/news.db] [--dry-run]`. It keeps ids, runs in one transaction, and
`--dry-run` shows the report without writing anything.

## Project structure

```text
src/
├── ai/          OpenAI service and scoring prompt
├── config/      typed configuration with safe fallbacks
├── database/    entities, repositories, migrations, TypeORM options
├── news/        RSS parser, feed list, filtering workflow
├── scheduler/   interval-based cycle
└── telegram/    channel publishing, commands, feedback buttons
scripts/         one-off SQLite → PostgreSQL import
docs/            technical specification (in Russian)
```

The original [technical specification](docs/technical-spec.md) is written in Russian.

## Roadmap

- [ ] Unit and integration tests, plus a CI pipeline
- [ ] Hosted deployment with a managed PostgreSQL
- [ ] Admin REST API: news moderation, feedback and statistics, with DTO validation and pagination
- [ ] JWT authentication and role guards for the admin API
- [ ] Next.js admin panel on top of the API

## License

[MIT](LICENSE) © 2026 a1lexandrv
