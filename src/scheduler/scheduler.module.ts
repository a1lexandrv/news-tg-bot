import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from '../database/database.module';
import { NewsModule } from '../news/news.module';
import { TelegramModule } from '../telegram/telegram.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, NewsModule, TelegramModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
