import type { Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { AppError, AuthRequest, UserRole } from '../types';
import {
  CreateBookingSchema,
  CancelBookingSchema,
  ListMyBookingsSchema,
  ListCafeBookingsSchema,
} from '../validate';
import * as bookingService from '../services/booking.service';
import { createCheckoutUrl, processRefund } from '../services/payment.service';
import { Booking } from '../models/booking.entity';
import { BookingParticipant } from '../models/booking-participant.entity';
import { BookingVehicle } from '../models/booking-vehicle.entity';
import { PaymentComponent } from '../models/payment-component.entity';
import { FnbOrder } from '../models/fnb-order.entity';
import { FnbOrderItem } from '../models/fnb-order-item.entity';

export const bookingController = {
  // POST /api/v1/bookings  [auth CUSTOMER]
  async createBooking(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = CreateBookingSchema.parse(req.body);
      const result = await bookingService.createBooking(req.user!.userId, body);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/bookings/:id/checkout  [auth CUSTOMER]
  async createCheckout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const bookingId = req.params.id;
      const forwardedFor = req.headers['x-forwarded-for'];
      const ipAddr =
        (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : null) ||
        req.ip ||
        req.socket.remoteAddress ||
        '127.0.0.1';

      // Ownership check: verify booking belongs to this customer
      const booking = await AppDataSource.getRepository(Booking).findOne({
        where: { id: bookingId },
      });
      if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');
      if (booking.customerId !== req.user!.userId) {
        throw new AppError('Access denied', 403, 'NOT_BOOKING_OWNER');
      }

      const result = await createCheckoutUrl(bookingId, ipAddr);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/bookings/:id  [auth]
  async getBooking(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const bookingId = req.params.id;
      const booking = await AppDataSource.getRepository(Booking).findOne({
        where: { id: bookingId },
      });
      if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');

      // Access control: customer sees own bookings; staff/provider sees their cafe's bookings
      const role = req.user!.role;
      if (role === UserRole.CUSTOMER && booking.customerId !== req.user!.userId) {
        throw new AppError('Access denied', 403, 'NOT_BOOKING_OWNER');
      }

      // Load related records
      const [participants, vehicles, components, fnbOrder] = await Promise.all([
        AppDataSource.getRepository(BookingParticipant).find({ where: { bookingId } }),
        AppDataSource.getRepository(BookingVehicle).find({ where: { bookingId } }),
        AppDataSource.getRepository(PaymentComponent).find({ where: { bookingId } }),
        AppDataSource.getRepository(FnbOrder).findOne({ where: { bookingId } }),
      ]);

      let fnbItems: FnbOrderItem[] = [];
      if (fnbOrder) {
        fnbItems = await AppDataSource.getRepository(FnbOrderItem).find({
          where: { fnbOrderId: fnbOrder.id },
        });
      }

      res.json({
        success: true,
        data: {
          ...booking,
          participants,
          vehicles,
          payment_components: components,
          fnb_order: fnbOrder ? { ...fnbOrder, items: fnbItems } : null,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/bookings  [auth CUSTOMER]
  async listMyBookings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = ListMyBookingsSchema.parse(req.query);
      let qb = AppDataSource.createQueryBuilder(Booking, 'b')
        .where('b.customer_id = :customerId', { customerId: req.user!.userId })
        .andWhere('b.deleted_at IS NULL')
        .orderBy('b.slot_start', 'DESC')
        .skip((query.page - 1) * query.limit)
        .take(query.limit);

      if (query.status) {
        qb = qb.andWhere('b.status = :status', { status: query.status });
      }

      const [data, total] = await Promise.all([qb.getMany(), qb.getCount()]);
      res.json({ success: true, data, total, page: query.page, limit: query.limit });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/bookings/:id/cancel  [auth CUSTOMER, PROVIDER]
  async cancelBooking(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const bookingId = req.params.id;
      const body = CancelBookingSchema.parse(req.body);
      await bookingService.cancelBooking(bookingId, req.user!.userId, req.user!.role, body.reason);
      const refund = await processRefund(bookingId, req.user!.role);
      res.json({ success: true, data: { bookingId, refund } });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/provider/cafes/:cafeId/bookings  [auth PROVIDER, STAFF]
  async listCafeBookings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const cafeId = req.params.cafeId;
      const query = ListCafeBookingsSchema.parse(req.query) as bookingService.ListCafeBookingsQuery;
      const result = await bookingService.listCafeBookings(cafeId, query);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },
};
