import * as crypto from 'crypto';
import { ObjectId } from 'mongodb';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import {
  APPROVED_INGESTION_DB_NAME,
  EXTERNAL_SOURCE_FOODY,
  IngestionValidationIssue,
  RESTAURANTS_COLLECTION,
} from './ingestion.types';
import { runRestaurantIngestionPipeline } from './ingestion.pipeline';
import {
  extractFoodDatasetRecords,
  MENU_ITEMS_COLLECTION,
  NormalizedDishCandidate,
  validateAndNormalizeDishRecord,
} from './dish-ingestion.normalizer';

export interface EntityImportBreakdown {
  totalReceived: number;
  valid: number;
  rejected: number;
  inserted: number;
  updated: number;
  skippedDuplicates: number;
}

export interface FoodDatasetValidationErrorEntry
  extends IngestionValidationIssue {
  entityType: 'restaurant' | 'dish';
}

export interface FoodDatasetImportReport {
  batchId: string;
  mode: 'dry-run' | 'apply';
  source: string;
  targetDb: string;
  targetUriRedacted: string;
  durationMs: number;
  totalRecordsReceived: number;
  validRecords: number;
  rejectedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  skippedDuplicates: number;
  restaurants: EntityImportBreakdown;
  dishes: EntityImportBreakdown;
  validationErrorsByField: Record<string, number>;
  validationErrors: FoodDatasetValidationErrorEntry[];
  warningsCount: number;
}

export interface FoodDatasetPipelineOptions {
  rawContent: string;
  source?: string;
  batchId?: string;
  mode: 'dry-run' | 'apply';
  targetDb?: string;
  targetUriRedacted?: string;
}

function computeDishContentDigest(
  candidate: NormalizedDishCandidate,
  restaurantId: ObjectId,
): string {
  const canonical = {
    restaurantId: restaurantId.toHexString(),
    name: candidate.name,
    description: candidate.description,
    price: candidate.price,
    image: candidate.image,
    isVegetarian: candidate.isVegetarian,
    calories: candidate.calories ?? null,
    tags: candidate.tags,
    isAvailable: candidate.isAvailable,
    isFeatured: candidate.isFeatured,
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
}

export async function runLocalFoodDatasetIngestionPipeline(
  db: Db,
  options: FoodDatasetPipelineOptions,
): Promise<FoodDatasetImportReport> {
  const startedAt = Date.now();
  const source = (options.source || EXTERNAL_SOURCE_FOODY).trim();
  const batchId =
    options.batchId?.trim() ||
    `food-batch-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const targetDb = options.targetDb || APPROVED_INGESTION_DB_NAME;
  const targetUriRedacted = options.targetUriRedacted || '<redacted-local-db>';

  const { restaurants: rawRestaurants, dishes: rawDishes } =
    extractFoodDatasetRecords(options.rawContent);

  const allErrors: FoodDatasetValidationErrorEntry[] = [];
  let warningsCount = 0;

  // --- STAGE 1: Restaurants (delegates to M10.2-M10.4 Core-owned pipeline) ---
  const restBreakdown: EntityImportBreakdown = {
    totalReceived: rawRestaurants.length,
    valid: 0,
    rejected: 0,
    inserted: 0,
    updated: 0,
    skippedDuplicates: 0,
  };

  if (rawRestaurants.length > 0) {
    const restResult = await runRestaurantIngestionPipeline(db, {
      rawContent: JSON.stringify(rawRestaurants),
      format: 'json',
      source,
      batchId,
      mode: options.mode,
      targetDb,
      targetUriRedacted,
    });

    restBreakdown.valid = restResult.metrics.valid_record_count;
    restBreakdown.rejected = restResult.metrics.rejected_count;
    restBreakdown.inserted =
      options.mode === 'apply'
        ? restResult.metrics.inserted_count
        : restResult.plannedInserts;
    restBreakdown.updated =
      options.mode === 'apply'
        ? restResult.metrics.updated_count
        : restResult.plannedUpdates;
    restBreakdown.skippedDuplicates = restResult.duplicatesSkipped;
    warningsCount += restResult.warnings.length;

    for (const err of restResult.validationErrors) {
      allErrors.push({ ...err, entityType: 'restaurant' });
    }
  }

  // --- STAGE 2: Dishes (Core-owned `menu_items` collection) ---
  const dishBreakdown: EntityImportBreakdown = {
    totalReceived: rawDishes.length,
    valid: 0,
    rejected: 0,
    inserted: 0,
    updated: 0,
    skippedDuplicates: 0,
  };

  if (rawDishes.length > 0) {
    const restaurantsCol = db.collection(RESTAURANTS_COLLECTION);
    const menuItemsCol = db.collection(MENU_ITEMS_COLLECTION);

    // 2a. Normalize & validate each dish record independently (partial failure isolation)
    const normalizedDishes: NormalizedDishCandidate[] = [];
    const seenDishKeys = new Set<string>();

    for (const rawDish of rawDishes) {
      const outcome = validateAndNormalizeDishRecord(rawDish, batchId, source);
      warningsCount += outcome.warnings.length;

      if (!outcome.valid || !outcome.candidate) {
        dishBreakdown.rejected += 1;
        for (const err of outcome.errors) {
          allErrors.push({ ...err, entityType: 'dish' });
        }
        continue;
      }

      const dedupKey = `${outcome.candidate.externalSource}::${outcome.candidate.externalSourceId}`;
      if (seenDishKeys.has(dedupKey)) {
        dishBreakdown.skippedDuplicates += 1;
        continue;
      }
      seenDishKeys.add(dedupKey);
      normalizedDishes.push(outcome.candidate);
    }

    // 2b. Resolve restaurant-dish relationships against Core `restaurants` collection
    const extRestLookups = new Map<
      string,
      { externalSource: string; externalSourceId: string }
    >();
    const objectIdLookups = new Set<string>();

    for (const dish of normalizedDishes) {
      if (dish.restaurantExternalId) {
        const key = `${dish.externalSource}::${dish.restaurantExternalId}`;
        extRestLookups.set(key, {
          externalSource: dish.externalSource,
          externalSourceId: dish.restaurantExternalId,
        });
      }
      if (dish.restaurantObjectId) {
        objectIdLookups.add(dish.restaurantObjectId);
      }
    }

    const restKeyToObjectId = new Map<string, ObjectId>();
    const validRestObjectIds = new Set<string>();

    if (extRestLookups.size > 0) {
      const orClauses = Array.from(extRestLookups.values()).map((pair) => ({
        externalSource: pair.externalSource,
        externalSourceId: pair.externalSourceId,
      }));
      const foundByExt = await restaurantsCol
        .find({ $or: orClauses })
        .project({ _id: 1, externalSource: 1, externalSourceId: 1 })
        .toArray();

      for (const doc of foundByExt) {
        if (
          doc._id instanceof ObjectId &&
          typeof doc.externalSource === 'string' &&
          typeof doc.externalSourceId === 'string'
        ) {
          restKeyToObjectId.set(
            `${doc.externalSource}::${doc.externalSourceId}`,
            doc._id,
          );
          validRestObjectIds.add(doc._id.toHexString());
        }
      }
    }

    if (objectIdLookups.size > 0) {
      const ids = Array.from(objectIdLookups).map((hex) => new ObjectId(hex));
      const foundById = await restaurantsCol
        .find({ _id: { $in: ids } })
        .project({ _id: 1 })
        .toArray();
      for (const doc of foundById) {
        if (doc._id instanceof ObjectId) {
          validRestObjectIds.add(doc._id.toHexString());
        }
      }
    }

    // In dry-run mode, restaurants from Stage 1 were not written to DB yet;
    // allow dishes referencing a valid Stage 1 restaurant externalSourceId to be counted as valid.
    const dryRunPlannedRestKeys = new Set<string>();
    if (options.mode === 'dry-run' && rawRestaurants.length > 0) {
      for (const rawRest of rawRestaurants) {
        const rawId =
          rawRest.externalSourceId ?? rawRest.RestaurantID ?? rawRest.id;
        const restExtId =
          typeof rawId === 'number'
            ? String(Math.trunc(rawId))
            : typeof rawId === 'string'
              ? rawId.trim()
              : '';
        const restName =
          typeof rawRest.name === 'string'
            ? rawRest.name.trim()
            : typeof rawRest.Name === 'string'
              ? rawRest.Name.trim()
              : typeof rawRest.tenQuan === 'string'
                ? rawRest.tenQuan.trim()
                : '';
        const restSource =
          typeof rawRest.externalSource === 'string' &&
          rawRest.externalSource.trim()
            ? rawRest.externalSource.trim()
            : source;
        if (restExtId && restName) {
          dryRunPlannedRestKeys.add(`${restSource}::${restExtId}`);
        }
      }
    }

    const resolvedDishes: Array<{
      candidate: NormalizedDishCandidate;
      restaurantId: ObjectId;
    }> = [];

    for (const dish of normalizedDishes) {
      let resolvedId: ObjectId | undefined;
      if (dish.restaurantExternalId) {
        const key = `${dish.externalSource}::${dish.restaurantExternalId}`;
        resolvedId = restKeyToObjectId.get(key);
        if (!resolvedId && dryRunPlannedRestKeys.has(key)) {
          // Deterministic placeholder ObjectId for dry-run planning only (never persisted)
          resolvedId = new ObjectId('000000000000000000000000');
        }
      } else if (
        dish.restaurantObjectId &&
        validRestObjectIds.has(dish.restaurantObjectId)
      ) {
        resolvedId = new ObjectId(dish.restaurantObjectId);
      }

      if (!resolvedId) {
        dishBreakdown.rejected += 1;
        allErrors.push({
          entityType: 'dish',
          recordIndex: dish.recordIndex,
          field: 'restaurantExternalId',
          errorCode: 'DISH_ORPHAN_RESTAURANT',
          reason: `Referenced restaurant "${dish.restaurantExternalId || dish.restaurantObjectId}" does not exist in Core restaurants collection.`,
          severity: 'error',
          sourceId: dish.externalSourceId,
        });
        continue;
      }

      resolvedDishes.push({ candidate: dish, restaurantId: resolvedId });
    }

    dishBreakdown.valid = resolvedDishes.length;

    // 2c. Idempotent deduplication & bulk upsert into Core `menu_items`
    if (resolvedDishes.length > 0) {
      const existingDishDocs = await menuItemsCol
        .find({
          $or: resolvedDishes.map(({ candidate }) => ({
            externalSource: candidate.externalSource,
            externalSourceId: candidate.externalSourceId,
          })),
        })
        .toArray();

      const existingMap = new Map<string, Record<string, unknown>>();
      for (const doc of existingDishDocs) {
        if (
          typeof doc.externalSource === 'string' &&
          typeof doc.externalSourceId === 'string'
        ) {
          existingMap.set(
            `${doc.externalSource}::${doc.externalSourceId}`,
            doc as Record<string, unknown>,
          );
        }
      }

      const bulkOps: AnyBulkWriteOperation[] = [];
      const now = new Date();

      for (const { candidate, restaurantId } of resolvedDishes) {
        const key = `${candidate.externalSource}::${candidate.externalSourceId}`;
        const existing = existingMap.get(key);
        const newDigest = computeDishContentDigest(candidate, restaurantId);

        if (existing) {
          const existingDigest =
            typeof existing._ingestionContentDigest === 'string'
              ? existing._ingestionContentDigest
              : null;
          if (existingDigest && existingDigest === newDigest) {
            dishBreakdown.skippedDuplicates += 1;
            continue;
          }
          dishBreakdown.updated += 1;
        } else {
          dishBreakdown.inserted += 1;
        }

        if (options.mode === 'apply') {
          const setPayload: Record<string, unknown> = {
            restaurantId,
            name: candidate.name,
            description: candidate.description,
            price: candidate.price,
            image: candidate.image,
            isVegetarian: candidate.isVegetarian,
            tags: candidate.tags,
            isAvailable: candidate.isAvailable,
            isFeatured: candidate.isFeatured,
            externalSource: candidate.externalSource,
            externalSourceId: candidate.externalSourceId,
            ingestionBatchId: candidate.ingestionBatchId,
            _ingestionContentDigest: newDigest,
            updatedAt: now,
          };
          if (candidate.calories !== undefined) {
            setPayload.calories = candidate.calories;
          }

          bulkOps.push({
            updateOne: {
              filter: {
                externalSource: candidate.externalSource,
                externalSourceId: candidate.externalSourceId,
              },
              update: {
                $set: setPayload,
                $setOnInsert: { createdAt: now },
              },
              upsert: true,
            },
          });
        }
      }

      if (options.mode === 'apply' && bulkOps.length > 0) {
        await menuItemsCol.bulkWrite(bulkOps, { ordered: false });
      }
    }
  }

  // --- STAGE 3: Group validation errors by field ---
  const validationErrorsByField: Record<string, number> = {};
  for (const err of allErrors) {
    const fieldKey = `${err.entityType}.${err.field}`;
    validationErrorsByField[fieldKey] =
      (validationErrorsByField[fieldKey] || 0) + 1;
  }

  const durationMs = Math.max(0, Date.now() - startedAt);

  return {
    batchId,
    mode: options.mode,
    source,
    targetDb,
    targetUriRedacted,
    durationMs,
    totalRecordsReceived:
      restBreakdown.totalReceived + dishBreakdown.totalReceived,
    validRecords: restBreakdown.valid + dishBreakdown.valid,
    rejectedRecords: restBreakdown.rejected + dishBreakdown.rejected,
    insertedRecords: restBreakdown.inserted + dishBreakdown.inserted,
    updatedRecords: restBreakdown.updated + dishBreakdown.updated,
    skippedDuplicates:
      restBreakdown.skippedDuplicates + dishBreakdown.skippedDuplicates,
    restaurants: restBreakdown,
    dishes: dishBreakdown,
    validationErrorsByField,
    validationErrors: allErrors,
    warningsCount,
  };
}
