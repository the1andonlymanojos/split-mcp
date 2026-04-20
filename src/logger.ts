/**
 * Tiny step-numbered logger.
 *
 * Every call prints a monotonically increasing `#N` counter so you can follow
 * the order of events in the OAuth flow even when things happen concurrently.
 *
 *   [2026-01-01T12:00:00.000Z] #1 AUTHORIZE start { clientId: "demo", ... }
 *   [2026-01-01T12:00:01.234Z] #2 AUTHORIZE redirect -> Splitwise { ourState: "..." }
 */

let stepCounter = 0;

export function log(step: string, data?: unknown): void {
  stepCounter += 1;
  const ts = new Date().toISOString();
  if (data === undefined) {
    console.log(`[${ts}] #${stepCounter} ${step}`);
  } else {
    console.log(`[${ts}] #${stepCounter} ${step}`, data);
  }
}
