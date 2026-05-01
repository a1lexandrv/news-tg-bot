import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiService } from '../ai/ai.service';
import { AppConfig } from '../config/configuration';
import { DatabaseService } from '../database/database.service';
import { RssParser, RssFetchError } from './parsers/rss.parser';

export interface FetchAndStoreNewsResult {
  fetched: number;
  inserted: number;
  skipped: number;
  successfulSources: number;
  failedSources: number;
  errors: RssFetchError[];
}

export interface FilterPendingNewsResult {
  total: number;
  processed: number;
  approved: number;
  rejected: number;
  failed: number;
  skippedReason?: string;
}

export interface NewsIntakeResult {
  fetch: FetchAndStoreNewsResult;
  filter: FilterPendingNewsResult;
}

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);
  private readonly minHypeScore: number;

  constructor(
    private readonly rssParser: RssParser,
    private readonly databaseService: DatabaseService,
    private readonly aiService: AiService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {
    this.minHypeScore = this.configService.get('news.minHypeScore', { infer: true });
  }

  async fetchAndStoreNews(): Promise<FetchAndStoreNewsResult> {
    this.logger.log('Starting RSS news collection');

    const rssSummary = await this.rssParser.fetchAllSources();
    const insertResult = this.databaseService.insertNewsBatch(rssSummary.items);

    this.logger.log(
      [
        'RSS news collection finished',
        `sources=${rssSummary.successfulSources}/${rssSummary.successfulSources + rssSummary.failedSources}`,
        `fetched=${rssSummary.items.length}`,
        `inserted=${insertResult.inserted}`,
        `skipped=${insertResult.skipped}`,
      ].join(' '),
    );

    if (rssSummary.errors.length > 0) {
      this.logger.warn(
        `RSS sources failed: ${rssSummary.errors.map((error) => `${error.source.name} (${error.message})`).join('; ')}`,
      );
    }

    return {
      fetched: rssSummary.items.length,
      inserted: insertResult.inserted,
      skipped: insertResult.skipped,
      successfulSources: rssSummary.successfulSources,
      failedSources: rssSummary.failedSources,
      errors: rssSummary.errors,
    };
  }

  async filterPendingNews(limit = 20): Promise<FilterPendingNewsResult> {
    if (!this.aiService.isConfigured()) {
      const skippedReason = 'OPENAI_API_KEY is not configured';
      this.logger.warn(`Skipping AI filtering: ${skippedReason}`);

      return {
        total: 0,
        processed: 0,
        approved: 0,
        rejected: 0,
        failed: 0,
        skippedReason,
      };
    }

    const pendingNews = this.databaseService.findUnprocessedNews(limit);

    if (pendingNews.length === 0) {
      this.logger.log('No news pending AI filtering');

      return {
        total: 0,
        processed: 0,
        approved: 0,
        rejected: 0,
        failed: 0,
      };
    }

    let processed = 0;
    let approved = 0;
    let rejected = 0;
    let failed = 0;

    this.logger.log(`Starting AI filtering for ${pendingNews.length} news items`);

    for (const news of pendingNews) {
      try {
        const aiResult = await this.aiService.filterNews({
          title: news.originalTitle ?? news.title,
          content: this.buildAiContent(news),
        });

        this.databaseService.updateAiResult(news.id, {
          title: aiResult.newTitle,
          summary: aiResult.summary,
          hypeScore: aiResult.hypeScore,
        });

        processed += 1;

        if (aiResult.hypeScore >= this.minHypeScore) {
          approved += 1;
        } else {
          rejected += 1;
        }
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : 'Unknown OpenAI filtering error';

        this.logger.warn(`Failed to filter news id=${news.id}: ${message}`);
      }
    }

    this.logger.log(
      [
        'AI filtering finished',
        `total=${pendingNews.length}`,
        `processed=${processed}`,
        `approved=${approved}`,
        `rejected=${rejected}`,
        `failed=${failed}`,
      ].join(' '),
    );

    return {
      total: pendingNews.length,
      processed,
      approved,
      rejected,
      failed,
    };
  }

  async collectAndFilterNews(): Promise<NewsIntakeResult> {
    const fetch = await this.fetchAndStoreNews();
    const filter = await this.filterPendingNews();

    return { fetch, filter };
  }

  private buildAiContent(news: { summary: string | null; source: string; category: string | null; url: string }): string {
    return [
      news.summary ?? 'Описание отсутствует.',
      `Источник: ${news.source}`,
      news.category ? `Категория: ${news.category}` : null,
      `URL: ${news.url}`,
    ]
      .filter((part): part is string => part !== null)
      .join('\n');
  }
}
