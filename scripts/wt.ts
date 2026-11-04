#!/usr/bin/env node
// Parallel ticket work with git worktrees: one "slot" per ticket with its own worktree,
// databases, ports and URL. The postgres and caddy containers of the main checkout are shared.
// Run `node scripts/wt.ts --help`.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import {
  confirm,
  fail,
  isPortOpen,
  isProcessAlive,
  mainRepoRoot,
  run,
  spawnBackground,
  stopProcessTree,
  upsertEnvFile,
  waitForPorts,
  type Env,
} from './lib/common.ts';
import {
  assertPostgresRunning,
  compose,
  dropDatabase,
  localDbConfig,
  newestDump,
  restoreDump,
  serviceRunning,
  type LocalDb,
} from './lib/db.ts';

// Slot N uses the API port 4000+N*100 and the web port 3000+N*100 (slot 0 is the main checkout)
const MAX_SLOTS = 9;
const API_BASE_PORT = 4000;
const WEB_BASE_PORT = 3000;
const SERVICES = ['postgres', 'caddy'] as const;
// wt-state.json is locked only while it is read and written, so a longer wait means a hung process
const STATE_LOCK_TIMEOUT_MS = 10_000;
// How long `dev` waits for the servers to listen, and `park` for the ports to close
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 15_000;

const mainRoot = mainRepoRoot();
const wtRoot = resolve(process.env.WT_ROOT ?? join(mainRoot, '..', 'wt'));
const statePath = join(wtRoot, 'wt-state.json');

/**
 * Variables that must not reach commands run inside a worktree: the process environment beats
 * the worktree's own .env in `@repo/db` and in the apps, so inheriting these from wt's own
 * environment would point a slot at another checkout's database or port.
 */
const WORKTREE_ENV: Env = { DB_DATABASE: undefined, DB_TEST_DATABASE: undefined, PORT: undefined };

const HELP = `Usage: pnpm wt <command> [options]
       node scripts/wt.ts <command> [options]

Work on several tickets in parallel. Each ticket gets a git worktree in <WT_ROOT>/<ticket>/,
its own databases (restored from a dump), its own API and web ports and its own URL. The
postgres and caddy containers of the main checkout are shared by all slots. Run it from the
main checkout (or any worktree; Docker Compose always runs in the main checkout).

Commands:
  new <branch> [--base <ref>] [--dump <file>] [--slot N] [--name <ticket>]
                                      Create worktree, databases, env files and the Caddy route
  dev <ticket>                        Start the API and web dev servers in the background
  park <ticket>                       Stop the dev servers (keeps worktree and databases)
  reset <ticket> [--latest] [--yes]   Restore both ticket databases from the dump again
  rm <ticket> [--yes]                 Remove processes, databases, Caddy route and worktree
  ls                                  List tickets with slot, branch, server status and URL
  info <ticket>                       Print the ticket's status block and working rules (Markdown)
  claude-access                       Let Claude sessions of the main checkout edit WT_ROOT
  help [command]                      Show this help, or a command's (same as <command> --help)

Slot N (1-${MAX_SLOTS}):
  URL        http://sN.localhost (with :<PROXY_PORT> when that is not 80)
  API        host port ${API_BASE_PORT}+N*100, reached through the URL under /api
  web        host port ${WEB_BASE_PORT}+N*100
  databases  app_wt_<ticket> and app_wt_<ticket>_test (hyphens become underscores)

The *.localhost names resolve in browsers only; host tools (curl, Node) use the ports.

Databases: \`new\` restores the newest dump in db-backups/ (written by \`pnpm db:backup\`) or
the one given with --dump into both databases and then runs \`pnpm db:migrate\` in the
worktree. \`reset\` restores the ticket's own dump again, so its starting point stays fixed;
\`reset --latest\` takes the newest one.

Environment:
  WT_ROOT   Folder for the ticket folders (default: <parent of the main checkout>/wt)

Prerequisites: the stack is up (\`docker compose up -d --wait\`) and db-backups/ holds a dump.`;

// ---------------------------------------------------------------------------------------------
// Types

type ServerKey = 'api' | 'web';
const SERVER_KEYS: ServerKey[] = ['api', 'web'];

/** One ticket as stored in wt-state.json */
interface Ticket {
  name: string;
  branch: string;
  slot: number;
  database: string;
  testDatabase: string;
  /** The git worktree */
  worktree: string;
  /** Dump the databases were restored from; `reset` restores it again */
  dump: string;
  /** Whether `new` created the branch (rolled back with the ticket if `new` fails) */
  createdBranch: boolean;
  createdAt: string;
  /** PIDs (process group leaders) of the running dev servers; used only for stopping them */
  processes: Partial<Record<ServerKey, number>>;
}

interface State {
  tickets: Record<string, Ticket>;
}

type Values = Record<string, string | boolean | undefined>;

interface Command {
  options: ParseArgsOptionsConfig;
  help: string;
  run(input: { values: Values; positionals: string[] }): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// State, naming and slot layout

function loadState(): State {
  return existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as State) : { tickets: {} };
}

/**
 * Applies `change` to the state as it is on disk now and saves it, under a lock file. Commands
 * (and several sessions) run concurrently and a command can take minutes, so none of them writes
 * back the copy it read at its start: each write re-reads the file and changes only its own
 * part. The lock is held for the read and write only.
 */
function updateState<T>(change: (state: State) => T): T {
  mkdirSync(wtRoot, { recursive: true });
  const lockPath = `${statePath}.lock`;
  const deadline = Date.now() + STATE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // A lock left behind by a killed wt process is removed
      let holder = Number.NaN;
      try {
        holder = Number(readFileSync(lockPath, 'utf8'));
      } catch {
        continue; // released in the meantime
      }
      if (!isProcessAlive(holder)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`${statePath} stays locked by another wt process (${lockPath}).`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    const state = loadState();
    const result = change(state);
    // Written next to the file and renamed, so a reader never sees a half-written file
    const temp = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temp, statePath);
    return result;
  } finally {
    rmSync(lockPath, { force: true });
  }
}

/** Applies `change` to the ticket's current state on disk (if it still exists). */
function updateTicket(name: string, change: (ticket: Ticket) => void): void {
  updateState((state) => {
    const ticket = state.tickets[name];
    if (ticket) change(ticket);
  });
}

function getTicket(name: string | undefined): Ticket {
  const state = loadState();
  const ticket = name ? state.tickets[name] : undefined;
  if (!ticket) {
    const known = Object.keys(state.tickets).join(', ') || 'none';
    throw new Error(`Unknown ticket '${name ?? ''}' (known: ${known}). See \`pnpm wt ls\`.`);
  }
  return ticket;
}

const TICKET_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The last segment of the branch (`feature/demo-one` gives `demo-one`). */
function ticketNameFromBranch(branch: string): string {
  return branch.split('/').pop() ?? branch;
}

function assertTicketName(name: string): void {
  if (!TICKET_NAME.test(name) || name.length > 40) {
    throw new Error(
      `Invalid ticket name '${name}': lowercase letters, digits and single hyphens, at most 40 characters. ` +
        'Pass --name <ticket> to choose one.',
    );
  }
}

function ticketDir(name: string): string {
  return join(wtRoot, name);
}

function logFile(ticket: Ticket, key: ServerKey): string {
  return join(ticketDir(ticket.name), 'logs', `${key}.log`);
}

function dbConfig(): LocalDb {
  return localDbConfig(mainRoot);
}

function slotInfo(slot: number) {
  const proxyPort = dbConfig().proxyPort;
  return {
    apiPort: API_BASE_PORT + slot * 100,
    webPort: WEB_BASE_PORT + slot * 100,
    host: `s${slot}.localhost`,
    // The Caddy site address has no port (Caddy ignores the port of the Host header), but the
    // URL a browser needs does when the proxy is published on another host port than 80
    url: `http://s${slot}.localhost${proxyPort === 80 ? '' : `:${proxyPort}`}`,
  };
}

function serverPort(ticket: Ticket, key: ServerKey): number {
  const s = slotInfo(ticket.slot);
  return key === 'api' ? s.apiPort : s.webPort;
}

function databaseNames(name: string): { database: string; testDatabase: string } {
  const base = `app_wt_${name.replace(/-/g, '_')}`;
  return { database: base, testDatabase: `${base}_test` };
}

// ---------------------------------------------------------------------------------------------
// Docker / Caddy

/** Starts the postgres and caddy services of the main checkout when they are not running. */
function ensureStack(): void {
  const stopped = SERVICES.filter((service) => !serviceRunning(mainRoot, service));
  if (!stopped.length) return;
  console.log(`\nStarting shared services: ${stopped.join(', ')} ...`);
  compose({ mainRoot, args: ['up', '-d', '--wait', ...stopped] });
}

function siteFile(slot: number): string {
  return join(mainRoot, 'dev-proxy', 'sites', `s${slot}.caddy`);
}

function writeCaddySite(ticket: Ticket): void {
  const s = slotInfo(ticket.slot);
  const site = `# Generated by scripts/wt.ts for slot ${ticket.slot} - do not edit.
http://${s.host} {
\thandle /api/* {
\t\treverse_proxy host.docker.internal:${s.apiPort}
\t}
\thandle {
\t\treverse_proxy host.docker.internal:${s.webPort}
\t}
}
`;
  mkdirSync(join(mainRoot, 'dev-proxy', 'sites'), { recursive: true });
  writeFileSync(siteFile(ticket.slot), site);
}

/** Makes a running Caddy pick up changed site files. */
function reloadCaddy(): void {
  if (!serviceRunning(mainRoot, 'caddy')) return;
  compose({
    mainRoot,
    args: ['exec', '-T', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile'],
    options: { capture: true },
  });
}

// ---------------------------------------------------------------------------------------------
// Git worktrees and generated files

function git(args: string[], options: { cwd?: string; allowFailure?: boolean; capture?: boolean } = {}) {
  return run('git', ['-C', options.cwd ?? mainRoot, ...args], options);
}

function refExists(ref: string): boolean {
  return git(['show-ref', '--verify', '--quiet', ref], { capture: true, allowFailure: true }).status === 0;
}

function commitExists(ref: string): boolean {
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { capture: true, allowFailure: true }).status === 0;
}

/** The start point of a new branch: `--base` as given, else `main`, else the current HEAD. */
function resolveBase(requested: string | undefined): string {
  const ref = requested ?? (commitExists('main') ? 'main' : 'HEAD');
  if (!commitExists(ref)) throw new Error(`Base '${ref}' not found in ${mainRoot}.`);
  return ref;
}

/**
 * Checks `branch` out into a new worktree: an existing local branch as it is, else origin's,
 * else a new branch from `base`. Returns whether the branch was created.
 */
function addWorktree({ path, branch, base }: { path: string; branch: string; base: string }): boolean {
  if (refExists(`refs/heads/${branch}`)) {
    git(['worktree', 'add', path, branch]);
    console.log(`Branch '${branch}' already exists; checked out as it is (base not used).`);
    return false;
  }
  if (refExists(`refs/remotes/origin/${branch}`)) {
    git(['worktree', 'add', '--track', '-b', branch, path, `origin/${branch}`]);
    return true;
  }
  // --no-track: the new branch must not get its base as upstream
  git(['worktree', 'add', '--no-track', '-b', branch, path, base]);
  return true;
}

/** The generated, git-ignored env files of the worktree (see the plan: DB settings in the root .env only). */
function writeEnvFiles(ticket: Ticket): void {
  const s = slotInfo(ticket.slot);
  const header = `# --- wt slot ${ticket.slot} (scripts/wt.ts) ---`;
  const rootEnv = join(mainRoot, '.env');
  if (!existsSync(rootEnv)) throw new Error(`${rootEnv} is missing. Copy .env.example to .env and set it.`);
  const target = join(ticket.worktree, '.env');
  // Everything else (DB_HOST, DB_PORT, credentials, PROXY_PORT, ...) stays as in the main checkout
  copyFileSync(rootEnv, target);
  upsertEnvFile({
    path: target,
    updates: { DB_DATABASE: ticket.database, DB_TEST_DATABASE: ticket.testDatabase },
    header,
  });
  writeFileSync(join(ticket.worktree, 'apps', 'api', '.env'), `${header}\nPORT=${s.apiPort}\n`);
  writeFileSync(join(ticket.worktree, 'apps', 'web', '.env.local'), `${header}\nPORT=${s.webPort}\n`);
}

/** `pnpm <args>` in the worktree, without database or port variables from wt's own environment. */
function pnpm(ticket: Ticket, args: string[]): void {
  run('pnpm', args, { cwd: ticket.worktree, env: WORKTREE_ENV });
}

function ticketMarkdown(ticket: Ticket): string {
  const s = slotInfo(ticket.slot);
  const n = ticket.name;
  return `# Worktree ticket \`${n}\` (slot ${ticket.slot})

Generated by \`scripts/wt.ts\` in the main checkout \`${mainRoot}\`.
Current version: \`pnpm wt info ${n}\` (run in the main checkout).

| | |
|---|---|
| Branch | \`${ticket.branch}\` |
| Worktree | \`${ticket.worktree}\` |
| URL | ${s.url} (API under ${s.url}/api) |
| Ports (host processes, curl) | API http://localhost:${s.apiPort}, web http://localhost:${s.webPort} |
| Databases | \`${ticket.database}\` and \`${ticket.testDatabase}\` in the shared \`postgres\` service, restored from \`${ticket.dump}\` |
| Dev server logs | \`${join(ticketDir(n), 'logs')}\` (api.log, web.log) |

## Working rules for this ticket

The main CLAUDE.md describes the main checkout. For this ticket these rules replace it where they differ:

- Edit and create files only under the worktree path above. The main checkout stays on \`main\`
  and is not edited for this ticket.
- Run git as \`git -C ${ticket.worktree} ...\` and pnpm commands as \`cd ${ticket.worktree} && pnpm ...\`,
  never bare in the main checkout. Commands there read the worktree's own \`.env\` (database names)
  and \`apps/*/.env\` files (ports); do not export \`DB_DATABASE\`, \`DB_TEST_DATABASE\` or \`PORT\` in the shell.
- The dev servers run only after \`pnpm wt dev ${n}\`; check \`pnpm wt ls\` first. They are
  stopped with \`pnpm wt park ${n}\`.
- postgres and caddy are shared with every other checkout: do not run \`docker compose down\`
  or \`docker compose restart\`, and do not touch other slots' databases.
- Run \`pnpm db:migrate\` in the worktree after a pull or merge that brings in migrations. The
  generated files (\`types.generated.ts\`, \`openapi.json\`, the web's API types) are git-ignored,
  recreated by \`db:migrate\` and the \`dev\`/\`build\`/\`test\`/\`typecheck\` scripts, and never edited.
- Resetting the databases (\`pnpm wt reset ${n}\`) discards the ticket's data: ask first.
`;
}

function writeTicketFiles(ticket: Ticket): void {
  const dir = ticketDir(ticket.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.local.md'), ticketMarkdown(ticket));
  const folders = [{ path: relative(dir, ticket.worktree) }];
  writeFileSync(join(dir, `${ticket.name}.code-workspace`), `${JSON.stringify({ folders, settings: {} }, null, 2)}\n`);
}

interface ClaudeSettings {
  permissions?: { additionalDirectories?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Adds WT_ROOT to `permissions.additionalDirectories` in the main checkout's git-ignored
 * .claude/settings.local.json, so Claude sessions started there may work in the worktrees.
 * Each developer's own resolved WT_ROOT is written, nothing machine-specific is versioned.
 */
function ensureClaudeAccess(): boolean {
  const path = join(mainRoot, '.claude', 'settings.local.json');
  const settings: ClaudeSettings = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ClaudeSettings) : {};
  settings.permissions ??= {};
  const directories = (settings.permissions.additionalDirectories ??= []);
  if (directories.some((entry) => resolve(entry) === wtRoot)) return false;
  directories.push(wtRoot);
  mkdirSync(join(mainRoot, '.claude'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`Claude: added ${wtRoot} to the additional directories in .claude/settings.local.json`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Dev servers: running = the port accepts connections; the stored PID is used only for stopping

/** Which of the ticket's servers have a listening port. */
async function runningServers(ticket: Ticket): Promise<ServerKey[]> {
  const open = await Promise.all(SERVER_KEYS.map((key) => isPortOpen(serverPort(ticket, key))));
  return SERVER_KEYS.filter((_, i) => open[i]);
}

/**
 * Starts the servers that are not listening yet, each in its own process group with its output
 * in <WT_ROOT>/<ticket>/logs/. `pnpm --filter <app> dev` is started in the worktree; the group
 * holds pnpm, the shell, tsx / next and their workers, so stopping the group stops everything.
 */
async function startServers(ticket: Ticket): Promise<void> {
  if (!existsSync(join(ticket.worktree, 'node_modules'))) {
    throw new Error(`${ticket.worktree} has no node_modules. Run \`pnpm install\` there first.`);
  }
  const running = await runningServers(ticket);
  const todo = SERVER_KEYS.filter((key) => !running.includes(key));
  for (const key of running) console.log(`${key}: already running on port ${serverPort(ticket, key)}`);
  if (!todo.length) return;
  // The same generated files as the root `dev` script writes first
  pnpm(ticket, ['openapi']);
  for (const key of todo) {
    const pid = spawnBackground({
      cmd: 'pnpm',
      args: ['--filter', key, 'dev'],
      cwd: ticket.worktree,
      env: WORKTREE_ENV,
      logFile: logFile(ticket, key),
    });
    ticket.processes[key] = pid;
    updateTicket(ticket.name, (saved) => {
      saved.processes[key] = pid;
    });
    console.log(`${key}: started (PID ${pid}), port ${serverPort(ticket, key)}, log: ${logFile(ticket, key)}`);
  }
  const ports = todo.map((key) => serverPort(ticket, key));
  const closed = await waitForPorts({ ports, want: 'open', timeoutMs: START_TIMEOUT_MS });
  if (closed.length) {
    console.warn(`Warning: port(s) ${closed.join(', ')} not listening after ${START_TIMEOUT_MS / 1000}s; see the logs.`);
    process.exitCode = 1;
  }
}

/**
 * Stops the stored process groups, waits until both ports are closed and reports ports that stay
 * open. Returns the servers that were running before.
 */
async function stopServers(ticket: Ticket): Promise<ServerKey[]> {
  const was = await runningServers(ticket);
  for (const key of SERVER_KEYS) {
    const pid = ticket.processes[key];
    if (pid === undefined) continue;
    await stopProcessTree({ pid });
    console.log(`${key}: stopped (PID ${pid})`);
  }
  ticket.processes = {};
  updateTicket(ticket.name, (saved) => {
    saved.processes = {};
  });
  const ports = SERVER_KEYS.map((key) => serverPort(ticket, key));
  const open = await waitForPorts({ ports, want: 'closed', timeoutMs: STOP_TIMEOUT_MS });
  if (open.length) {
    console.warn(
      `Warning: port(s) ${open.join(', ')} of '${ticket.name}' stay open: another process holds them (not started by \`wt dev\`, or its PID is not stored). Nothing else was killed.`,
    );
    process.exitCode = 1;
  }
  return was;
}

/** The ticket's live status in a few lines. Printed at the end of `new` and `dev`, and first by `info`. */
async function ticketSummary(ticket: Ticket): Promise<string> {
  const s = slotInfo(ticket.slot);
  const running = await runningServers(ticket);
  const status = (key: ServerKey): string => {
    const pid = ticket.processes[key];
    return running.includes(key) ? `up${pid ? ` (PID ${pid})` : ''}` : 'not running';
  };
  const caddy = serviceRunning(mainRoot, 'caddy') ? '' : ' (caddy service not running)';
  const rows: [string, string][] = [
    ['URL', s.url],
    ['API', `${s.url}/api/tickets   host port ${s.apiPort}   ${status('api')}`],
    ['Web', `${s.url}   host port ${s.webPort}   ${status('web')}`],
    ['Databases', `${ticket.database}, ${ticket.testDatabase}`],
    ['Caddy', `${s.host} -> host.docker.internal:${s.apiPort} (/api/*), :${s.webPort}${caddy}`],
    ['Worktree', ticket.worktree],
    ['Logs', join(ticketDir(ticket.name), 'logs')],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`);
  return [`Ticket ${ticket.name} - slot ${ticket.slot} - branch ${ticket.branch}`, ...lines].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Commands

async function confirmOrAbort(yes: boolean | undefined, question: string): Promise<boolean> {
  if (yes || (await confirm(question))) return true;
  console.log('Aborted (pass --yes to skip the question; it is required without a terminal).');
  process.exitCode = 1;
  return false;
}

/** The dump file to restore: `dumpOption`, else the newest dump in db-backups/. */
function resolveDump(dumpOption: string | undefined): string {
  const file = dumpOption ? resolve(dumpOption) : newestDump(join(mainRoot, 'db-backups'));
  if (!file) throw new Error('db-backups/ has no dump. Run `pnpm db:backup` or pass --dump <file>.');
  if (!existsSync(file)) throw new Error(`Dump file not found: ${file}`);
  return file;
}

/** `requested` if it is free, else the lowest free slot. A slot is taken when it is in the state or its ports are open. */
function pickSlot({ state, requested, busy }: { state: State; requested: number | undefined; busy: Map<number, number> }): number {
  const used = new Set(Object.values(state.tickets).map((ticket) => ticket.slot));
  if (requested !== undefined) {
    if (used.has(requested)) throw new Error(`Slot ${requested} is in use.`);
    if (busy.has(requested)) throw new Error(`Port ${busy.get(requested)} of slot ${requested} is in use by another process.`);
    return requested;
  }
  const free = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).find((slot) => !used.has(slot) && !busy.has(slot));
  if (!free) throw new Error(`No free slot left (1-${MAX_SLOTS}; slots whose ports are in use count as taken). See \`pnpm wt ls\`.`);
  return free;
}

/** Slots whose API or web port already accepts connections (e.g. another project's dev server), with the port found open. */
async function busySlots(): Promise<Map<number, number>> {
  const busy = new Map<number, number>();
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    for (const port of [API_BASE_PORT + slot * 100, WEB_BASE_PORT + slot * 100]) {
      if (await isPortOpen(port)) {
        busy.set(slot, port);
        break;
      }
    }
  }
  return busy;
}

/**
 * Removes the ticket's dev processes, databases, Caddy route, worktree, folder and state entry;
 * its branch stays. `rollback` (a `new` that failed half-way) carries on past steps that fail,
 * since some parts may not exist yet, force-removes the worktree and deletes the branch if `new`
 * created it (it has no commits of its own then).
 */
async function removeTicket(ticket: Ticket, { rollback = false } = {}): Promise<void> {
  const step = async (action: () => void | Promise<void>): Promise<void> => {
    if (!rollback) return action();
    try {
      await action();
    } catch (error) {
      console.warn(`Warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await step(async () => void (await stopServers(ticket)));
  await step(() => {
    ensureStack();
    const db = dbConfig();
    dropDatabase(db, ticket.database);
    dropDatabase(db, ticket.testDatabase);
  });
  await step(() => {
    rmSync(siteFile(ticket.slot), { force: true });
    reloadCaddy();
  });
  await step(() => {
    if (existsSync(ticket.worktree)) git(['worktree', 'remove', ...(rollback ? ['--force'] : []), ticket.worktree]);
    git(['worktree', 'prune']);
  });
  if (rollback && ticket.createdBranch) await step(() => void git(['branch', '-D', ticket.branch]));

  const dir = ticketDir(ticket.name);
  if (dir.startsWith(wtRoot + sep)) rmSync(dir, { recursive: true, force: true });
  updateState((state) => {
    delete state.tickets[ticket.name];
  });
}

const NEW_OPTIONS = {
  name: { type: 'string' },
  slot: { type: 'string' },
  base: { type: 'string' },
  dump: { type: 'string' },
} as const satisfies ParseArgsOptionsConfig;

async function cmdNew({ values, positionals }: { values: Values; positionals: string[] }): Promise<void> {
  const [branch] = positionals;
  if (!branch) throw new Error('Missing <branch>. Example: pnpm wt new feature/demo-one');
  git(['check-ref-format', '--branch', branch], { capture: true });

  const name = (values.name as string | undefined) ?? ticketNameFromBranch(branch);
  assertTicketName(name);
  const requestedSlot = values.slot === undefined ? undefined : Number(values.slot);
  if (requestedSlot !== undefined && !(Number.isInteger(requestedSlot) && requestedSlot >= 1 && requestedSlot <= MAX_SLOTS)) {
    throw new Error(`--slot must be 1-${MAX_SLOTS}.`);
  }
  const assertNew = (state: State): void => {
    if (state.tickets[name] || existsSync(ticketDir(name))) {
      throw new Error(`Ticket '${name}' already exists (${ticketDir(name)}). Pick another --name or remove it first.`);
    }
  };
  assertNew(loadState());

  ensureStack();
  assertPostgresRunning(dbConfig());
  const dump = resolveDump(values.dump as string | undefined);
  const base = resolveBase(values.base as string | undefined);
  const busy = await busySlots();
  pickSlot({ state: loadState(), requested: requestedSlot, busy });

  ensureClaudeAccess();
  const { database, testDatabase } = databaseNames(name);
  // Reserved under the state lock, so two concurrent `new` runs never get the same slot
  const ticket = updateState((state): Ticket => {
    assertNew(state);
    const reserved: Ticket = {
      name,
      branch,
      slot: pickSlot({ state, requested: requestedSlot, busy }),
      database,
      testDatabase,
      worktree: join(ticketDir(name), basename(mainRoot)),
      dump,
      createdBranch: false,
      createdAt: new Date().toISOString(),
      processes: {},
    };
    state.tickets[name] = reserved;
    return reserved;
  });

  // A failure while the ticket is set up removes everything created so far (including the
  // branch if it was created here), so `new` can simply be run again. If that clean-up fails
  // as well, the ticket stays in the state and `rm <ticket> --yes` finishes it.
  try {
    mkdirSync(ticketDir(name), { recursive: true });
    console.log(`\nWorktree: ${ticket.worktree} (${ticket.branch}, base ${base})`);
    ticket.createdBranch = addWorktree({ path: ticket.worktree, branch, base });
    updateTicket(name, (saved) => {
      saved.createdBranch = ticket.createdBranch;
    });

    writeEnvFiles(ticket);
    pnpm(ticket, ['install', '--frozen-lockfile']);

    const db = dbConfig();
    for (const target of [database, testDatabase]) {
      console.log(`\nDatabase: ${target}`);
      restoreDump(db, { database: target, file: dump });
    }
    // Migrations that exist only on this branch are applied to this slot's database only; the
    // command also generates the database types
    pnpm(ticket, ['db:migrate']);
    pnpm(ticket, ['openapi']);

    writeCaddySite(ticket);
    reloadCaddy();
    writeTicketFiles(ticket);
  } catch (error) {
    console.error(`\nCreating ticket '${name}' failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Removing what was created so far ...');
    await removeTicket(ticket, { rollback: true });
    throw new Error(`Ticket '${name}' was not created (see above); fix the cause and run \`new\` again.`);
  }

  console.log(`
${await ticketSummary(ticket)}

Next: pnpm wt dev ${name}
Claude: /wt ${name}`);
}

async function cmdDev({ positionals }: { values: Values; positionals: string[] }): Promise<void> {
  const ticket = getTicket(positionals[0]);
  ensureStack();
  writeCaddySite(ticket);
  reloadCaddy();
  await startServers(ticket);
  console.log(`\n${await ticketSummary(getTicket(ticket.name))}`);
}

async function cmdPark({ positionals }: { values: Values; positionals: string[] }): Promise<void> {
  const ticket = getTicket(positionals[0]);
  await stopServers(ticket);
  console.log(`\nTicket '${ticket.name}' parked; \`pnpm wt dev ${ticket.name}\` starts it again.`);
}

const RESET_OPTIONS = {
  yes: { type: 'boolean', short: 'y' },
  latest: { type: 'boolean' },
} as const satisfies ParseArgsOptionsConfig;

async function cmdReset({ values, positionals }: { values: Values; positionals: string[] }): Promise<void> {
  const ticket = getTicket(positionals[0]);

  // By default the ticket keeps its own starting point; --latest chooses the newest dump
  let dump = ticket.dump;
  if (values.latest) {
    dump = resolveDump(undefined);
  } else if (!existsSync(dump)) {
    throw new Error(`The ticket's dump ${dump} no longer exists. Use --latest.`);
  }
  const question = `Replace databases '${ticket.database}' and '${ticket.testDatabase}' with '${basename(dump)}'?`;
  if (!(await confirmOrAbort(values.yes as boolean | undefined, question))) return;

  ensureStack();
  // Open connections are closed by the restore, which would leave a running server with broken
  // pooled connections: stop the servers first and start them again afterwards
  const was = await stopServers(ticket);
  const db = dbConfig();
  for (const target of [ticket.database, ticket.testDatabase]) restoreDump(db, { database: target, file: dump });
  ticket.dump = dump;
  updateTicket(ticket.name, (saved) => {
    saved.dump = dump;
  });
  pnpm(ticket, ['db:migrate']);
  writeTicketFiles(ticket);
  if (was.length) await startServers(ticket);
  console.log(`\nDatabases of '${ticket.name}' reset to '${basename(dump)}' and migrated.`);
}

async function cmdRm({ values, positionals }: { values: Values; positionals: string[] }): Promise<void> {
  const ticket = getTicket(positionals[0]);

  if (existsSync(ticket.worktree)) {
    const dirty = git(['status', '--porcelain'], { cwd: ticket.worktree, capture: true }).stdout.trim();
    if (dirty) {
      throw new Error(`Uncommitted changes in ${ticket.worktree}:\n${dirty}\nCommit, stash or discard them first; nothing was removed.`);
    }
  }
  const question = `Remove ticket '${ticket.name}': dev servers, databases '${ticket.database}' and '${ticket.testDatabase}', the Caddy route and the worktree (branch '${ticket.branch}' is kept)?`;
  if (!(await confirmOrAbort(values.yes as boolean | undefined, question))) return;

  await removeTicket(ticket);
  console.log(`\nTicket '${ticket.name}' removed. Branch '${ticket.branch}' is kept.`);
}

async function cmdLs(): Promise<void> {
  const tickets = Object.values(loadState().tickets).sort((a, b) => a.slot - b.slot);
  if (!tickets.length) {
    console.log('No worktree tickets. Create one: pnpm wt new <branch>');
  }
  const rows: string[][] = [];
  for (const ticket of tickets) {
    const running = await runningServers(ticket);
    const status = (key: ServerKey): string => (running.includes(key) ? `up :${serverPort(ticket, key)}` : 'down');
    rows.push([String(ticket.slot), ticket.name, ticket.branch, status('api'), status('web'), slotInfo(ticket.slot).url]);
  }
  if (rows.length) {
    const header = ['SLOT', 'TICKET', 'BRANCH', 'API', 'WEB', 'URL'];
    const widths = header.map((title, i) => Math.max(title.length, ...rows.map((row) => row[i]?.length ?? 0)));
    for (const row of [header, ...rows]) {
      console.log(row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ').trimEnd());
    }
    console.log();
  }
  const unassigned = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).filter((slot) => !tickets.some((t) => t.slot === slot));
  const busy = await busySlots();
  const free = unassigned.filter((slot) => !busy.has(slot));
  const taken = unassigned.flatMap((slot) => (busy.has(slot) ? [`${slot} (port ${busy.get(slot)} in use)`] : []));
  console.log(`Free slots: ${free.join(', ') || 'none'}`);
  if (taken.length) console.log(`Busy slots: ${taken.join(', ')}`);
}

async function cmdClaudeAccess(): Promise<void> {
  if (!ensureClaudeAccess()) console.log(`Claude: ${wtRoot} is already an additional directory.`);
  console.log('Running Claude sessions pick it up after a restart.');
}

async function cmdInfo({ positionals }: { values: Values; positionals: string[] }): Promise<void> {
  const ticket = getTicket(positionals[0]);
  writeTicketFiles(ticket);
  console.log(`${await ticketSummary(ticket)}\n\n${ticketMarkdown(ticket)}`);
}

const NO_OPTIONS = {} satisfies ParseArgsOptionsConfig;

const COMMANDS: Record<string, Command> = {
  new: {
    run: cmdNew,
    options: NEW_OPTIONS,
    help: `Usage: pnpm wt new <branch> [--base <ref>] [--dump <file>] [--slot N] [--name <ticket>]

Creates <WT_ROOT>/<ticket>/ with a worktree on <branch>: an existing local branch is checked
out, else origin's, else a new branch is created from the base (default: main, else HEAD;
without upstream). The ticket name is the last part of the branch (feature/demo-one gives
demo-one): lowercase letters, digits and single hyphens.

Then, in this order: takes a slot, creates the worktree, writes the env files (the root .env is
copied from the main checkout with DB_DATABASE / DB_TEST_DATABASE of the ticket; apps/api/.env
and apps/web/.env.local set PORT), runs \`pnpm install --frozen-lockfile\`, restores both
databases from the dump, runs \`pnpm db:migrate\` and \`pnpm openapi\` in the worktree, writes
the Caddy route (and reloads Caddy), CLAUDE.local.md and <ticket>.code-workspace. If a step
fails, everything created so far is removed again.

Options:
  --base <ref>    Start point of a new branch (default: main, else HEAD)
  --dump <file>   Dump for both databases (default: the newest dump in db-backups/);
                  remembered as the ticket's starting point for \`reset\`
  --slot <n>      Slot 1-${MAX_SLOTS} (default: the first free one; slots whose ports are
                  already in use by another process are skipped)
  --name <name>   Ticket name (default: last part of the branch)`,
  },
  dev: {
    run: cmdDev,
    options: NO_OPTIONS,
    help: `Usage: pnpm wt dev <ticket>

Starts the API and the web dev server of the ticket in the background, each in its own process
group, output in <WT_ROOT>/<ticket>/logs/ (api.log, web.log). They keep running when this
command, the terminal or the editor closes; \`park\` stops them. A server counts as running
when its port accepts connections; running ones are left alone. Ends with the status block.`,
  },
  park: {
    run: cmdPark,
    options: NO_OPTIONS,
    help: `Usage: pnpm wt park <ticket>

Stops the ticket's dev servers (the whole process group, SIGTERM then SIGKILL; taskkill /T on
Windows), waits until both ports are closed and reports ports that stay open. Worktree and
databases stay; \`dev <ticket>\` starts everything again.`,
  },
  reset: {
    run: cmdReset,
    options: RESET_OPTIONS,
    help: `Usage: pnpm wt reset <ticket> [--latest] [--yes]

Restores both ticket databases from the ticket's dump again (the one it was created or last
reset from) and runs \`pnpm db:migrate\` in the worktree. Running dev servers are stopped
first and started again afterwards. All data in the ticket's databases is lost.

Options:
  --latest    Use the newest dump in db-backups/ instead (becomes the ticket's dump)
  -y, --yes   Do not ask for confirmation (required when there is no terminal)`,
  },
  rm: {
    run: cmdRm,
    options: { yes: { type: 'boolean', short: 'y' } },
    help: `Usage: pnpm wt rm <ticket> [--yes]

Stops the dev servers, drops both databases, removes the Caddy route and the worktree and the
ticket folder. Refuses when the worktree has uncommitted changes. The branch is kept.

Options:
  -y, --yes   Do not ask for confirmation (required when there is no terminal)`,
  },
  ls: {
    run: cmdLs,
    options: NO_OPTIONS,
    help: `Usage: pnpm wt ls

Lists the tickets with slot, branch, server status (from the ports) and URL, plus the free slots.`,
  },
  'claude-access': {
    run: cmdClaudeAccess,
    options: NO_OPTIONS,
    help: `Usage: pnpm wt claude-access

Adds WT_ROOT (${wtRoot}) to permissions.additionalDirectories in the main checkout's
git-ignored .claude/settings.local.json, so Claude sessions started in the main checkout can
edit the worktrees without a prompt per file. \`new\` does this automatically; the path is
each developer's own WT_ROOT, nothing is versioned. Restart running sessions afterwards.`,
  },
  info: {
    run: cmdInfo,
    options: NO_OPTIONS,
    help: `Usage: pnpm wt info <ticket>

Prints the ticket's status block (URL, ports, server status, databases, Caddy route, worktree),
then its branch, paths and working rules as Markdown (and refreshes
<WT_ROOT>/<ticket>/CLAUDE.local.md, which holds the Markdown part). The /wt skill loads this
into a Claude session.`,
  },
};

async function runCommand(spec: Command, args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { ...spec.options, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(spec.help);
    return;
  }
  await spec.run({ values: values as Values, positionals });
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) {
    const topic = rest[0] ? COMMANDS[rest[0]] : undefined;
    console.log(topic ? topic.help : HELP);
    return;
  }
  const spec = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!spec) throw new Error(`Unknown command '${command}'. See \`pnpm wt --help\`.`);
  await runCommand(spec, rest);
}

main(process.argv.slice(2)).catch(fail);
