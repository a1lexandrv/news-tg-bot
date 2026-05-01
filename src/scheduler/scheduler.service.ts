import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';

import { AppConfig } from '../config/configuration';
import { DatabaseService } from '../database/database.service';
import { NewsService } from '../news/news.service';
import { TelegramService } from '../telegram/telegram.service';

export interface ScheduledCycleResult {
  fetched: number;
  aiProcessed: number;
  published: number;
  publishFailed: number;
}

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly fetchIntervalMs: number;
  private readonly minHypeScore: number;
  private readonly dailyLimit: number;
  private lastRunAtMs = Date.now();
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly newsService: NewsService,
    private readonly databaseService: DatabaseService,
    private readonly telegramService: TelegramService,
  ) {
    this.fetchIntervalMs = this.configService.get('news.fetchIntervalMinutes', { infer: true }) * 60_000;
    this.minHypeScore = this.configService.get('news.minHypeScore', { infer: true });
    this.dailyLimit = this.configService.get('news.dailyLimit', { infer: true });
  }

  onModuleInit(): void {
    this.logger.log(
      `Scheduler initialized: interval=${Math.round(this.fetchIntervalMs / 60_000)}m dailyLimit=${this.dailyLimit}`,
    );
  }

  @Interval(60_000)
  async handleIntervalTick(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Skipping scheduler tick because previous cycle is still running');
      return;
    }

    if (!this.shouldRunNow()) {
      return;
    }

    await this.runScheduledCycle();
  }

  async runScheduledCycle(): Promise<ScheduledCycleResult> {
    this.isRunning = true;
    this.lastRunAtMs = Date.now();

    try {
      this.logger.log('Scheduled news cycle started');

      const intakeResult = await this.newsService.collectAndFilterNews();
      const publishResult = await this.publishApprovedNews();

      const result: ScheduledCycleResult = {
        fetched: intakeResult.fetch.fetched,
        aiProcessed: intakeResult.filter.processed,
        published: publishResult.published,
        publishFailed: publishResult.failed,
      };

      this.logger.log(
        [
          'Scheduled news cycle finished',
          `fetched=${result.fetched}`,
          `aiProcessed=${result.aiProcessed}`,
          `published=${result.published}`,
          `publishFailed=${result.publishFailed}`,
        ].join(' '),
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scheduler error';
      this.logger.error(`Scheduled news cycle failed: ${message}`);

      return {
        fetched: 0,
        aiProcessed: 0,
        published: 0,
        publishFailed: 0,
      };
    } finally {
      this.isRunning = false;
    }
  }

  private async publishApprovedNews(): Promise<{ published: number; failed: number }> {
    if (!this.telegramService.isPublishingConfigured()) {
      this.logger.warn('Skipping Telegram publishing: BOT_TOKEN or CHANNEL_ID is not configured');
      return { published: 0, failed: 0 };
    }

    const publishedToday = this.databaseService.countPublishedToday();
    const remainingLimit = Math.max(this.dailyLimit - publishedToday, 0);

    if (remainingLimit === 0) {
      this.logger.log(`Daily publishing limit reached: ${publishedToday}/${this.dailyLimit}`);
      return { published: 0, failed: 0 };
    }

    const publishableNews = this.databaseService.findTopPublishableNews({
      minHypeScore: this.minHypeScore,
      limit: remainingLimit,
    });

    if (publishableNews.length === 0) {
      this.logger.log('No approved news pending Telegram publishing');
      return { published: 0, failed: 0 };
    }

    this.logger.log(`Publishing ${publishableNews.length} approved news items`);

    return this.telegramService.publishNewsBatch(publishableNews);
  }

  private shouldRunNow(): boolean {
    return Date.now() - this.lastRunAtMs >= this.fetchIntervalMs;
  }
}
