import { Router } from 'express';
import { contestController } from '../controllers/contest.controller';
import {
  authenticate,
  authorize,
  optionalAuthenticate,
  requireActiveProvider,
} from '../middlewares/auth.middleware';
import { UserRole } from '../types';

export const contestRouter = Router();

contestRouter.get('/contest-catalog/types', contestController.listContestTypes);
contestRouter.get('/contest-catalog/formats', contestController.listContestFormats);
contestRouter.get('/contest-catalog/templates', contestController.listContestTemplates);

contestRouter.get('/contests', optionalAuthenticate, contestController.listContests);
contestRouter.get(
  '/cafes/:cafeId/contests',
  optionalAuthenticate,
  contestController.listCafeContests,
);
contestRouter.get('/contests/:contestId', optionalAuthenticate, contestController.getContestById);
contestRouter.get(
  '/contests/:contestId/matches',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.listMatches,
);

contestRouter.post(
  '/contests',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.createContest,
);
contestRouter.patch(
  '/contests/:contestId',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.updateContest,
);
contestRouter.post(
  '/contests/:contestId/open',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.openContest,
);
contestRouter.post(
  '/contests/:contestId/close',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.closeContest,
);
contestRouter.post(
  '/contests/:contestId/cancel',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.cancelContest,
);
contestRouter.post(
  '/contests/:contestId/matches/generate',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.generateMatches,
);
contestRouter.post(
  '/contests/:contestId/leaderboard/publish',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.publishLeaderboard,
);
contestRouter.get(
  '/contests/:contestId/audit-logs',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.listAuditLogs,
);
contestRouter.get(
  '/contests/:contestId/metrics',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.getMetrics,
);

contestRouter.post(
  '/contests/:contestId/register',
  authenticate,
  authorize(UserRole.CUSTOMER),
  contestController.createRegistration,
);
contestRouter.get(
  '/me/contest-registrations',
  authenticate,
  authorize(UserRole.CUSTOMER),
  contestController.listMyRegistrations,
);
contestRouter.get(
  '/contests/:contestId/registrations',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.listContestRegistrations,
);
contestRouter.get(
  '/contests/:contestId/registrations/lookup',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestController.lookupRegistration,
);
contestRouter.post(
  '/contest-registrations/:registrationId/mark-entry-fee-paid',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.markEntryFeePaid,
);
contestRouter.post(
  '/contest-registrations/:registrationId/waive-entry-fee',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.waiveEntryFee,
);
contestRouter.post(
  '/contest-registrations/:registrationId/approve',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.approveRegistration,
);
contestRouter.post(
  '/contest-registrations/:registrationId/reject',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.rejectRegistration,
);
contestRouter.post(
  '/contest-registrations/:registrationId/cancel',
  authenticate,
  authorize(UserRole.CUSTOMER, UserRole.PROVIDER),
  contestController.cancelRegistration,
);
contestRouter.post(
  '/contest-registrations/:registrationId/check-in',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestController.checkInRegistration,
);
contestRouter.patch(
  '/contest-matches/:matchId/participants',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.updateMatchParticipants,
);
contestRouter.post(
  '/contest-matches/:matchId/results',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.submitMatchResults,
);
contestRouter.post(
  '/contest-matches/:matchId/results/correct',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.correctMatchResults,
);
contestRouter.post(
  '/contest-matches/:matchId/advance',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.advanceMatch,
);
