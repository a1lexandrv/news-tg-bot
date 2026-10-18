/**
 * One-off import of the legacy SQLite database (data/news.db) into PostgreSQL.
 *
 *   npm run import:sqlite -- [path/to/news.db] [--dry-run]
 *
 * - Reads SQLite with the built-in `node:sqlite` (Node >= 22.13), so no native module is required.
 * - Keeps original ids so feedback keeps pointing at the right news, then re-syncs the id sequences.
 * - Runs in one transaction; `--dry-run` rolls it back after printing the report.
 * - Safe to re-run: rows that are already imported are skipped. If the target already holds *different*
 *   rows with the same id or url (for example the bot has been running on Postgres), it aborts instead of
 *   mixing data - import into a fresh database (`docker compose down -v && docker compose up -d`).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import dataSource from '../src/database/data-source';

interface SqliteNewsRow {
  id: number;
  title: string;
  original_title: string | null;
  summary: string | null;
  source: string;
  url: string;
  category: string | null;
  published_at: number | null;
  hype_score: number | null;
  is_posted: number;
  posted_at: number | null;
  created_at: number | null;
}

interface SqliteFeedbackRow {
  news_id: number;
  user_id: number;
  feedback_type: 'like' | 'dislike';
  created_at: number | null;
}

interface TargetCounts {
  total: number;
  pendingAi: number;
  posted: number;
  feedback: number;
}

const toDate = (unixSeconds: number | null): Date | null =>
  unixSeconds === null ? null : new Date(unixSeconds * 1000);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sqlitePath = resolve(args.find((arg) => !arg.startsWith('--')) ?? './data/news.db');

  if (!existsSync(sqlitePath)) {
    throw new Error(`SQLite file not found: ${sqlitePath}`);
  }

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const newsRows = sqlite.prepare('SELECT * FROM news ORDER BY id').all() as unknown as SqliteNewsRow[];
  const feedbackRows = sqlite.prepare('SELECT * FROM feedback ORDER BY id').all() as unknown as SqliteFeedbackRow[];
  sqlite.close();

  const source: TargetCounts = {
    total: newsRows.length,
    pendingAi: newsRows.filter((row) => row.hype_score === null).length,
    posted: newsRows.filter((row) => row.is_posted === 1).length,
    feedback: feedbackRows.length,
  };

  await dataSource.initialize();
  await dataSource.runMigrations();

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const existing = (await queryRunner.query('SELECT id, url FROM news')) as { id: number; url: string }[];
    const urlById = new Map(existing.map((row) => [row.id, row.url]));
    const idByUrl = new Map(existing.map((row) => [row.url, row.id]));

    const toInsert: SqliteNewsRow[] = [];
    const conflicts: string[] = [];

    for (const row of newsRows) {
      const urlForId = urlById.get(row.id);
      const idForUrl = idByUrl.get(row.url);

      if (urlForId === row.url) {
        continue; // already imported
      }

      if (urlForId !== undefined || idForUrl !== undefined) {
        conflicts.push(`id=${row.id} url=${row.url}`);
        continue;
      }

      toInsert.push(row);
    }

    if (conflicts.length > 0) {
      throw new Error(
        `Target database already contains different rows for ${conflicts.length} imported ids/urls ` +
          `(e.g. ${conflicts[0]}). Import into an empty database to keep ids and feedback consistent.`,
      );
    }

    for (const row of toInsert) {
      await queryRunner.query(
        `INSERT INTO news (id, title, original_title, summary, source, url, category, published_at,
                           hype_score, is_posted, posted_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          row.id,
          row.title,
          row.original_title,
          row.summary,
          row.source,
          row.url,
          row.category,
          toDate(row.published_at),
          row.hype_score,
          row.is_posted === 1,
          toDate(row.posted_at),
          toDate(row.created_at) ?? new Date(),
        ],
      );
    }

    const knownNewsIds = new Set<number>([...urlById.keys(), ...newsRows.map((row) => row.id)]);
    let feedbackInserted = 0;
    let feedbackOrphans = 0;

    for (const row of feedbackRows) {
      if (!knownNewsIds.has(row.news_id)) {
        feedbackOrphans += 1;
        continue;
      }

      const inserted = (await queryRunner.query(
        `INSERT INTO feedback (news_id, user_id, feedback_type, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (news_id, user_id) DO NOTHING
         RETURNING id`,
        [row.news_id, row.user_id, row.feedback_type, toDate(row.created_at) ?? new Date()],
      )) as unknown[];

      feedbackInserted += inserted.length;
    }

    // Rows were inserted with explicit ids, so move the serial sequences past them.
    for (const table of ['news', 'feedback']) {
      await queryRunner.query(
        `SELECT setval(
           pg_get_serial_sequence('${table}', 'id'),
           GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1),
           (SELECT COUNT(*) > 0 FROM ${table})
         )`,
      );
    }

    const [counts] = (await queryRunner.query(
      `SELECT
         (SELECT COUNT(*) FROM news)::int AS total,
         (SELECT COUNT(*) FROM news WHERE hype_score IS NULL)::int AS "pendingAi",
         (SELECT COUNT(*) FROM news WHERE is_posted)::int AS posted,
         (SELECT COUNT(*) FROM feedback)::int AS feedback`,
    )) as TargetCounts[];

    console.log(`SQLite source: ${sqlitePath}`);
    console.log(`news inserted: ${toInsert.length} (already present: ${newsRows.length - toInsert.length})`);
    console.log(`feedback inserted: ${feedbackInserted} (orphans skipped: ${feedbackOrphans})`);
    console.table({ sqlite: source, postgres: counts });

    const matches =
      counts.total === source.total &&
      counts.pendingAi === source.pendingAi &&
      counts.posted === source.posted &&
      counts.feedback === source.feedback - feedbackOrphans;

    if (!matches) {
      throw new Error('Row counts in PostgreSQL do not match the SQLite source - rolling back.');
    }

    if (dryRun) {
      await queryRunner.rollbackTransaction();
      console.log('Dry run: transaction rolled back, nothing was written.');
    } else {
      await queryRunner.commitTransaction();
      console.log('Import committed.');
    }
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }

    throw error;
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
