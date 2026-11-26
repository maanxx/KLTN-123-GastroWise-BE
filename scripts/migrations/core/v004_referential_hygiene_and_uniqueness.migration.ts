import { AnyBulkWriteOperation, Document, ObjectId } from 'mongodb';
import { MigrationDefinition } from '@shared/migrations';
import { normalizeEmail } from '@shared/utils/email.util';

const BATCH_SIZE = 500;
const REVIEW_UNIQUE_INDEX = 'uniq_user_restaurant_review';

/**
 * M8.3 / M9.5 V004 — Email Case Normalization, Orphan Cleanup & Duplicate Review Dedup
 *
 * 1. Detects case-variant duplicate emails in `users` BEFORE lowercasing (aborts cleanly if
 *    colliding accounts require manual merge so E11000 is never hit blindly).
 * 2. Normalizes mixed-case/whitespace `users.email` values in batches of 500.
 * 3. Deduplicates `(userId, restaurantId)` pairs in `reviews` (preserving latest doc and
 *    archiving duplicates to `_archive_reviews_duplicates`).
 * 4. Pulls dangling `savedRestaurants` IDs on `users` and archives/removes orphan `menu_items`
 *    whose parent `restaurantId` no longer exists into `_archive_orphan_refs`.
 * 5. Creates partial unique index `uniq_user_restaurant_review` on `reviews`.
 */
export const v004ReferentialHygieneMigration: MigrationDefinition = {
  id: 'v004_referential_hygiene_and_uniqueness',
  version: '004',
  name: 'Normalize user emails, prune orphan refs, deduplicate reviews and enforce partial unique index',
  database: 'core',
  idempotency: 'idempotent',
  reversible: true,
  description:
    'Safely prepares email normalization, deduplicates reviews, cleans orphan references with archive collections, and enforces uniq_user_restaurant_review.',
  up: async ({ db, dryRun, logger }) => {
    const users = db.collection('users');
    const restaurants = db.collection('restaurants');
    const reviews = db.collection('reviews');
    const menuItems = db.collection('menu_items');
    const archiveDupReviews = db.collection('_archive_reviews_duplicates');
    const archiveOrphans = db.collection('_archive_orphan_refs');

    // Step 1: Detect case-variant duplicate emails BEFORE mutating any user document
    const emailCollisions = await users
      .aggregate([
        {
          $project: {
            email: 1,
            normalized: { $toLower: { $trim: { input: '$email' } } },
          },
        },
        {
          $group: {
            _id: '$normalized',
            count: { $sum: 1 },
            ids: { $push: '$_id' },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    if (emailCollisions.length > 0 && !dryRun) {
      throw new Error(
        `[v004] Detected ${emailCollisions.length} case-variant duplicate email group(s) on users. Resolve manually before normalizing emails.`,
      );
    }

    // Step 2: Find duplicate (userId, restaurantId) review groups
    const dupReviewGroups = await reviews
      .aggregate([
        { $match: { userId: { $type: 'objectId' } } },
        { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
        {
          $group: {
            _id: { userId: '$userId', restaurantId: '$restaurantId' },
            ids: { $push: '$_id' },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    // Step 3: Identify orphan menu_items & dangling savedRestaurants references
    const orphanMenuItems = await menuItems
      .aggregate([
        {
          $lookup: {
            from: 'restaurants',
            localField: 'restaurantId',
            foreignField: '_id',
            as: 'parent',
          },
        },
        { $match: { 'parent.0': { $exists: false } } },
        { $project: { _id: 1, restaurantId: 1, name: 1 } },
      ])
      .toArray();

    const validRestaurantIds = new Set(
      (await restaurants.find({}, { projection: { _id: 1 } }).toArray()).map(
        (r) => r._id.toString(),
      ),
    );

    if (dryRun) {
      let emailsToNormalize = 0;
      const userCursor = users
        .find({}, { projection: { _id: 1, email: 1, savedRestaurants: 1 } })
        .batchSize(BATCH_SIZE);
      let danglingSavedUsers = 0;

      for await (const u of userCursor) {
        if (
          typeof u.email === 'string' &&
          normalizeEmail(u.email) !== u.email
        ) {
          emailsToNormalize++;
        }
        if (
          Array.isArray(u.savedRestaurants) &&
          u.savedRestaurants.some((id) => !validRestaurantIds.has(String(id)))
        ) {
          danglingSavedUsers++;
        }
      }

      logger.info('v004_dry_run_projection', {
        scope: 'core',
        migrationId: 'v004_referential_hygiene_and_uniqueness',
        details: {
          emailCollisions: emailCollisions.length,
          emailsToNormalize,
          duplicateReviewGroups: dupReviewGroups.length,
          orphanMenuItems: orphanMenuItems.length,
          usersWithDanglingFavorites: danglingSavedUsers,
        },
      });
      return;
    }

    // Apply Step 2a: Email lowercasing & trim + dangling favorite pruning in batches
    const userCursor = users
      .find({}, { projection: { _id: 1, email: 1, savedRestaurants: 1 } })
      .batchSize(BATCH_SIZE);
    let userOps: AnyBulkWriteOperation<Document>[] = [];

    for await (const u of userCursor) {
      const updates: Record<string, any> = {};
      if (typeof u.email === 'string') {
        const normalized = normalizeEmail(u.email);
        if (normalized && normalized !== u.email) {
          updates.email = normalized;
        }
      }
      const savedList: unknown = u.savedRestaurants;
      if (Array.isArray(savedList) && savedList.length > 0) {
        const filtered = savedList.filter((rid: unknown) =>
          validRestaurantIds.has(String(rid)),
        );
        if (filtered.length !== savedList.length) {
          updates.savedRestaurants = filtered;
        }
      }
      if (Object.keys(updates).length > 0) {
        userOps.push({
          updateOne: { filter: { _id: u._id }, update: { $set: updates } },
        });
      }
      if (userOps.length >= BATCH_SIZE) {
        await users.bulkWrite(userOps, { ordered: false });
        userOps = [];
      }
    }
    if (userOps.length > 0) {
      await users.bulkWrite(userOps, { ordered: false });
    }

    // Apply Step 2b: Archive and delete duplicate reviews (retain first = newest)
    let dedupedReviews = 0;
    for (const grp of dupReviewGroups) {
      const ids = Array.isArray(grp.ids) ? (grp.ids as ObjectId[]) : [];
      const [, ...duplicateIds] = ids;
      if (duplicateIds.length === 0) continue;
      const docsToArchive = await reviews
        .find({ _id: { $in: duplicateIds } })
        .toArray();
      if (docsToArchive.length > 0) {
        await archiveDupReviews.bulkWrite(
          docsToArchive.map((d) => ({
            replaceOne: {
              filter: { _id: d._id },
              replacement: { ...d, _archivedAt: new Date() },
              upsert: true,
            },
          })),
          { ordered: false },
        );
        const delRes = await reviews.deleteMany({ _id: { $in: duplicateIds } });
        dedupedReviews += delRes.deletedCount;
      }
    }

    // Apply Step 2c: Archive and delete orphan menu items
    let cleanedMenuItems = 0;
    if (orphanMenuItems.length > 0) {
      const orphanIds = orphanMenuItems.map((m) => m._id as ObjectId);
      const fullOrphans = await menuItems
        .find({ _id: { $in: orphanIds } })
        .toArray();
      if (fullOrphans.length > 0) {
        await archiveOrphans.bulkWrite(
          fullOrphans.map((d) => ({
            replaceOne: {
              filter: { _id: d._id },
              replacement: {
                _id: d._id,
                sourceCollection: 'menu_items',
                document: d,
                _archivedAt: new Date(),
              },
              upsert: true,
            },
          })),
          { ordered: false },
        );
        const delMenus = await menuItems.deleteMany({
          _id: { $in: orphanIds },
        });
        cleanedMenuItems = delMenus.deletedCount;
      }
    }

    // Step 3: Enforce partial unique index on (userId, restaurantId)
    await reviews.createIndex(
      { userId: 1, restaurantId: 1 },
      {
        unique: true,
        name: REVIEW_UNIQUE_INDEX,
        partialFilterExpression: { userId: { $type: 'objectId' } },
        background: true,
      },
    );

    logger.info('v004_referential_hygiene_complete', {
      scope: 'core',
      migrationId: 'v004_referential_hygiene_and_uniqueness',
      details: {
        dedupedReviews,
        cleanedMenuItems,
        uniqueIndex: REVIEW_UNIQUE_INDEX,
      },
    });
  },
  down: async ({ db, dryRun, logger }) => {
    const reviews = db.collection('reviews');
    const archiveDupReviews = db.collection('_archive_reviews_duplicates');
    if (dryRun) {
      return;
    }

    try {
      await reviews.dropIndex(REVIEW_UNIQUE_INDEX);
    } catch {
      // Index already absent
    }

    const archivedReviews = await archiveDupReviews.find({}).toArray();
    if (archivedReviews.length > 0) {
      await reviews.bulkWrite(
        archivedReviews.map((doc) => {
          const original = { ...doc };
          delete original._archivedAt;
          return {
            replaceOne: {
              filter: { _id: original._id },
              replacement: original,
              upsert: true,
            },
          };
        }),
        { ordered: false },
      );
    }

    logger.info('v004_rollback_complete', {
      scope: 'core',
      migrationId: 'v004_referential_hygiene_and_uniqueness',
      details: { restoredDuplicateReviews: archivedReviews.length },
    });
  },
};
