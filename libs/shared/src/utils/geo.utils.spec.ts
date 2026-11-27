import {
  calculateHaversineDistanceKm,
  estimateTransitTimeMinutes,
  extractValidGeoPoint,
  isValidGeoJsonPoint,
  parseValidCoordinatePair,
  toGeoJsonPoint,
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

  it('validates coordinate ranges and rejects missing, null, out-of-range, and [0,0]', () => {
    expect(parseValidCoordinatePair(10.7769, 106.7009)).toEqual({
      lat: 10.7769,
      lon: 106.7009,
    });
    expect(parseValidCoordinatePair('10,7769', '106,7009')).toEqual({
      lat: 10.7769,
      lon: 106.7009,
    });
    expect(parseValidCoordinatePair(undefined, undefined)).toBeNull();
    expect(parseValidCoordinatePair(null, null)).toBeNull();
    expect(parseValidCoordinatePair(0, 0)).toBeNull();
    expect(parseValidCoordinatePair(90.1, 106.7)).toBeNull();
    expect(parseValidCoordinatePair(-90.1, 106.7)).toBeNull();
    expect(parseValidCoordinatePair(10.7, 180.1)).toBeNull();
    expect(parseValidCoordinatePair(10.7, -180.1)).toBeNull();

    expect(toGeoJsonPoint(10.78, 106.69)).toEqual({
      type: 'Point',
      coordinates: [106.69, 10.78],
    });
    expect(toGeoJsonPoint(0, 0)).toBeNull();
    expect(
      isValidGeoJsonPoint({ type: 'Point', coordinates: [106.69, 10.78] }),
    ).toBe(true);
    expect(isValidGeoJsonPoint({ type: 'Point', coordinates: [0, 0] })).toBe(
      false,
    );
    expect(extractValidGeoPoint({ location: null })).toBeNull();
  });
});
