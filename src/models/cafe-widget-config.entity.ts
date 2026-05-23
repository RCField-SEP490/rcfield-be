import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('cafe_widget_configs')
export class CafeWidgetConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'cafe_id', unique: true })
  cafeId: string;

  @Column({
    name: 'greeting_message',
    type: 'text',
    default: 'Xin chào! Tôi có thể giúp gì cho bạn?',
  })
  greetingMessage: string;

  @Column({ length: 20, default: 'BOTTOM_RIGHT' })
  position: string;

  @Column({ name: 'primary_color', length: 7, default: '#2563EB' })
  primaryColor: string;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string | null;

  @Column({
    name: 'welcome_message',
    type: 'text',
    default: 'Xin chào! Tôi có thể giúp gì cho bạn?',
  })
  welcomeMessage: string;

  @Column({ name: 'quick_replies', type: 'jsonb', default: '[]' })
  quickReplies: string[];

  @Column({ name: 'system_prompt', type: 'text', nullable: true })
  systemPrompt: string | null;

  @Column({ name: 'is_enabled', default: true })
  isEnabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
