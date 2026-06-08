import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { FnbOrderStatus, FnbOrderType } from '../types';

@Entity('fnb_orders')
@Index(['bookingId'])
export class FnbOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @Column({ name: 'order_type', type: 'varchar', length: 20 })
  orderType: FnbOrderType;

  @Column({ name: 'total_amount', type: 'numeric', precision: 15, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: FnbOrderStatus.PENDING })
  status: FnbOrderStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
