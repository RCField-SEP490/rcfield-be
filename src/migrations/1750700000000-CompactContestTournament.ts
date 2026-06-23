import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompactContestTournament1750700000000 implements MigrationInterface {
  name = 'CompactContestTournament1750700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS contest_reward_claims CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_rewards CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_leaderboard_snapshots CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_bracket_matches CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_result_audits CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_results CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_heat_entries CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_heats CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_rounds CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_classes CASCADE`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_matches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        round_no INT NOT NULL,
        match_no INT NOT NULL,
        name VARCHAR(255),
        match_type VARCHAR(30) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
        scheduled_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        next_match_id UUID REFERENCES contest_matches(id),
        advancement_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by UUID REFERENCES users(id),
        decided_by UUID REFERENCES users(id),
        decided_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_contest_matches_round_match UNIQUE (contest_id, round_no, match_no),
        CONSTRAINT chk_contest_match_type CHECK (match_type IN ('HEAD_TO_HEAD', 'MULTI_DRIVER', 'TIME_ATTACK', 'FINAL')),
        CONSTRAINT chk_contest_match_status CHECK (status IN ('DRAFT', 'READY', 'RUNNING', 'COMPLETED', 'CANCELLED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_contest_matches_contest_status ON contest_matches(contest_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_contest_matches_next_match ON contest_matches(next_match_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_match_participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id UUID NOT NULL REFERENCES contest_matches(id) ON DELETE CASCADE,
        registration_id UUID NOT NULL REFERENCES contest_registrations(id) ON DELETE CASCADE,
        slot_no INT NOT NULL,
        lane VARCHAR(30),
        grid_position INT,
        seed_no INT,
        status VARCHAR(30) NOT NULL DEFAULT 'READY',
        score NUMERIC(12, 2),
        finish_position INT,
        best_lap_ms INT,
        total_time_ms INT,
        is_winner BOOLEAN NOT NULL DEFAULT FALSE,
        result_note TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_contest_match_participants_slot UNIQUE (match_id, slot_no),
        CONSTRAINT uq_contest_match_participants_registration UNIQUE (match_id, registration_id),
        CONSTRAINT chk_contest_match_participant_status CHECK (status IN ('READY', 'STARTED', 'FINISHED', 'DNS', 'DNF', 'DQ'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_contest_match_participants_registration ON contest_match_participants(registration_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        registration_id UUID REFERENCES contest_registrations(id) ON DELETE SET NULL,
        match_id UUID REFERENCES contest_matches(id) ON DELETE SET NULL,
        actor_id UUID REFERENCES users(id),
        actor_role VARCHAR(30),
        event_type VARCHAR(80) NOT NULL,
        before_json JSONB,
        after_json JSONB,
        reason TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_contest_audit_logs_contest_created ON contest_audit_logs(contest_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_contest_audit_logs_event_type ON contest_audit_logs(event_type)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS contest_audit_logs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_match_participants CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_matches CASCADE`);
  }
}
