import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContestRewardType } from '../types';

@Entity('contest_rewards')
@Index(['contestId', 'contestClassId'])
export class ContestReward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ name: 'contest_class_id', type: 'uuid', nullable: true })
  contestClassId: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'reward_type', type: 'varchar', length: 30 })
  rewardType: ContestRewardType;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ name: 'is_published', type: 'boolean', default: true })
  isPublished: boolean;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
