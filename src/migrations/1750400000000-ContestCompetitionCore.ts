import { MigrationInterface, QueryRunner } from 'typeorm';

export class ContestCompetitionCore1750400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_classes (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id      UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        code            VARCHAR(50) NOT NULL,
        name            VARCHAR(255) NOT NULL,
        track_type_id   UUID REFERENCES track_types(id),
        rules           JSONB NOT NULL DEFAULT '{}',
        capacity        INTEGER,
        display_order   INTEGER NOT NULL DEFAULT 0,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_classes_code ON contest_classes(contest_id, code);
      CREATE INDEX IF NOT EXISTS idx_contest_classes_contest_id ON contest_classes(contest_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_rounds (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id          UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        contest_class_id    UUID NOT NULL REFERENCES contest_classes(id) ON DELETE CASCADE,
        round_type          VARCHAR(30) NOT NULL,
        round_no            INTEGER NOT NULL,
        name                VARCHAR(255),
        scheduled_at        TIMESTAMPTZ,
        rules               JSONB NOT NULL DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_rounds_unique ON contest_rounds(contest_class_id, round_type, round_no);
      CREATE INDEX IF NOT EXISTS idx_contest_rounds_contest_id ON contest_rounds(contest_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_heats (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id          UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        contest_round_id    UUID NOT NULL REFERENCES contest_rounds(id) ON DELETE CASCADE,
        heat_no             INTEGER NOT NULL,
        status              VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
        scheduled_at        TIMESTAMPTZ,
        config              JSONB NOT NULL DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_heats_unique ON contest_heats(contest_round_id, heat_no);
      CREATE INDEX IF NOT EXISTS idx_contest_heats_contest_id ON contest_heats(contest_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_heat_entries (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        heat_id             UUID NOT NULL REFERENCES contest_heats(id) ON DELETE CASCADE,
        registration_id     UUID NOT NULL REFERENCES contest_registrations(id),
        contest_class_id    UUID REFERENCES contest_classes(id),
        grid_position       INTEGER,
        metadata            JSONB NOT NULL DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_heat_entries_unique ON contest_heat_entries(heat_id, registration_id);
      CREATE INDEX IF NOT EXISTS idx_contest_heat_entries_registration ON contest_heat_entries(registration_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_results (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id          UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        heat_id             UUID NOT NULL REFERENCES contest_heats(id) ON DELETE CASCADE,
        heat_entry_id       UUID NOT NULL REFERENCES contest_heat_entries(id) ON DELETE CASCADE,
        registration_id     UUID NOT NULL REFERENCES contest_registrations(id),
        result_type         VARCHAR(30) NOT NULL,
        best_lap_ms         INTEGER,
        total_time_ms       INTEGER,
        finish_position     INTEGER,
        laps_completed      INTEGER,
        penalty_ms          INTEGER NOT NULL DEFAULT 0,
        dnf                 BOOLEAN NOT NULL DEFAULT FALSE,
        status              VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
        submitted_by        UUID NOT NULL REFERENCES users(id),
        verified_by         UUID REFERENCES users(id),
        verified_at         TIMESTAMPTZ,
        notes               TEXT,
        metadata            JSONB NOT NULL DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_results_heat_entry ON contest_results(heat_entry_id);
      CREATE INDEX IF NOT EXISTS idx_contest_results_contest_status ON contest_results(contest_id, status);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_result_audits (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        result_id       UUID NOT NULL REFERENCES contest_results(id) ON DELETE CASCADE,
        changed_by      UUID NOT NULL REFERENCES users(id),
        action          VARCHAR(50) NOT NULL,
        before_data     JSONB,
        after_data      JSONB,
        reason          TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_contest_result_audits_result ON contest_result_audits(result_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS contest_result_audits`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_results`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_heat_entries`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_heats`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_rounds`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_classes`);
  }
}
