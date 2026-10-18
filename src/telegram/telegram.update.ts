import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Action, Command, Ctx, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';

import { AppConfig } from '../config/configuration';
import { FeedbackRepository } from '../database/repositories/feedback.repository';
import { NewsRepository } from '../database/repositories/news.repository';
import { TelegramService } from './telegram.service';

type FeedbackType = 'like' | 'dislike';

interface ActionContext extends Context {
  match?: RegExpExecArray;
}

@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);
  private readonly adminUserIds: number[];

  constructor(
    private readonly telegramService: TelegramService,
    private readonly newsRepository: NewsRepository,
    private readonly feedbackRepository: FeedbackRepository,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {
    this.adminUserIds = this.configService.get('telegram.adminUserIds', { infer: true });
  }

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    await ctx.replyWithHTML(
      [
        '<b>AI News Bot</b>',
        '',
        'Я собираю новости про AI и нейросети, фильтрую их через AI и публикую лучшее в канал.',
        '',
        'Команды:',
        '/latest — последние 5 новостей',
        '/help — помощь',
      ].join('\n'),
    );
  }

  @Command('help')
  async onHelp(@Ctx() ctx: Context): Promise<void> {
    await ctx.replyWithHTML(
      [
        '<b>Команды</b>',
        '/start — описание бота',
        '/latest — последние 5 одобренных новостей',
        '/help — список команд',
        '/stats — статистика для администратора',
      ].join('\n'),
    );
  }

  @Command('latest')
  async onLatest(@Ctx() ctx: Context): Promise<void> {
    const latestNews = await this.newsRepository.findLatestNews(5);

    await ctx.replyWithHTML(this.telegramService.buildLatestNewsMessage(latestNews), {
      link_preview_options: {
        is_disabled: true,
      },
    });
  }

  @Command('stats')
  async onStats(@Ctx() ctx: Context): Promise<void> {
    const userId = ctx.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      await ctx.reply('Команда доступна только администратору.');
      return;
    }

    await ctx.replyWithHTML(await this.telegramService.buildStatsMessage());
  }

  @Action(/^feedback:(like|dislike):(\d+)$/)
  async onFeedback(@Ctx() ctx: ActionContext): Promise<void> {
    const userId = ctx.from?.id;
    const feedbackType = ctx.match?.[1] as FeedbackType | undefined;
    const newsId = Number(ctx.match?.[2]);

    if (!userId || !feedbackType || !Number.isInteger(newsId)) {
      await ctx.answerCbQuery('Не удалось сохранить реакцию.');
      return;
    }

    try {
      await this.feedbackRepository.saveFeedback({
        newsId,
        userId,
        feedbackType,
      });

      await ctx.answerCbQuery(feedbackType === 'like' ? 'Спасибо за оценку!' : 'Спасибо, учту.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown feedback error';
      this.logger.warn(`Failed to save feedback for news id=${newsId}: ${message}`);

      await ctx.answerCbQuery('Не удалось сохранить реакцию.');
    }
  }

  private isAdmin(userId: number): boolean {
    return this.adminUserIds.includes(userId);
  }
}
