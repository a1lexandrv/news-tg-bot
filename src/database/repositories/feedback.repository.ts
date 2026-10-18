import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FeedbackEntity, FeedbackType } from '../entities/feedback.entity';

export interface FeedbackInput {
  newsId: number;
  userId: number;
  feedbackType: FeedbackType;
}

@Injectable()
export class FeedbackRepository {
  constructor(
    @InjectRepository(FeedbackEntity)
    private readonly repository: Repository<FeedbackEntity>,
  ) {}

  /** Idempotent: a repeated reaction from the same user replaces the previous one. */
  async saveFeedback(input: FeedbackInput): Promise<void> {
    await this.repository.upsert({ ...input, createdAt: new Date() }, ['newsId', 'userId']);
  }
}
