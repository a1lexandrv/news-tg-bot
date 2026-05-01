import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';

import { AppConfig } from '../config/configuration';
import { DatabaseModule } from '../database/database.module';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';

const DISABLED_BOT_TOKEN = '0000000000:telegram_bot_token_is_not_configured';

@Module({
  imports: [
    DatabaseModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const botToken = configService.get('telegram.botToken', { infer: true });
        const isConfigured = botToken.length > 0;

        return {
          token: isConfigured ? botToken : DISABLED_BOT_TOKEN,
          launchOptions: isConfigured ? undefined : false,
        };
      },
    }),
  ],
  providers: [TelegramService, TelegramUpdate],
  exports: [TelegramService],
})
export class TelegramModule {}
