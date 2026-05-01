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

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
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
    minHypeScore: parseNumber(process.env.MIN_HYPE_SCORE, 6),
    fetchIntervalMinutes: parseNumber(process.env.FETCH_INTERVAL_MINUTES, 180),
    dailyLimit: parseNumber(process.env.NEWS_PER_DAY_LIMIT, 15),
  },
});
