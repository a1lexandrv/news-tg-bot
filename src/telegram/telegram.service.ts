import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Markup, Telegraf } from 'telegraf';
import { ExtraReplyMessage } from 'telegraf/typings/telegram-types';

import { AppConfig } from '../config/configuration';
import { NewsEntity } from '../database/entities/news.entity';
import { NewsRepository } from '../database/repositories/news.repository';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly publishDelayMs = 3_000;
  private readonly channelId: string;

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly newsRepository: NewsRepository,
  ) {
    this.channelId = this.configService.get('telegram.channelId', { infer: true });

    if (!this.configService.get('telegram.botToken', { infer: true })) {
      this.patchStopForDisabledBot();
    }
  }

  isPublishingConfigured(): boolean {
    return this.channelId.length > 0 && this.configService.get('telegram.botToken', { infer: true }).length > 0;
  }

  async publishNews(news: NewsEntity): Promise<void> {
    if (!this.isPublishingConfigured()) {
      throw new Error('Telegram BOT_TOKEN or CHANNEL_ID is not configured');
    }

    await this.bot.telegram.sendMessage(this.channelId, this.formatChannelPost(news), {
      parse_mode: 'HTML',
      ...this.buildFeedbackKeyboard(news.id),
    });

    await this.newsRepository.markAsPosted(news.id);
    this.logger.log(`Published news id=${news.id} to Telegram channel`);
  }

  async publishNewsBatch(newsItems: NewsEntity[]): Promise<{ published: number; failed: number }> {
    let published = 0;
    let failed = 0;

    for (const news of newsItems) {
      try {
        await this.publishNews(news);
        published += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : 'Unknown Telegram publish error';

        this.logger.warn(`Failed to publish news id=${news.id}: ${message}`);
      }

      if (news !== newsItems.at(-1)) {
        await this.delay(this.publishDelayMs);
      }
    }

    return { published, failed };
  }

  buildLatestNewsMessage(newsItems: NewsEntity[]): string {
    if (newsItems.length === 0) {
      return 'Пока нет одобренных новостей. Попробуйте позже.';
    }

    return [
      '<b>Последние новости</b>',
      ...newsItems.map((news, index) => {
        const score = news.hypeScore ?? 0;

        return [
          '',
          `${index + 1}. <a href="${this.escapeHtmlAttribute(news.url)}">${this.escapeHtml(news.title)}</a>`,
          `Оценка: ${score}/10`,
          news.summary ? this.escapeHtml(news.summary) : null,
        ]
          .filter((part): part is string => part !== null)
          .join('\n');
      }),
    ].join('\n');
  }

  async buildStatsMessage(): Promise<string> {
    const stats = await this.newsRepository.getStats();

    return [
      '<b>Статистика</b>',
      `Всего новостей: ${stats.totalNews}`,
      `Опубликовано сегодня: ${stats.postedToday}`,
      `Проверено AI: ${stats.filteredByAi}`,
      `Ожидает AI: ${stats.pendingAiReview}`,
    ].join('\n');
  }

  private formatChannelPost(news: NewsEntity): string {
    const hypeScore = news.hypeScore ?? 0;
    const icon = hypeScore >= 9 ? '🔥' : '🤖';
    const categoryTag = this.toHashTag(news.category ?? 'AI');

    return [
      `${icon} <b>${this.escapeHtml(news.title)}</b>`,
      '',
      this.escapeHtml(news.summary ?? 'Краткое описание пока недоступно.'),
      '',
      `🔗 <a href="${this.escapeHtmlAttribute(news.url)}">Читать полностью</a>`,
      '',
      `🏷️ ${categoryTag} #AI #News`,
    ].join('\n');
  }

  private buildFeedbackKeyboard(newsId: number): ExtraReplyMessage {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('👍 Полезно', `feedback:like:${newsId}`),
        Markup.button.callback('👎 Не очень', `feedback:dislike:${newsId}`),
      ],
    ]);
  }

  private toHashTag(value: string): string {
    const normalized = value.replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '');

    return `#${normalized || 'AI'}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escapeHtmlAttribute(value: string): string {
    return this.escapeHtml(value);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private patchStopForDisabledBot(): void {
    const originalStop = this.bot.stop.bind(this.bot);

    // nestjs-telegraf calls stop() on shutdown even when launchOptions=false.
    // In local/dev mode without BOT_TOKEN we intentionally never start polling.
    this.bot.stop = ((reason?: string) => {
      try {
        return originalStop(reason);
      } catch (error) {
        if (error instanceof Error && error.message === 'Bot is not running!') {
          return;
        }

        throw error;
      }
    }) as Telegraf['stop'];
  }
}
