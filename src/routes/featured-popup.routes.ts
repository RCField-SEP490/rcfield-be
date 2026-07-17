import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { featuredPopupController } from '../controllers/featured-popup.controller';

export const featuredPopupRouter = Router();

featuredPopupRouter.get('/explore/featured-popup', featuredPopupController.getActive);

featuredPopupRouter.use('/admin/featured-popups', authenticate, authorize(UserRole.ADMIN));
featuredPopupRouter.get('/admin/featured-popups', featuredPopupController.list);
featuredPopupRouter.post('/admin/featured-popups', featuredPopupController.create);
featuredPopupRouter.patch('/admin/featured-popups/:popupId', featuredPopupController.update);
