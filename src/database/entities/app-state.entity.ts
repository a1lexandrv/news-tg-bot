import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Small key-value table for runtime state that must survive restarts (e.g. the last scheduler run). */
@Entity({ name: 'app_state' })
export class AppStateEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
