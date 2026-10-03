/** How long called players have to confirm presence before the referee is alerted. */
export const MATCH_CALL_TIMEOUT_MS = 10 * 60 * 1000;

/** «Ждать ещё»: how far one referee press pushes the call deadline. */
export const MATCH_CALL_EXTEND_MS = 5 * 60 * 1000;

/** How often the overdue-call sweep runs (see processOverdueCalls). */
export const MATCH_CALL_SWEEP_INTERVAL_MS = 60 * 1000;
