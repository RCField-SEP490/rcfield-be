import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { KycBusinessType, KycDocumentItem, ProviderStatus } from '../types';

@Entity('provider_profiles')
export class ProviderProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'business_name', type: 'varchar', length: 255 })
  businessName: string;

  @Column({ name: 'business_description', type: 'text', nullable: true })
  businessDescription: string | null;

  @Column({
    name: 'registration_status',
    type: 'enum',
    enum: ProviderStatus,
    enumName: 'provider_status_enum',
    default: ProviderStatus.PENDING,
  })
  registrationStatus: ProviderStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @Column({ name: 'suspended_reason', type: 'text', nullable: true })
  suspendedReason: string | null;

  @Column({ name: 'business_type', type: 'varchar', length: 20, nullable: true })
  businessType: KycBusinessType | null;

  @Column({ name: 'kyc_documents', type: 'jsonb', default: [] })
  kycDocuments: KycDocumentItem[];

  @Column({ name: 'kyc_submitted_at', type: 'timestamptz', nullable: true })
  kycSubmittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
