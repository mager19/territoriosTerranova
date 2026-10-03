/**
 * Graceful shutdown for main.ts. Idempotent: `tsx watch` and process
 * managers can deliver SIGTERM/SIGINT more than once (or both), and
 * pg's Pool throws "Called end on pool more than once" on a second end().
 * Every call returns the same promise, so the work runs exactly once.
 */

export interface ClosableApp {
  close(): Promise<unknown>;
  readonly log: { info(details: object, message: string): void };
}

export interface EndablePool {
  end(): Promise<unknown>;
}

export function createShutdown(app: ClosableApp, pool: EndablePool): (signal: string) => Promise<void> {
  let pending: Promise<void> | null = null;
  return (signal) => {
    pending ??= (async () => {
      app.log.info({ signal }, 'shutting down');
      await app.close();
      await pool.end();
    })();
    return pending;
  };
}
