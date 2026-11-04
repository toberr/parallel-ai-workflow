// Test-only helpers, exposed as "@repo/db/testing" (not part of the public API in index.ts).
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import pg from "pg";
import { getDbConfig, getTestDatabaseName } from "./config.ts";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

const provider: MigrationProvider = {
  async getMigrations() {
    const migrations: Record<string, Migration> = {};
    for (const file of await readdir(MIGRATIONS_DIR)) {
      if (!file.endsWith(".ts")) continue;
      migrations[file.slice(0, -3)] = await import(fileURLToPath(new URL(file, MIGRATIONS_DIR)));
    }
    return migrations;
  },
};

function connect(database: string): Kysely<any> {
  const { host, port, user, password } = getDbConfig({ database });
  return new Kysely<any>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ host, port, user, password, database }) }),
  });
}

/**
 * Creates the database named in DB_TEST_DATABASE if it is missing and migrates it to the latest
 * version. Refuses to run if it is the same as DB_DATABASE. Returns the database name.
 */
export async function prepareTestDatabase(): Promise<string> {
  const name = getTestDatabaseName();
  if (name === getDbConfig().database) {
    throw new Error("DB_TEST_DATABASE must differ from DB_DATABASE; tests never touch the development database.");
  }
  const admin = connect("postgres");
  try {
    const exists = await admin
      .selectFrom("pg_database" as any)
      .select("datname")
      .where("datname", "=", name)
      .executeTakeFirst();
    if (!exists) {
      // Identifiers cannot be bound parameters; quote it with Kysely's identifier escaping.
      await sql`create database ${sql.id(name)}`.execute(admin);
    }
  } finally {
    await admin.destroy();
  }

  const db = connect(name);
  try {
    const { error } = await new Migrator({ db, provider, allowUnorderedMigrations: true }).migrateToLatest();
    if (error) throw error;
  } finally {
    await db.destroy();
  }
  return name;
}
