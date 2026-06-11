import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('contest_leaderboard_snapshots')
@Index(['contestId', 'scope', 'publishedAt'])
export class ContestLeaderboardSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ name: 'contest_class_id', type: 'uuid', nullable: true })
  contestClassId: string | null;

  @Column({ type: 'varchar', length: 50, default: 'OVERALL' })
  scope: string;

  @Column({ type: 'jsonb' })
  standings: Record<string, unknown>[];

  @Column({ name: 'published_by', type: 'uuid' })
  publishedBy: string;

  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
