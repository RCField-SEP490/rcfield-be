import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('contest_heat_entries')
@Index(['heatId', 'registrationId'], { unique: true })
@Index(['registrationId'])
export class ContestHeatEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'heat_id', type: 'uuid' })
  heatId: string;

  @Column({ name: 'registration_id', type: 'uuid' })
  registrationId: string;

  @Column({ name: 'contest_class_id', type: 'uuid', nullable: true })
  contestClassId: string | null;

  @Column({ name: 'grid_position', type: 'int', nullable: true })
  gridPosition: number | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
