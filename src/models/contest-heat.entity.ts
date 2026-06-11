import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContestHeatStatus } from '../types';

@Entity('contest_heats')
@Index(['contestRoundId', 'heatNo'], { unique: true })
@Index(['contestId'])
export class ContestHeat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ name: 'contest_round_id', type: 'uuid' })
  contestRoundId: string;

  @Column({ name: 'heat_no', type: 'int' })
  heatNo: number;

  @Column({ type: 'varchar', length: 30, default: ContestHeatStatus.SCHEDULED })
  status: ContestHeatStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  config: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
