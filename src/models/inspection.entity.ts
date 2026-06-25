import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { InspectionType, InspectionSubjectType } from '../types';

@Entity('inspections')
@Index(['sessionId'])
export class Inspection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'session_vehicle_id', type: 'uuid', nullable: true })
  sessionVehicleId: string | null;

  @Column({ type: 'enum', enum: InspectionType })
  type: InspectionType;

  @Column({ name: 'subject_type', type: 'enum', enum: InspectionSubjectType })
  subjectType: InspectionSubjectType;

  @Column({ name: 'performed_by', type: 'uuid' })
  performedBy: string;

  @Column({ name: 'pre_existing_flag', type: 'boolean', default: false })
  preExistingFlag: boolean;

  @Column({ name: 'damage_noted', type: 'boolean', default: false })
  damageNoted: boolean;

  @Column({ name: 'damage_description', type: 'text', nullable: true })
  damageDescription: string | null;

  @Column({
    name: 'damage_cost_estimate',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  damageCostEstimate: number | null;

  @Column({ name: 'ai_analysis_json', type: 'jsonb', nullable: true })
  aiAnalysisJson: Record<string, unknown> | null;

  @Column({ name: 'customer_confirmed', type: 'boolean', default: false })
  customerConfirmed: boolean;

  @Column({ name: 'customer_confirmed_at', type: 'timestamptz', nullable: true })
  customerConfirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
