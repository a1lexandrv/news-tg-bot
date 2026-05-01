import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  logger.log(`AI News Bot is running on port ${port}`);
}

void bootstrap();
