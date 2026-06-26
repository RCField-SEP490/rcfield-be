import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerVehiclesAndMatchLocation1751200000000 implements MigrationInterface {
  name = 'CustomerVehiclesAndMatchLocation1751200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Keep the Phase 1 BYOC table and add contest-facing RC vehicle fields safely.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS customer_vehicles (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id   UUID NOT NULL REFERENCES users(id),
        brand         VARCHAR(100),
        model         VARCHAR(100),
        serial_number VARCHAR(100),
        description   TEXT,
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      );

      ALTER TABLE customer_vehicles
        ADD COLUMN IF NOT EXISTS name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS scale VARCHAR(50),
        ADD COLUMN IF NOT EXISTS chassis_type VARCHAR(100),
        ADD COLUMN IF NOT EXISTS frequency VARCHAR(100),
        ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN IF NOT EXISTS image_url TEXT,
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

      UPDATE customer_vehicles
         SET name = COALESCE(
           NULLIF(name, ''),
           NULLIF(TRIM(CONCAT_WS(' ', brand, model)), ''),
           NULLIF(description, ''),
           'Xe ca nhan'
         ),
         scale = COALESCE(NULLIF(scale, ''), '1/10'),
         chassis_type = COALESCE(NULLIF(chassis_type, ''), model, 'RC'),
         frequency = COALESCE(NULLIF(frequency, ''), serial_number, '2.4GHz')
       WHERE name IS NULL
          OR scale IS NULL
          OR chassis_type IS NULL
          OR frequency IS NULL;

      ALTER TABLE customer_vehicles
        ALTER COLUMN name SET NOT NULL,
        ALTER COLUMN scale SET NOT NULL,
        ALTER COLUMN chassis_type SET NOT NULL,
        ALTER COLUMN frequency SET NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_vehicles_customer_id ON customer_vehicles(customer_id);
      CREATE INDEX IF NOT EXISTS idx_customer_vehicles_status ON customer_vehicles(status);
    `);

    await queryRunner.query(`
      ALTER TABLE contest_registrations
      ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_contest_registrations_customer_vehicle'
            AND table_name = 'contest_registrations'
        ) THEN
          ALTER TABLE contest_registrations
            ADD CONSTRAINT fk_contest_registrations_customer_vehicle
            FOREIGN KEY (customer_vehicle_id) REFERENCES customer_vehicles(id) ON DELETE SET NULL;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_contest_registrations_booking_id
        ON contest_registrations(booking_id)
        WHERE booking_id IS NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE contest_matches
      ADD COLUMN IF NOT EXISTS cafe_id UUID REFERENCES cafes(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS track_config_id UUID REFERENCES cafe_track_configs(id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contest_matches
      DROP COLUMN IF EXISTS track_config_id,
      DROP COLUMN IF EXISTS cafe_id
    `);

    await queryRunner.query(`
      ALTER TABLE contest_registrations
      DROP CONSTRAINT IF EXISTS fk_contest_registrations_customer_vehicle
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contest_registrations_booking_id`);
    await queryRunner.query(`ALTER TABLE contest_registrations DROP COLUMN IF EXISTS booking_id`);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_customer_vehicles_status;

      ALTER TABLE customer_vehicles
        DROP COLUMN IF EXISTS metadata,
        DROP COLUMN IF EXISTS image_url,
        DROP COLUMN IF EXISTS status,
        DROP COLUMN IF EXISTS frequency,
        DROP COLUMN IF EXISTS chassis_type,
        DROP COLUMN IF EXISTS scale,
        DROP COLUMN IF EXISTS name;
    `);
  }
}
