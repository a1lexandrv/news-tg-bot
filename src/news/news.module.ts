import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { DatabaseModule } from '../database/database.module';
import { NewsService } from './news.service';
import { RssParser } from './parsers/rss.parser';

@Module({
  imports: [DatabaseModule, AiModule],
  providers: [NewsService, RssParser],
  exports: [NewsService],
})
export class NewsModule {}
