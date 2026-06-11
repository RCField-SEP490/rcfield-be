import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContestResultStatus, ContestResultType } from '../types';

@Entity('contest_results')
@Index(['heatEntryId'], { unique: true })
@Index(['contestId', 'status'])
export class ContestResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ name: 'heat_id', type: 'uuid' })
  heatId: string;

  @Column({ name: 'heat_entry_id', type: 'uuid' })
  heatEntryId: string;

  @Column({ name: 'registration_id', type: 'uuid' })
  registrationId: string;

  @Column({ name: 'result_type', type: 'varchar', length: 30 })
  resultType: ContestResultType;

  @Column({ name: 'best_lap_ms', type: 'int', nullable: true })
  bestLapMs: number | null;

  @Column({ name: 'total_time_ms', type: 'int', nullable: true })
  totalTimeMs: number | null;

  @Column({ name: 'finish_position', type: 'int', nullable: true })
  finishPosition: number | null;

  @Column({ name: 'laps_completed', type: 'int', nullable: true })
  lapsCompleted: number | null;

  @Column({ name: 'penalty_ms', type: 'int', default: 0 })
  penaltyMs: number;

  @Column({ type: 'boolean', default: false })
  dnf: boolean;

  @Column({ type: 'varchar', length: 30, default: ContestResultStatus.SUBMITTED })
  status: ContestResultStatus;

  @Column({ name: 'submitted_by', type: 'uuid' })
  submittedBy: string;

  @Column({ name: 'verified_by', type: 'uuid', nullable: true })
  verifiedBy: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
