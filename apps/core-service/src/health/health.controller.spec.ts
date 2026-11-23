import { HealthController } from './health.controller';

describe('Core HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('should return UP status for Core Service', () => {
    const result = controller.check();
    expect(result.status).toBe('UP');
    expect(result.service).toBe('core-service');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
  });
});
