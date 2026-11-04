// Helpers for the local Postgres container (compose service `postgres`, shared by the main
// checkout and all wt slots), used by db-backup.ts, db-restore.ts and wt.ts. psql and pg_dump
// run inside the container through `docker compose exec`, so no local client tools are needed.
// Compose always runs with the main checkout as working directory: its bind mounts and .env
// resolve there.

import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnvFile, run, type RunOptions, type RunResult } from './common.ts';

export interface LocalDb {
  /** The main checkout, where `docker compose` runs and whose .env holds the settings */
  mainRoot: string;
  user: string;
  password: string;
  /** The main checkout's database (DB_DATABASE) */
  database: string;
  /** The main checkout's test database (DB_TEST_DATABASE) */
  testDatabase: string;
  /** Host port of the proxy (PROXY_PORT, default 80) */
  proxyPort: number;
}

/** Database settings of the main checkout, read from its root .env (nothing from the process env). */
export function localDbConfig(mainRoot: string): LocalDb {
  const file = join(mainRoot, '.env');
  const env = parseEnvFile(file);
  const need = (key: string): string => {
    const value = env.get(key);
    if (!value) throw new Error(`${key} is missing from ${file}. Copy .env.example to .env and set it.`);
    return value;
  };
  const proxyPort = Number(env.get('PROXY_PORT') ?? '80');
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
    throw new Error(`PROXY_PORT in ${file} must be a port number.`);
  }
  return {
    mainRoot,
    user: need('DB_USER'),
    password: need('DB_PASSWORD'),
    database: need('DB_DATABASE'),
    testDatabase: need('DB_TEST_DATABASE'),
    proxyPort,
  };
}

/** `docker compose <args>` in the main checkout. */
export function compose({ mainRoot, args, options = {} }: {
  mainRoot: string;
  args: string[];
  options?: RunOptions;
}): RunResult {
  return run('docker', ['compose', ...args], { cwd: mainRoot, ...options });
}

/** Whether the compose service is running (started, not necessarily healthy). */
export function serviceRunning(mainRoot: string, service: string): boolean {
  const { status, stdout } = compose({
    mainRoot,
    args: ['ps', '--status', 'running', '-q', service],
    options: { capture: true, allowFailure: true },
  });
  return status === 0 && stdout.trim() !== '';
}

export function assertPostgresRunning(db: LocalDb): void {
  if (!serviceRunning(db.mainRoot, 'postgres')) {
    throw new Error(`The postgres service is not running. Start the stack first: docker compose up -d --wait (in ${db.mainRoot})`);
  }
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Arguments of `docker compose exec` for a client tool in the postgres service. The password goes
 * through the environment (`-e PGPASSWORD` copies it from our own), so it never shows up in the
 * process list. `-T` because stdin may be a file and there is no terminal.
 */
export function execArgs(tool: string[]): string[] {
  return ['exec', '-T', '-e', 'PGPASSWORD', 'postgres', ...tool];
}

function psqlTool(db: LocalDb, database: string): string[] {
  return ['psql', '-U', db.user, '-d', database];
}

/** Runs one SQL statement and returns its unaligned output. */
export function psql(db: LocalDb, sql: string, database = 'postgres'): string {
  const { stdout } = compose({
    mainRoot: db.mainRoot,
    args: execArgs([...psqlTool(db, database), '-v', 'ON_ERROR_STOP=1', '-Atc', sql]),
    options: { env: { PGPASSWORD: db.password }, capture: true },
  });
  return stdout.trim();
}

/** Drops a database, closing any open connections (e.g. a running dev server) first. */
export function dropDatabase(db: LocalDb, name: string): void {
  psql(db, `DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
}

export function createDatabase(db: LocalDb, name: string): void {
  psql(db, `CREATE DATABASE ${quoteIdent(name)}`);
}

// pg_dump ends a complete plain-format dump with this comment
const DUMP_COMPLETE_MARKER = 'PostgreSQL database dump complete';

/** Whether the end of the file carries pg_dump's completion marker (a truncated dump does not). */
function dumpIsComplete(file: string): boolean {
  const size = statSync(file).size;
  const length = Math.min(size, 4096);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8').includes(DUMP_COMPLETE_MARKER);
}

/** Replaces `database` with the contents of an SQL dump. */
export function restoreDump(db: LocalDb, { database, file }: { database: string; file: string }): void {
  if (!existsSync(file)) throw new Error(`Dump file not found: ${file}`);
  // Checked before anything is dropped, so a cut-off file cannot destroy a working database
  if (!dumpIsComplete(file)) {
    throw new Error(`Dump '${file}' is incomplete (it does not end with pg_dump's completion marker). Nothing was changed; create a new dump with \`pnpm db:backup\`.`);
  }

  console.log(`Dropping and re-creating '${database}' ...`);
  dropDatabase(db, database);
  createDatabase(db, database);

  console.log(`Restoring '${file}' into '${database}' ...`);
  const input = openSync(file, 'r');
  try {
    // -q and the ignored stdout keep the thousands of `SET` / `CREATE TABLE` lines out of the
    // console; errors still arrive on stderr. ON_ERROR_STOP makes psql stop at the first error
    // with a non-zero exit, so an incompatible dump fails instead of leaving a half-loaded
    // database that looks restored
    const { status } = compose({
      mainRoot: db.mainRoot,
      args: execArgs([...psqlTool(db, database), '-q', '-v', 'ON_ERROR_STOP=1']),
      options: { env: { PGPASSWORD: db.password }, stdio: [input, 'ignore', 'inherit'], allowFailure: true },
    });
    if (status !== 0) {
      throw new Error(
        `Restoring '${file}' stopped at an SQL error (psql exit code ${status}, see above); ` +
          `database '${database}' is incomplete. Check the dump, or restore another one.`,
      );
    }
  } finally {
    closeSync(input);
  }
}

// File name prefix of the dumps written by db-backup.ts
export const DUMP_PREFIX = 'dump-app-dev-';

/** The most recently modified dump (`dump-app-dev-*.sql`) in `dir`, or undefined. */
export function newestDump(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter((name) => name.startsWith(DUMP_PREFIX) && name.endsWith('.sql'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
