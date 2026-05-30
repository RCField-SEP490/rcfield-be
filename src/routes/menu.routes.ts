import { Router } from 'express';
import { menuController } from '../controllers/menu.controller';
import { authenticate, authorize, requireActiveProvider } from '../middlewares/auth.middleware';
import { UserRole } from '../types';

export const menuRouter = Router({ mergeParams: true });

menuRouter.use(authenticate, authorize(UserRole.PROVIDER), requireActiveProvider);
menuRouter.get('/', menuController.listMenuItems);
menuRouter.post('/', menuController.createMenuItem);
menuRouter.patch('/:itemId', menuController.updateMenuItem);
menuRouter.delete('/:itemId', menuController.deleteMenuItem);
