import {
  IngestionValidationError,
  RESTAURANTS_COLLECTION,
} from './ingestion.types';
import type {
  ExternalSourceDuplicateGroup,
  IngestionIndexPreflightReport,
} from './ingestion.types';
import type { Db } from 'mongodb';

export const UNIQUE_EXTERNAL_SOURCE_INDEX_NAME =
  'uniq_external_source_id_partial' as const;

export const MAX_DUPLICATE_GROUP_SAMPLES = 200 as const;
export const MAX_SAMPLE_DOCS_PER_GROUP = 10 as const;

export const UNIQUE_EXTERNAL_SOURCE_PARTIAL_FILTER = {
  externalSource: { $type: 'string' },
  externalSourceId: { $type: 'string' },
} as const;

const INDEX_PREFLIGHT_REMEDIATION_STEPS = [
  '1. Review the reported duplicate (externalSource, externalSourceId) groups and inspect affected docIds.',
  '2. Verify user-owned fields (ownerId, reviewsCount > 0, isVerified, isFeatured) before selecting the surviving document.',
  '3. Archive superseded duplicates into a dedicated archive collection and re-link references; never blindly delete records.',
  '4. Re-run `--preflight-indexes` until duplicateGroupCount is 0.',
  '5. Execute `--ensure-indexes --apply` against the verified target database.',
];

interface DuplicateAggRow {
  _id?: {
    externalSource?: unknown;
    externalSourceId?: unknown;
  };
  count?: unknown;
  docIds?: unknown;
  names?: unknown;
}

interface DuplicateSummaryRow {
  totalDuplicateGroups?: unknown;
  totalAffectedDocuments?: unknown;
}

interface DuplicateFacetRow {
  summary?: DuplicateSummaryRow[];
  sampleGroups?: DuplicateAggRow[];
}

/**
 * Inspects existing restaurant documents for duplicate `(externalSource, externalSourceId)` pairs
 * non-destructively BEFORE attempting partial unique index creation.
 *
 * Uses MongoDB 7.0 `$firstN` + `$facet` so per-group memory stays bounded while computing
 * exact `duplicateGroupCount` and `totalAffectedDocuments` independently from the 200-group sample.
 */
export async function preflightExternalSourceUniqueIndex(
  db: Db,
): Promise<IngestionIndexPreflightReport> {
  const restaurantsCol = db.collection(RESTAURANTS_COLLECTION);

  const scannedCount = await restaurantsCol.countDocuments(
    UNIQUE_EXTERNAL_SOURCE_PARTIAL_FILTER,
  );

  const facetRows = (await restaurantsCol
    .aggregate(
      [
        { $match: UNIQUE_EXTERNAL_SOURCE_PARTIAL_FILTER },
        {
          $group: {
            _id: {
              externalSource: '$externalSource',
              externalSourceId: '$externalSourceId',
            },
            count: { $sum: 1 },
            docIds: {
              $firstN: { input: '$_id', n: MAX_SAMPLE_DOCS_PER_GROUP },
            },
            names: {
              $firstN: { input: '$tenQuan', n: MAX_SAMPLE_DOCS_PER_GROUP },
            },
          },
        },
        { $match: { count: { $gt: 1 } } },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  totalDuplicateGroups: { $sum: 1 },
                  totalAffectedDocuments: { $sum: '$count' },
                },
              },
            ],
            sampleGroups: [
              {
                $sort: {
                  count: -1,
                  '_id.externalSource': 1,
                  '_id.externalSourceId': 1,
                },
              },
              { $limit: MAX_DUPLICATE_GROUP_SAMPLES },
            ],
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray()) as DuplicateFacetRow[];

  const facetResult = facetRows[0] ?? {};
  const summaryRow = Array.isArray(facetResult.summary)
    ? facetResult.summary[0]
    : undefined;
  const dupRows = Array.isArray(facetResult.sampleGroups)
    ? facetResult.sampleGroups
    : [];

  const duplicates: ExternalSourceDuplicateGroup[] = dupRows.map((row) => {
    const extSource =
      typeof row._id?.externalSource === 'string' ? row._id.externalSource : '';
    const extSourceId =
      typeof row._id?.externalSourceId === 'string'
        ? row._id.externalSourceId
        : '';
    const count =
      typeof row.count === 'number' && Number.isFinite(row.count)
        ? row.count
        : 0;
    const docIds = Array.isArray(row.docIds)
      ? row.docIds
          .slice(0, MAX_SAMPLE_DOCS_PER_GROUP)
          .map((id) =>
            id !== null && typeof id === 'object' && 'toString' in id
              ? (id as { toString: () => string }).toString()
              : typeof id === 'string'
                ? id
                : '',
          )
      : [];
    const names = Array.isArray(row.names)
      ? row.names
          .slice(0, MAX_SAMPLE_DOCS_PER_GROUP)
          .map((n) => (typeof n === 'string' ? n : ''))
      : [];

    return {
      externalSource: extSource,
      externalSourceId: extSourceId,
      count,
      docIds,
      names,
      sampleTruncated: count > docIds.length,
    };
  });

  const rawTotalGroups =
    typeof summaryRow?.totalDuplicateGroups === 'number' &&
    Number.isFinite(summaryRow.totalDuplicateGroups)
      ? summaryRow.totalDuplicateGroups
      : duplicates.length;
  const rawTotalAffected =
    typeof summaryRow?.totalAffectedDocuments === 'number' &&
    Number.isFinite(summaryRow.totalAffectedDocuments)
      ? summaryRow.totalAffectedDocuments
      : duplicates.reduce((acc, g) => acc + g.count, 0);

  const duplicateGroupCount = Math.max(rawTotalGroups, duplicates.length);
  const totalAffectedDocuments = Math.max(
    rawTotalAffected,
    duplicates.reduce((acc, g) => acc + g.count, 0),
  );

  return {
    collection: RESTAURANTS_COLLECTION,
    indexName: UNIQUE_EXTERNAL_SOURCE_INDEX_NAME,
    indexSpec: { externalSource: 1, externalSourceId: 1 },
    partialFilterExpression: {
      externalSource: { $type: 'string' },
      externalSourceId: { $type: 'string' },
    },
    scannedCount,
    duplicateGroupCount,
    displayedDuplicateGroupCount: duplicates.length,
    totalAffectedDocuments,
    sampleLimits: {
      maxGroups: MAX_DUPLICATE_GROUP_SAMPLES,
      maxDocsPerGroup: MAX_SAMPLE_DOCS_PER_GROUP,
    },
    duplicates,
    safeToCreateUniqueIndex: duplicateGroupCount === 0,
    indexCreated: false,
    dryRun: true,
    remediationSteps:
      duplicateGroupCount > 0 ? [...INDEX_PREFLIGHT_REMEDIATION_STEPS] : [],
  };
}

/**
 * Safely rolls out `uniq_external_source_id_partial` ONLY after preflight verifies
 * zero `(externalSource, externalSourceId)` duplicates. Never deletes or merges records.
 */
export async function rolloutIngestionIndexes(
  db: Db,
  options: { dryRun?: boolean } = {},
): Promise<IngestionIndexPreflightReport> {
  const dryRun = options.dryRun !== false;
  const report = await preflightExternalSourceUniqueIndex(db);

  if (!report.safeToCreateUniqueIndex) {
    const preview = report.duplicates
      .slice(0, 10)
      .map(
        (d) =>
          `(${d.externalSource}, ${d.externalSourceId}) count=${d.count} sampleDocIds=[${d.docIds.join(', ')}]`,
      )
      .join('; ');
    throw new IngestionValidationError(
      `Cannot create unique index "${UNIQUE_EXTERNAL_SOURCE_INDEX_NAME}": detected ${report.duplicateGroupCount} duplicate (externalSource, externalSourceId) group(s) affecting ${report.totalAffectedDocuments} document(s) (showing ${report.displayedDuplicateGroupCount} group(s)): ${preview}. Manual remediation required before unique index rollout.`,
    );
  }

  if (dryRun) {
    return {
      ...report,
      indexCreated: false,
      dryRun: true,
    };
  }

  const restaurantsCol = db.collection(RESTAURANTS_COLLECTION);
  await restaurantsCol.createIndex(
    { externalSource: 1, externalSourceId: 1 },
    {
      name: UNIQUE_EXTERNAL_SOURCE_INDEX_NAME,
      unique: true,
      partialFilterExpression: UNIQUE_EXTERNAL_SOURCE_PARTIAL_FILTER,
    },
  );
  await restaurantsCol.createIndex({ slug: 1 }, { sparse: true });
  await restaurantsCol.createIndex({ urlGoc: 1 }, { sparse: true });
  await restaurantsCol.createIndex(
    { normalizedNameAddressKey: 1 },
    { sparse: true },
  );
  await restaurantsCol.createIndex({ tenQuan: 1, diaChi: 1 });
  await restaurantsCol.createIndex({ ingestionBatchId: 1 }, { sparse: true });

  return {
    ...report,
    indexCreated: true,
    dryRun: false,
  };
}
