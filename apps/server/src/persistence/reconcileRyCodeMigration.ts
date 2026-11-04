import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import AutoSettleDisabledAt from "./Migrations/054_ProjectionThreadsAutoSettleDisabledAt.ts";

// RyCode used id 54 for reply suggestions before upstream assigned it to auto-settle.
export const reconcileRyCodeMigration = Effect.fn("reconcileRyCodeMigration")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
      `;
      if (tables.length === 0) return [];
      const history = yield* sql`
        SELECT migration_id FROM effect_sql_migrations
        WHERE migration_id = 54 AND name = 'ProjectionThreadReplySuggestion'
      `;
      if (history.length === 0) return [];

      yield* AutoSettleDisabledAt;
      // Keep the reply column and its data; a higher replacement id would skip required V2 migrations.
      yield* sql`
        UPDATE effect_sql_migrations SET name = 'ProjectionThreadsAutoSettleDisabledAt'
        WHERE migration_id = 54 AND name = 'ProjectionThreadReplySuggestion'
      `;
      return [[54, "ProjectionThreadsAutoSettleDisabledAt"]] as const;
    }),
  );
});
