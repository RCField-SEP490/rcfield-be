import { Router } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import {
  chat,
  chatStream,
  getWidgetConfig,
  updateWidgetConfig,
} from '../controllers/chat.controller';
import {
  uploadDocument,
  listDocuments,
  deleteDocument,
  debugKb,
} from '../controllers/kb.controller';
import { UserRole } from '../types';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// mergeParams: true so :cafeId from parent router is accessible
const router = Router({ mergeParams: true });

// ── Public chat endpoints ──────────────────────────────────────────────────────

router.post('/chat', chat);
router.post('/chat/stream', chatStream);
router.get('/chat/config', getWidgetConfig);
router.get('/kb/debug', debugKb);

// ── Provider-only endpoints ────────────────────────────────────────────────────

router.put('/chat/config', authenticate, authorize(UserRole.PROVIDER), updateWidgetConfig);

router.get('/kb/documents', authenticate, authorize(UserRole.PROVIDER), listDocuments);

router.post(
  '/kb/documents',
  authenticate,
  authorize(UserRole.PROVIDER),
  upload.single('file'),
  uploadDocument,
);

router.delete(
  '/kb/documents/:documentId',
  authenticate,
  authorize(UserRole.PROVIDER),
  deleteDocument,
);

export { router as chatRouter };
