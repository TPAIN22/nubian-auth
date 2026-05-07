/**
 * Centralised queue names. Pattern: `nubian:notif:<channel>`.
 *
 * Use the constants — never hardcode the strings — so renames stay safe and
 * grep-friendly. The optional REDIS_PREFIX env adds a further namespace at
 * connection time (e.g. for sharing one Redis across staging/prod).
 */
export const QUEUE_NAMES = Object.freeze({
  PUSH: 'nubian_notif_push',
  EMAIL: 'nubian_notif_email',
  SMS: 'nubian_notif_sms',
  FANOUT: 'nubian_notif_fanout',
  MAINTENANCE: 'nubian_notif_maintenance',
});

/**
 * Job names within each queue. The Worker dispatches on these.
 */
export const JOB_NAMES = Object.freeze({
  // PUSH queue
  PUSH_SEND: 'push.send',

  // EMAIL queue
  EMAIL_WELCOME: 'email.welcome',
  EMAIL_ORDER: 'email.order',
  EMAIL_MERCHANT_SUSPENSION: 'email.merchant.suspension',
  EMAIL_MERCHANT_UNSUSPENSION: 'email.merchant.unsuspension',
  EMAIL_GENERIC: 'email.generic',

  // SMS queue (placeholder)
  SMS_SEND: 'sms.send',

  // FANOUT queue
  FANOUT_BROADCAST: 'fanout.broadcast',
  FANOUT_MARKETING: 'fanout.marketing',
  FANOUT_SEGMENT: 'fanout.segment',

  // MAINTENANCE queue
  MAINT_DLQ_SWEEP: 'maintenance.dlq-sweep',
  MAINT_TOKEN_CLEANUP: 'maintenance.token-cleanup',
  MAINT_EXPIRED_NOTIFS: 'maintenance.expired-notifs',
});

export const ALL_QUEUE_NAMES = Object.values(QUEUE_NAMES);
