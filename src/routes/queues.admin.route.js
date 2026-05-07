import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import { isAdmin } from '../middleware/auth.middleware.js';
import {
  getQueueStats,
  listFailedJobs,
  retryFailedJobs,
  drainFailedJobs,
} from '../controllers/queues.admin.controller.js';

const router = Router();

// All routes require admin
router.use(requireAuth(), isAdmin);

// GET  /api/admin/queues/stats               — per-queue job counts
router.get('/stats', getQueueStats);

// GET  /api/admin/queues/:queue/failed       — list failed jobs (newest first)
router.get('/:queue/failed', listFailedJobs);

// POST /api/admin/queues/:queue/retry        — bulk retry (body: { ids?: string[] })
router.post('/:queue/retry', retryFailedJobs);

// POST /api/admin/queues/:queue/drain        — drop failed older than N days
//                                              (body: { olderThanDays?: number })
router.post('/:queue/drain', drainFailedJobs);

export default router;
