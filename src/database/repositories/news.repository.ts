import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, MoreThanOrEqual, Not, Repository } from 'typeorm';

import { AppConfig } from '../../config/configuration';
import { NewsEntity } from '../entities/news.entity';

export interface CreateNewsInput {
  title: string;
  originalTitle?: string | null;
  summary?: string | null;
  source: string;
  url: string;
  category?: string | null;
  publishedAt?: Date | null;
}

export interface AiResultInput {
  title: string;
  summary: string;
  hypeScore: number;
}

export interface DatabaseStats {
  totalNews: number;
  postedToday: number;
  filteredByAi: number;
  pendingAiReview: number;
}

// Postgres allows 65535 bind parameters per statement; 7 columns per row leaves lots of headroom.
const INSERT_CHUNK_SIZE = 500;

@Injectable()
export class NewsRepository {
  private readonly timezone: string;

  constructor(
    @InjectRepository(NewsEntity)
    private readonly repository: Repository<NewsEntity>,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.timezone = configService.get('news.timezone', { infer: true });
  }

  async insertNewsBatch(items: CreateNewsInput[]): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;

    for (let offset = 0; offset < items.length; offset += INSERT_CHUNK_SIZE) {
      const chunk = items.slice(offset, offset + INSERT_CHUNK_SIZE);

      // ON CONFLICT DO NOTHING + RETURNING yields rows only for URLs that were actually new.
      const result = await this.repository
        .createQueryBuilder()
        .insert()
        .into(NewsEntity)
        .values(
          chunk.map((item) => ({
            title: item.title,
            originalTitle: item.originalTitle ?? item.title,
            summary: item.summary ?? null,
            source: item.source,
            url: item.url,
            category: item.category ?? null,
            publishedAt: item.publishedAt ?? null,
          })),
        )
        .orIgnore()
        .returning('id')
        .execute();

      inserted += (result.raw as unknown[]).length;
    }

    return { inserted, skipped: items.length - inserted };
  }

  findUnprocessedNews(limit = 20): Promise<NewsEntity[]> {
    return this.repository.find({
      where: { hypeScore: IsNull() },
      order: {
        publishedAt: { direction: 'DESC', nulls: 'LAST' },
        createdAt: 'DESC',
      },
      take: limit,
    });
  }

  async updateAiResult(newsId: number, result: AiResultInput): Promise<void> {
    await this.repository.update(newsId, {
      title: result.title,
      summary: result.summary,
      hypeScore: result.hypeScore,
    });
  }

  findTopPublishableNews(options: { minHypeScore: number; limit: number }): Promise<NewsEntity[]> {
    return this.repository.find({
      where: {
        isPosted: false,
        hypeScore: MoreThanOrEqual(options.minHypeScore),
      },
      order: {
        hypeScore: 'DESC',
        publishedAt: { direction: 'DESC', nulls: 'LAST' },
        createdAt: 'DESC',
      },
      take: options.limit,
    });
  }

  async markAsPosted(newsId: number, postedAt = new Date()): Promise<void> {
    await this.repository.update(newsId, { isPosted: true, postedAt });
  }

  findLatestNews(limit = 5): Promise<NewsEntity[]> {
    return this.repository.find({
      where: { hypeScore: MoreThan(0) },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  countPublishedToday(): Promise<number> {
    // "Today" starts at midnight in DAY_BOUNDARY_TIMEZONE, independent of the server's local zone.
    return this.repository
      .createQueryBuilder('news')
      .where('news.isPosted = true')
      .andWhere(`news.postedAt >= date_trunc('day', now() AT TIME ZONE :tz) AT TIME ZONE :tz`, { tz: this.timezone })
      .getCount();
  }

  async getStats(): Promise<DatabaseStats> {
    const [totalNews, postedToday, filteredByAi, pendingAiReview] = await Promise.all([
      this.repository.count(),
      this.countPublishedToday(),
      this.repository.count({ where: { hypeScore: Not(IsNull()) } }),
      this.repository.count({ where: { hypeScore: IsNull() } }),
    ]);

    return { totalNews, postedToday, filteredByAi, pendingAiReview };
  }
}
