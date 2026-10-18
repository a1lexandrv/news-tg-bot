import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { NewsEntity } from './news.entity';

export type FeedbackType = 'like' | 'dislike';

// Telegram user ids exceed the int32 range, so they are stored as bigint.
// pg returns bigint as string; ids stay far below Number.MAX_SAFE_INTEGER.
const bigintToNumber = {
  to: (value: number | undefined): number | undefined => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

@Entity({ name: 'feedback' })
@Unique('uq_feedback_news_user', ['newsId', 'userId'])
@Check('chk_feedback_type', `"feedback_type" IN ('like', 'dislike')`)
export class FeedbackEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'news_id', type: 'integer' })
  newsId: number;

  @ManyToOne(() => NewsEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'news_id', foreignKeyConstraintName: 'fk_feedback_news' })
  news: NewsEntity;

  @Column({ name: 'user_id', type: 'bigint', transformer: bigintToNumber })
  userId: number;

  @Column({ name: 'feedback_type', type: 'varchar', length: 16 })
  feedbackType: FeedbackType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
