#!/usr/bin/env node
// Dumps the local main database (DB_DATABASE) into db-backups/. See `--help`.

import { closeSync, existsSync, mkdirSync, openSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fail, mainRepoRoot } from './lib/common.ts';
import { assertPostgresRunning, compose, DUMP_PREFIX, execArgs, localDbConfig } from './lib/db.ts';

const HELP = `Usage: pnpm db:backup [--out <dir>]
       node scripts/db-backup.ts [--out <dir>]

Dumps the main database (DB_DATABASE from the root .env) with pg_dump, run inside the
'postgres' compose service, into db-backups/${DUMP_PREFIX}<date>-<HHMM>.sql.
Restore it with \`pnpm db:restore\`; new wt tickets (\`pnpm wt new\`) start from the newest one.

Options:
  --out <dir>   Target directory (default: db-backups/ in the main checkout)
  -h, --help    Show this help

The dump stays git-ignored in db-backups/. Do not put dumps of real data into this repository
or share them.`;

function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }

  const mainRoot = mainRepoRoot();
  const db = localDbConfig(mainRoot);
  assertPostgresRunning(db);

  const outDir = values.out ? resolve(values.out) : join(mainRoot, 'db-backups');
  mkdirSync(outDir, { recursive: true });
  // The time keeps a second backup on the same day from replacing a dump that tickets restore
  // from (`wt reset`); an existing file is refused below in any case
  const dumpPath = join(outDir, `${DUMP_PREFIX}${timestamp(new Date())}.sql`);
  // Written under another name and renamed when complete, so a failed or interrupted run never
  // leaves a partial .sql that the restore scripts would pick as the newest dump
  const partialPath = `${dumpPath}.partial`;

  if (existsSync(dumpPath)) throw new Error(`${dumpPath} already exists (wait a minute or use --out).`);
  console.log(`Dumping database '${db.database}' to '${dumpPath}' ...`);
  // 0600: the dump holds the database's data, so only the current user may read it
  const output = openSync(partialPath, 'w', 0o600);
  try {
    // --no-owner / --no-privileges: the restored objects belong to the restoring user
    compose({
      mainRoot,
      args: execArgs(['pg_dump', '--no-owner', '--no-privileges', '-U', db.user, db.database]),
      options: { env: { PGPASSWORD: db.password }, stdio: ['ignore', output, 'inherit'] },
    });
  } catch (error) {
    closeSync(output);
    unlinkSync(partialPath);
    throw error;
  }
  closeSync(output);
  renameSync(partialPath, dumpPath);
  console.log(`Database dump completed: ${dumpPath}`);
}

/** Local date and time for the file name, e.g. 2026-11-03-0739. */
function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

try {
  main();
} catch (error) {
  fail(error);
}
