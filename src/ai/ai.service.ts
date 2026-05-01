import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { AppConfig } from '../config/configuration';
import { FILTER_PROMPT } from './prompts/filter.prompt';

export interface FilterNewsInput {
  title: string;
  content: string;
}

export interface FilterNewsResult {
  hypeScore: number;
  newTitle: string;
  summary: string;
}

interface RawFilterNewsResult {
  hypeScore?: unknown;
  newTitle?: unknown;
  summary?: unknown;
}

const FILTER_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hypeScore', 'newTitle', 'summary'],
  properties: {
    hypeScore: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
    },
    newTitle: {
      type: 'string',
      maxLength: 80,
    },
    summary: {
      type: 'string',
      maxLength: 280,
    },
  },
} as const;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private client: OpenAI | null = null;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.apiKey = this.configService.get('openai.apiKey', { infer: true });
    this.model = this.configService.get('openai.model', { infer: true });
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async filterNews(input: FilterNewsInput): Promise<FilterNewsResult> {
    if (!this.isConfigured()) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const response = await this.getClient().responses.create({
      model: this.model,
      input: this.buildPrompt(input),
      max_output_tokens: 350,
      store: false,
      temperature: 0.2,
      text: {
        format: {
          type: 'json_schema',
          name: 'ai_news_filter_result',
          strict: true,
          schema: FILTER_RESULT_SCHEMA,
        },
      },
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    return this.parseFilterResult(response.output_text);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
      });
    }

    return this.client;
  }

  private buildPrompt(input: FilterNewsInput): string {
    return FILTER_PROMPT.replace('{title}', input.title).replace('{content}', input.content);
  }

  private parseFilterResult(rawJson: string): FilterNewsResult {
    let parsed: RawFilterNewsResult;

    try {
      parsed = JSON.parse(rawJson) as RawFilterNewsResult;
    } catch (error) {
      this.logger.warn(`OpenAI returned invalid JSON: ${rawJson}`);
      throw error;
    }

    const hypeScore = this.parseHypeScore(parsed.hypeScore);
    const newTitle = this.parseTextField(parsed.newTitle, 'newTitle', 80);
    const summary = this.parseTextField(parsed.summary, 'summary', 280);

    return {
      hypeScore: hypeScore < 6 ? 0 : hypeScore,
      newTitle,
      summary,
    };
  }

  private parseHypeScore(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10) {
      throw new Error('OpenAI response contains invalid hypeScore');
    }

    return value;
  }

  private parseTextField(value: unknown, fieldName: string, maxLength: number): string {
    if (typeof value !== 'string') {
      throw new Error(`OpenAI response contains invalid ${fieldName}`);
    }

    const normalized = value.replace(/\s+/g, ' ').trim();

    if (normalized.length === 0) {
      throw new Error(`OpenAI response contains empty ${fieldName}`);
    }

    return normalized.slice(0, maxLength);
  }
}
