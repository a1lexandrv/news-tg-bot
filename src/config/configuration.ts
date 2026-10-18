export interface AppConfig {
  telegram: {
    botToken: string;
    channelId: string;
    adminUserIds: number[];
  };
  openai: {
    apiKey: string;
    model: string;
  };
  database: {
    url: string;
    ssl: boolean;
  };
  news: {
    minHypeScore: number;
    fetchIntervalMinutes: number;
    dailyLimit: number;
    timezone: string;
  };
}

export const DEFAULT_DATABASE_URL = 'postgres://ainews:ainews@localhost:5432/ainews';

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

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const parseTimezone = (value: string | undefined, fallback: string): string => {
  const candidate = value?.trim();

  if (!candidate) {
    return fallback;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });

    return candidate;
  } catch {
    return fallback;
  }
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
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  },
  database: {
    url: process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL,
    ssl: parseBoolean(process.env.DB_SSL, false),
  },
  news: {
    minHypeScore: parseInteger(process.env.MIN_HYPE_SCORE, 6, { min: 0, max: 10 }),
    fetchIntervalMinutes: parseInteger(process.env.FETCH_INTERVAL_MINUTES, 180, { min: 1 }),
    dailyLimit: parseInteger(process.env.NEWS_PER_DAY_LIMIT, 15, { min: 1 }),
    timezone: parseTimezone(process.env.DAY_BOUNDARY_TIMEZONE, 'UTC'),
  },
});
