import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const REQUIRED = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_DATABASE"] as const;

export type DbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

/** The repository root's .env (packages/db/src -> repository root). */
const ROOT_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

function readEnv(): Record<string, string | undefined> {
  const fromFile = existsSync(ROOT_ENV_FILE) ? parseEnv(readFileSync(ROOT_ENV_FILE, "utf8")) : {};
  // Process env wins over the file.
  return { ...fromFile, ...process.env };
}

/**
 * Connection settings from DB_* (root .env, process env wins). `database` overrides
 * DB_DATABASE. Stops with a clear message if a setting is missing or invalid.
 */
export function getDbConfig(options: { database?: string } = {}): DbConfig {
  const env = readEnv();
  const missing = REQUIRED.filter((key) => key !== "DB_DATABASE" || !options.database)
    .filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing database settings: ${missing.join(", ")}. Copy .env.example to .env in the repository root (${ROOT_ENV_FILE}) and set them.`,
    );
  }
  const port = Number(env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DB_PORT must be a port number, got "${env.DB_PORT}".`);
  }
  return {
    host: env.DB_HOST!,
    port,
    user: env.DB_USER!,
    password: env.DB_PASSWORD!,
    database: options.database ?? env.DB_DATABASE!,
  };
}

/** DB_TEST_DATABASE from the same sources; stops with a clear message if it is missing. */
export function getTestDatabaseName(): string {
  const name = readEnv().DB_TEST_DATABASE;
  if (!name) {
    throw new Error(`Missing database setting: DB_TEST_DATABASE (root .env: ${ROOT_ENV_FILE}).`);
  }
  return name;
}
