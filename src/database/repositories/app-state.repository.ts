import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppStateEntity } from '../entities/app-state.entity';

@Injectable()
export class AppStateRepository {
  constructor(
    @InjectRepository(AppStateEntity)
    private readonly repository: Repository<AppStateEntity>,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = await this.repository.findOneBy({ key });

    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.repository.upsert({ key, value, updatedAt: new Date() }, ['key']);
  }
}
