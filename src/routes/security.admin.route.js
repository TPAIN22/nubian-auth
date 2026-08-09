import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import { isAdmin } from '../middleware/auth.middleware.js';
import {
  getSecurityStatus,
  getBans,
  createBan,
  deleteBan,
} from '../controllers/security.admin.controller.js';

const router = Router();

// All routes require admin
router.use(requireAuth(), isAdmin);

// GET    /api/admin/security/status      — store backend, circuit state, ban counts
router.get('/status', getSecurityStatus);

// GET    /api/admin/security/bans        — active bans with reason + expiry
router.get('/bans', getBans);

// POST   /api/admin/security/bans        — { ip, durationMs?, reason? }
router.post('/bans', createBan);

// DELETE /api/admin/security/bans/:ip    — lift a ban (manual or automatic)
router.delete('/bans/:ip', deleteBan);

export default router;
