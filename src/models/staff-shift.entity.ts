import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('staff_shifts')
@Index(['providerId', 'cafeId', 'shiftDate'])
@Index(['providerId', 'cafeId', 'positionId', 'shiftDate', 'staffId'])
export class StaffShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId: string;

  @Column({ name: 'cafe_id', type: 'uuid' })
  cafeId: string;

  @Column({ name: 'position_id', type: 'uuid' })
  positionId: string;

  @Column({ name: 'staff_id', type: 'uuid' })
  staffId: string;

  @Column({ name: 'shift_date', type: 'date' })
  shiftDate: string;

  @Column({ name: 'shift_label', type: 'varchar', length: 120, nullable: true })
  shiftLabel: string | null;

  @Column({ name: 'start_time', type: 'time', nullable: true })
  startTime: string | null;

  @Column({ name: 'end_time', type: 'time', nullable: true })
  endTime: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
