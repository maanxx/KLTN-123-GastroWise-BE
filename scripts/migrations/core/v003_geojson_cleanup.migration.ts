import { AnyBulkWriteOperation, Document } from 'mongodb';
import { MigrationDefinition } from '@shared/migrations';
import { isValidGeoJsonPoint, toGeoJsonPoint } from '@shared/utils/geo.utils';

const BATCH_SIZE = 500;
const LEGACY_Q1_LON = 106.7009;
const LEGACY_Q1_LAT = 10.7769;

function isFabricatedQ1DefaultForUngeocoded(doc: Document): boolean {
  const loc = doc?.location as { coordinates?: unknown } | undefined;
  const coords = loc?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) {
    return false;
  }
  const isQ1Default =
    Number(coords[0]) === LEGACY_Q1_LON && Number(coords[1]) === LEGACY_Q1_LAT;
  if (!isQ1Default) {
    return false;
  }
  const validFlat = toGeoJsonPoint(doc.lat, doc.lon);
  return validFlat === null;
}

/**
 * M8.3 / M9.5 V003 — GeoJSON Location Cleanup & Backfill
 *
 * Replaces the former unindexed boot scan `RestaurantsService.ensureGeoJsonLocations()`.
 * - Clears fabricated Q1 default `[106.7009, 10.7769]` or invalid `[0,0]` / out-of-range
 *   `location` values to `null` when underlying `lat`/`lon` are missing or zero.
 * - Backfills valid GeoJSON `{ type: 'Point', coordinates: [lon, lat] }` where valid flat
 *   `lat`/`lon` exist and `location` is missing/null/out-of-sync.
 * - Archives prior `location` states into `_migration_audit_v003` for bounded rollback.
 */
export const v003GeoJsonCleanupMigration: MigrationDefinition = {
  id: 'v003_geojson_cleanup',
  version: '003',
  name: 'Clean invalid/Q1-defaulted GeoJSON locations and backfill valid coordinates on restaurants',
  database: 'core',
  idempotency: 'idempotent',
  reversible: true,
  description:
    'Normalizes restaurant GeoJSON Point coordinates in bounded batches of 500 and snapshots prior values to _migration_audit_v003.',
  up: async ({ db, dryRun, logger }) => {
    const restaurants = db.collection('restaurants');
    const auditCol = db.collection('_migration_audit_v003');

    const candidateFilter = {
      $or: [
        { location: { $exists: false } },
        {
          location: null,
          lat: { $exists: true, $ne: null },
          lon: { $exists: true, $ne: null },
        },
        { location: { $ne: null } },
      ],
    };

    if (dryRun) {
      let clearedCount = 0;
      let backfilledCount = 0;
      const cursor = restaurants
        .find(candidateFilter, {
          projection: { _id: 1, lat: 1, lon: 1, location: 1 },
        })
        .batchSize(BATCH_SIZE);

      for await (const doc of cursor) {
        const validFromFlat = toGeoJsonPoint(doc.lat, doc.lon);
        const hasLocation = doc.location !== null && doc.location !== undefined;

        if (isFabricatedQ1DefaultForUngeocoded(doc)) {
          clearedCount++;
        } else if (hasLocation && !isValidGeoJsonPoint(doc.location)) {
          if (validFromFlat) backfilledCount++;
          else clearedCount++;
        } else if (!hasLocation && validFromFlat) {
          backfilledCount++;
        }
      }

      logger.info('v003_dry_run_projection', {
        scope: 'core',
        migrationId: 'v003_geojson_cleanup',
        details: {
          toClearToNull: clearedCount,
          toBackfillPoint: backfilledCount,
        },
      });
      return;
    }

    const cursor = restaurants
      .find(candidateFilter, {
        projection: { _id: 1, lat: 1, lon: 1, location: 1 },
      })
      .batchSize(BATCH_SIZE);

    let updateOps: AnyBulkWriteOperation<Document>[] = [];
    let auditOps: AnyBulkWriteOperation<Document>[] = [];
    let modified = 0;

    const flush = async () => {
      if (auditOps.length > 0) {
        await auditCol.bulkWrite(auditOps, { ordered: false });
        auditOps = [];
      }
      if (updateOps.length > 0) {
        const res = await restaurants.bulkWrite(updateOps, { ordered: false });
        modified += res.modifiedCount;
        updateOps = [];
      }
    };

    for await (const doc of cursor) {
      const validFromFlat = toGeoJsonPoint(doc.lat, doc.lon);
      const hasLocation = doc.location !== null && doc.location !== undefined;
      let nextLocation: unknown = undefined;

      if (isFabricatedQ1DefaultForUngeocoded(doc)) {
        nextLocation = null;
      } else if (hasLocation && !isValidGeoJsonPoint(doc.location)) {
        nextLocation = validFromFlat ?? null;
      } else if (!hasLocation && validFromFlat) {
        nextLocation = validFromFlat;
      }

      if (nextLocation !== undefined) {
        auditOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $setOnInsert: {
                _id: doc._id,
                previousLocation: doc.location ?? null,
                previousLat: doc.lat ?? null,
                previousLon: doc.lon ?? null,
                capturedAt: new Date(),
              },
            },
            upsert: true,
          },
        });
        updateOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { location: nextLocation } },
          },
        });
      }

      if (updateOps.length >= BATCH_SIZE) {
        await flush();
      }
    }

    await flush();

    logger.info('v003_geojson_cleanup_complete', {
      scope: 'core',
      migrationId: 'v003_geojson_cleanup',
      details: { modifiedCount: modified },
    });
  },
  down: async ({ db, dryRun, logger }) => {
    const restaurants = db.collection('restaurants');
    const auditCol = db.collection('_migration_audit_v003');
    if (dryRun) {
      return;
    }

    const cursor = auditCol.find({}).batchSize(BATCH_SIZE);
    let ops: AnyBulkWriteOperation<Document>[] = [];
    let restored = 0;

    for await (const entry of cursor) {
      ops.push({
        updateOne: {
          filter: { _id: entry._id },
          update: { $set: { location: entry.previousLocation ?? null } },
        },
      });
      if (ops.length >= BATCH_SIZE) {
        const res = await restaurants.bulkWrite(ops, { ordered: false });
        restored += res.modifiedCount;
        ops = [];
      }
    }
    if (ops.length > 0) {
      const res = await restaurants.bulkWrite(ops, { ordered: false });
      restored += res.modifiedCount;
    }

    logger.info('v003_rollback_complete', {
      scope: 'core',
      migrationId: 'v003_geojson_cleanup',
      details: { restoredCount: restored },
    });
  },
};
