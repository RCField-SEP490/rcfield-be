import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ContestRegistrationStatus, UserRole, VehicleSource } from '../types';

@Entity('contest_registrations')
@Index(['contestId', 'userId'], { unique: true })
@Index(['contestId', 'status'])
@Index(['userId'])
export class ContestRegistration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'participant_role_snapshot', type: 'varchar', length: 30 })
  participantRoleSnapshot: UserRole;

  @Column({
    name: 'vehicle_source',
    type: 'enum',
    enum: VehicleSource,
    enumName: 'vehicle_source_enum',
  })
  vehicleSource: VehicleSource;

  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId: string | null;

  @Column({ name: 'customer_vehicle_id', type: 'uuid', nullable: true })
  customerVehicleId: string | null;

  @Column({
    type: 'enum',
    enum: ContestRegistrationStatus,
    enumName: 'contest_registration_status_enum',
    default: ContestRegistrationStatus.PENDING,
  })
  status: ContestRegistrationStatus;

  @Column({ name: 'check_in_code', type: 'varchar', length: 64, unique: true })
  checkInCode: string;

  @Column({ name: 'checked_in_cafe_id', type: 'uuid', nullable: true })
  checkedInCafeId: string | null;

  @Column({ name: 'checked_in_by', type: 'uuid', nullable: true })
  checkedInBy: string | null;

  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checkedInAt: Date | null;

  @Column({ name: 'cancelled_by', type: 'uuid', nullable: true })
  cancelledBy: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
