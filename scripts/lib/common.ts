// Shared helpers for the scripts in this folder: .env files, child processes, ports and paths.
// Node built-ins only, so the scripts run on Linux, macOS and Windows without an install step.

import { spawn, spawnSync, type StdioOptions } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

export const isWindows = process.platform === 'win32';

// On Windows these are .cmd shims, which can only be started through a shell
const WINDOWS_SHIMS = new Set(['npm', 'npx', 'pnpm']);

/** Environment overrides; a value of `undefined` removes the variable from the child's environment. */
export type Env = Record<string, string | undefined>;

export interface RunOptions {
  cwd?: string;
  /** Added to (and overriding) the current process environment */
  env?: Env;
  /** Return stdout/stderr instead of printing them; the command itself is not printed either */
  capture?: boolean;
  /** Return a non-zero exit (or a command that cannot start) instead of throwing */
  allowFailure?: boolean;
  /** Overrides the stdio setup chosen by `capture` */
  stdio?: StdioOptions;
}

export interface RunResult {
  /** Exit code; -1 when the command could not be started */
  status: number;
  stdout: string;
  stderr: string;
}

export interface BackgroundCommand {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Env;
  logFile: string;
}

/**
 * A command as one line to paste into a POSIX shell, prefixed with `cd <cwd> &&` when it runs
 * elsewhere. Environment values are left out on purpose: some are secrets (e.g. PGPASSWORD).
 */
export function formatCommand(cmd: string, args: string[], cwd?: string): string {
  const quote = (arg: string) => (/^[\w./:=@%+,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`);
  const line = [cmd, ...args].map(quote).join(' ');
  return cwd && resolve(cwd) !== process.cwd() ? `cd ${quote(cwd)} && ${line}` : line;
}

function quoteWindowsArg(arg: string): string {
  return /^[\w./:=@-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

function resolveCommand(cmd: string, args: string[]): { file: string; args: string[]; shell: boolean } {
  if (!isWindows || !WINDOWS_SHIMS.has(cmd)) return { file: cmd, args, shell: false };
  return { file: [cmd, ...args].map(quoteWindowsArg).join(' '), args: [], shell: true };
}

/** The process environment with `overrides` applied; `undefined` values delete the variable. */
function buildEnv(overrides: Env | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return env;
}

/** Runs a command synchronously. Throws on a non-zero exit unless `allowFailure` is set. */
export function run(cmd: string, args: string[], options: RunOptions = {}): RunResult {
  const { cwd, env, capture = false, allowFailure = false, stdio } = options;
  // Commands whose output is shown are printed first, so a step can be re-run by hand
  if (!capture) console.log(`$ ${formatCommand(cmd, args, cwd)}`);
  const command = resolveCommand(cmd, args);
  const result = spawnSync(command.file, command.args, {
    cwd,
    env: buildEnv(env),
    shell: command.shell,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: stdio ?? (capture ? 'pipe' : 'inherit'),
  });

  if (result.error) {
    if (allowFailure) return { status: -1, stdout: '', stderr: result.error.message };
    throw new Error(`Could not start \`${formatCommand(cmd, args, cwd)}\`: ${result.error.message}`);
  }
  // status is null when the process was killed by a signal
  const status = result.status ?? -1;
  if (status !== 0 && !allowFailure) {
    const detail = capture && result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(`\`${formatCommand(cmd, args, cwd)}\` failed with exit code ${status}${detail}`);
  }
  return { status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Starts a long-running command detached from this process (its own process group on POSIX),
 * stdout and stderr appended to `logFile`. Returns its PID.
 */
export function spawnBackground({ cmd, args, cwd, env, logFile }: BackgroundCommand): number {
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, 'a');
  console.log(`$ ${formatCommand(cmd, args, cwd)}`);
  const command = resolveCommand(cmd, args);
  const child = spawn(command.file, command.args, {
    cwd,
    env: buildEnv(env),
    shell: command.shell,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  closeSync(fd);
  if (child.pid === undefined) throw new Error(`Could not start \`${formatCommand(cmd, args, cwd)}\` (see ${logFile}).`);
  return child.pid;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Whether a process with this PID exists (it may belong to another user). Used for lock files only. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** One connection attempt; resolves true when something accepts it within the timeout. */
function tryConnect({ host, port, timeoutMs }: { host: string; port: number; timeoutMs: number }): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port });
    const finish = (open: boolean) => {
      socket.destroy();
      done(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Whether a TCP connection to the port succeeds (IPv4 or IPv6 loopback). */
export async function isPortOpen(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', '::1']) {
    if (await tryConnect({ host, port, timeoutMs: 1000 })) return true;
  }
  return false;
}

/** Polls until every port accepts connections (`want: 'open'`) or none does (`'closed'`); returns the ports still in the wrong state. */
export async function waitForPorts({ ports, want, timeoutMs }: {
  ports: number[];
  want: 'open' | 'closed';
  timeoutMs: number;
}): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const wrong: number[] = [];
    for (const port of ports) if ((await isPortOpen(port)) !== (want === 'open')) wrong.push(port);
    if (!wrong.length || Date.now() > deadline) return wrong;
    await sleep(300);
  }
}

/** Whether any member of the POSIX process group `pgid` is still alive. */
function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Stops a process started by `spawnBackground` together with everything it started. This is the
 * only place with a platform branch. POSIX: the server is its own process group leader, so the
 * negative PID reaches the whole group; SIGTERM first, SIGKILL after `graceMs`. Windows: taskkill
 * with /T (tree) and /F.
 */
export async function stopProcessTree({ pid, graceMs = 8000 }: { pid: number; graceMs?: number }): Promise<void> {
  if (isWindows) {
    run('taskkill', ['/PID', String(pid), '/T', '/F'], { capture: true, allowFailure: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return; // no such group: already gone
  }
  const deadline = Date.now() + graceMs;
  while (processGroupAlive(pid) && Date.now() < deadline) await sleep(200);
  if (processGroupAlive(pid)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // gone in the meantime
    }
  }
}

function unquoteEnvValue(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    return end > 0 ? value.slice(1, end) : value.slice(1);
  }
  // Unquoted values may carry an inline comment: `KEY=value   # comment`
  return value.replace(/\s+#.*$/, '');
}

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** Parses a .env file into a Map; a missing file gives an empty Map. Later duplicates win. */
export function parseEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(ENV_LINE);
    if (match?.[1] !== undefined) values.set(match[1], unquoteEnvValue(match[2] ?? ''));
  }
  return values;
}

/**
 * Sets `updates` (key to value) in a .env file, keeping all other lines. An existing key is
 * replaced in place (later duplicates are dropped); new keys are appended under `header`.
 */
export function upsertEnvFile({ path, updates, header = '# --- generated overrides ---' }: {
  path: string;
  updates: Record<string, string | number>;
  header?: string;
}): void {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  const seen = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const key = line.match(ENV_LINE)?.[1];
    if (key && pending.has(key)) {
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(`${key}=${pending.get(key)}`);
      continue;
    }
    output.push(line);
  }

  const missing = [...pending].filter(([key]) => !seen.has(key));
  if (missing.length) {
    while (output.length && output.at(-1)?.trim() === '') output.pop();
    if (output.length) output.push('');
    output.push(header, ...missing.map(([key, value]) => `${key}=${value}`));
  }
  writeFileSync(path, `${output.join('\n')}\n`);
}

/** The main checkout, also when the script runs from inside a worktree. */
export function mainRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const { stdout } = run('git', ['-C', here, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    capture: true,
  });
  return dirname(stdout.trim());
}

/** Asks a yes/no question on the terminal. Without a terminal the answer is "no". */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Prints the error and exits; used as the top-level catch of the CLI scripts. */
export function fail(error: unknown): never {
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
