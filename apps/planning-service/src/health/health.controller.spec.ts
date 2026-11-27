import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('Planning HealthController', () => {
  it('should return UP status for Planning Service liveness', () => {
    const controller = new HealthController();
    const result = controller.check();
    expect(result.status).toBe('UP');
    expect(result.service).toBe('planning-service');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
  });

  it('should return READY on /health/ready when Mongo connection readyState === 1 and ping succeeds', async () => {
    const controller = new HealthController({
      readyState: 1,
      db: {
        admin: () => ({
          command: jest.fn().mockResolvedValue({ ok: 1 }),
        }),
      },
    } as any);

    const res = await controller.ready();
    expect(res.status).toBe('READY');
    expect(res.service).toBe('planning-service');
    expect(res.database.readyState).toBe(1);
    expect(res.database.dbPingOk).toBe(true);
  });

  it('should throw ServiceUnavailableException (503) on /health/ready when DB is disconnected', async () => {
    const controller = new HealthController({
      readyState: 0,
      db: undefined,
    } as any);

    await expect(controller.ready()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
