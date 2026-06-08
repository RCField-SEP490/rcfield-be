import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PaymentTransactionStatus, PaymentTransactionType } from '../types';

@Entity('payment_transactions')
@Index(['bookingId'])
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @Column({ name: 'type', type: 'varchar', length: 20 })
  type: PaymentTransactionType;

  @Column({ name: 'gateway', type: 'varchar', length: 20, default: 'VNPAY' })
  gateway: string;

  @Column({ name: 'txn_ref', type: 'varchar', length: 100, unique: true })
  txnRef: string;

  @Column({ name: 'amount', type: 'numeric', precision: 15, scale: 2 })
  amount: number;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: PaymentTransactionStatus.PENDING,
  })
  status: PaymentTransactionStatus;

  @Column({ name: 'raw_request', type: 'jsonb', nullable: true })
  rawRequest: object | null;

  @Column({ name: 'raw_response', type: 'jsonb', nullable: true })
  rawResponse: object | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
