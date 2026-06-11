import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContestRewardClaimStatus } from '../types';

@Entity('contest_reward_claims')
@Index(['contestRewardId', 'registrationId'], { unique: true })
@Index(['userId', 'status'])
export class ContestRewardClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_reward_id', type: 'uuid' })
  contestRewardId: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ name: 'registration_id', type: 'uuid' })
  registrationId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'source_result_id', type: 'uuid', nullable: true })
  sourceResultId: string | null;

  @Column({ type: 'varchar', length: 30, default: ContestRewardClaimStatus.ISSUED })
  status: ContestRewardClaimStatus;

  @Column({ name: 'issued_by', type: 'uuid' })
  issuedBy: string;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
