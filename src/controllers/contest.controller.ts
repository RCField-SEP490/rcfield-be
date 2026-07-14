import type { NextFunction, Request, Response } from 'express';
import { AuthRequest, AppError, ContestStatus, UserRole } from '../types';
import {
  ContestCatalogTemplateQuerySchema,
  ContestCorrectResultsSchema,
  ContestCheckInSchema,
  ContestGenerateMatchesSchema,
  ContestListQuerySchema,
  ContestMatchesQuerySchema,
  ContestMarkFeePaidSchema,
  ContestMatchParticipantsUpdateSchema,
  ContestRegistrationsQuerySchema,
  ContestRegistrationActionSchema,
  ContestSubmitResultsSchema,
  CreateContestRegistrationSchema,
  CreateContestSchema,
  MyContestRegistrationsQuerySchema,
  UpdateContestSchema,
} from '../validate';
import * as contestService from '../services/contest.service';
import * as contestRuntimeService from '../services/contest-runtime.service';
import * as racingNetworkService from '../services/racing-network.service';

function requireViewer(req: AuthRequest) {
  if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  return { userId: req.user.userId, role: req.user.role };
}

export const contestController = {
  async listContestTypes(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await contestService.listContestTypes();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listContestFormats(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await contestService.listContestFormats();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listContestTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      const query = ContestCatalogTemplateQuerySchema.parse(req.query);
      const data = await contestService.listContestTemplates(query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listContests(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const query = ContestListQuerySchema.parse(req.query);
      const viewer = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
      const result = await contestService.listContests({ ...query, viewer });
      res.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page: query.page, limit: query.limit },
      });
    } catch (error) {
      next(error);
    }
  },

  async getContestById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
      const data = await contestService.getContestDetail(req.params.contestId, viewer);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createContest(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      if (viewer.role !== UserRole.PROVIDER) throw new AppError('Forbidden', 403, 'FORBIDDEN');
      const body = CreateContestSchema.parse(req.body);
      const data = await contestService.createContest(viewer, body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateContest(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = UpdateContestSchema.parse(req.body);
      const data = await contestService.updateContest(req.params.contestId, viewer, body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async openContest(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const data = await contestService.changeContestStatus(
        req.params.contestId,
        viewer,
        ContestStatus.OPEN,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async closeContest(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const data = await contestService.changeContestStatus(
        req.params.contestId,
        viewer,
        ContestStatus.CLOSED,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async cancelContest(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const data = await contestService.changeContestStatus(
        req.params.contestId,
        viewer,
        ContestStatus.CANCELLED,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listCafeContests(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const query = ContestListQuerySchema.parse({ ...req.query, cafe_id: req.params.cafeId });
      const viewer = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
      const result = await contestService.listContests({ ...query, viewer });
      res.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page: query.page, limit: query.limit },
      });
    } catch (error) {
      next(error);
    }
  },

  async createRegistration(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = CreateContestRegistrationSchema.parse(req.body);
      const data = await contestService.createContestRegistration(
        req.params.contestId,
        viewer,
        body,
      );
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listMyRegistrations(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const query = MyContestRegistrationsQuerySchema.parse(req.query);
      const data = await contestService.listMyContestRegistrations(viewer, query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listContestRegistrations(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const query = ContestRegistrationsQuerySchema.parse(req.query);
      const data = await contestService.listContestRegistrations(
        req.params.contestId,
        viewer,
        query,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async markEntryFeePaid(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestMarkFeePaidSchema.parse(req.body);
      const data = await contestService.markEntryFeePaid(
        req.params.registrationId,
        viewer,
        body.note,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async waiveEntryFee(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestMarkFeePaidSchema.parse(req.body);
      const data = await contestService.waiveEntryFee(req.params.registrationId, viewer, body.note);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async approveRegistration(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestRegistrationActionSchema.parse(req.body);
      const data = await contestService.approveRegistration(
        req.params.registrationId,
        viewer,
        body.reason,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async rejectRegistration(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestRegistrationActionSchema.parse(req.body);
      const data = await contestService.rejectRegistration(
        req.params.registrationId,
        viewer,
        body.reason,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async cancelRegistration(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestRegistrationActionSchema.parse(req.body);
      const data = await contestService.cancelRegistration(
        req.params.registrationId,
        viewer,
        body.reason,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async lookupRegistration(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const code = String(req.query.check_in_code ?? '').trim();
      if (!code) throw new AppError('Thiếu check_in_code', 400, 'CHECK_IN_CODE_REQUIRED');
      const data = await contestService.lookupRegistrationByCode(
        req.params.contestId,
        code,
        viewer,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async checkInRegistration(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestCheckInSchema.parse(req.body);
      const data = await contestService.checkInRegistration(
        req.params.registrationId,
        body.checked_in_cafe_id,
        viewer,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listMatches(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
      const query = ContestMatchesQuerySchema.parse(req.query);
      const data = await contestRuntimeService.listContestMatches(
        req.params.contestId,
        viewer,
        query,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async generateMatches(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestGenerateMatchesSchema.parse(req.body);
      const data = await contestRuntimeService.generateContestMatches(
        req.params.contestId,
        viewer,
        body,
      );
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateMatchParticipants(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestMatchParticipantsUpdateSchema.parse(req.body);
      const data = await contestRuntimeService.updateMatchParticipants(
        req.params.matchId,
        viewer,
        body,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async submitMatchResults(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestSubmitResultsSchema.parse(req.body);
      const data = await contestRuntimeService.submitMatchResults(req.params.matchId, viewer, body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async correctMatchResults(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const body = ContestCorrectResultsSchema.parse(req.body);
      const data = await contestRuntimeService.correctMatchResults(
        req.params.matchId,
        viewer,
        body,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async advanceMatch(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const data = await contestRuntimeService.advanceMatch(req.params.matchId, viewer);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async publishLeaderboard(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const data = await contestRuntimeService.publishContestLeaderboard(
        req.params.contestId,
        viewer,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listAuditLogs(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const data = await contestRuntimeService.listContestAuditLogs(req.params.contestId, viewer);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getMetrics(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const data = await contestRuntimeService.getContestMetrics(req.params.contestId, viewer);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/v1/contests/:contestId/sync-race-records  [auth]
  async syncRaceRecords(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const viewer = requireViewer(req);
      const data = await racingNetworkService.syncContestRaceRecords(req.params.contestId, viewer);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
