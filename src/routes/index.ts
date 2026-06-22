import { Router } from 'express';
import { authRouter } from './auth.routes';
import { chatRouter } from './chat.routes';
import { systemRouter } from './system.routes';
import { fbChannelRouter } from './fb-channel.routes';
import { fbWebhookRouter } from './fb-webhook.routes';
import { providerOnboardingRouter } from './provider-onboarding.routes';
import { adminProviderRouter } from './admin-provider.routes';
import { adminPaymentRequestRouter } from './admin-payment-request.routes';
import { notificationRouter } from './notification.routes';
import { providerSubscriptionRouter } from './provider-subscription.routes';
import { staffInviteRouter } from './staff-invite.routes';
import { staffRouter } from './staff.routes';
import { adminSubscriptionPlanRouter } from './admin-subscription-plan.routes';
import { adminAmenityRouter } from './admin-amenity.routes';
import { cafeRouter } from './cafe.routes';
import { cafeImagesRouter } from './cafe-images.routes';
import { uploadRouter } from './upload.routes';
import { vehicleCatalogRouter } from './vehicle-catalog.routes';
import { adminTrackTypeRouter } from './admin-track-type.routes';
import { vnpayRouter } from './vnpay.routes';
import { bookingRouter } from './booking.routes';
import { contestRouter } from './contest.routes';
import { contestRegistrationRouter } from './contest-registration.routes';
import {
  contestHeatRouter,
  contestBracketMatchRouter,
  contestResultRouter,
  contestRoundRouter,
} from './contest-competition.routes';
import { contestLeaderboardController } from '../controllers/contest-leaderboard.controller';
import { contestRegistrationController } from '../controllers/contest-registration.controller';
import { bookingController } from '../controllers/booking.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { AppDataSource } from '../config/database';
import { SubscriptionPlan } from '../models/subscription-plan.entity';
import { AmenityCatalog } from '../models/amenity-catalog.entity';
import { TrackType } from '../models/track-type.entity';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'RCField API is running' });
});

// GET /api/v1/subscription-plans — public, trả về các gói trả phí để provider chọn khi nộp payment request
router.get('/subscription-plans', async (_req, res, next) => {
  try {
    const plans = await AppDataSource.getRepository(SubscriptionPlan).find({
      where: { isTrial: false },
      order: { pricePerMonth: 'ASC' },
    });
    res.json(
      plans.map((p) => ({
        id: p.id,
        name: p.name,
        branchLimit: p.branchLimit,
        aiQuotaPerMonth: p.aiQuotaPerMonth,
        channelLimit: p.channelLimit,
        pricePerMonth: Number(p.pricePerMonth),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get('/amenities', async (_req, res, next) => {
  try {
    const items = await AppDataSource.getRepository(AmenityCatalog).find({
      order: { sortOrder: 'ASC' },
    });
    res.json(
      items.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        icon: a.icon,
        sortOrder: a.sortOrder,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get('/track-types', async (_req, res, next) => {
  try {
    const items = await AppDataSource.getRepository(TrackType).find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
    res.json(
      items.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        description: t.description,
        sortOrder: t.sortOrder,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.use('/auth', authRouter);
router.use('/auth/staff-invite', staffInviteRouter);
router.use('/auth', providerOnboardingRouter);
router.use('/admin/providers', adminProviderRouter);
router.use('/admin/payment-requests', adminPaymentRequestRouter);
router.use('/admin/subscription-plans', adminSubscriptionPlanRouter);
router.use('/admin/amenities', adminAmenityRouter);
router.use('/admin/track-types', adminTrackTypeRouter);
router.use('/provider/notifications', notificationRouter);
router.use('/provider', providerSubscriptionRouter);
router.use('/staff', staffRouter);
router.use('/system', systemRouter);
router.use('/uploads', uploadRouter);
router.use('/cafes', cafeRouter);
router.use('/', cafeImagesRouter);
router.use('/cafes/:cafeId/vehicle-catalogs', vehicleCatalogRouter);
router.use('/cafes/:cafeId', chatRouter);
router.use('/channels/facebook', fbChannelRouter);
router.use('/webhook/facebook', fbWebhookRouter);
router.use('/payments/vnpay', vnpayRouter);
router.use('/bookings', bookingRouter);
router.use('/contests', contestRouter);
router.use('/contest-registrations', contestRegistrationRouter);
router.use('/contest-rounds', contestRoundRouter);
router.use('/contest-heats', contestHeatRouter);
router.use('/contest-results', contestResultRouter);
router.use('/contest-bracket-matches', contestBracketMatchRouter);
router.get(
  '/me/contest-reward-claims',
  authenticate,
  authorize(UserRole.CUSTOMER, UserRole.PROVIDER),
  contestLeaderboardController.myRewardClaims,
);
router.get(
  '/me/contest-registrations',
  authenticate,
  authorize(UserRole.CUSTOMER, UserRole.PROVIDER),
  contestRegistrationController.listMine,
);
router.get(
  '/provider/cafes/:cafeId/bookings',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  bookingController.listCafeBookings,
);

// router.use('/bookings', bookingsRouter);
// router.use('/vehicles', vehiclesRouter);
// router.use('/inspections', inspectionsRouter);
// router.use('/payments', paymentsRouter);
// router.use('/fnb', fnbRouter);

export { router };
