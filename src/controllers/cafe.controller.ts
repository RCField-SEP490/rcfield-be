import type { Response, NextFunction } from 'express';
import {
  CafeListQuerySchema,
  CreateCafeSchema,
  UpdateCafeSchema,
  UpdateCafeStatusSchema,
  UpsertWidgetConfigSchema,
  CheckAvailabilitySchema,
} from '../validate';
import { AppError, AuthRequest, BookingMode, CafeStatus, UserRole, VehicleStatus } from '../types';
import * as cafeService from '../services/cafe.service';
import { getWidgetConfigForCafe, upsertWidgetConfig } from '../services/chat.service';
import { AppDataSource } from '../config/database';
import { redis } from '../config/redis';
import { Cafe } from '../models/cafe.entity';
import { Vehicle } from '../models/vehicle.entity';
import { VehicleCatalog } from '../models/vehicle-catalog.entity';

function viewerFromRequest(req: AuthRequest) {
  return req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
}

export const cafeController = {
  // POST /api/v1/cafes  [auth]
  async createCafe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = CreateCafeSchema.parse(req.body);
      const cafe = await cafeService.createCafe(req.user.userId, body);
      res.status(201).json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes
  async listCafes(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit, scope, slug, district, city, track_type, status } =
        CafeListQuerySchema.parse(req.query);
      const canFilterStatus =
        req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.PROVIDER;
      const visibleStatus = canFilterStatus ? (status as CafeStatus | undefined) : undefined;

      const result = await cafeService.listCafes({
        page,
        limit,
        scope,
        slug,
        district,
        city,
        track_type,
        status: visibleStatus,
        viewer: viewerFromRequest(req),
      });
      res.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page, limit },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId
  async getCafeById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const cafe = await cafeService.getCafeDetail(req.params.cafeId, viewerFromRequest(req));
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/cafes/:cafeId  [auth]
  async updateCafe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== UserRole.PROVIDER) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }
      const body = UpdateCafeSchema.parse(req.body);
      const cafe = await cafeService.updateCafe(req.params.cafeId, req.user.userId, body);
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/cafes/:cafeId/status  [auth]
  async updateCafeStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const { status } = UpdateCafeStatusSchema.parse(req.body);
      const cafe = await cafeService.updateCafeStatus(req.params.cafeId, status, {
        userId: req.user.userId,
        role: req.user.role,
      });
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId/widget-config  [auth]
  async getWidgetConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const cafe = await cafeService.getManagedCafeOrThrow(req.params.cafeId, {
        userId: req.user.userId,
        role: req.user.role,
      });
      const config = await getWidgetConfigForCafe(req.params.cafeId);
      res.json({
        success: true,
        data: {
          cafeId: cafe.id,
          cafeSlug: cafe.slug,
          greetingMessage: config?.greetingMessage ?? 'Xin chào! Tôi có thể giúp gì cho bạn?',
          welcomeMessage: config?.welcomeMessage ?? 'Xin chào! Tôi có thể giúp gì cho bạn?',
          position: config?.position ?? 'BOTTOM_RIGHT',
          primaryColor: config?.primaryColor ?? '#EA580C',
          avatarUrl: config?.avatarUrl ?? null,
          quickReplies: config?.quickReplies ?? [],
          systemPrompt: config?.systemPrompt ?? null,
          isEnabled: config?.isEnabled ?? false,
          fullPageEnabled: config?.fullPageEnabled ?? false,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/v1/cafes/:cafeId/widget-config  [auth]
  async updateWidgetConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      await cafeService.getManagedCafeOrThrow(req.params.cafeId, {
        userId: req.user.userId,
        role: req.user.role,
      });
      const body = UpsertWidgetConfigSchema.parse(req.body);
      const updated = await upsertWidgetConfig(req.params.cafeId, {
        ...(body.greeting_message !== undefined && { greetingMessage: body.greeting_message }),
        ...(body.welcome_message !== undefined && { welcomeMessage: body.welcome_message }),
        ...(body.position !== undefined && { position: body.position }),
        ...(body.primary_color !== undefined && { primaryColor: body.primary_color }),
        ...(body.avatar_url !== undefined && { avatarUrl: body.avatar_url }),
        ...(body.quick_replies !== undefined && { quickReplies: body.quick_replies }),
        ...(body.system_prompt !== undefined && { systemPrompt: body.system_prompt }),
        ...(body.is_enabled !== undefined && { isEnabled: body.is_enabled }),
        ...(body.full_page_enabled !== undefined && { fullPageEnabled: body.full_page_enabled }),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId/availability
  async getAvailability(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const cafeId = req.params.cafeId;
      const query = CheckAvailabilitySchema.parse(req.query);
      const slotStart = new Date(query.slot_start);

      const cafeRepo = AppDataSource.getRepository(Cafe);
      const cafe = await cafeRepo.findOne({ where: { id: cafeId } });
      if (!cafe) throw new AppError('Cafe not found', 404, 'CAFE_NOT_FOUND');
      if (cafe.status !== CafeStatus.ACTIVE) {
        throw new AppError('Cafe is not accepting bookings', 400, 'CAFE_NOT_ACTIVE');
      }

      if (query.play_mode === BookingMode.BYOC) {
        const counterKey = `slot:byoc:${cafeId}:${slotStart.getTime()}`;
        const current = Number((await redis.get(counterKey)) ?? 0);
        const remaining = Math.max(0, cafe.byocCapacity - current);
        res.json({
          success: true,
          data: {
            play_mode: 'BYOC',
            available: remaining > 0,
            byoc_remaining: remaining,
            vehicles: [],
          },
        });
        return;
      }

      // RENTAL: return all AVAILABLE vehicles not currently Redis-locked for this slot
      const vehicleRepo = AppDataSource.getRepository(Vehicle);
      const catalogRepo = AppDataSource.getRepository(VehicleCatalog);

      const vehicles = await vehicleRepo.find({
        where: { cafeId, status: VehicleStatus.AVAILABLE },
      });

      const slotEpoch = slotStart.getTime();
      const available = await Promise.all(
        vehicles.map(async (v) => {
          const lockKey = `slot:lock:vehicle:${v.id}:${slotEpoch}`;
          const locked = await redis.get(lockKey);
          if (locked) return null;
          const catalog = await catalogRepo.findOne({ where: { id: v.catalogId } });
          return catalog
            ? {
                vehicle_id: v.id,
                vehicle_identifier: v.identifier,
                catalog_name: catalog.name,
                tier: catalog.tier,
                rental_fee_per_hour: Number(catalog.hourlyRate),
                security_deposit: Number(catalog.securityDeposit),
              }
            : null;
        }),
      );

      const filteredVehicles = available.filter(Boolean);
      res.json({
        success: true,
        data: {
          play_mode: 'RENTAL',
          available: filteredVehicles.length > 0,
          vehicles: filteredVehicles,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
