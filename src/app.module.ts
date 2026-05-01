import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';
import { AiModule } from './ai/ai.module';
import { DatabaseModule } from './database/database.module';
import { NewsModule } from './news/news.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    AiModule,
    NewsModule,
    TelegramModule,
    SchedulerModule,
  ],
})
export class AppModule {}
