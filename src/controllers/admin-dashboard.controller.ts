import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as adminDashboardService from '../services/admin-dashboard.service';

export const adminDashboardController = {
  // GET /api/v1/admin/dashboard/summary
  async getSummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const summary = await adminDashboardService.getAdminDashboardSummary();
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
};
