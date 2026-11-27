import type { Db } from 'mongodb';

export type MigrationDatabaseScope = 'core' | 'planning';

export type MigrationStatus = 'running' | 'applied' | 'failed' | 'rolled_back';

export type MigrationIdempotencyKind = 'idempotent' | 'non_idempotent';

export interface MigrationErrorRecord {
  message: string;
  name?: string;
  code?: string | number;
  stack?: string;
}

export interface MigrationHistoryDocument {
  _id: string;
  version: string;
  name: string;
  database: MigrationDatabaseScope;
  checksum: string;
  idempotency: MigrationIdempotencyKind;
  reversible: boolean;
  status: MigrationStatus;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  runnerId: string;
  error: MigrationErrorRecord | null;
}

export interface MigrationLockDocument {
  _id: string;
  ownerId: string;
  scope: MigrationDatabaseScope;
  acquiredAt: Date;
  expiresAt: Date;
  pid: number;
  hostname: string;
}

export interface MigrationLogEvent {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  component: 'MigrationRunner';
  event: string;
  scope?: MigrationDatabaseScope;
  migrationId?: string;
  version?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface MigrationLogger {
  info(
    event: string,
    meta?: Partial<
      Omit<MigrationLogEvent, 'timestamp' | 'level' | 'component' | 'event'>
    >,
  ): void;
  warn(
    event: string,
    meta?: Partial<
      Omit<MigrationLogEvent, 'timestamp' | 'level' | 'component' | 'event'>
    >,
  ): void;
  error(
    event: string,
    meta?: Partial<
      Omit<MigrationLogEvent, 'timestamp' | 'level' | 'component' | 'event'>
    >,
  ): void;
}

export function redactSensitiveString(input: string): string {
  return input.replace(
    /mongodb(\+srv)?:\/\/([^:@/\s]+):([^@/\s]+)@/gi,
    'mongodb$1://$2:***@',
  );
}

export class JsonMigrationLogger implements MigrationLogger {
  constructor(private readonly silent = false) {}

  info(
    event: string,
    meta: Partial<
      Omit<MigrationLogEvent, 'timestamp' | 'level' | 'component' | 'event'>
    > = {},
  ): void {
    this.emit('INFO', event, meta);
  }

  warn(
    event: string,
    meta: Partial<
      Omit<MigrationLogEvent, 'timestamp' | 'level' | 'component' | 'event'>
    > = {},
  ): void {
    this.emit('WARN', event, meta);
  }

  error(
    event: string,
    meta: Partial<
      Omit<MigrationLogEvent, 'timestamp' | 'level' | 'component' | 'event'>
    > = {},
  ): void {
    this.emit('ERROR', event, meta);
  }

  private emit(
    level: MigrationLogEvent['level'],
    event: string,
    meta: Partial<
      Omit<MigrationLogEvent, 'timestamp' | 'level' | 'component' | 'event'>
    >,
  ): void {
    if (this.silent) return;
    const payload: MigrationLogEvent = {
      timestamp: new Date().toISOString(),
      level,
      component: 'MigrationRunner',
      event,
      ...meta,
    };
    const serialized = redactSensitiveString(JSON.stringify(payload));
    if (level === 'ERROR') {
      console.error(serialized);
    } else if (level === 'WARN') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }
}

export interface MigrationContext {
  db: Db;
  scope: MigrationDatabaseScope;
  dryRun: boolean;
  runnerId: string;
  logger: MigrationLogger;
}

export interface MigrationDefinition {
  id: string;
  version: string;
  name: string;
  database: MigrationDatabaseScope;
  idempotency: MigrationIdempotencyKind;
  reversible: boolean;
  description?: string;
  up: (ctx: MigrationContext) => Promise<void>;
  down?: (ctx: MigrationContext) => Promise<void>;
}

export class MigrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationValidationError';
  }
}

export class DuplicateMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateMigrationError';
  }
}

export class MigrationLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationLockError';
  }
}

export class IncompleteMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteMigrationError';
  }
}

export class IrreversibleMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IrreversibleMigrationError';
  }
}
