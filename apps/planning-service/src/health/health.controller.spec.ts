import { HealthController } from './health.controller';

describe('Planning HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('should return UP status for Planning Service', () => {
    const result = controller.check();
    expect(result.status).toBe('UP');
    expect(result.service).toBe('planning-service');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
  });
});
