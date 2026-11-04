import { PostgresDialect } from "kysely";
import { defineConfig } from "kysely-ctl";
import pg from "pg";
import { getDbConfig } from "./src/config.ts";

const { host, port, user, password, database } = getDbConfig();

export default defineConfig({
  dialect: new PostgresDialect({ pool: new pg.Pool({ host, port, user, password, database }) }),
  migrations: {
    migrationFolder: "src/migrations",
    // Branches are merged in any order, so an older migration may arrive after a newer one.
    allowUnorderedMigrations: true,
  },
});
