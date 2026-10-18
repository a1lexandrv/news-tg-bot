import { join } from 'node:path';
import { DataSourceOptions } from 'typeorm';

import { AppStateEntity } from './entities/app-state.entity';
import { FeedbackEntity } from './entities/feedback.entity';
import { NewsEntity } from './entities/news.entity';

export interface DatabaseConnectionConfig {
  url: string;
  ssl: boolean;
}

/** Shared by the Nest app (DatabaseModule) and the TypeORM CLI (data-source.ts). */
export const buildTypeOrmOptions = ({ url, ssl }: DatabaseConnectionConfig): DataSourceOptions => ({
  type: 'postgres',
  url,
  ssl: ssl ? { rejectUnauthorized: false } : false,
  entities: [NewsEntity, FeedbackEntity, AppStateEntity],
  // Works both from src (ts-node CLI) and from dist (compiled app).
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  synchronize: false,
});
