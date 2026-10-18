import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';

import { AppConfig } from '../config/configuration';
import { AppStateRepository } from '../database/repositories/app-state.repository';
import { NewsRepository } from '../database/repositories/news.repository';
import { NewsService } from '../news/news.service';
import { TelegramService } from '../telegram/telegram.service';

const LAST_RUN_STATE_KEY = 'scheduler.last_run_at';

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
    private readonly newsRepository: NewsRepository,
    private readonly appStateRepository: AppStateRepository,
    private readonly telegramService: TelegramService,
  ) {
    this.fetchIntervalMs = this.configService.get('news.fetchIntervalMinutes', { infer: true }) * 60_000;
    this.minHypeScore = this.configService.get('news.minHypeScore', { infer: true });
    this.dailyLimit = this.configService.get('news.dailyLimit', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    // Restore the last run so restarts/redeploys do not postpone the next cycle by a full interval.
    // With no stored value we start the clock now, so nothing is published right at startup.
    const storedLastRun = await this.loadLastRunAtMs();

    if (storedLastRun !== null) {
      this.lastRunAtMs = storedLastRun;
    } else {
      await this.saveLastRunAtMs(this.lastRunAtMs);
    }

    this.logger.log(
      [
        `Scheduler initialized: interval=${Math.round(this.fetchIntervalMs / 60_000)}m`,
        `dailyLimit=${this.dailyLimit}`,
        `lastRunAt=${new Date(this.lastRunAtMs).toISOString()}`,
      ].join(' '),
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
      await this.saveLastRunAtMs(this.lastRunAtMs);

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

    const publishedToday = await this.newsRepository.countPublishedToday();
    const remainingLimit = Math.max(this.dailyLimit - publishedToday, 0);

    if (remainingLimit === 0) {
      this.logger.log(`Daily publishing limit reached: ${publishedToday}/${this.dailyLimit}`);
      return { published: 0, failed: 0 };
    }

    const publishableNews = await this.newsRepository.findTopPublishableNews({
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

  private async loadLastRunAtMs(): Promise<number | null> {
    const stored = await this.appStateRepository.get(LAST_RUN_STATE_KEY);
    const parsed = stored ? Date.parse(stored) : Number.NaN;

    // A value from the future (clock change, bad data) must not block the scheduler.
    return Number.isFinite(parsed) && parsed <= Date.now() ? parsed : null;
  }

  private async saveLastRunAtMs(timestampMs: number): Promise<void> {
    try {
      await this.appStateRepository.set(LAST_RUN_STATE_KEY, new Date(timestampMs).toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.warn(`Failed to persist scheduler state: ${message}`);
    }
  }
}
