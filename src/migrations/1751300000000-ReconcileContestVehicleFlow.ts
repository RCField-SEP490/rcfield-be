import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReconcileContestVehicleFlow1751300000000 implements MigrationInterface {
  name = 'ReconcileContestVehicleFlow1751300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customer_vehicles
        ADD COLUMN IF NOT EXISTS customer_id UUID,
        ADD COLUMN IF NOT EXISTS scale VARCHAR(50),
        ADD COLUMN IF NOT EXISTS chassis_type VARCHAR(100),
        ADD COLUMN IF NOT EXISTS frequency VARCHAR(100),
        ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100),
        ADD COLUMN IF NOT EXISTS description TEXT;

      UPDATE customer_vehicles
         SET customer_id = COALESCE(customer_id, user_id)
       WHERE customer_id IS NULL;

      UPDATE customer_vehicles
         SET user_id = COALESCE(user_id, customer_id)
       WHERE user_id IS NULL;

      UPDATE customer_vehicles
         SET name = COALESCE(NULLIF(name, ''), 'Xe ca nhan'),
             scale = COALESCE(NULLIF(scale, ''), '1/10'),
             chassis_type = COALESCE(NULLIF(chassis_type, ''), 'RC'),
             frequency = COALESCE(NULLIF(frequency, ''), '2.4GHz')
       WHERE name IS NULL
          OR scale IS NULL
          OR chassis_type IS NULL
          OR frequency IS NULL;

      ALTER TABLE customer_vehicles
        ALTER COLUMN customer_id SET NOT NULL,
        ALTER COLUMN name SET NOT NULL,
        ALTER COLUMN scale SET NOT NULL,
        ALTER COLUMN chassis_type SET NOT NULL,
        ALTER COLUMN frequency SET NOT NULL,
        ALTER COLUMN user_id DROP NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_customer_vehicles_customer_id ON customer_vehicles(customer_id);
      CREATE INDEX IF NOT EXISTS idx_customer_vehicles_status ON customer_vehicles(status);
    `);

    await queryRunner.query(`
      ALTER TABLE contest_registrations
        ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_contest_registrations_booking_id
        ON contest_registrations(booking_id)
        WHERE booking_id IS NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE contest_matches
        ADD COLUMN IF NOT EXISTS cafe_id UUID REFERENCES cafes(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS track_config_id UUID REFERENCES cafe_track_configs(id) ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contest_registrations_booking_id`);
    await queryRunner.query(`ALTER TABLE contest_registrations DROP COLUMN IF EXISTS booking_id`);
    await queryRunner.query(`
      ALTER TABLE contest_matches
        DROP COLUMN IF EXISTS track_config_id,
        DROP COLUMN IF EXISTS cafe_id;
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_customer_vehicles_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_customer_vehicles_customer_id`);
  }
}
