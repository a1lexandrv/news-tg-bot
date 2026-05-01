import { Injectable, Logger } from '@nestjs/common';

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

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(
    private readonly rssParser: RssParser,
    private readonly databaseService: DatabaseService,
  ) {}

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
}
