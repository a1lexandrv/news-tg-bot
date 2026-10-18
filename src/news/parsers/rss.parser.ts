import { Injectable, Logger } from '@nestjs/common';
import Parser = require('rss-parser');

import { CreateNewsInput } from '../../database/repositories/news.repository';
import { RSS_SOURCES, RssSource } from './sources.config';

export interface RssFetchResult {
  source: RssSource;
  items: CreateNewsInput[];
}

export interface RssFetchError {
  source: RssSource;
  message: string;
}

export interface RssFetchSummary {
  items: CreateNewsInput[];
  successfulSources: number;
  failedSources: number;
  errors: RssFetchError[];
}

interface FeedItem {
  title?: string;
  link?: string;
  guid?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  isoDate?: string;
  pubDate?: string;
}

@Injectable()
export class RssParser {
  private readonly logger = new Logger(RssParser.name);
  private readonly maxItemsPerSource = 25;
  private readonly parser = new Parser<object, FeedItem>({
    headers: {
      'User-Agent': 'Mozilla/5.0 ai-news-bot RSS reader',
    },
    timeout: 15_000,
  });

  async fetchAllSources(sources = RSS_SOURCES): Promise<RssFetchSummary> {
    const settledResults = await Promise.allSettled(sources.map((source) => this.fetchSource(source)));
    const errors: RssFetchError[] = [];
    const items: CreateNewsInput[] = [];
    let successfulSources = 0;

    for (const result of settledResults) {
      if (result.status === 'fulfilled') {
        successfulSources += 1;
        items.push(...result.value.items);
        continue;
      }

      errors.push(result.reason as RssFetchError);
    }

    return {
      items,
      successfulSources,
      failedSources: errors.length,
      errors,
    };
  }

  private async fetchSource(source: RssSource): Promise<RssFetchResult> {
    try {
      const feed = await this.parseFeed(source.url);
      const items = feed.items
        .slice(0, this.maxItemsPerSource)
        .map((item) => this.normalizeItem(item, source))
        .filter((item): item is CreateNewsInput => item !== null);

      this.logger.log(`Fetched ${items.length} RSS items from ${source.name}`);

      return { source, items };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown RSS parsing error';

      this.logger.warn(`Failed to fetch RSS source "${source.name}": ${message}`);

      throw { source, message } satisfies RssFetchError;
    }
  }

  private async parseFeed(url: string): Promise<Parser.Output<FeedItem>> {
    try {
      return await this.parser.parseURL(url);
    } catch (error) {
      if (!this.canRetryWithSanitizedXml(error)) {
        throw error;
      }

      const xml = await this.fetchRawXml(url);

      return this.parser.parseString(this.sanitizeXml(xml));
    }
  }

  private normalizeItem(item: FeedItem, source: RssSource): CreateNewsInput | null {
    const title = this.normalizeText(item.title);
    const url = this.normalizeUrl(item.link ?? item.guid);

    if (!title || !url) {
      return null;
    }

    return {
      title,
      originalTitle: title,
      summary: this.extractSummary(item),
      source: source.name,
      url,
      category: source.category,
      publishedAt: this.parsePublishedAt(item.isoDate ?? item.pubDate),
    };
  }

  private extractSummary(item: FeedItem): string | null {
    const content = item.contentSnippet ?? item.summary ?? item.content;
    const normalized = this.normalizeText(content);

    if (!normalized) {
      return null;
    }

    // RSS content can be huge; keep enough context for AI filtering without bloating database rows.
    return normalized.slice(0, 2_000);
  }

  private parsePublishedAt(value: string | undefined): Date | null {
    if (!value) {
      return null;
    }

    const timestamp = Date.parse(value);

    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }

  private normalizeUrl(value: string | undefined): string | null {
    const normalized = this.normalizeText(value);

    if (!normalized) {
      return null;
    }

    try {
      return new URL(normalized).toString();
    } catch {
      return normalized;
    }
  }

  private async fetchRawXml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 ai-news-bot RSS reader',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Status code ${response.status}`);
      }

      return response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private canRetryWithSanitizedXml(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';

    return message.includes('Invalid character in entity name') || message.includes('Invalid character entity');
  }

  private sanitizeXml(xml: string): string {
    // Some feeds occasionally ship unescaped ampersands in text nodes. This keeps
    // known XML entities intact and fixes the common broken ampersand case.
    return xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g, '&amp;');
  }

  private normalizeText(value: string | undefined): string | null {
    if (!value) {
      return null;
    }

    const normalized = value
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return normalized.length > 0 ? normalized : null;
  }
}
