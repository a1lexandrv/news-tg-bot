import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database = require('better-sqlite3');
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { AppConfig } from '../config/configuration';
import { NewsEntity } from './entities/news.entity';

export interface CreateNewsInput {
  title: string;
  originalTitle?: string | null;
  summary?: string | null;
  source: string;
  url: string;
  category?: string | null;
  publishedAt?: number | null;
}

export interface AiResultInput {
  title: string;
  summary: string;
  hypeScore: number;
}

export interface FeedbackInput {
  newsId: number;
  userId: number;
  feedbackType: 'like' | 'dislike';
}

export interface DatabaseStats {
  totalNews: number;
  postedToday: number;
  filteredByAi: number;
  pendingAiReview: number;
}

interface NewsRow {
  id: number;
  title: string;
  original_title: string | null;
  summary: string | null;
  source: string;
  url: string;
  category: string | null;
  published_at: number | null;
  hype_score: number | null;
  is_posted: 0 | 1;
  posted_at: number | null;
  created_at: number;
}

interface CountRow {
  count: number;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private db: Database.Database | null = null;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  onModuleInit(): void {
    const databasePath = this.getDatabasePath();

    mkdirSync(dirname(databasePath), { recursive: true });

    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();

    this.logger.log(`SQLite database is ready: ${databasePath}`);
  }

  onModuleDestroy(): void {
    this.db?.close();
    this.db = null;
  }

  insertNewsBatch(items: CreateNewsInput[]): { inserted: number; skipped: number } {
    if (items.length === 0) {
      return { inserted: 0, skipped: 0 };
    }

    const db = this.getDb();
    const statement = db.prepare(`
      INSERT OR IGNORE INTO news (
        title,
        original_title,
        summary,
        source,
        url,
        category,
        published_at
      )
      VALUES (
        @title,
        @originalTitle,
        @summary,
        @source,
        @url,
        @category,
        @publishedAt
      )
    `);

    const insertMany = db.transaction((newsItems: CreateNewsInput[]) => {
      let inserted = 0;

      for (const item of newsItems) {
        const result = statement.run({
          title: item.title,
          originalTitle: item.originalTitle ?? item.title,
          summary: item.summary ?? null,
          source: item.source,
          url: item.url,
          category: item.category ?? null,
          publishedAt: item.publishedAt ?? null,
        });

        inserted += result.changes;
      }

      return inserted;
    });

    const inserted = insertMany(items);

    return {
      inserted,
      skipped: items.length - inserted,
    };
  }

  findUnprocessedNews(limit = 20): NewsEntity[] {
    const rows = this.getDb()
      .prepare(
        `
        SELECT *
        FROM news
        WHERE hype_score IS NULL
        ORDER BY published_at DESC NULLS LAST, created_at DESC
        LIMIT ?
      `,
      )
      .all(limit) as NewsRow[];

    return rows.map(this.mapNewsRow);
  }

  updateAiResult(newsId: number, result: AiResultInput): void {
    this.getDb()
      .prepare(
        `
        UPDATE news
        SET title = @title,
            summary = @summary,
            hype_score = @hypeScore
        WHERE id = @newsId
      `,
      )
      .run({
        newsId,
        title: result.title,
        summary: result.summary,
        hypeScore: result.hypeScore,
      });
  }

  findTopPublishableNews(options: { minHypeScore: number; limit: number }): NewsEntity[] {
    const rows = this.getDb()
      .prepare(
        `
        SELECT *
        FROM news
        WHERE is_posted = 0
          AND hype_score >= @minHypeScore
        ORDER BY hype_score DESC, published_at DESC NULLS LAST, created_at DESC
        LIMIT @limit
      `,
      )
      .all(options) as NewsRow[];

    return rows.map(this.mapNewsRow);
  }

  markAsPosted(newsId: number, postedAt = this.getUnixTime()): void {
    this.getDb()
      .prepare(
        `
        UPDATE news
        SET is_posted = 1,
            posted_at = @postedAt
        WHERE id = @newsId
      `,
      )
      .run({ newsId, postedAt });
  }

  findLatestNews(limit = 5): NewsEntity[] {
    const rows = this.getDb()
      .prepare(
        `
        SELECT *
        FROM news
        WHERE hype_score IS NOT NULL
          AND hype_score > 0
        ORDER BY created_at DESC
        LIMIT ?
      `,
      )
      .all(limit) as NewsRow[];

    return rows.map(this.mapNewsRow);
  }

  saveFeedback(input: FeedbackInput): void {
    this.getDb()
      .prepare(
        `
        INSERT INTO feedback (news_id, user_id, feedback_type)
        VALUES (@newsId, @userId, @feedbackType)
        ON CONFLICT(news_id, user_id) DO UPDATE SET
          feedback_type = excluded.feedback_type,
          created_at = strftime('%s', 'now')
      `,
      )
      .run(input);
  }

  getStats(): DatabaseStats {
    const startOfDay = this.getStartOfCurrentDayUnix();

    return {
      totalNews: this.count('SELECT COUNT(*) AS count FROM news'),
      postedToday: this.count('SELECT COUNT(*) AS count FROM news WHERE is_posted = 1 AND posted_at >= ?', [
        startOfDay,
      ]),
      filteredByAi: this.count('SELECT COUNT(*) AS count FROM news WHERE hype_score IS NOT NULL'),
      pendingAiReview: this.count('SELECT COUNT(*) AS count FROM news WHERE hype_score IS NULL'),
    };
  }

  countPublishedToday(): number {
    return this.count('SELECT COUNT(*) AS count FROM news WHERE is_posted = 1 AND posted_at >= ?', [
      this.getStartOfCurrentDayUnix(),
    ]);
  }

  private migrate(): void {
    const db = this.getDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS news (
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

      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        news_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        feedback_type TEXT NOT NULL CHECK (feedback_type IN ('like', 'dislike')),
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (news_id) REFERENCES news(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_url ON news(url);
      CREATE INDEX IF NOT EXISTS idx_posted ON news(is_posted, hype_score);
      CREATE INDEX IF NOT EXISTS idx_created ON news(created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_news_user ON feedback(news_id, user_id);
    `);
  }

  private getDatabasePath(): string {
    const configuredPath = this.configService.get('database.path', { infer: true });

    return resolve(configuredPath);
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database connection is not initialized');
    }

    return this.db;
  }

  private count(sql: string, params: unknown[] = []): number {
    const row = this.getDb().prepare(sql).get(...params) as CountRow | undefined;

    return row?.count ?? 0;
  }

  private getStartOfCurrentDayUnix(): number {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    return Math.floor(start.getTime() / 1000);
  }

  private getUnixTime(): number {
    return Math.floor(Date.now() / 1000);
  }

  private readonly mapNewsRow = (row: NewsRow): NewsEntity => ({
    id: row.id,
    title: row.title,
    originalTitle: row.original_title,
    summary: row.summary,
    source: row.source,
    url: row.url,
    category: row.category,
    publishedAt: row.published_at,
    hypeScore: row.hype_score,
    isPosted: row.is_posted === 1,
    postedAt: row.posted_at,
    createdAt: row.created_at,
  });
}
