import {
  calculateHaversineDistanceKm,
  estimateTransitTimeMinutes,
} from './geo.utils';

describe('GeoUtils (Shared Library)', () => {
  it('should calculate accurate Haversine distance between Ben Thanh Market and Landmark 81', () => {
    // Ben Thanh Market: 10.7725, 106.6980
    // Landmark 81: 10.7950, 106.7219
    const distanceKm = calculateHaversineDistanceKm(
      10.7725,
      106.698,
      10.795,
      106.7219,
    );
    expect(distanceKm).toBeGreaterThan(3.0);
    expect(distanceKm).toBeLessThan(4.5);
  });

  it('should estimate transit time with minimum 3 minutes floor', () => {
    const mins01km = estimateTransitTimeMinutes(0.1, 'walking');
    expect(mins01km).toBeGreaterThanOrEqual(3);

    const mins10kmMotorbike = estimateTransitTimeMinutes(10, 'motorbike');
    expect(mins10kmMotorbike).toBe(24); // 10km / 25km/h * 60 = 24 mins
  });
});
