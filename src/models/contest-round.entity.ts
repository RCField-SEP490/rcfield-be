import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContestRoundType } from '../types';

@Entity('contest_rounds')
@Index(['contestClassId', 'roundType', 'roundNo'], { unique: true })
@Index(['contestId'])
export class ContestRound {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ name: 'contest_class_id', type: 'uuid' })
  contestClassId: string;

  @Column({ name: 'round_type', type: 'varchar', length: 30 })
  roundType: ContestRoundType;

  @Column({ name: 'round_no', type: 'int' })
  roundNo: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  rules: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
