import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContestMatchParticipantStatus } from '../types';

@Entity('contest_match_participants')
@Index(['matchId', 'slotNo'], { unique: true })
@Index(['registrationId'])
export class ContestMatchParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'match_id', type: 'uuid' })
  matchId: string;

  @Column({ name: 'registration_id', type: 'uuid' })
  registrationId: string;

  @Column({ name: 'slot_no', type: 'int' })
  slotNo: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  lane: string | null;

  @Column({ name: 'grid_position', type: 'int', nullable: true })
  gridPosition: number | null;

  @Column({ name: 'seed_no', type: 'int', nullable: true })
  seedNo: number | null;

  @Column({ type: 'varchar', length: 30, default: ContestMatchParticipantStatus.READY })
  status: ContestMatchParticipantStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  score: number | null;

  @Column({ name: 'finish_position', type: 'int', nullable: true })
  finishPosition: number | null;

  @Column({ name: 'best_lap_ms', type: 'int', nullable: true })
  bestLapMs: number | null;

  @Column({ name: 'total_time_ms', type: 'int', nullable: true })
  totalTimeMs: number | null;

  @Column({ name: 'is_winner', type: 'boolean', default: false })
  isWinner: boolean;

  @Column({ name: 'result_note', type: 'text', nullable: true })
  resultNote: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
