import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContestFeeOrderStatus } from '../types';

/** Đơn phí của MỘT giải: provider chọn gói, chuyển khoản, admin đối soát. */
@Entity('contest_fee_orders')
@Index(['providerId', 'status'])
export class ContestFeeOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ type: 'varchar', length: 30, default: ContestFeeOrderStatus.PENDING_PAYMENT })
  status: ContestFeeOrderStatus;

  /** Giá chốt lúc đặt — đổi bảng giá về sau không làm thay đổi đơn đã trả. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({ name: 'featured_days', type: 'integer', default: 0 })
  featuredDays: number;

  @Column({ name: 'transfer_reference', type: 'varchar', length: 255, nullable: true })
  transferReference: string | null;

  @Column({ name: 'transfer_date', type: 'date', nullable: true })
  transferDate: string | null;

  @Column({ name: 'transfer_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  transferAmount: number | null;

  @Column({ name: 'admin_notes', type: 'text', nullable: true })
  adminNotes: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
