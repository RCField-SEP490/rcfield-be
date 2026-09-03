import { CreateContestSchema } from '../../validate';

const UUID = {
  type: '00000000-0000-4000-8000-000000000001',
  format: '00000000-0000-4000-8000-000000000002',
  template: '00000000-0000-4000-8000-000000000003',
  track: '00000000-0000-4000-8000-000000000004',
  cafe: '00000000-0000-4000-8000-000000000005',
};

function contestBody(registrationOpensAt: Date) {
  const registrationClosesAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const startsAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const endsAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return {
    name: 'Giải kiểm thử thời gian',
    contest_type_id: UUID.type,
    contest_format_id: UUID.format,
    contest_template_id: UUID.template,
    track_type_id: UUID.track,
    participating_cafe_ids: [UUID.cafe],
    registration_opens_at: registrationOpensAt.toISOString(),
    registration_closes_at: registrationClosesAt.toISOString(),
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    capacity: 8,
    vehicle_rule: { vehicle_policy: 'BYOC_ONLY' },
  };
}

describe('CreateContestSchema — thời gian mở đăng ký', () => {
  it('từ chối tạo giải có thời gian mở đăng ký trong quá khứ', () => {
    const result = CreateContestSchema.safeParse(contestBody(new Date(Date.now() - 60_000)));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['registration_opens_at'],
            message: 'registration_opens_at phải sau thời điểm hiện tại',
          }),
        ]),
      );
    }
  });

  it('chấp nhận thời gian mở đăng ký trong tương lai', () => {
    const result = CreateContestSchema.safeParse(
      contestBody(new Date(Date.now() + 30 * 60 * 1000)),
    );

    expect(result.success).toBe(true);
  });
});
