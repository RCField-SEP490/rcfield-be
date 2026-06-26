import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerVehiclesAndMatchLocation1751200000000 implements MigrationInterface {
  name = 'CustomerVehiclesAndMatchLocation1751200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 0. Drop pre-existing table if any to ensure clean slate
    await queryRunner.query(`DROP TABLE IF EXISTS customer_vehicles CASCADE`);

    // 1. Create customer_vehicles table
    await queryRunner.query(`
      CREATE TABLE customer_vehicles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        brand VARCHAR(255),
        model VARCHAR(255),
        color VARCHAR(100),
        notes TEXT,
        image_url TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `);

    // 2. Create index on user_id
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_vehicles_user_id ON customer_vehicles(user_id)
    `);

    // 3. Add foreign key constraint to contest_registrations
    await queryRunner.query(`
      ALTER TABLE contest_registrations
      ADD CONSTRAINT fk_contest_registrations_customer_vehicle
      FOREIGN KEY (customer_vehicle_id) REFERENCES customer_vehicles(id) ON DELETE SET NULL
    `);

    // 4. Add cafe_id and track_config_id to contest_matches
    await queryRunner.query(`
      ALTER TABLE contest_matches
      ADD COLUMN cafe_id UUID REFERENCES cafes(id) ON DELETE SET NULL,
      ADD COLUMN track_config_id UUID REFERENCES cafe_track_configs(id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop columns from contest_matches
    await queryRunner.query(`
      ALTER TABLE contest_matches
      DROP COLUMN IF EXISTS track_config_id,
      DROP COLUMN IF EXISTS cafe_id
    `);

    // 2. Drop constraint from contest_registrations
    await queryRunner.query(`
      ALTER TABLE contest_registrations
      DROP CONSTRAINT IF EXISTS fk_contest_registrations_customer_vehicle
    `);

    // 3. Drop index
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_customer_vehicles_user_id
    `);

    // 4. Drop customer_vehicles table
    await queryRunner.query(`
      DROP TABLE IF EXISTS customer_vehicles CASCADE
    `);
  }
}
