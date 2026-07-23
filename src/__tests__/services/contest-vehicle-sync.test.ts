import { ContestRegistrationStatus } from '../../types';

const mockRegistrationRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
};
const mockAuditRepo = {
  create: jest.fn((payload: unknown) => payload),
  save: jest.fn(),
};

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn((entity: { name?: string }) => {
      const name = entity?.name ?? '';
      if (name === 'ContestRegistration') return mockRegistrationRepo;
      if (name === 'ContestAuditLog') return mockAuditRepo;
      throw new Error(`Unexpected repository: ${name}`);
    }),
  },
}));

jest.mock('../../config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  logContestVehicleCheckedOut,
  syncContestRegistrationOnVehicleCheckIn,
} from '../../services/contest-rental.service';

const contestBooking = {
  id: 'booking-1',
  contestId: 'contest-1',
  cafeId: 'cafe-1',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('syncContestRegistrationOnVehicleCheckIn', () => {
  it('returns null for non-contest bookings', async () => {
    const result = await syncContestRegistrationOnVehicleCheckIn(
      { ...contestBooking, contestId: null },
      { staffUserId: 'staff-1' },
    );
    expect(result).toBeNull();
    expect(mockRegistrationRepo.findOne).not.toHaveBeenCalled();
  });

  it('skips when no registration is linked to the booking', async () => {
    mockRegistrationRepo.findOne.mockResolvedValue(null);
    const result = await syncContestRegistrationOnVehicleCheckIn(contestBooking, {
      staffUserId: 'staff-1',
    });
    expect(result).toEqual({ registrationId: null, synced: false, previousStatus: null });
    expect(mockRegistrationRepo.save).not.toHaveBeenCalled();
  });

  it('transitions a CONFIRMED registration to CHECKED_IN and writes an audit log', async () => {
    const registration = {
      id: 'reg-1',
      status: ContestRegistrationStatus.CONFIRMED,
      checkedInCafeId: null,
      checkedInBy: null,
      checkedInAt: null,
    };
    mockRegistrationRepo.findOne.mockResolvedValue(registration);

    const result = await syncContestRegistrationOnVehicleCheckIn(contestBooking, {
      staffUserId: 'staff-1',
    });

    expect(result).toEqual({
      registrationId: 'reg-1',
      synced: true,
      previousStatus: ContestRegistrationStatus.CONFIRMED,
    });
    expect(mockRegistrationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'reg-1',
        status: ContestRegistrationStatus.CHECKED_IN,
        checkedInCafeId: 'cafe-1',
        checkedInBy: 'staff-1',
        checkedInAt: expect.any(Date),
      }),
    );
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: 'contest-1',
        registrationId: 'reg-1',
        actorId: 'staff-1',
        eventType: 'registration.checked_in',
        beforeJson: { status: ContestRegistrationStatus.CONFIRMED },
        afterJson: { status: ContestRegistrationStatus.CHECKED_IN, checkedInCafeId: 'cafe-1' },
      }),
    );
  });

  it('is a no-op when the registration is already CHECKED_IN', async () => {
    mockRegistrationRepo.findOne.mockResolvedValue({
      id: 'reg-1',
      status: ContestRegistrationStatus.CHECKED_IN,
    });
    const result = await syncContestRegistrationOnVehicleCheckIn(contestBooking, {
      staffUserId: 'staff-1',
    });
    expect(result).toEqual({
      registrationId: 'reg-1',
      synced: false,
      previousStatus: ContestRegistrationStatus.CHECKED_IN,
    });
    expect(mockRegistrationRepo.save).not.toHaveBeenCalled();
  });

  it('does not block check-in for unexpected statuses (e.g. PENDING)', async () => {
    mockRegistrationRepo.findOne.mockResolvedValue({
      id: 'reg-1',
      status: ContestRegistrationStatus.PENDING,
    });
    const result = await syncContestRegistrationOnVehicleCheckIn(contestBooking, {
      staffUserId: 'staff-1',
    });
    expect(result).toEqual({
      registrationId: 'reg-1',
      synced: false,
      previousStatus: ContestRegistrationStatus.PENDING,
    });
    expect(mockRegistrationRepo.save).not.toHaveBeenCalled();
    expect(mockAuditRepo.save).not.toHaveBeenCalled();
  });
});

describe('logContestVehicleCheckedOut', () => {
  it('does nothing for non-contest bookings', async () => {
    await logContestVehicleCheckedOut({ id: 'booking-1', contestId: null }, { id: 'session-1' });
    expect(mockAuditRepo.save).not.toHaveBeenCalled();
  });

  it('writes an audit entry with booking/session/registration metadata', async () => {
    mockRegistrationRepo.findOne.mockResolvedValue({ id: 'reg-1' });
    await logContestVehicleCheckedOut(contestBooking, { id: 'session-1' });
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: 'contest-1',
        registrationId: 'reg-1',
        eventType: 'booking.vehicle_checked_out',
        metadata: {
          booking_id: 'booking-1',
          session_id: 'session-1',
          registration_id: 'reg-1',
        },
      }),
    );
  });

  it('still writes an audit entry when no registration exists', async () => {
    mockRegistrationRepo.findOne.mockResolvedValue(null);
    await logContestVehicleCheckedOut(contestBooking, { id: 'session-1' });
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationId: null,
        metadata: expect.objectContaining({ registration_id: null }),
      }),
    );
  });
});
