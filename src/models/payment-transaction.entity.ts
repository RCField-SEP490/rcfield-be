import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import {
  PaymentTransactionStatus,
  PaymentTransactionSubjectType,
  PaymentTransactionType,
} from '../types';

@Entity('payment_transactions')
@Index(['bookingId'])
@Index('IDX_payment_transactions_customer_package_id', ['customerPackageId'])
@Index('IDX_payment_transactions_contest_registration_id', ['contestRegistrationId'])
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', type: 'uuid', nullable: true })
  bookingId: string | null;

  @Column({ name: 'customer_package_id', type: 'uuid', nullable: true })
  customerPackageId: string | null;

  @Column({ name: 'contest_registration_id', type: 'uuid', nullable: true })
  contestRegistrationId: string | null;

  @Column({
    name: 'subject_type',
    type: 'varchar',
    length: 40,
    default: PaymentTransactionSubjectType.BOOKING,
  })
  subjectType: PaymentTransactionSubjectType;

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
