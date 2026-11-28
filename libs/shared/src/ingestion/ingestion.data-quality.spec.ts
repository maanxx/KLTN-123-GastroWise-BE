import {
  evaluateRestaurantDataQuality,
  EXTERNAL_SOURCE_FOODY,
  IngestionValidationError,
  INGESTION_BATCHES_COLLECTION,
  MAX_DATA_QUALITY_RECORDS,
  MAX_RAW_CONTENT_BYTES,
  MAX_REJECTED_SAMPLE_RECORDS,
  RAW_STAGING_COLLECTION,
  RESTAURANTS_COLLECTION,
  runRestaurantIngestionPipeline,
  sanitizeRawPreview,
} from './index';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

describe('M10.3 Restaurant Data Quality & Ingestion Readiness', () => {
  it('normalizes valid ShopeeFood records deterministically while preserving raw source fields', () => {
    const res = evaluateRestaurantDataQuality({
      records: [
        {
          RestaurantID: 1000070216,
          Name: '  Phở   Thìn   Lò Đúc  ',
          Address: '  13  Lò Đúc, Hai Bà Trưng, Hà Nội ',
          CityID: 218,
          Latitude: 21.0112,
          Longtitude: 105.8551,
          AvgRating: 8.6,
          TotalReview: 245,
          PriceMin: 55000,
          PriceMax: 85000,
          Cuisines: [{ Name: 'Phở' }, { Name: 'Món Bắc' }, { Name: 'phở' }],
          Phone: '+84 912-345-678',
          MicrositeUrl: '/ha-noi/pho-thin-lo-duc',
          ResUrlRewrite: 'pho-thin-lo-duc',
          PictureModel: {
            ImageUrl: 'https://images.foody.vn/res/g1/pho-thin.jpg',
          },
          IsActive: true,
        },
      ],
    });

    expect(res.report.overallQualityStatus).toBe('PASSED');
    expect(res.report.validRecords).toBe(1);
    expect(res.report.rejectedRecords).toBe(0);
    expect(res.report.warningRecords).toBe(0);
    expect(res.report.infoRecords).toBe(1);

    const cand = res.validatedCandidates[0];
    expect(cand.externalSource).toBe(EXTERNAL_SOURCE_FOODY);
    expect(cand.externalSourceId).toBe('1000070216');
    expect(cand.tenQuan).toBe('Phở Thìn Lò Đúc');
    expect(cand.diaChi).toBe('13 Lò Đúc, Hai Bà Trưng, Hà Nội');
    expect(cand.cityId).toBe('hanoi');
    expect(cand.contactPhone).toBe('0912345678');
    expect(cand.diemTrungBinh).toBe(4.3);
    expect(cand.rawRating).toBe(8.6);
    expect(cand.ratingScale).toBe('10_point');
    expect(cand.foodyReviewsCount).toBe(245);
    expect(cand.giaCa).toBe('55.000đ - 85.000đ');
    expect(cand.tags).toBe('Phở, Món Bắc');
    expect(cand.urlGoc).toBe('https://www.foody.vn/ha-noi/pho-thin-lo-duc');
    expect(cand.images).toEqual([
      'https://images.foody.vn/res/g1/pho-thin.jpg',
    ]);
    expect(cand.rawPreserved).toMatchObject({
      name: 'Phở   Thìn   Lò Đúc',
      address: '13  Lò Đúc, Hai Bà Trưng, Hà Nội',
      phone: '+84 912-345-678',
      rating: 8.6,
      reviewCount: 245,
    });
  });

  it('rejects records with missing required fields, invalid ratings, invalid review counts, malformed URLs, and unsupported sources', () => {
    const res = evaluateRestaurantDataQuality({
      records: [
        {
          // Missing RestaurantID and Name
          Address: '123 Lê Lợi, Q1',
        },
        {
          RestaurantID: 'bad-rating-1',
          Name: 'Quán Rating Lỗi',
          AvgRating: 12.5,
          TotalReview: -5,
          MicrositeUrl: 'javascript:alert(1)',
        },
        {
          RestaurantID: 'bad-rating-2',
          Name: 'Quán Rating Chuỗi',
          AvgRating: 'not-a-number',
        },
        {
          RestaurantID: 'bad-source-1',
          Name: 'Quán Nguồn Lạ',
          externalSource: 'unknown_crawler_xyz',
        },
      ],
    });

    expect(res.report.overallQualityStatus).toBe('FAILED');
    expect(res.report.totalInputRecords).toBe(4);
    expect(res.report.validRecords).toBe(0);
    expect(res.report.rejectedRecords).toBe(4);
    expect(res.validatedCandidates).toHaveLength(0);

    const codes = res.errors.map((e) => e.errorCode);
    expect(codes).toEqual(
      expect.arrayContaining([
        'MISSING_EXTERNAL_ID',
        'MISSING_NAME',
        'INVALID_RATING',
        'INVALID_REVIEW_COUNT',
        'MALFORMED_URL',
        'UNSUPPORTED_SOURCE_FORMAT',
      ]),
    );
  });

  it('handles invalid coordinates, incomplete addresses, malformed avatar URLs, and null/empty values without fabricating defaults', () => {
    const res = evaluateRestaurantDataQuality({
      records: [
        {
          RestaurantID: 'warn-1',
          Name: 'Quán Thiếu Tọa Độ',
          Address: 'Q1',
          Latitude: 0,
          Longtitude: 0,
          AvgRating: null,
          PriceMin: 0,
          PriceMax: '',
          Phone: 'abc-xyz',
          avatarUrl: 'not-a-valid-image-url',
        },
      ],
    });

    expect(res.report.overallQualityStatus).toBe('PASSED_WITH_WARNINGS');
    expect(res.report.validRecords).toBe(1);
    expect(res.report.rejectedRecords).toBe(0);
    expect(res.report.warningRecords).toBe(1);

    const cand = res.validatedCandidates[0];
    expect(cand.location).toBeNull();
    expect(cand.coordsValid).toBe(false);
    expect(cand.diemTrungBinh).toBeUndefined();
    expect(cand.giaCa).toBe('');
    expect(cand.contactPhone).toBe('');
    expect(cand.avatarUrl).toBe('');

    const warningCodes = res.warnings.map((w) => w.errorCode);
    expect(warningCodes).toEqual(
      expect.arrayContaining([
        'INCOMPLETE_ADDRESS',
        'INVALID_OR_MISSING_COORDINATES',
        'MISSING_RATING',
        'MISSING_OR_ZERO_PRICE',
        'MISSING_TAGS',
        'MALFORMED_IMAGE_URL',
        'INVALID_PHONE_NUMBER',
      ]),
    );
  });

  it('detects intra-batch duplicate candidates without marking confirmed duplicates or deleting records', () => {
    const res = evaluateRestaurantDataQuality({
      records: [
        {
          RestaurantID: 'dup-100',
          Name: 'Cơm Tấm Ba Ghiền',
          Address: '84 Đặng Văn Ngữ, Phú Nhuận',
          Latitude: 10.793,
          Longtitude: 106.671,
          AvgRating: 8.8,
        },
        {
          RestaurantID: 'dup-100',
          Name: 'Cơm Tấm Ba Ghiền',
          Address: '84 Đặng Văn Ngữ, Phú Nhuận',
          Latitude: 10.793,
          Longtitude: 106.671,
          AvgRating: 8.8,
        },
      ],
    });

    expect(res.report.validRecords).toBe(1);
    expect(res.report.duplicateCandidates.intraBatchCount).toBe(1);
    expect(res.report.duplicateCandidates.confirmedDuplicatesCount).toBe(0);
    expect(res.report.duplicateCandidates.totalCandidateCount).toBe(1);
    expect(res.report.overallQualityStatus).toBe('PASSED_WITH_WARNINGS');
  });

  it('produces accurate reports and bounds rejected samples for large mixed datasets', () => {
    const records: Array<Record<string, unknown>> = [
      {
        RestaurantID: 'mix-valid-1',
        Name: 'Bánh Cuốn Tây Hồ',
        Address: '127 Đinh Tiên Hoàng, Q1',
        Latitude: 10.791,
        Longtitude: 106.697,
        AvgRating: 8.2,
        PriceMin: 35000,
        PriceMax: 60000,
        Cuisines: [{ Name: 'Bánh cuốn' }],
      },
    ];
    for (let i = 0; i < MAX_REJECTED_SAMPLE_RECORDS + 10; i += 1) {
      records.push({
        RestaurantID: `mix-bad-${i}`,
        // Missing Name
        AvgRating: 'invalid',
        apiKey: 'should-not-leak',
      });
    }

    const res = evaluateRestaurantDataQuality({ records });
    expect(res.report.totalInputRecords).toBe(MAX_REJECTED_SAMPLE_RECORDS + 11);
    expect(res.report.validRecords).toBe(1);
    expect(res.report.rejectedRecords).toBe(MAX_REJECTED_SAMPLE_RECORDS + 10);
    expect(res.report.rejectedSample).toHaveLength(MAX_REJECTED_SAMPLE_RECORDS);
    expect(res.report.rejectedSample[0].rawPreview.apiKey).toBeUndefined();
    expect(res.report.overallQualityStatus).toBe('FAILED');
    expect(res.report.missingFieldCounts.Name).toBe(
      MAX_REJECTED_SAMPLE_RECORDS + 10,
    );
    expect(res.report.invalidFieldCounts.AvgRating).toBe(
      MAX_REJECTED_SAMPLE_RECORDS + 10,
    );
  });

  it('rejects invalid records before final restaurants writes and keeps dry-run safe in the ingestion pipeline', async () => {
    const insertedRestaurants: Array<Record<string, unknown>> = [];
    const insertedStaging: Array<Record<string, unknown>> = [];
    const insertedLedgers: Array<Record<string, unknown>> = [];

    const makeCol = (target: Array<Record<string, unknown>>) => ({
      find: () => ({
        limit: () => ({
          toArray: () => Promise.resolve([]),
        }),
        toArray: () => Promise.resolve([]),
      }),
      findOne: () => Promise.resolve(null),
      insertOne: (doc: Record<string, unknown>) => {
        target.push(doc);
        return Promise.resolve({ insertedId: doc._id ?? new ObjectId() });
      },
      updateOne: () =>
        Promise.resolve({
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
        }),
      bulkWrite: (ops: Array<Record<string, unknown>>) => {
        for (const op of ops) {
          if (op.insertOne) {
            target.push(
              (op.insertOne as { document: Record<string, unknown> }).document,
            );
          }
        }
        return Promise.resolve({
          insertedCount: ops.length,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 0,
        });
      },
    });

    const db = {
      databaseName: 'gastro_core_test',
      collection: (name: string) => {
        if (name === RESTAURANTS_COLLECTION)
          return makeCol(insertedRestaurants);
        if (name === RAW_STAGING_COLLECTION) return makeCol(insertedStaging);
        if (name === INGESTION_BATCHES_COLLECTION)
          return makeCol(insertedLedgers);
        return makeCol([]);
      },
    } as unknown as Db;

    const mixedRaw = JSON.stringify([
      {
        RestaurantID: 'pipe-valid-1',
        Name: 'Bún Chả Hương Liên',
        Address: '24 Lê Văn Hưu, Hai Bà Trưng',
        Latitude: 21.018,
        Longtitude: 105.853,
        AvgRating: 9.0,
        PriceMin: 50000,
        PriceMax: 80000,
        Cuisines: [{ Name: 'Bún chả' }],
      },
      {
        RestaurantID: 'pipe-invalid-1',
        Name: 'Quán Lỗi Rating',
        AvgRating: 99,
      },
    ]);

    // Dry-run default performs zero DB writes and returns DataQualityReport
    const drySummary = await runRestaurantIngestionPipeline(db, {
      rawContent: mixedRaw,
      batchId: 'm10-3-dry-run-batch',
    });
    expect(drySummary.mode).toBe('dry-run');
    expect(drySummary.plannedInserts).toBe(1);
    expect(drySummary.metrics.rejected_count).toBe(1);
    expect(drySummary.dataQualityReport?.overallQualityStatus).toBe('FAILED');
    expect(insertedRestaurants).toHaveLength(0);
    expect(insertedLedgers).toHaveLength(0);

    // Apply mode writes only the 1 valid record to `restaurants`, never the rejected record
    const applySummary = await runRestaurantIngestionPipeline(db, {
      rawContent: mixedRaw,
      mode: 'apply',
      batchId: 'm10-3-apply-batch',
    });
    expect(applySummary.metrics.inserted_count).toBe(1);
    expect(applySummary.metrics.rejected_count).toBe(1);
    expect(insertedRestaurants).toHaveLength(1);
    expect(insertedRestaurants[0].externalSourceId).toBe('pipe-valid-1');
  });

  it('throws IngestionValidationError when neither rawContent nor records is supplied', () => {
    expect(() => evaluateRestaurantDataQuality({})).toThrow(
      IngestionValidationError,
    );
  });

  describe('Source provenance propagation (M10.3.1)', () => {
    it('propagates source="shopeefood" when records omit externalSource and keeps 10-point Foody rating compatibility', () => {
      const res = evaluateRestaurantDataQuality({
        source: 'shopeefood',
        records: [
          {
            RestaurantID: 'sf-101',
            Name: 'Trà Sữa Gong Cha',
            Address: '88 Nguyễn Huệ, Q1',
            Latitude: 10.774,
            Longtitude: 106.703,
            AvgRating: 8.4,
          },
        ],
      });

      expect(res.source).toBe('shopeefood');
      expect(res.validatedCandidates).toHaveLength(1);
      expect(res.validatedCandidates[0].externalSource).toBe('shopeefood');
      expect(res.validatedCandidates[0].diemTrungBinh).toBe(4.2);
      expect(res.validatedCandidates[0].ratingScale).toBe('10_point');
    });

    it('propagates source="foody" when records omit externalSource', () => {
      const res = evaluateRestaurantDataQuality({
        source: 'foody',
        records: [
          {
            RestaurantID: 'fd-202',
            Name: 'Phở Hòa Pasteur',
            Address: '260C Pasteur, Q3',
            Latitude: 10.785,
            Longtitude: 106.688,
            AvgRating: 4.4,
          },
        ],
      });

      expect(res.source).toBe('foody');
      expect(res.validatedCandidates).toHaveLength(1);
      expect(res.validatedCandidates[0].externalSource).toBe('foody');
      expect(res.validatedCandidates[0].ratingScale).toBe('10_point');
      expect(res.validatedCandidates[0].diemTrungBinh).toBe(2.2);
    });

    it('preserves explicit record-level externalSource over batch default without silent relabeling', () => {
      const res = evaluateRestaurantDataQuality({
        source: 'shopeefood',
        records: [
          {
            RestaurantID: 'mix-src-1',
            Name: 'Quán Mặc Định ShopeeFood',
            AvgRating: 8.0,
          },
          {
            RestaurantID: 'mix-src-2',
            Name: 'Quán Explicit Foody',
            externalSource: 'foody',
            AvgRating: 9.0,
          },
        ],
      });

      expect(res.source).toBe('shopeefood');
      expect(res.validatedCandidates).toHaveLength(2);
      expect(res.validatedCandidates[0].externalSource).toBe('shopeefood');
      expect(res.validatedCandidates[1].externalSource).toBe('foody');
    });

    it('rejects unsupported batch source and unsupported record-level externalSource', () => {
      expect(() =>
        evaluateRestaurantDataQuality({
          source: 'unsupported_batch_source',
          records: [{ RestaurantID: '1', Name: 'Test' }],
        }),
      ).toThrow(IngestionValidationError);

      const perRecordRes = evaluateRestaurantDataQuality({
        source: 'shopeefood',
        records: [
          {
            RestaurantID: 'bad-rec-src',
            Name: 'Quán Nguồn Lạ',
            externalSource: 'unknown_per_record_source',
          },
        ],
      });

      expect(perRecordRes.report.rejectedRecords).toBe(1);
      expect(perRecordRes.errors[0].errorCode).toBe(
        'UNSUPPORTED_SOURCE_FORMAT',
      );
    });

    it('preserves source provenance identically for rawContent JSON and records array inputs and redacts URL credentials', () => {
      const rawJson = JSON.stringify([
        {
          RestaurantID: 'raw-sf-1',
          Name: 'Bánh Mì Ô Môi',
          AvgRating: 8.6,
        },
        {
          RestaurantID: 'raw-fd-2',
          Name: 'Cơm Tấm Mộc',
          externalSource: 'foody',
          AvgRating: 8.8,
        },
        {
          RestaurantID: 'raw-bad-url',
          Name: 'Quán URL Có Secret',
          MicrositeUrl: 'https://user:supersecret@bad host/path?token=abc123',
        },
      ]);

      const rawRes = evaluateRestaurantDataQuality({
        rawContent: rawJson,
        format: 'json',
        source: 'shopeefood',
      });

      expect(rawRes.source).toBe('shopeefood');
      expect(rawRes.validatedCandidates).toHaveLength(2);
      expect(rawRes.validatedCandidates[0].externalSource).toBe('shopeefood');
      expect(rawRes.validatedCandidates[1].externalSource).toBe('foody');
      expect(rawRes.report.rejectedRecords).toBe(1);
      expect(String(rawRes.errors[0].originalValue)).not.toContain(
        'supersecret',
      );
      expect(String(rawRes.errors[0].originalValue)).not.toContain('abc123');
    });
  });

  describe('M10.3.2 API hardening, recursive sanitization & resource safety', () => {
    it('rejects empty inputs and supplying both rawContent and records simultaneously', () => {
      expect(() =>
        evaluateRestaurantDataQuality({
          rawContent: '[]',
          records: [{ RestaurantID: '1', Name: 'A' }],
        }),
      ).toThrow(IngestionValidationError);

      expect(() =>
        evaluateRestaurantDataQuality({ rawContent: '   ' }),
      ).toThrow(IngestionValidationError);

      expect(() => evaluateRestaurantDataQuality({ records: [] })).toThrow(
        IngestionValidationError,
      );
    });

    it('rejects oversized rawContent and excessive record counts before parsing or normalizing', () => {
      const oversizedRaw = 'x'.repeat(MAX_RAW_CONTENT_BYTES + 1);
      expect(() =>
        evaluateRestaurantDataQuality({ rawContent: oversizedRaw }),
      ).toThrow(IngestionValidationError);

      const tooManyRecords = Array.from(
        { length: MAX_DATA_QUALITY_RECORDS + 1 },
        (_, i) => ({
          RestaurantID: `r-${i}`,
          Name: `Name ${i}`,
        }),
      );
      expect(() =>
        evaluateRestaurantDataQuality({ records: tooManyRecords }),
      ).toThrow(IngestionValidationError);
    });

    it('recursively redacts nested secrets, array secrets, circular refs, and bounds deep payloads', () => {
      const deep: Record<string, unknown> = {
        level1: {
          password: 'p1',
          level2: {
            authorization: 'Bearer secret-jwt',
            level3: {
              cookie: 'session=secret-cookie',
              level4: {
                credential: 'nested-cred',
                beyondLimit: 'hidden',
              },
            },
          },
        },
        items: [
          { apiKey: 'arr-api-key', safeName: 'item-1' },
          { token: 'arr-token', note: 'https://u:pw@host.com/x?token=zzz' },
        ],
        secret: 'top-secret',
      };
      deep.self = deep;

      const sanitized = sanitizeRawPreview(deep);
      const serialized = JSON.stringify(sanitized);

      expect(serialized).not.toContain('p1');
      expect(serialized).not.toContain('secret-jwt');
      expect(serialized).not.toContain('secret-cookie');
      expect(serialized).not.toContain('nested-cred');
      expect(serialized).not.toContain('arr-api-key');
      expect(serialized).not.toContain('arr-token');
      expect(serialized).not.toContain('top-secret');
      expect(serialized).not.toContain(':pw@');
      expect(serialized).not.toContain('=zzz');
      expect(serialized).toContain('[Circular]');
      expect(serialized).toContain('[MaxDepthObject]');
      expect(serialized).toContain('item-1');

      // Verify rejectedSample in report uses recursive sanitization
      const evalRes = evaluateRestaurantDataQuality({
        records: [
          {
            RestaurantID: '',
            Name: '',
            metadata: {
              token: 'nested-secret-token',
              headers: [{ cookie: 'c=123', label: 'ok' }],
            },
          },
        ],
      });
      const sampleJson = JSON.stringify(evalRes.report.rejectedSample);
      expect(sampleJson).not.toContain('nested-secret-token');
      expect(sampleJson).not.toContain('c=123');
      expect(sampleJson).toContain('ok');
    });

    it('clamps excessive maxRejectedSample to MAX_REJECTED_SAMPLE_RECORDS', () => {
      const records = Array.from(
        { length: MAX_REJECTED_SAMPLE_RECORDS + 15 },
        (_, i) => ({
          RestaurantID: `clamp-${i}`,
        }),
      );
      const res = evaluateRestaurantDataQuality({
        records,
        maxRejectedSample: 999999,
      });

      expect(res.report.rejectedRecords).toBe(MAX_REJECTED_SAMPLE_RECORDS + 15);
      expect(res.rejectedRecords).toHaveLength(MAX_REJECTED_SAMPLE_RECORDS);
      expect(res.report.rejectedSample).toHaveLength(
        MAX_REJECTED_SAMPLE_RECORDS,
      );
    });
  });
});
