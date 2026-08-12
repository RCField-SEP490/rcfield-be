import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gỡ hai bảng đã bị thay thế nhưng chưa ai dọn, cùng ba cột khoá ngoại trỏ tới
 * chúng. Khác đợt trước ở chỗ: hai bảng này còn khoá ngoại từ bảng đang sống,
 * nên phải bỏ cột trước rồi mới bỏ được bảng.
 *
 *   subscriptions      → provider_subscriptions đã thay thế hoàn toàn.
 *                        Không còn một truy vấn nào trong mã nguồn; chuỗi
 *                        `/provider/subscriptions` rải rác chỉ là URL frontend.
 *
 *   customer_vehicles  → xe của khách nay đi theo `vehicles`. Đường ghi duy nhất
 *                        còn lại là `contest/registrations.ts`, và nó gán cứng
 *                        `customerVehicleId = null` — nghĩa là cột này không thể
 *                        nhận giá trị nào khác null qua API.
 *
 * Ba cột bị bỏ đều đang rỗng 100% (đã kiểm trên dữ liệu thật) và không cột nào
 * có index riêng, nên bỏ chúng không mất gì.
 *
 * Kèm theo: `contest_registrations.customer_vehicle_id` từng lộ ra API dưới tên
 * `customer_vehicle_id`. Trường đó luôn null nên đã gỡ khỏi payload trong cùng
 * thay đổi này — xem `contest/payload.ts`.
 *
 * `play_mode_enum` KHÔNG bị bỏ dù `subscriptions` có dùng: `bookings.play_mode`
 * vẫn đang dùng chung nó.
 */
export class DropSupersededSubscriptionAndCustomerVehicle1786700000000 implements MigrationInterface {
  private static readonly TABLES = ['subscriptions', 'customer_vehicles'];

  /** [bảng, cột] — các cột khoá ngoại phải rỗng thì mới bỏ được mà không mất dữ liệu. */
  private static readonly COLUMNS: Array<[string, string]> = [
    ['bookings', 'subscription_id'],
    ['contest_registrations', 'customer_vehicle_id'],
    ['session_vehicles', 'customer_vehicle_id'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cùng lý do như migration trước: `DB_AUTO_MIGRATE` mặc định bật nên đoạn này
    // chạy không người trông khi deploy. Thà dừng deploy còn hơn xoá nhầm.
    const problems: string[] = [];

    for (const table of DropSupersededSubscriptionAndCustomerVehicle1786700000000.TABLES) {
      if (!(await queryRunner.hasTable(table))) continue;
      const [{ count }] = await queryRunner.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      if (count > 0) problems.push(`bảng ${table} có ${count} dòng`);
    }

    for (const [
      table,
      column,
    ] of DropSupersededSubscriptionAndCustomerVehicle1786700000000.COLUMNS) {
      if (!(await queryRunner.hasColumn(table, column))) continue;
      const [{ count }] = await queryRunner.query(
        `SELECT COUNT("${column}")::int AS count FROM "${table}"`,
      );
      if (count > 0) problems.push(`${table}.${column} có ${count} giá trị khác null`);
    }

    if (problems.length > 0) {
      throw new Error(
        `Huỷ bỏ migration: dữ liệu không khớp giả định "đã chết" — ${problems.join('; ')}. ` +
          `Kiểm tra lại trước khi xoá.`,
      );
    }

    // Bỏ cột kéo theo khoá ngoại của chính nó, không cần DROP CONSTRAINT riêng.
    for (const [
      table,
      column,
    ] of DropSupersededSubscriptionAndCustomerVehicle1786700000000.COLUMNS) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${column}"`);
    }

    for (const table of DropSupersededSubscriptionAndCustomerVehicle1786700000000.TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }

    // Chỉ `subscriptions` dùng type này; `play_mode_enum` thì không, vì
    // `bookings.play_mode` vẫn cần.
    await queryRunner.query(`DROP TYPE IF EXISTS "subscription_status_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "subscription_status_enum" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED')`,
    );

    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        cafe_id uuid NOT NULL,
        customer_id uuid NOT NULL,
        play_mode play_mode_enum NOT NULL,
        track_type character varying(50) NOT NULL,
        frequency_rule jsonb NOT NULL,
        slot_count integer NOT NULL DEFAULT 1,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz,
        status subscription_status_enum NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
        CONSTRAINT subscriptions_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES cafes(id),
        CONSTRAINT subscriptions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES users(id)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_subscriptions_cafe_id ON subscriptions (cafe_id)`);
    await queryRunner.query(
      `CREATE INDEX idx_subscriptions_customer_id ON subscriptions (customer_id)`,
    );
    await queryRunner.query(`CREATE INDEX idx_subscriptions_status ON subscriptions (status)`);

    await queryRunner.query(`
      CREATE TABLE "customer_vehicles" (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL,
        brand character varying(100),
        model character varying(100),
        serial_number character varying(100),
        description text,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT customer_vehicles_pkey PRIMARY KEY (id),
        CONSTRAINT customer_vehicles_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES users(id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_vehicles_customer_id ON customer_vehicles (customer_id)`,
    );

    await queryRunner.query(`ALTER TABLE "bookings" ADD COLUMN "subscription_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD CONSTRAINT fk_bookings_subscription_id FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_registrations" ADD COLUMN "customer_vehicle_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_registrations" ADD CONSTRAINT contest_registrations_customer_vehicle_id_fkey FOREIGN KEY (customer_vehicle_id) REFERENCES customer_vehicles(id)`,
    );
    await queryRunner.query(`ALTER TABLE "session_vehicles" ADD COLUMN "customer_vehicle_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "session_vehicles" ADD CONSTRAINT session_vehicles_customer_vehicle_id_fkey FOREIGN KEY (customer_vehicle_id) REFERENCES customer_vehicles(id)`,
    );
  }
}
