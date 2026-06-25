import type { Response, NextFunction } from 'express';
import { In, Not } from 'typeorm';
import { AppDataSource } from '../config/database';
import { AppError, AuthRequest, UserRole, SessionStatus } from '../types';
import {
  CreateBookingSchema,
  CancelBookingSchema,
  ListMyBookingsSchema,
  ListCafeBookingsSchema,
} from '../validate';
import * as bookingService from '../services/booking.service';
import {
  createCheckoutUrl,
  mockConfirmPayment,
  processRefund,
  createPaymentComponents,
  createCheckoutAdditionalPaymentUrl,
} from '../services/payment.service';
import type { BookingSnapshot } from '../services/payment.service';
import { env } from '../config/env';
import { Booking } from '../models/booking.entity';
import { BookingParticipant } from '../models/booking-participant.entity';
import { BookingVehicle } from '../models/booking-vehicle.entity';
import { Vehicle } from '../models/vehicle.entity';
import { PaymentComponent } from '../models/payment-component.entity';
import { FnbOrder } from '../models/fnb-order.entity';
import { FnbOrderItem } from '../models/fnb-order-item.entity';
import { Cafe } from '../models/cafe.entity';
import { User } from '../models/user.entity';
import { MenuItem } from '../models/menu-item.entity';
import { TrackType } from '../models/track-type.entity';
import { Session } from '../models/session.entity';

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

  // POST /api/v1/bookings/:id/checkout-additional-payment  [auth CUSTOMER]
  async createCheckoutAdditionalPayment(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const bookingId = req.params.id;
      const forwardedFor = req.headers['x-forwarded-for'];
      const ipAddr =
        (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : null) ||
        req.ip ||
        req.socket.remoteAddress ||
        '127.0.0.1';

      const booking = await AppDataSource.getRepository(Booking).findOne({
        where: { id: bookingId },
      });
      if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');
      if (booking.customerId !== req.user!.userId) {
        throw new AppError('Access denied', 403, 'NOT_BOOKING_OWNER');
      }

      const result = await createCheckoutAdditionalPaymentUrl(bookingId, ipAddr);
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
      const [rawParticipants, vehicles, components, fnbOrders, cafe, session] = await Promise.all([
        AppDataSource.getRepository(BookingParticipant).find({ where: { bookingId } }),
        AppDataSource.getRepository(BookingVehicle).find({ where: { bookingId } }),
        AppDataSource.getRepository(PaymentComponent).find({ where: { bookingId } }),
        AppDataSource.getRepository(FnbOrder).find({ where: { bookingId } }),
        AppDataSource.getRepository(Cafe).findOne({ where: { id: booking.cafeId } }),
        AppDataSource.getRepository(Session).findOne({ where: { bookingId } }),
      ]);

      // Enrich participants: resolve name/phone for registered users
      const userIds = rawParticipants.map((p) => p.userId).filter(Boolean) as string[];
      const users = userIds.length
        ? await AppDataSource.getRepository(User).findByIds(userIds)
        : [];
      const userMap = new Map(users.map((u) => [u.id, u]));
      const participants = rawParticipants.map((p) => ({
        ...p,
        resolvedName: p.guestName ?? userMap.get(p.userId ?? '')?.full_name ?? null,
        resolvedPhone: p.guestPhone ?? userMap.get(p.userId ?? '')?.phone ?? null,
      }));

      // Enrich vehicles with catalog info (name, tier, identifier, color, image)
      const vehicleIds = vehicles.map((v) => v.vehicleId);
      const enrichedVehicles = await Promise.all(
        vehicles.map(async (bv) => {
          const vehicle = await AppDataSource.getRepository(Vehicle).findOne({
            where: { id: bv.vehicleId },
            relations: ['catalog'],
          });
          return {
            ...bv,
            catalogName: vehicle?.catalog?.name ?? null,
            tier: vehicle?.catalog?.tier ?? null,
            identifier: vehicle?.identifier ?? null,
            color: vehicle?.color ?? null,
            coverImageUrl: vehicle?.catalog?.coverImageUrl ?? vehicle?.distinctiveImageUrl ?? null,
          };
        }),
      );
      void vehicleIds; // suppress unused warning

      // Enrich FnbOrder items with menu item names across all orders
      let fnbItems: (FnbOrderItem & { itemName: string | null })[] = [];
      let mergedFnbOrder = null;

      if (fnbOrders.length > 0) {
        const allRawItems: FnbOrderItem[] = [];
        for (const order of fnbOrders) {
          const items = await AppDataSource.getRepository(FnbOrderItem).find({
            where: { fnbOrderId: order.id },
          });
          allRawItems.push(...items);
        }

        const menuItemIds = [
          ...new Set(
            allRawItems.map((i) => i.menuItemId).filter((id): id is string => Boolean(id)),
          ),
        ];
        const menuItems = menuItemIds.length
          ? await AppDataSource.getRepository(MenuItem).findByIds(menuItemIds)
          : [];
        const menuMap = new Map(menuItems.map((m) => [m.id, m.name]));

        fnbItems = allRawItems.map((i) => ({
          ...i,
          itemName: i.menuItemId ? (menuMap.get(i.menuItemId) ?? null) : null,
        }));

        mergedFnbOrder = {
          id: fnbOrders[0].id,
          bookingId,
          orderType: 'MERGED',
          totalAmount: fnbOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0),
          status: 'CONFIRMED',
          items: fnbItems,
        };
      }

      // Backfill payment components if booking is confirmed but components are missing
      if (
        ['CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(booking.status) &&
        components.length === 0 &&
        booking.snapshot
      ) {
        const paymentSnapshot = booking.snapshot as unknown as BookingSnapshot;
        await createPaymentComponents(booking, paymentSnapshot, vehicles);
        components.push(
          ...(await AppDataSource.getRepository(PaymentComponent).find({ where: { bookingId } })),
        );
      }

      // Resolve track type name: snapshot first, then DB lookup
      const snapshot = booking.snapshot as Record<string, unknown> | null;
      let trackTypeName: string | null = (snapshot?.track_type_name as string) ?? null;
      if (!trackTypeName && booking.trackTypeId) {
        const tt = await AppDataSource.getRepository(TrackType).findOne({
          where: { id: booking.trackTypeId },
        });
        trackTypeName = tt?.name ?? null;
      }

      res.json({
        success: true,
        data: {
          ...booking,
          participants,
          vehicles: enrichedVehicles,
          payment_components: components,
          fnb_order: mergedFnbOrder,
          cafe: cafe ? { name: cafe.name, address: cafe.address, city: cafe.city } : null,
          track_type_name: trackTypeName,
          session: session
            ? {
                id: session.id,
                status: session.status,
                plannedEndAt: session.plannedEndAt,
                actualStartAt: session.actualStartAt,
                actualEndAt: session.actualEndAt,
              }
            : null,
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

      const [bookings, total] = await Promise.all([qb.getMany(), qb.getCount()]);

      // Batch-fetch active sessions for these bookings
      const bookingIds = bookings.map((b) => b.id);
      const activeSessions =
        bookingIds.length > 0
          ? await AppDataSource.getRepository(Session).find({
              where: {
                bookingId: In(bookingIds),
                status: Not(In([SessionStatus.COMPLETED, SessionStatus.CANCELLED])),
              },
              select: ['id', 'bookingId', 'status', 'plannedEndAt', 'actualStartAt'],
            })
          : [];

      const sessionByBookingId = new Map(activeSessions.map((s) => [s.bookingId, s]));
      const data = bookings.map((b) => {
        const sess = sessionByBookingId.get(b.id);
        return {
          ...b,
          session: sess
            ? {
                id: sess.id,
                status: sess.status,
                plannedEndAt: sess.plannedEndAt,
                actualStartAt: sess.actualStartAt,
              }
            : null,
        };
      });

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

  // POST /api/v1/bookings/:id/mock-checkout  [auth CUSTOMER] [dev only]
  async mockCheckout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (env.NODE_ENV === 'production') {
        throw new AppError('Not available in production', 403, 'FORBIDDEN');
      }
      const result = await mockConfirmPayment(req.params.id);
      res.json({ success: true, data: result });
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
