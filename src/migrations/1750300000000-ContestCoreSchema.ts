import { MigrationInterface, QueryRunner } from 'typeorm';

export class ContestCoreSchema1750300000000 implements MigrationInterface {
  name = 'ContestCoreSchema1750300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contests
        ADD COLUMN IF NOT EXISTS provider_id UUID,
        ADD COLUMN IF NOT EXISTS track_type_id UUID,
        ADD COLUMN IF NOT EXISTS registration_opens_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS registration_closes_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS banner_image_url TEXT,
        ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE contests
        ALTER COLUMN cafe_id DROP NOT NULL,
        ALTER COLUMN track_type DROP NOT NULL
    `);

    await queryRunner.query(`
      UPDATE contests c
      SET provider_id = cafes.provider_id
      FROM cafes
      WHERE c.provider_id IS NULL
        AND c.cafe_id IS NOT NULL
        AND cafes.id = c.cafe_id
    `);

    await queryRunner.query(`
      UPDATE contests
      SET registration_opens_at = COALESCE(registration_opens_at, created_at, NOW()),
          registration_closes_at = COALESCE(registration_closes_at, starts_at)
      WHERE registration_opens_at IS NULL OR registration_closes_at IS NULL
    `);

    await queryRunner.query(`
      UPDATE contests c
      SET track_type_id = tt.id
      FROM track_types tt
      WHERE c.track_type_id IS NULL
        AND c.track_type IS NOT NULL
        AND (tt.code = c.track_type OR tt.name = c.track_type)
    `);

    await queryRunner.query(`
      UPDATE contests
      SET track_type_id = (SELECT id FROM track_types ORDER BY sort_order ASC, code ASC LIMIT 1)
      WHERE track_type_id IS NULL
        AND EXISTS (SELECT 1 FROM track_types)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_contests_provider_id'
            AND table_name = 'contests'
        ) THEN
          ALTER TABLE contests
            ADD CONSTRAINT fk_contests_provider_id FOREIGN KEY (provider_id) REFERENCES users(id);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_contests_track_type_id'
            AND table_name = 'contests'
        ) THEN
          ALTER TABLE contests
            ADD CONSTRAINT fk_contests_track_type_id FOREIGN KEY (track_type_id) REFERENCES track_types(id);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_cafes (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id        UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        cafe_id           UUID NOT NULL REFERENCES cafes(id),
        role              VARCHAR(30) NOT NULL DEFAULT 'HOST',
        capacity_override INTEGER,
        check_in_enabled  BOOLEAN NOT NULL DEFAULT true,
        display_order     INTEGER NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      INSERT INTO contest_cafes (contest_id, cafe_id, role)
      SELECT id, cafe_id, 'HOST'
      FROM contests
      WHERE cafe_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_cafes_unique ON contest_cafes(contest_id, cafe_id);
      CREATE INDEX IF NOT EXISTS idx_contest_cafes_cafe_id ON contest_cafes(cafe_id);
      CREATE INDEX IF NOT EXISTS idx_contests_provider_status ON contests(provider_id, status);
      CREATE INDEX IF NOT EXISTS idx_contests_status_starts ON contests(status, starts_at);
      CREATE INDEX IF NOT EXISTS idx_contests_registration_window ON contests(registration_opens_at, registration_closes_at);
    `);

    await queryRunner.query(`
      ALTER TABLE contest_registrations
        ADD COLUMN IF NOT EXISTS participant_role_snapshot VARCHAR(30),
        ADD COLUMN IF NOT EXISTS check_in_code VARCHAR(64),
        ADD COLUMN IF NOT EXISTS checked_in_cafe_id UUID REFERENCES cafes(id),
        ADD COLUMN IF NOT EXISTS checked_in_by UUID REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'
    `);

    await queryRunner.query(`
      UPDATE contest_registrations cr
      SET participant_role_snapshot = users.role
      FROM users
      WHERE cr.participant_role_snapshot IS NULL
        AND users.id = cr.user_id
    `);

    await queryRunner.query(`
      UPDATE contest_registrations
      SET check_in_code = UPPER(REPLACE(gen_random_uuid()::text, '-', ''))
      WHERE check_in_code IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE contest_registrations
        ALTER COLUMN participant_role_snapshot SET NOT NULL,
        ALTER COLUMN check_in_code SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_registrations_check_in_code
        ON contest_registrations(check_in_code);
      CREATE INDEX IF NOT EXISTS idx_contest_registrations_contest_status
        ON contest_registrations(contest_id, status);
      CREATE INDEX IF NOT EXISTS idx_contest_registrations_user_id
        ON contest_registrations(user_id);
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM contests WHERE provider_id IS NULL)
           AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contests' AND column_name = 'provider_id') THEN
          ALTER TABLE contests ALTER COLUMN provider_id SET NOT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM contests WHERE track_type_id IS NULL)
           AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contests' AND column_name = 'track_type_id') THEN
          ALTER TABLE contests ALTER COLUMN track_type_id SET NOT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM contests WHERE registration_opens_at IS NULL)
           AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contests' AND column_name = 'registration_opens_at') THEN
          ALTER TABLE contests ALTER COLUMN registration_opens_at SET NOT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM contests WHERE registration_closes_at IS NULL)
           AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contests' AND column_name = 'registration_closes_at') THEN
          ALTER TABLE contests ALTER COLUMN registration_closes_at SET NOT NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contest_registrations_user_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contest_registrations_contest_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contest_registrations_check_in_code`);
    await queryRunner.query(`
      ALTER TABLE contest_registrations
        DROP COLUMN IF EXISTS metadata,
        DROP COLUMN IF EXISTS cancellation_reason,
        DROP COLUMN IF EXISTS cancelled_at,
        DROP COLUMN IF EXISTS cancelled_by,
        DROP COLUMN IF EXISTS checked_in_at,
        DROP COLUMN IF EXISTS checked_in_by,
        DROP COLUMN IF EXISTS checked_in_cafe_id,
        DROP COLUMN IF EXISTS check_in_code,
        DROP COLUMN IF EXISTS participant_role_snapshot
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_contests_registration_window`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contests_status_starts`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contests_provider_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contest_cafes_cafe_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contest_cafes_unique`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_cafes`);

    await queryRunner.query(`
      ALTER TABLE contests
        DROP CONSTRAINT IF EXISTS fk_contests_track_type_id,
        DROP CONSTRAINT IF EXISTS fk_contests_provider_id,
        DROP COLUMN IF EXISTS deleted_at,
        DROP COLUMN IF EXISTS config,
        DROP COLUMN IF EXISTS banner_image_url,
        DROP COLUMN IF EXISTS registration_closes_at,
        DROP COLUMN IF EXISTS registration_opens_at,
        DROP COLUMN IF EXISTS track_type_id,
        DROP COLUMN IF EXISTS provider_id
    `);
  }
}
