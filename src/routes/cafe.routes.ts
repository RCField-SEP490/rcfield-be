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
import { UserRole } from '../types';

export const cafeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

cafeRouter.get('/', optionalAuthenticate, cafeController.list);
cafeRouter.get('/:id', optionalAuthenticate, cafeController.detail);
cafeRouter.get('/:id/images', optionalAuthenticate, cafeImageController.listImages);
cafeRouter.post(
  '/',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  cafeController.create,
);
cafeRouter.patch(
  '/:id',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  cafeController.update,
);
cafeRouter.patch(
  '/:id/status',
  authenticate,
  authorize(UserRole.ADMIN),
  cafeController.updateStatus,
);
cafeRouter.post(
  '/:id/images',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.ADMIN),
  requireActiveProvider,
  upload.array('files', 20),
  cafeImageController.createImages,
);
