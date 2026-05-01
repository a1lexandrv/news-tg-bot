import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { NewsService } from './news.service';
import { RssParser } from './parsers/rss.parser';

@Module({
  imports: [DatabaseModule],
  providers: [NewsService, RssParser],
  exports: [NewsService],
})
export class NewsModule {}
