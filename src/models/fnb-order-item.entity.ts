import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('fnb_order_items')
@Index(['fnbOrderId'])
export class FnbOrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'fnb_order_id', type: 'uuid' })
  fnbOrderId: string;

  @Column({ name: 'menu_item_id', type: 'uuid' })
  menuItemId: string;

  @Column({ name: 'quantity', type: 'int' })
  quantity: number;

  @Column({ name: 'unit_price', type: 'numeric', precision: 15, scale: 2 })
  unitPrice: number;

  @Column({ name: 'subtotal', type: 'numeric', precision: 15, scale: 2 })
  subtotal: number;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
