import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { ContestStatus } from '../types';

@Entity('contests')
@Index(['providerId', 'status'])
@Index(['status', 'startsAt'])
export class Contest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'track_type_id', type: 'uuid' })
  trackTypeId: string;

  @Column({ name: 'vehicle_rule', type: 'jsonb', default: {} })
  vehicleRule: Record<string, unknown>;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'registration_opens_at', type: 'timestamptz' })
  registrationOpensAt: Date;

  @Column({ name: 'registration_closes_at', type: 'timestamptz' })
  registrationClosesAt: Date;

  @Column({ type: 'int' })
  capacity: number;

  @Column({ name: 'entry_fee', type: 'numeric', precision: 15, scale: 2, default: 0 })
  entryFee: number;

  @Column({ type: 'enum', enum: ContestStatus, enumName: 'contest_status_enum' })
  status: ContestStatus;

  @Column({ name: 'banner_image_url', type: 'text', nullable: true })
  bannerImageUrl: string | null;

  @Column({ type: 'jsonb', default: {} })
  config: Record<string, unknown>;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
