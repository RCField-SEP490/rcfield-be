import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('menu_item_components')
export class MenuItemComponent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'combo_id', type: 'uuid' })
  comboId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'smallint', default: 1 })
  quantity: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
