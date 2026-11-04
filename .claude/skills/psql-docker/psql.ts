#!/usr/bin/env node
// Zero-dependency psql wrapper: runs psql inside a throw-away Docker container
// against the local Postgres. Read-only by default.

import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { spawn, type StdioOptions } from 'node:child_process';

interface Config {
  host?: string | undefined;
  port?: string | undefined;
  database?: string | undefined;
  user?: string | undefined;
  password?: string | undefined;
}

interface Options {
  sql: string | null;
  file: string | null;
  stdin: boolean;
  csv: boolean;
  expanded: boolean;
  rw: boolean;
  timeout: number;
  maxLines: number;
  show: boolean;
  rest: string[];
}

const DEFAULT_MAX_LINES = 100;
const IMAGE = process.env.PSQL_DOCKER_IMAGE || 'postgres:18-alpine';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

const USAGE = `Usage: node psql.ts [options] "<SQL or psql meta-command>"
       node psql.ts [options] -f <file.sql>
       echo "SELECT 1" | node psql.ts [options] -

Options:
  -f, --file <path>   Run SQL from a file
  -                   Read SQL from stdin
  --csv               CSV output (psql --csv)
  -x                  Expanded (vertical) output
  --rw                Allow writes (default is read-only). Only on explicit user request.
  --timeout <ms>      statement_timeout (default 30000, 0 = none)
  --max-lines <n>     Stop after n lines of output (default ${DEFAULT_MAX_LINES}; counts header/footer
                      lines too, so ~n-3 table rows or n-1 CSV rows). Read-only mode only.
  --no-limit          Do not cap the output
  --show-config       Print the resolved connection (password redacted) and exit
  -h, --help          Show this help
  --                  Everything after is passed to psql verbatim

Config sources (first complete one wins): .env in cwd, then process env.
Within a source: DATABASE_URL, then DB_HOST/DB_PORT/DB_DATABASE/DB_USER/DB_PASSWORD,
then PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.
Image override: PSQL_DOCKER_IMAGE (default ${IMAGE}).`;

function fail(msg: string): never {
  process.stderr.write(`psql.ts: ${msg}\n`);
  process.exit(1);
}

function parseDotenv(file: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1] as string;
    let v = m[2] as string;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      const q = v[0];
      v = v.slice(1, -1);
      if (q === '"') v = v.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      v = v.replace(/\s+#.*$/, '');
    }
    out[key] = v;
  }
  return out;
}

function fromUrl(str: string): Config | null {
  let u: URL;
  try {
    u = new URL(str);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
  return {
    host: u.hostname || undefined,
    port: u.port || undefined,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || undefined,
    user: decodeURIComponent(u.username) || undefined,
    password: decodeURIComponent(u.password) || undefined,
  };
}

function fromEnv(env: Record<string, string | undefined>): Config | null {
  if (env.DATABASE_URL) {
    const c = fromUrl(env.DATABASE_URL);
    if (c && c.database) return c;
  }
  const pick = (a: string, b: string): string | undefined => env[a] || env[b] || undefined;
  const c: Config = {
    host: pick('DB_HOST', 'PGHOST'),
    port: pick('DB_PORT', 'PGPORT'),
    database: pick('DB_DATABASE', 'PGDATABASE'),
    user: pick('DB_USER', 'PGUSER'),
    password: pick('DB_PASSWORD', 'PGPASSWORD'),
  };
  return c.database && c.user ? c : null;
}

function resolveConfig(): { cfg: Config; source: string } {
  const dotenvPath = path.join(process.cwd(), '.env');
  const dotenv = parseDotenv(dotenvPath);
  let cfg = dotenv && fromEnv(dotenv);
  let source = dotenvPath;
  if (!cfg) {
    cfg = fromEnv(process.env);
    source = 'process env';
  }
  if (!cfg) {
    fail(
      `no DB config found. Looked for DATABASE_URL or DB_*/PG* variables in ${dotenvPath} and the process env.`
    );
  }
  return { cfg, source };
}

// A compose-internal hostname (e.g. "database") does not resolve on the host;
// the published port on localhost does.
async function pickHost(host: string | undefined): Promise<{ host: string; note?: string }> {
  if (!host) return { host: '127.0.0.1' };
  if (LOCAL_HOSTS.has(host)) return { host };
  try {
    await dns.promises.lookup(host);
    return { host };
  } catch {
    return { host: '127.0.0.1', note: `host "${host}" does not resolve locally, using 127.0.0.1` };
  }
}

function parseArgs(argv: string[]): Options {
  const o: Options = { sql: null, file: null, stdin: false, csv: false, expanded: false, rw: false, timeout: 30000, maxLines: DEFAULT_MAX_LINES, show: false, rest: [] };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--') { o.rest = argv.slice(i + 1); break; }
    else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else if (a === '-f' || a === '--file') o.file = argv[++i] || fail('--file needs a path');
    else if (a === '-') o.stdin = true;
    else if (a === '--csv') o.csv = true;
    else if (a === '-x') o.expanded = true;
    else if (a === '--rw') o.rw = true;
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else if (a === '--max-lines') o.maxLines = Number(argv[++i]);
    else if (a === '--no-limit') o.maxLines = 0;
    else if (a === '--show-config') o.show = true;
    else positional.push(a);
  }
  if (Number.isNaN(o.timeout)) fail('--timeout must be a number');
  if (!Number.isInteger(o.maxLines) || o.maxLines < 0) fail('--max-lines must be a non-negative integer');
  if (positional.length) o.sql = positional.join(' ');
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { cfg, source } = resolveConfig();
  const { host: rawHost, note } = await pickHost(cfg.host);
  const port = cfg.port || '5432';

  // Linux shares the host network; Docker Desktop (macOS/Windows) does not.
  const linux = process.platform === 'linux';
  const host = !linux && LOCAL_HOSTS.has(rawHost) ? 'host.docker.internal' : rawHost;

  if (note) process.stderr.write(`psql.ts: ${note}\n`);

  if (opts.show) {
    console.log(JSON.stringify({ source, image: IMAGE, host, port, database: cfg.database, user: cfg.user, password: cfg.password ? '***' : null, readOnly: !opts.rw }, null, 2));
    return;
  }

  const sources = [opts.sql !== null, opts.file !== null, opts.stdin].filter(Boolean).length;
  if (sources !== 1) fail(`provide exactly one of: SQL argument, -f <file>, or - (stdin)\n\n${USAGE}`);

  let stdinData = null;
  if (opts.file) {
    try { stdinData = fs.readFileSync(opts.file); } catch (e) { fail(`cannot read ${opts.file}: ${(e as Error).message}`); }
  } else if (opts.stdin) {
    stdinData = fs.readFileSync(0);
  }

  // Values are passed through the environment ("-e NAME" without a value) so the
  // password and options never appear in the process list.
  const pgopts: string[] = [];
  if (!opts.rw) pgopts.push('-c default_transaction_read_only=on');
  if (opts.timeout > 0) pgopts.push(`-c statement_timeout=${opts.timeout}`);

  const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: cfg.password || '', PGOPTIONS: pgopts.join(' ') };

  const dockerArgs = ['run', '--rm', '-i'];
  if (linux) dockerArgs.push('--network=host');
  dockerArgs.push('-e', 'PGPASSWORD', '-e', 'PGOPTIONS', IMAGE);
  dockerArgs.push('psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', host, '-p', String(port), '-U', cfg.user as string, '-d', cfg.database as string);
  if (opts.csv) dockerArgs.push('--csv');
  if (opts.expanded) dockerArgs.push('-x');
  dockerArgs.push(...opts.rest);
  if (stdinData !== null) dockerArgs.push('-f', '-');
  else dockerArgs.push('-c', opts.sql as string);

  // The cap only applies to read-only sessions: killing a write session midway
  // could abort a statement the user asked for.
  const cap = !opts.rw && opts.maxLines > 0 ? opts.maxLines : 0;
  const stdio: StdioOptions = [stdinData !== null ? 'pipe' : 'ignore', cap ? 'pipe' : 'inherit', 'inherit'];
  const child = spawn('docker', dockerArgs, { env, stdio });
  if (stdinData !== null) child.stdin?.end(stdinData);

  let truncated = false;
  if (cap) {
    let lines = 0;
    child.stdout?.on('data', (chunk: Buffer) => {
      if (truncated) return;
      let end = -1;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 10 && ++lines >= cap) { end = i + 1; break; }
      }
      if (end === -1) {
        process.stdout.write(chunk);
        return;
      }
      truncated = true;
      process.stdout.write(chunk.subarray(0, end));
      child.kill('SIGTERM'); // docker run forwards the signal to the container
    });
  }

  child.on('error', (e: NodeJS.ErrnoException) => fail(e.code === 'ENOENT' ? 'docker not found on PATH' : e.message));
  // "close" (not "exit") so all buffered stdout has been read first; no process.exit()
  // so stdout writes to a pipe are flushed before the process ends.
  child.on('close', (code) => {
    if (truncated) {
      process.stderr.write(`psql.ts: output truncated at ${cap} lines; narrow the query (WHERE/LIMIT) or use --max-lines <n> / --no-limit\n`);
      process.exitCode = 0;
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

main().catch((e: Error) => fail(e.message));
