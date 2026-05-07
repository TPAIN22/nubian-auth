/**
 * Versioned job payload contracts. Workers assert `v === JOB_PAYLOAD_VERSION`
 * and DLQ unknown versions instead of risking silent data corruption when API
 * and worker deploys drift apart.
 *
 * Bump JOB_PAYLOAD_VERSION whenever a breaking change is made to any payload.
 * Add a non-breaking field freely.
 */
export const JOB_PAYLOAD_VERSION = 1;

/**
 * Wrap a payload with the version header. Producers use this so every enqueue
 * goes through one place.
 */
export const wrap = (payload) => ({ v: JOB_PAYLOAD_VERSION, ...payload });

/**
 * Assert at the worker boundary. Throws an UnrecoverableError-equivalent error
 * (a plain Error here — the worker maps it to BullMQ's UnrecoverableError so
 * BullMQ doesn't waste retry attempts on a structural mismatch).
 */
export const assertVersion = (job) => {
  const v = job?.data?.v;
  if (v !== JOB_PAYLOAD_VERSION) {
    const err = new Error(
      `Job payload version mismatch: expected ${JOB_PAYLOAD_VERSION}, got ${v} (job ${job?.id})`
    );
    err.unrecoverable = true;
    throw err;
  }
};

/**
 * Reference shapes — for documentation and editor autocomplete only. Not
 * runtime-validated; producers are responsible for shape correctness.
 *
 * PUSH_SEND payload:
 *   {
 *     v: 1,
 *     notificationId: string,   // Mongo _id of the Notification document
 *     bypassQuietHours?: boolean // for test notifications
 *   }
 *
 * EMAIL_* payload:
 *   {
 *     v: 1,
 *     to: string,
 *     // Plus template-specific fields (e.g. userName, orderNumber, ...)
 *   }
 *
 * FANOUT_BROADCAST payload:
 *   {
 *     v: 1,
 *     type: string,              // notification type enum
 *     title: string,
 *     body: string,
 *     deepLink?: string,
 *     metadata?: object,
 *     target: 'users' | 'merchants' | 'all',
 *     chunkSize?: number         // default 1000 recipients per child job
 *   }
 *
 * FANOUT_MARKETING payload:
 *   { ...FANOUT_BROADCAST, targetRecipients: null | string[] | { segment: object } }
 *
 * MAINT_*: empty payload — these run on a repeatable schedule.
 */
