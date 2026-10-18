import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';

import configuration from '../config/configuration';
import { buildTypeOrmOptions } from './typeorm.options';

// The TypeORM CLI runs outside Nest, so load .env ourselves (Node >= 20.12).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const { database } = configuration();

export default new DataSource(buildTypeOrmOptions(database));
