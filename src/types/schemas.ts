/**
 * io-ts schemas for runtime type validation
 */

import * as t from 'io-ts';
import { pipe } from 'fp-ts/function';
import { fold, left, right } from 'fp-ts/Either';
import type { Either } from 'fp-ts/Either';
import { PathReporter } from 'io-ts/PathReporter';

// Custom codec for Date
const DateFromNumber = new t.Type<Date, number, unknown>(
  'DateFromNumber',
  (u): u is Date => u instanceof Date,
  (u, c) =>
    pipe(
      t.number.validate(u, c),
      fold(
        () => t.failure(u, c),
        (n) => t.success(new Date(n)),
      ),
    ),
  (a) => a.getTime(),
);

// Database value codec
export const DbValueCodec = t.union([
  t.string,
  t.number,
  t.boolean,
  t.null,
  DateFromNumber,
  new t.Type<Uint8Array, Uint8Array, unknown>(
    'Uint8Array',
    (u): u is Uint8Array => u instanceof Uint8Array,
    (u, c) => u instanceof Uint8Array ? t.success(u) : t.failure(u, c),
    (a) => a,
  ),
]);

// Database record codec
export const DbRecordCodec = t.record(t.string, DbValueCodec);

// Operation type codec
export const OperationTypeCodec = t.union([
  t.literal('INSERT'),
  t.literal('UPDATE'),
  t.literal('DELETE'),
]);

// Change codec
export const ChangeCodec = t.intersection([
  t.type({
    id: t.string,
    table: t.string,
    operation: OperationTypeCodec,
    timestamp: t.number,
    data: DbRecordCodec,
  }),
  t.partial({
    oldData: DbRecordCodec,
  }),
]);

// Conflict codec
export const ConflictCodec = t.type({
  table: t.string,
  key: DbRecordCodec,
  localValue: DbRecordCodec,
  remoteValue: DbRecordCodec,
  localTimestamp: t.number,
  remoteTimestamp: t.number,
});

// Network state codec
export const NetworkStateCodec = t.intersection([
  t.type({
    online: t.boolean,
    type: t.union([
      t.literal('wifi'),
      t.literal('cellular'),
      t.literal('ethernet'),
      t.literal('unknown'),
    ]),
  }),
  t.partial({
    effectiveType: t.union([
      t.literal('4g'),
      t.literal('3g'),
      t.literal('2g'),
      t.literal('slow-2g'),
    ]),
  }),
]);

// Sync config codec (partial for API responses)
export const SyncConfigPartialCodec = t.partial({
  motherduckToken: t.string,
  syncInterval: t.number,
  tables: t.array(t.string),
  batchSize: t.number,
  motherduckApiUrl: t.string,
});

// Query result codec for MotherDuck API
export const QueryResultCodec = t.type({
  rows: t.array(DbRecordCodec),
  metadata: t.partial({
    count: t.number,
    hasMore: t.boolean,
    cursor: t.string,
  }),
});

// API response codecs
export const ApiErrorCodec = t.type({
  error: t.string,
  code: t.string,
  details: t.union([t.string, t.record(t.string, t.unknown)]),
});

// Validation helper
export const validate = <A>(codec: t.Decoder<unknown, A>) => (
  value: unknown,
): Either<Error, A> => {
  return pipe(
    codec.decode(value),
    fold(
      (errors) => {
        const message = PathReporter.report(left(errors)).join('\n');
        return left(new Error(`Validation failed: ${message}`));
      },
      (a) => right(a),
    ),
  );
};

// Type extraction
export type DbValue = t.TypeOf<typeof DbValueCodec>;
export type DbRecord = t.TypeOf<typeof DbRecordCodec>;
export type Change = t.TypeOf<typeof ChangeCodec>;
export type Conflict = t.TypeOf<typeof ConflictCodec>;
export type NetworkState = t.TypeOf<typeof NetworkStateCodec>;
export type QueryResult = t.TypeOf<typeof QueryResultCodec>;