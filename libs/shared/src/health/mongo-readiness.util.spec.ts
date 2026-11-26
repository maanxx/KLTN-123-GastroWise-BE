import { Connection } from 'mongoose';
import { checkMongoReadiness } from './mongo-readiness.util';

type MockConn = { readyState: number; db?: Connection['db'] };

describe('mongo-readiness.util', () => {
  it('returns ready=true when readyState is 1 and admin ping succeeds', async () => {
    const conn: MockConn = {
      readyState: 1,
      db: {
        admin: () => ({
          command: jest.fn().mockResolvedValue({ ok: 1 }),
        }),
      } as unknown as Connection['db'],
    };
    const res = await checkMongoReadiness(conn);

    expect(res.ready).toBe(true);
    expect(res.readyState).toBe(1);
    expect(res.readyStateLabel).toBe('connected');
    expect(res.dbPingOk).toBe(true);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ready=false immediately for disconnected/connecting states', async () => {
    for (const state of [0, 2, 3]) {
      const res = await checkMongoReadiness({
        readyState: state,
        db: undefined,
      });
      expect(res.ready).toBe(false);
      expect(res.readyState).toBe(state);
      expect(res.dbPingOk).toBe(false);
    }
  });

  it('returns ready=false cleanly when ping throws or times out', async () => {
    const failed = await checkMongoReadiness({
      readyState: 1,
      db: {
        admin: () => ({
          command: jest.fn().mockRejectedValue(new Error('Topology closed')),
        }),
      } as unknown as Connection['db'],
    });
    expect(failed.ready).toBe(false);
    expect(failed.dbPingOk).toBe(false);

    const stalled = await checkMongoReadiness(
      {
        readyState: 1,
        db: {
          admin: () => ({
            command: () => new Promise(() => undefined),
          }),
        } as unknown as Connection['db'],
      },
      25,
    );
    expect(stalled.ready).toBe(false);
    expect(stalled.dbPingOk).toBe(false);
  });
});
