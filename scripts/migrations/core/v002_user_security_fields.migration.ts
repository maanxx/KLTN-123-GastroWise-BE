import { MigrationDefinition } from '@shared/migrations';

/**
 * M8.3 V002 — User Security Field Backfill
 *
 * Ensures legacy user documents carry `hashedRefreshToken: null` and
 * `resetOtpExpiresAt: null`, invalidates any non-bcrypt plaintext
 * `hashedRefreshToken` values so legacy unhashed sessions cannot be trusted,
 * and clears unexpiring legacy `resetOtp` values missing `resetOtpExpiresAt`.
 */
export const v002UserSecurityFieldsMigration: MigrationDefinition = {
  id: 'v002_user_security_fields',
  version: '002',
  name: 'Backfill hashedRefreshToken and resetOtpExpiresAt security fields on users',
  database: 'core',
  idempotency: 'idempotent',
  reversible: true,
  description:
    'Initializes hashedRefreshToken/resetOtpExpiresAt to null where missing, invalidates any non-bcrypt refresh tokens, and clears unexpiring legacy resetOtp tokens.',
  up: async ({ db, dryRun, logger }) => {
    const users = db.collection('users');

    // 1. Backfill missing hashedRefreshToken or invalidate non-bcrypt values
    const refreshFilter = {
      $or: [
        { hashedRefreshToken: { $exists: false } },
        {
          hashedRefreshToken: { $type: 'string' },
          $expr: {
            $not: {
              $regexMatch: {
                input: '$hashedRefreshToken',
                regex: '^\\$2[aby]\\$',
              },
            },
          },
        },
      ],
    };

    // 2. Backfill missing resetOtpExpiresAt and clear unexpiring legacy resetOtp
    const otpMissingExpiresFilter = {
      resetOtpExpiresAt: { $exists: false },
    };

    if (dryRun) {
      const [refreshCount, otpCount] = await Promise.all([
        users.countDocuments(refreshFilter),
        users.countDocuments(otpMissingExpiresFilter),
      ]);
      logger.info('v002_dry_run_projection', {
        scope: 'core',
        migrationId: 'v002_user_security_fields',
        details: {
          refreshDocsToUpdate: refreshCount,
          otpDocsToUpdate: otpCount,
        },
      });
      return;
    }

    const refreshRes = await users.updateMany(refreshFilter, {
      $set: { hashedRefreshToken: null },
    });

    const otpRes = await users.updateMany(otpMissingExpiresFilter, {
      $set: { resetOtp: null, resetOtpExpiresAt: null },
    });

    logger.info('v002_backfill_complete', {
      scope: 'core',
      migrationId: 'v002_user_security_fields',
      details: {
        refreshModified: refreshRes.modifiedCount,
        otpModified: otpRes.modifiedCount,
      },
    });
  },
  down: async ({ db, dryRun, logger }) => {
    const users = db.collection('users');
    if (dryRun) {
      return;
    }
    const res = await users.updateMany(
      {},
      { $unset: { hashedRefreshToken: '', resetOtpExpiresAt: '' } },
    );
    logger.info('v002_rollback_complete', {
      scope: 'core',
      migrationId: 'v002_user_security_fields',
      details: { modifiedCount: res.modifiedCount },
    });
  },
};
