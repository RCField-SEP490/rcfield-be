import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContestBracketMatchStatus } from '../types';

@Entity('contest_bracket_matches')
@Index(['contestRoundId', 'matchNo'], { unique: true })
@Index(['contestId'])
export class ContestBracketMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ name: 'contest_round_id', type: 'uuid' })
  contestRoundId: string;

  @Column({ name: 'match_no', type: 'int' })
  matchNo: number;

  @Column({ name: 'competitor_a_registration_id', type: 'uuid', nullable: true })
  competitorARegistrationId: string | null;

  @Column({ name: 'competitor_b_registration_id', type: 'uuid', nullable: true })
  competitorBRegistrationId: string | null;

  @Column({ name: 'winner_registration_id', type: 'uuid', nullable: true })
  winnerRegistrationId: string | null;

  @Column({ name: 'loser_registration_id', type: 'uuid', nullable: true })
  loserRegistrationId: string | null;

  @Column({ name: 'next_match_id', type: 'uuid', nullable: true })
  nextMatchId: string | null;

  @Column({ name: 'next_slot', type: 'varchar', length: 1, nullable: true })
  nextSlot: 'A' | 'B' | null;

  @Column({ type: 'varchar', length: 30, default: ContestBracketMatchStatus.SCHEDULED })
  status: ContestBracketMatchStatus;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
