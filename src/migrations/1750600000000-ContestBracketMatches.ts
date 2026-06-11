import { MigrationInterface, QueryRunner } from 'typeorm';

export class ContestBracketMatches1750600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_bracket_matches (
        id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id                      UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        contest_round_id                UUID NOT NULL REFERENCES contest_rounds(id) ON DELETE CASCADE,
        match_no                        INTEGER NOT NULL,
        competitor_a_registration_id    UUID REFERENCES contest_registrations(id),
        competitor_b_registration_id    UUID REFERENCES contest_registrations(id),
        winner_registration_id          UUID REFERENCES contest_registrations(id),
        loser_registration_id           UUID REFERENCES contest_registrations(id),
        next_match_id                   UUID REFERENCES contest_bracket_matches(id),
        next_slot                       VARCHAR(1),
        status                          VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
        decided_by                      UUID REFERENCES users(id),
        decided_at                      TIMESTAMPTZ,
        metadata                        JSONB NOT NULL DEFAULT '{}',
        created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_contest_bracket_next_slot CHECK (next_slot IS NULL OR next_slot IN ('A', 'B'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_bracket_matches_round_match
        ON contest_bracket_matches(contest_round_id, match_no);
      CREATE INDEX IF NOT EXISTS idx_contest_bracket_matches_contest
        ON contest_bracket_matches(contest_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS contest_bracket_matches`);
  }
}
