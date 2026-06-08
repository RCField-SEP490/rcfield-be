import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('booking_vehicles')
@Index(['bookingId'])
@Index(['vehicleId', 'bookingId'])
export class BookingVehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId: string;

  @Column({ name: 'rental_fee_snapshot', type: 'numeric', precision: 15, scale: 2 })
  rentalFeeSnapshot: number;

  @Column({ name: 'security_deposit_snapshot', type: 'numeric', precision: 15, scale: 2 })
  securityDepositSnapshot: number;

  @Column({ name: 'damage_multiplier_snapshot', type: 'numeric', precision: 4, scale: 2 })
  damageMultiplierSnapshot: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
