import {
  DEFAULT_NEUTRAL_RATING,
  formatRestaurantTagsString,
  normalizeRestaurantRating,
  normalizeRestaurantTags,
  normalizeStopOrderIndexes,
  parseRestaurantPriceVnd,
} from './restaurant-normalizer.util';

describe('restaurant-normalizer.util (M10.1)', () => {
  describe('normalizeRestaurantTags & formatRestaurantTagsString', () => {
    it('handles string tags, array tags, mixed nested strings, and null/missing tags safely', () => {
      expect(normalizeRestaurantTags('pho, vietnamese, noodle')).toEqual([
        'pho',
        'vietnamese',
        'noodle',
      ]);
      expect(normalizeRestaurantTags(['pho', 'vietnamese', 'noodle'])).toEqual([
        'pho',
        'vietnamese',
        'noodle',
      ]);
      expect(
        normalizeRestaurantTags(['pho, beef', '  noodle  ', '', null as any]),
      ).toEqual(['pho', 'beef', 'noodle']);
      expect(normalizeRestaurantTags(null)).toEqual([]);
      expect(normalizeRestaurantTags(undefined)).toEqual([]);
      expect(formatRestaurantTagsString(['cơm chay', 'vegan'])).toBe(
        'cơm chay, vegan',
      );
      expect(formatRestaurantTagsString(null)).toBe('');
    });
  });

  describe('normalizeRestaurantRating', () => {
    it('normalizes 10-point Foody scores and Foody subscore low ratings', () => {
      expect(
        normalizeRestaurantRating({
          diemTrungBinh: 8.6,
          diemChatLuong: 8.8,
          reviewsCount: 0,
        }),
      ).toEqual({
        rating: 4.3,
        rawRating: 8.6,
        ratingScale: '10_point',
      });

      expect(
        normalizeRestaurantRating({
          diemTrungBinh: 4.0,
          diemChatLuong: 4.2,
          reviewsCount: 0,
        }),
      ).toEqual({
        rating: 2.0,
        rawRating: 4.0,
        ratingScale: '10_point',
      });
    });

    it('preserves 5-point GastroWise ratings and handles missing/null/out-of-range safely', () => {
      expect(
        normalizeRestaurantRating({
          diemTrungBinh: 4.4,
          reviewsCount: 15,
        }),
      ).toEqual({
        rating: 4.4,
        rawRating: 4.4,
        ratingScale: '5_point',
      });

      expect(normalizeRestaurantRating({ diemTrungBinh: 0 })).toEqual({
        rating: 0,
        rawRating: 0,
        ratingScale: '5_point',
      });

      expect(normalizeRestaurantRating({ diemTrungBinh: null })).toEqual({
        rating: DEFAULT_NEUTRAL_RATING,
        rawRating: DEFAULT_NEUTRAL_RATING,
        ratingScale: 'default',
      });

      expect(normalizeRestaurantRating({ diemTrungBinh: -3 }).rating).toBe(0);
      expect(normalizeRestaurantRating({ diemTrungBinh: 25 }).rating).toBe(5);
    });

    it('prevents double normalization when already normalized or rawRating recorded', () => {
      const first = normalizeRestaurantRating({
        diemTrungBinh: 8.4,
        reviewsCount: 0,
      });
      expect(first.rating).toBe(4.2);

      const second = normalizeRestaurantRating({
        rating: first.rating,
        rawRating: first.rawRating,
        ratingScale: first.ratingScale,
        _ratingNormalized: true,
      });
      expect(second.rating).toBe(4.2);
      expect(second.rawRating).toBe(8.4);
    });
  });

  describe('parseRestaurantPriceVnd & normalizeStopOrderIndexes', () => {
    it('parses single prices, ranges, and invalid inputs safely', () => {
      expect(parseRestaurantPriceVnd(65000)).toBe(65000);
      expect(parseRestaurantPriceVnd('65.000đ')).toBe(65000);
      expect(parseRestaurantPriceVnd('30.000đ - 150.000đ')).toBe(90000);
      expect(parseRestaurantPriceVnd(-1000, 50000)).toBe(50000);
      expect(parseRestaurantPriceVnd(null, 50000)).toBe(50000);
    });

    it('canonicalizes 0-based order_index to [1..N] once and leaves 1-based [1..N] unchanged', () => {
      const shifted = normalizeStopOrderIndexes([
        { id: 'a', order_index: 0 },
        { id: 'b', order_index: 1 },
        { id: 'c', order_index: 2 },
      ]);
      expect(shifted.map((s) => s.order_index)).toEqual([1, 2, 3]);

      const kept = normalizeStopOrderIndexes(shifted);
      expect(kept.map((s) => s.order_index)).toEqual([1, 2, 3]);
    });
  });
});
