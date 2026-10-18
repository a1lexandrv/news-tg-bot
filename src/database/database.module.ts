import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfig } from '../config/configuration';
import { AppStateEntity } from './entities/app-state.entity';
import { FeedbackEntity } from './entities/feedback.entity';
import { NewsEntity } from './entities/news.entity';
import { AppStateRepository } from './repositories/app-state.repository';
import { FeedbackRepository } from './repositories/feedback.repository';
import { NewsRepository } from './repositories/news.repository';
import { buildTypeOrmOptions } from './typeorm.options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        ...buildTypeOrmOptions(configService.get('database', { infer: true })),
        // Apply pending migrations on startup so a fresh deploy needs no manual step.
        migrationsRun: true,
        logging: ['error', 'warn', 'migration'],
      }),
    }),
    TypeOrmModule.forFeature([NewsEntity, FeedbackEntity, AppStateEntity]),
  ],
  providers: [NewsRepository, FeedbackRepository, AppStateRepository],
  exports: [NewsRepository, FeedbackRepository, AppStateRepository],
})
export class DatabaseModule {}
