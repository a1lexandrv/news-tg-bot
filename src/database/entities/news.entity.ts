import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'news' })
@Unique('uq_news_url', ['url'])
@Index('idx_news_posted_hype', ['isPosted', 'hypeScore'])
@Index('idx_news_created_at', ['createdAt'])
@Check('chk_news_hype_score', '"hype_score" IS NULL OR ("hype_score" >= 0 AND "hype_score" <= 10)')
export class NewsEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  title: string;

  @Column({ name: 'original_title', type: 'text', nullable: true })
  originalTitle: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'text', nullable: true })
  category: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  // NULL = not reviewed by AI yet, 0 = rejected, 1..10 = AI score.
  @Column({ name: 'hype_score', type: 'smallint', nullable: true })
  hypeScore: number | null;

  @Column({ name: 'is_posted', type: 'boolean', default: false })
  isPosted: boolean;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
