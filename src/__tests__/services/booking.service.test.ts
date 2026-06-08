import { BookingStatus } from '../../types';
import { canTransition } from '../../services/booking.service';

describe('BookingService.canTransition', () => {
  it('PENDING → CONFIRMED via PAYMENT_CONFIRMED is valid', () => {
    expect(canTransition(BookingStatus.PENDING, 'PAYMENT_CONFIRMED')).toBe(true);
  });

  it('PENDING → CANCELLED via PAYMENT_TIMEOUT is valid', () => {
    expect(canTransition(BookingStatus.PENDING, 'PAYMENT_TIMEOUT')).toBe(true);
  });

  it('CONFIRMED → CANCELLED via CUSTOMER_CANCEL is valid', () => {
    expect(canTransition(BookingStatus.CONFIRMED, 'CUSTOMER_CANCEL')).toBe(true);
  });

  it('CONFIRMED → CANCELLED via PROVIDER_CANCEL is valid', () => {
    expect(canTransition(BookingStatus.CONFIRMED, 'PROVIDER_CANCEL')).toBe(true);
  });

  it('CANCELLED → CONFIRMED is invalid', () => {
    expect(canTransition(BookingStatus.CANCELLED, 'PAYMENT_CONFIRMED')).toBe(false);
  });

  it('CONFIRMED → PENDING is invalid', () => {
    expect(canTransition(BookingStatus.CONFIRMED, 'PAYMENT_CONFIRMED')).toBe(false);
  });

  it('PENDING → CUSTOMER_CANCEL is invalid', () => {
    expect(canTransition(BookingStatus.PENDING, 'CUSTOMER_CANCEL')).toBe(false);
  });

  it('COMPLETED → CANCELLED is invalid', () => {
    expect(canTransition(BookingStatus.COMPLETED, 'CUSTOMER_CANCEL')).toBe(false);
  });
});
