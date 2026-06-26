import type { Response, NextFunction } from 'express';
import { CreateCustomerVehicleSchema, UpdateCustomerVehicleSchema } from '../validate';
import { AppError, AuthRequest } from '../types';
import * as customerVehicleService from '../services/customer-vehicle.service';

export const customerVehicleController = {
  // POST /api/v1/me/customer-vehicles
  async createVehicle(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = CreateCustomerVehicleSchema.parse(req.body);
      const data = await customerVehicleService.createCustomerVehicle(req.user.userId, body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/me/customer-vehicles
  async listVehicles(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const data = await customerVehicleService.listCustomerVehicles(req.user.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/me/customer-vehicles/:id
  async getVehicle(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const data = await customerVehicleService.getCustomerVehicleOrThrow(
        req.params.id,
        req.user.userId,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/me/customer-vehicles/:id
  async updateVehicle(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = UpdateCustomerVehicleSchema.parse(req.body);
      const data = await customerVehicleService.updateCustomerVehicle(
        req.params.id,
        req.user.userId,
        body,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/v1/me/customer-vehicles/:id
  async deleteVehicle(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      await customerVehicleService.deleteCustomerVehicle(req.params.id, req.user.userId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
