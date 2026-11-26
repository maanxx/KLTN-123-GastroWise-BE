import { Connection } from 'mongoose';

export interface DbReadinessResult {
  ready: boolean;
  readyState: number;
  readyStateLabel: string;
  dbPingOk: boolean;
  latencyMs?: number;
  error?: string;
}

const READY_STATE_LABELS: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

/**
 * Evaluates MongoDB readiness via Mongoose connection state (1 === connected)
 * and a bounded admin ping command. Never includes credentials or raw URIs.
 */
export async function checkMongoReadiness(
  connection: Pick<Connection, 'readyState' | 'db'> | undefined | null,
  pingTimeoutMs = 2000,
): Promise<DbReadinessResult> {
  const readyState: number =
    typeof connection?.readyState === 'number'
      ? Number(connection.readyState)
      : 0;
  const readyStateLabel = READY_STATE_LABELS[readyState] || 'unknown';

  if (readyState !== 1) {
    return {
      ready: false,
      readyState,
      readyStateLabel,
      dbPingOk: false,
      error: `Database connection not ready (state=${readyStateLabel})`,
    };
  }

  const adminDb = connection?.db?.admin?.();
  if (!adminDb) {
    return {
      ready: false,
      readyState,
      readyStateLabel,
      dbPingOk: false,
      error: 'Database handle unavailable',
    };
  }

  const start = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      adminDb.command({ ping: 1 }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Mongo ping timed out after ${pingTimeoutMs}ms`)),
          pingTimeoutMs,
        );
      }),
    ]);

    return {
      ready: true,
      readyState,
      readyStateLabel,
      dbPingOk: true,
      latencyMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      ready: false,
      readyState,
      readyStateLabel,
      dbPingOk: false,
      latencyMs: Date.now() - start,
      error:
        err instanceof Error ? 'Database ping failed' : 'Unknown ping failure',
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
