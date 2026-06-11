import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('contest_result_audits')
@Index(['resultId'])
export class ContestResultAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'result_id', type: 'uuid' })
  resultId: string;

  @Column({ name: 'changed_by', type: 'uuid' })
  changedBy: string;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ name: 'before_data', type: 'jsonb', nullable: true })
  beforeData: Record<string, unknown> | null;

  @Column({ name: 'after_data', type: 'jsonb', nullable: true })
  afterData: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
