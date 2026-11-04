import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { getDbConfig } from "./config.ts";
import type { DB } from "./types.generated.ts";

/** Creates a Kysely instance for the checkout's database (DB_DATABASE from the root .env). */
export function createDb(): Kysely<DB> {
  const { host, port, user, password, database } = getDbConfig();
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ host, port, user, password, database }) }),
  });
}
