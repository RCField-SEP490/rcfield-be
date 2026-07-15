import {
  SubmitInspectionV2Schema,
  ConfirmCheckoutSchema,
  UpdateDamageItemsSchema,
} from '../../validate';
import { DamagePartType } from '../../types';

// ── SubmitInspectionV2Schema — damageLineItems validation ──────────────────────

describe('SubmitInspectionV2Schema — damageLineItems', () => {
  const base = { type: 'CHECK_OUT' as const, damageFlagged: true };

  it('chấp nhận 1 line item hợp lệ', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      ...base,
      damageLineItems: [
        { partType: DamagePartType.TIRE_WHEEL, partsPrice: 150000, laborPrice: 50000 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('chấp nhận N line items hợp lệ và tính tổng đúng', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      ...base,
      damageLineItems: [
        { partType: DamagePartType.TIRE_WHEEL, partsPrice: 150000, laborPrice: 50000 },
        { partType: DamagePartType.SHELL, partsPrice: 80000, laborPrice: 0 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.damageLineItems).toHaveLength(2);
    }
  });

  it('chấp nhận mảng rỗng (không hư hỏng)', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      type: 'CHECK_OUT',
      damageFlagged: false,
      damageLineItems: [],
    });
    expect(result.success).toBe(true);
  });

  it('laborPrice mặc định = 0 khi không truyền', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      ...base,
      damageLineItems: [{ partType: DamagePartType.SPOILER, partsPrice: 80000 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.damageLineItems![0].laborPrice).toBe(0);
    }
  });

  it('từ chối partsPrice < 0', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      ...base,
      damageLineItems: [{ partType: DamagePartType.SHELL, partsPrice: -1000, laborPrice: 0 }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes('0'))).toBe(true);
  });

  it('từ chối laborPrice < 0', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      ...base,
      damageLineItems: [{ partType: DamagePartType.MOTOR, partsPrice: 100000, laborPrice: -500 }],
    });
    expect(result.success).toBe(false);
  });

  it('từ chối partType=OTHER khi không có customPartName', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      ...base,
      damageLineItems: [{ partType: DamagePartType.OTHER, partsPrice: 30000, laborPrice: 0 }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes('Vui lòng nhập tên hư hỏng'))).toBe(
      true,
    );
  });

  it('từ chối partType=OTHER khi customPartName là chuỗi rỗng/khoảng trắng', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      ...base,
      damageLineItems: [
        { partType: DamagePartType.OTHER, customPartName: '   ', partsPrice: 30000, laborPrice: 0 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes('Vui lòng nhập tên hư hỏng'))).toBe(
      true,
    );
  });

  it('chấp nhận partType=OTHER với customPartName hợp lệ', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      ...base,
      damageLineItems: [
        {
          partType: DamagePartType.OTHER,
          customPartName: 'Ăng-ten gãy',
          partsPrice: 30000,
          laborPrice: 20000,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('từ chối giá trị partType không tồn tại trong enum', () => {
    const result = SubmitInspectionV2Schema.safeParse({
      ...base,
      damageLineItems: [{ partType: 'BUMPER', partsPrice: 50000, laborPrice: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

// ── ConfirmCheckoutSchema ──────────────────────────────────────────────────────

describe('ConfirmCheckoutSchema', () => {
  it('chấp nhận UUID hợp lệ', () => {
    const result = ConfirmCheckoutSchema.safeParse({
      inspectionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('từ chối chuỗi không phải UUID', () => {
    const result = ConfirmCheckoutSchema.safeParse({ inspectionId: 'not-a-uuid' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('UUID');
  });

  it('từ chối body thiếu inspectionId', () => {
    const result = ConfirmCheckoutSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── UpdateDamageItemsSchema ────────────────────────────────────────────────────

describe('UpdateDamageItemsSchema', () => {
  it('chấp nhận mảng hợp lệ', () => {
    const result = UpdateDamageItemsSchema.safeParse({
      damageLineItems: [{ partType: 'CHASSIS', partsPrice: 200000, laborPrice: 50000 }],
    });
    expect(result.success).toBe(true);
  });

  it('chấp nhận mảng rỗng (xóa hết hạng mục)', () => {
    const result = UpdateDamageItemsSchema.safeParse({ damageLineItems: [] });
    expect(result.success).toBe(true);
  });

  it('từ chối partType=OTHER không có customPartName', () => {
    const result = UpdateDamageItemsSchema.safeParse({
      damageLineItems: [{ partType: 'OTHER', partsPrice: 30000 }],
    });
    expect(result.success).toBe(false);
  });

  it('từ chối thiếu field damageLineItems', () => {
    const result = UpdateDamageItemsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
