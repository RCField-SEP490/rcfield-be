import { Router } from 'express';
import { providerOnboardingController } from '../controllers/provider-onboarding.controller';

export const providerOnboardingRouter = Router();

providerOnboardingRouter.post('/register-provider', providerOnboardingController.registerProvider);
