---
name: psql-docker
description: Query a local PostgreSQL database via psql running in a Docker container, for read-only investigations. Connection comes from .env (DATABASE_URL or DB_*/PG* variables) in the current directory or the process env. Use whenever the user asks to look at, count, inspect, or debug data in the database, or check rows/relations/constraints — instead of guessing from code.
---

# psql via Docker

Runs `psql` inside a throw-away container (`docker run --rm`, image `postgres:18-alpine`, the same image as the `postgres` service in `docker-compose.yml`) against the local Postgres, using the bundled cross-platform Node CLI `psql.ts` (next to this file). No local `psql` install needed. Requires `docker` and `node` on PATH.

## Usage

The script is `.claude/skills/psql-docker/psql.ts`. Run it from the repository root (or from a worktree root, see below) with Node >= 22.18, which runs the TypeScript file directly. Use that literal relative path.

Run from the checkout whose database is to be inspected: the script reads `.env` from the **current working directory**. In the main checkout that is `app_dev`; in a `wt` worktree root it is the slot's database `app_wt_<ticket>` (check with `--show-config`). Do not export `DB_*` variables in the shell to override this.

**Show the SQL and the actual results in your final reply.** Some interfaces collapse tool calls, and text written before a tool call can end up collapsed with them, so the user cannot see the query or its result. The **final message of the turn, after the last tool call,** must contain: (1) every SQL statement that was run, as a fenced ```` ```sql ```` block (same text as in the heredoc, without the `node` line), (2) **the actual result rows the user asked for, not a summary**: reproduce them as a markdown table (or a compact grouped table for long lists), complete and unaltered, and add a one-line note on row count and anything odd (NULLs, rows dropped by a join). Do not replace results with counts, samples or "the rest looks similar", and do not withhold requested rows out of caution; the user asked for them. If the result really is too large to paste (hundreds of rows), say so, paste what fits, and offer to save the rest to a file. Repeat the SQL there even if you already printed it before running the query. Skip this only for trivial meta-commands like `\dt`.

**Default: write every query as readable multi-line SQL via a quoted heredoc**, the way a person would type it in psql, so the user can follow what is being run. Use `-` (stdin) with `<<'EOF'`; the quotes around `EOF` stop the shell from expanding or mangling anything. One clause per line (`SELECT` columns, `FROM`, `JOIN`, `WHERE`, `ORDER BY`, `LIMIT`), indented, with a short `--` comment saying what the query is checking when it isn't obvious:

```bash
node .claude/skills/psql-docker/psql.ts - <<'EOF'
-- Tickets with their branch and services
SELECT
  t.id,
  t.name,
  t.git_branch,
  t.services
FROM tickets t
ORDER BY t.id
LIMIT 10;
EOF
```

Several statements can go in one heredoc; each result is printed in order. Options go before `-`:

```bash
node .claude/skills/psql-docker/psql.ts -x - <<'EOF'      # vertical output, for wide rows
node .claude/skills/psql-docker/psql.ts --csv - <<'EOF'   # CSV: compact, for post-processing; not the default
```

**Output cap.** To keep results small, output is cut off after **100 lines** (header and footer lines count, so about 97 table rows or 99 CSV rows). When that happens the script prints `output truncated at 100 lines …` on stderr and exits 0. On truncation, narrow the query (`WHERE`, `LIMIT`, fewer columns) rather than lifting the cap. Only when the full output is really needed:

```bash
node .claude/skills/psql-docker/psql.ts --no-limit - <<'EOF'          # no cap
node .claude/skills/psql-docker/psql.ts --max-lines 500 - <<'EOF'     # custom cap
```

The cap applies to read-only sessions only (it is not applied with `--rw`). **Do not use `--csv` by default**: the normal aligned table is easier for the user to read. Use `--csv` only when the user asks for it or the output is meant for post-processing.

Single-line form is only for trivial one-offs and psql meta-commands:

```bash
node .claude/skills/psql-docker/psql.ts '\dt'
node .claude/skills/psql-docker/psql.ts '\d some_table'
node .claude/skills/psql-docker/psql.ts --show-config   # resolved connection, password redacted
```

Start every command directly with `node` and the literal path. Do not store the path in a shell variable and do not create temporary `.sql` files, so that the command stays easy to recognise and review. `-f <file>` is only for SQL files that already exist.

## Connection resolution

The first source that yields a complete config wins: (1) `.env` in the cwd, (2) the process environment. Within a source: `DATABASE_URL` (connection string), then `DB_HOST`/`DB_PORT`/`DB_DATABASE`/`DB_USER`/`DB_PASSWORD`, then `PG*`.

Gotcha: a host name that only exists inside docker-compose (e.g. `DB_HOST=database`) does not resolve on the host. The script then falls back to `127.0.0.1` (the published port) and prints a note to stderr. That is expected. On macOS/Windows (Docker Desktop) `localhost` is mapped to `host.docker.internal` automatically.

Run `--show-config` first if a connection fails. If you get "Connection refused", the database is not running or not published on that host/port (check `docker ps`).

## Safety rules

- **Read-only by default**: sessions run with `default_transaction_read_only=on` and a 30 s `statement_timeout` (`--timeout <ms>`, `0` disables). Writes fail with "cannot execute ... in a read-only transaction".
- `--rw` lifts the read-only guard. **Never use it unless the user explicitly asks for a write**, and show the exact statement first. This is a data-changing action; prefer a migration or the app itself for real changes.
- Always add `LIMIT` to exploratory selects; avoid dumping whole tables.
- Do not print or echo the password. The script passes it via the environment, not argv. Never paste real personal data from query results into code, docs, commit messages or examples — use placeholders (e.g. `user_id: 12345`).
- Local dev DB only (the shared postgres container; see [database.instructions.md](../../../docs/instructions/database.instructions.md)). Do not point this at shared/staging/production databases via env overrides without the user's explicit instruction.

## Tips

- Schema overview: check the repo for a schema dump or migrations (`packages/db/src/migrations/`; the generated `packages/db/src/types.generated.ts` shows the current schema of the checkout) and search them for table/column names before querying; it may be stale vs. the live DB. Use `\d <table>` and `\dt` for the live truth.
- If a table has no creation-date column, look for an audit/activity table before guessing.
- Non-zero exit code means psql failed (`ON_ERROR_STOP` is set); the error is on stderr.
- Image override: set `PSQL_DOCKER_IMAGE` (e.g. to match a different Postgres major version; the default follows `docker-compose.yml`).