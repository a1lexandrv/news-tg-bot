export interface AppConfig {
  telegram: {
    botToken: string;
    channelId: string;
    adminUserIds: number[];
  };
  openai: {
    apiKey: string;
  };
  database: {
    path: string;
  };
  news: {
    minHypeScore: number;
    fetchIntervalMinutes: number;
    dailyLimit: number;
  };
}

const parseInteger = (
  value: string | undefined,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  if (options.min !== undefined && parsed < options.min) {
    return fallback;
  }

  if (options.max !== undefined && parsed > options.max) {
    return fallback;
  }

  return parsed;
};

const parseAdminUserIds = (value: string | undefined): number[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isInteger(id));
};

export default (): AppConfig => ({
  telegram: {
    botToken: process.env.BOT_TOKEN ?? '',
    channelId: process.env.CHANNEL_ID ?? '',
    adminUserIds: parseAdminUserIds(process.env.ADMIN_USER_IDS),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
  },
  database: {
    path: process.env.DB_PATH ?? './data/news.db',
  },
  news: {
    minHypeScore: parseInteger(process.env.MIN_HYPE_SCORE, 6, { min: 0, max: 10 }),
    fetchIntervalMinutes: parseInteger(process.env.FETCH_INTERVAL_MINUTES, 180, { min: 1 }),
    dailyLimit: parseInteger(process.env.NEWS_PER_DAY_LIMIT, 15, { min: 1 }),
  },
});
