import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('contest_classes')
@Index(['contestId', 'code'], { unique: true })
@Index(['contestId'])
export class ContestClass {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'track_type_id', type: 'uuid', nullable: true })
  trackTypeId: string | null;

  @Column({ type: 'jsonb', default: {} })
  rules: Record<string, unknown>;

  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
