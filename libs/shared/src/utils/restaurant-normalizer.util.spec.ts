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
    it('handles string, array, nested comma strings, empty arrays, null/undefined, and unsupported types safely', () => {
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
        normalizeRestaurantTags([
          'pho, beef',
          '  noodle  ',
          '',
          null as any,
          123 as any,
          { nested: true } as any,
        ]),
      ).toEqual(['pho', 'beef', 'noodle']);
      expect(normalizeRestaurantTags([])).toEqual([]);
      expect(normalizeRestaurantTags(null)).toEqual([]);
      expect(normalizeRestaurantTags(undefined)).toEqual([]);
      expect(normalizeRestaurantTags(42)).toEqual([]);
      expect(normalizeRestaurantTags(true)).toEqual([]);
      expect(normalizeRestaurantTags({ foo: 'bar' })).toEqual([]);
      expect(formatRestaurantTagsString(['cơm chay, vegan', 'mới'])).toBe(
        'cơm chay, vegan, mới',
      );
      expect(formatRestaurantTagsString([])).toBe('');
      expect(formatRestaurantTagsString(null)).toBe('');
      expect(formatRestaurantTagsString({ foo: 'bar' })).toBe('');
    });
  });

  describe('normalizeRestaurantRating', () => {
    it('normalizes 10-point Foody scores, explicit scales, and Foody subscore low ratings', () => {
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
        isAmbiguous: false,
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
        isAmbiguous: false,
      });

      expect(
        normalizeRestaurantRating({
          diemTrungBinh: 4.2,
          ratingScale: '10_point',
        }),
      ).toEqual({
        rating: 2.1,
        rawRating: 4.2,
        ratingScale: '10_point',
        isAmbiguous: false,
      });

      expect(
        normalizeRestaurantRating({
          diemTrungBinh: 4.2,
          ratingScale: '5_point',
        }),
      ).toEqual({
        rating: 4.2,
        rawRating: 4.2,
        ratingScale: '5_point',
        isAmbiguous: false,
      });
    });

    it('preserves verified 5-point ratings, flags ambiguous [0, 5] ratings without metadata, and handles missing/null/out-of-range', () => {
      expect(
        normalizeRestaurantRating({
          diemTrungBinh: 4.4,
          reviewsCount: 15,
        }),
      ).toEqual({
        rating: 4.4,
        rawRating: 4.4,
        ratingScale: '5_point',
        isAmbiguous: false,
      });

      // Missing explicit scale, no Foody subscores, and reviewsCount missing/0 -> must NOT claim verified 5_point
      expect(normalizeRestaurantRating({ diemTrungBinh: 4.0 })).toEqual({
        rating: 4.0,
        rawRating: 4.0,
        ratingScale: 'ambiguous',
        isAmbiguous: true,
      });

      expect(normalizeRestaurantRating({ diemTrungBinh: 0 })).toEqual({
        rating: 0,
        rawRating: 0,
        ratingScale: 'ambiguous',
        isAmbiguous: true,
      });

      expect(normalizeRestaurantRating({ diemTrungBinh: null })).toEqual({
        rating: DEFAULT_NEUTRAL_RATING,
        rawRating: DEFAULT_NEUTRAL_RATING,
        ratingScale: 'default',
        isAmbiguous: false,
      });

      expect(normalizeRestaurantRating({ diemTrungBinh: -3 })).toEqual({
        rating: 0,
        rawRating: -3,
        ratingScale: 'default',
        isAmbiguous: false,
      });
      expect(normalizeRestaurantRating({ diemTrungBinh: 25 })).toEqual({
        rating: 5,
        rawRating: 25,
        ratingScale: '10_point',
        isAmbiguous: false,
      });
    });

    it('prevents double normalization and preserves ambiguous flag across re-normalization', () => {
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
      expect(second.isAmbiguous).toBe(false);

      const ambiguousFirst = normalizeRestaurantRating({ diemTrungBinh: 3.8 });
      const ambiguousSecond = normalizeRestaurantRating({
        rating: ambiguousFirst.rating,
        rawRating: ambiguousFirst.rawRating,
        ratingScale: ambiguousFirst.ratingScale,
      });
      expect(ambiguousSecond).toEqual({
        rating: 3.8,
        rawRating: 3.8,
        ratingScale: 'ambiguous',
        isAmbiguous: true,
      });
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

    it('canonicalizes 0-based, 1-based, missing, duplicate, mixed, and empty stops without silent duplicates or skips', () => {
      expect(normalizeStopOrderIndexes([])).toEqual([]);

      // Fully zero-based -> [1, 2, 3]
      const shifted = normalizeStopOrderIndexes([
        { id: 'a', order_index: 0 },
        { id: 'b', order_index: 1 },
        { id: 'c', order_index: 2 },
      ]);
      expect(shifted.map((s) => ({ id: s.id, o: s.order_index }))).toEqual([
        { id: 'a', o: 1 },
        { id: 'b', o: 2 },
        { id: 'c', o: 3 },
      ]);

      // Fully one-based (idempotent)
      const kept = normalizeStopOrderIndexes(shifted);
      expect(kept.map((s) => ({ id: s.id, o: s.order_index }))).toEqual([
        { id: 'a', o: 1 },
        { id: 'b', o: 2 },
        { id: 'c', o: 3 },
      ]);

      // Missing indexes -> explicitly indexed stop first, then missing in input order, contiguous [1..N]
      const missing = normalizeStopOrderIndexes([
        { id: 'a' },
        { id: 'b', order_index: 1 },
        { id: 'c' },
      ]);
      expect(missing.map((s) => ({ id: s.id, o: s.order_index }))).toEqual([
        { id: 'b', o: 1 },
        { id: 'a', o: 2 },
        { id: 'c', o: 3 },
      ]);

      // Duplicate & gapped indexes -> deterministic tie-break [1, 2, 3]
      const duplicated = normalizeStopOrderIndexes([
        { id: 'a', order_index: 1 },
        { id: 'b', order_index: 1 },
        { id: 'c', order_index: 3 },
      ]);
      expect(duplicated.map((s) => ({ id: s.id, o: s.order_index }))).toEqual([
        { id: 'a', o: 1 },
        { id: 'b', o: 2 },
        { id: 'c', o: 3 },
      ]);

      // Mixed 0-based and duplicate 1-based -> contiguous [1, 2, 3, 4]
      const mixed = normalizeStopOrderIndexes([
        { id: 'a', order_index: 0 },
        { id: 'b', order_index: 1 },
        { id: 'c', order_index: 1 },
        { id: 'd', order_index: 2 },
      ]);
      expect(mixed.map((s) => ({ id: s.id, o: s.order_index }))).toEqual([
        { id: 'a', o: 1 },
        { id: 'b', o: 2 },
        { id: 'c', o: 3 },
        { id: 'd', o: 4 },
      ]);
    });
  });
});
