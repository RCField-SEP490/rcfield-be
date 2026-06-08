import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { BookingMode, BookingSource, BookingStatus } from '../types';

@Entity('bookings')
@Index(['customerId'])
@Index(['cafeId', 'slotStart'])
@Index(['status', 'paymentExpiresAt'])
@Index(['cafeId', 'status', 'slotStart'])
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'cafe_id', type: 'uuid' })
  cafeId: string;

  @Column({ name: 'track_type_id', type: 'uuid' })
  trackTypeId: string;

  @Column({ name: 'play_mode', type: 'varchar', length: 10, enum: BookingMode })
  playMode: BookingMode;

  @Column({ name: 'source', type: 'varchar', length: 20, default: BookingSource.APP })
  source: BookingSource;

  @Column({ name: 'status', type: 'varchar', length: 20, default: BookingStatus.PENDING })
  status: BookingStatus;

  @Column({ name: 'slot_start', type: 'timestamptz' })
  slotStart: Date;

  @Column({ name: 'slot_end', type: 'timestamptz' })
  slotEnd: Date;

  @Column({ name: 'payment_expires_at', type: 'timestamptz' })
  paymentExpiresAt: Date;

  @Column({ name: 'snapshot', type: 'jsonb', nullable: true })
  snapshot: object | null;

  @Column({ name: 'promotion_id', type: 'uuid', nullable: true })
  promotionId: string | null;

  @Column({ name: 'discount_amount', type: 'numeric', precision: 15, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @Column({ name: 'cancelled_by', type: 'uuid', nullable: true })
  cancelledBy: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
