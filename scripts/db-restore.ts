#!/usr/bin/env node
// Restores an SQL dump into the local Postgres container (default: the main database). See `--help`.

import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { confirm, fail, mainRepoRoot } from './lib/common.ts';
import { assertPostgresRunning, DUMP_PREFIX, localDbConfig, newestDump, restoreDump } from './lib/db.ts';

const HELP = `Usage: pnpm db:restore [--file <dump.sql>] [--db <name>] [--yes]
       node scripts/db-restore.ts [--file <dump.sql>] [--db <name>] [--yes]

Drops the target database in the 'postgres' compose service (open connections are closed),
re-creates it and loads the dump into it. Connection details come from the main checkout's
root .env (DB_USER, DB_PASSWORD, DB_DATABASE).

Options:
  --file <path>   Dump to restore (default: the newest dump in db-backups/, ${DUMP_PREFIX}*.sql)
  --db <name>     Target database (default: DB_DATABASE from .env, i.e. the main database)
  -y, --yes       Do not ask for confirmation (required when there is no terminal)
  -h, --help      Show this help

Afterwards run \`pnpm db:migrate\` if the branch has migrations newer than the dump.
Worktree tickets restore their own databases: see \`pnpm wt new --help\`.`;

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      db: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }

  const mainRoot = mainRepoRoot();
  const db = localDbConfig(mainRoot);
  assertPostgresRunning(db);

  const file = values.file ? resolve(values.file) : newestDump(join(mainRoot, 'db-backups'));
  if (!file) throw new Error('No --file given and db-backups/ has no dump. Run `pnpm db:backup` first.');

  const database = values.db ?? db.database;
  if (!values.yes && !(await confirm(`Replace local database '${database}' with '${basename(file)}'?`))) {
    console.log('Aborted (pass --yes to skip the question; it is required without a terminal).');
    process.exitCode = 1;
    return;
  }

  restoreDump(db, { database, file });
  console.log(`Restore completed: '${database}' from '${file}'.`);
}

main().catch(fail);
