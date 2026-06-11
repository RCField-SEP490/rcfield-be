import { MigrationInterface, QueryRunner } from 'typeorm';

export class ContestLeaderboardRewards1750500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_leaderboard_snapshots (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id          UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        contest_class_id    UUID REFERENCES contest_classes(id),
        scope               VARCHAR(50) NOT NULL DEFAULT 'OVERALL',
        standings           JSONB NOT NULL,
        published_by        UUID NOT NULL REFERENCES users(id),
        published_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_contest_leaderboard_scope
        ON contest_leaderboard_snapshots(contest_id, scope, published_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_rewards (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_id          UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        contest_class_id    UUID REFERENCES contest_classes(id),
        title               VARCHAR(255) NOT NULL,
        description         TEXT,
        reward_type         VARCHAR(30) NOT NULL,
        position            INTEGER NOT NULL,
        quantity            INTEGER NOT NULL DEFAULT 1,
        is_published        BOOLEAN NOT NULL DEFAULT TRUE,
        metadata            JSONB NOT NULL DEFAULT '{}',
        created_by          UUID NOT NULL REFERENCES users(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_contest_rewards_contest
        ON contest_rewards(contest_id, contest_class_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contest_reward_claims (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contest_reward_id   UUID NOT NULL REFERENCES contest_rewards(id),
        contest_id          UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
        registration_id     UUID NOT NULL REFERENCES contest_registrations(id),
        user_id             UUID NOT NULL REFERENCES users(id),
        source_result_id    UUID REFERENCES contest_results(id),
        status              VARCHAR(30) NOT NULL DEFAULT 'ISSUED',
        issued_by           UUID NOT NULL REFERENCES users(id),
        issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at          TIMESTAMPTZ,
        metadata            JSONB NOT NULL DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_reward_claims_unique
        ON contest_reward_claims(contest_reward_id, registration_id);
      CREATE INDEX IF NOT EXISTS idx_contest_reward_claims_user
        ON contest_reward_claims(user_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS contest_reward_claims`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_rewards`);
    await queryRunner.query(`DROP TABLE IF EXISTS contest_leaderboard_snapshots`);
  }
}
