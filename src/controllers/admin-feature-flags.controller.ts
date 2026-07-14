import { Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { AuthRequest } from '../types';

export const adminFeatureFlagsController = {
  // GET /api/v1/admin/feature-flags
  async list(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const rows = await AppDataSource.query(
        `SELECT feature_key, entity_type, entity_id, is_enabled, config, updated_at
         FROM feature_flags
         ORDER BY feature_key`,
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/admin/feature-flags/:key
  async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { key } = req.params;
      const { isEnabled, config } = req.body as {
        isEnabled?: boolean;
        config?: Record<string, unknown>;
      };

      const setParts: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let idx = 1;

      if (isEnabled !== undefined) {
        setParts.push(`is_enabled = $${idx++}`);
        params.push(isEnabled);
      }
      if (config !== undefined) {
        setParts.push(`config = $${idx++}`);
        params.push(JSON.stringify(config));
      }
      params.push(key);

      const result = await AppDataSource.query(
        `UPDATE feature_flags
         SET ${setParts.join(', ')}
         WHERE feature_key = $${idx}
         RETURNING feature_key, entity_type, entity_id, is_enabled, config, updated_at`,
        params,
      );

      const updated = Array.isArray(result[0]) ? result[0][0] : result[0];
      if (!updated) {
        res.status(404).json({ success: false, error: 'Flag not found' });
        return;
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
};
