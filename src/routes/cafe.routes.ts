import { Router } from 'express';
import multer from 'multer';
import {
  authenticate,
  authorize,
  optionalAuthenticate,
  requireActiveProvider,
} from '../middlewares/auth.middleware';
import { cafeController } from '../controllers/cafe.controller';
import { cafeImageController } from '../controllers/cafe-image.controller';
import { menuController } from '../controllers/menu.controller';
import { menuRouter } from './menu.routes';
import { UserRole } from '../types';

export const cafeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

cafeRouter.get('/', optionalAuthenticate, cafeController.listCafes);
cafeRouter.get('/:cafeId/menu', optionalAuthenticate, menuController.listMenuItems);
cafeRouter.use('/:cafeId/menu', menuRouter);
cafeRouter.get('/:cafeId', optionalAuthenticate, cafeController.getCafeById);
cafeRouter.get('/:cafeId/images', cafeImageController.listImages);
cafeRouter.post(
  '/',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  cafeController.createCafe,
);
cafeRouter.patch(
  '/:cafeId',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  cafeController.updateCafe,
);
cafeRouter.patch(
  '/:cafeId/status',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.PROVIDER),
  cafeController.updateCafeStatus,
);
cafeRouter.post(
  '/:cafeId/images',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.ADMIN),
  requireActiveProvider,
  upload.array('files', 20),
  cafeImageController.createImages,
);
