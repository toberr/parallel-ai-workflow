---
applyTo: "packages/db/**,scripts/db-*.ts,scripts/lib/db.ts"
---

# Database and shared packages (`packages/db`, `scripts/db-*.ts`)

Terms such as *migration*, *dump*, *generated files*, *workspace package*, *slot* and *shared
stack* are defined in [CLAUDE.md](../../CLAUDE.md).

## Purpose

PostgreSQL runs in the shared `postgres` container. `packages/db` (`@repo/db`) owns the schema
(kysely-ctl migrations), generates the database types (kysely-codegen) and exposes a typed
Kysely instance. It is also the repository's example of a shared workspace package.

## The `@repo/db` package

- **Exports** (`src/index.ts`): `createDb()` (a Kysely instance with the `pg` driver, typed with
  the generated `DB` interface) and the types `Selectable`, `Insertable`, `Updateable` and
  `Tickets`. Nothing else is public. Migrations and `config.ts` internals stay private.
  `@repo/db/testing` (`prepareTestDatabase()`) is a second, test-only entry point used by the
  API's Vitest global setup.
- **Connection settings**: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` (and
  `DB_TEST_DATABASE` for tests) come from the repository root `.env`; the process environment
  wins over the file. If a setting is missing the package stops with a message. There is no
  `DATABASE_URL` and no database setting in the app `.env` files. Never `export` `DB_*` in a
  shell: a slot would silently use the exported database.
- **No build step.** `package.json` `exports` points at the TypeScript source
  (`./src/index.ts`). The consumers compile it themselves: `tsx` (API), Vitest and `tsc` with
  bundler module resolution. A change in `packages/db` therefore needs no rebuild. (Node's own
  type stripping refuses `.ts` files below `node_modules`, which is why the API runs through
  `tsx`.)
- **Scripts** of the package: `migrate`, `migrate:down`, `migrate:make`, `migrate:list`,
  `codegen`, `typecheck`. The root `db:*` scripts call them with `pnpm --filter @repo/db ...`.

### Using the package from an app

In the app's `package.json`:

```json
"dependencies": { "@repo/db": "workspace:*" }
```

Run `pnpm install` so that pnpm links the package into the app's `node_modules`, then
`import { createDb } from "@repo/db"`. Import only through the package name, never by a relative
path into `packages/db` (`rg "packages/db" apps/` must find no relative imports).
`pnpm --filter api ls @repo/db` shows the workspace link.

### Adding another shared package the same way

1. Create `packages/<name>/` with `package.json` (`"name": "@repo/<name>"`, `"private": true`,
   `"type": "module"`, `exports` pointing at `./src/index.ts`) and a `tsconfig.json` that
   extends `tsconfig.base.json`. Give it a `typecheck` script.
2. Put the public API in `src/index.ts` and export only what consumers need.
3. In each consuming app add `"@repo/<name>": "workspace:*"` and run `pnpm install`
   (`pnpm-workspace.yaml` already includes `packages/*`).
4. Keep it local: the `@repo/` scope is never published, and the package needs no build step.
   A new dependency of the package requires compliance review before use in government projects.

## Schema-change workflow

1. `pnpm db:migrate:make <name>` creates `packages/db/src/migrations/<timestamp>_<name>.ts`.
2. Write `up` and `down` with Kysely's schema builder. `Kysely<any>` is intentional in
   migrations: a migration is frozen in time and must not depend on the current types.
3. `pnpm db:migrate` applies the migration to this checkout's database and then regenerates
   `packages/db/src/types.generated.ts`, so the types match the database.
4. Check the reverse: `pnpm db:migrate:down` followed by `pnpm db:migrate`. Note that
   `db:migrate:down` reverts the most recently *executed* migration, not the one with the
   highest name.
5. Adapt the code that uses the new schema, run `pnpm typecheck` and `pnpm test`.
6. Commit the migration (not the generated types).

`pnpm db:migrate:list` shows which migrations are applied.

### Migration rules

- One schema change per migration, with a working `down`.
- Never edit a migration after it has been merged; add a new one.
- Unordered migrations are allowed (`allowUnorderedMigrations: true`): parallel branches merge
  in any order, and an older migration that arrives later still runs. Migrations must therefore
  not depend on the order in which unrelated branches were merged.
- Seed data that the application needs belongs in a migration; demo data may use kysely-ctl seeds.
- Raw `sql` templates must not interpolate untrusted strings.
- A migration created in a slot changes that slot's databases only. It reaches `app_dev` when
  the branch is merged and `pnpm db:migrate` runs in the main checkout.

## Generated files

`packages/db/src/types.generated.ts` (kysely-codegen, from the live migrated database, Kysely's
migration tables excluded), `apps/api/openapi.json` and `apps/web/src/lib/api-types.generated.ts`
are git-ignored, never edited and never committed. `pnpm db:migrate` and `pnpm db:migrate:down`
regenerate the database types; the `dev`, `build`, `test` and `typecheck` scripts regenerate
the OpenAPI document and the web's API types (`pnpm openapi`). `pnpm db:codegen` regenerates only
the database types. After a pull, merge or rebase that brings in migrations, run
`pnpm db:migrate`. On a fresh clone the types do not exist until `pnpm db:migrate` has run, so
the order is: stack up, `pnpm db:migrate`, `pnpm typecheck`.

## Databases per checkout

| Checkout | Development database | Test database |
|---|---|---|
| Main checkout | `app_dev` | `app_test` |
| Slot, ticket `<ticket>` | `app_wt_<ticket>` | `app_wt_<ticket>_test` |

The names come from the checkout's own root `.env` (`DB_DATABASE`, `DB_TEST_DATABASE`); `wt`
writes them into a worktree's `.env`. Hyphens in a ticket name become underscores. The test
database is created and migrated by the Vitest global setup; tests never touch the development
database.

## Backup and restore

| Command | Effect |
|---|---|
| `pnpm db:backup` | `pg_dump` of the main database into `db-backups/dump-app-dev-<date>-<HHMM>.sql` (git-ignored). |
| `pnpm db:restore [--file <dump>] [--db <name>] [--yes]` | Restores the newest dump (or `--file`) into the main database (or `--db`) after a confirmation; `--yes` skips it. Refuses a truncated dump before dropping anything. |

A dump contains the `kysely_migration` tables, so `pnpm db:migrate` after a restore applies only
the migrations that are newer than the dump. `pnpm wt new` restores the newest dump into both
slot databases and then migrates them; `pnpm wt reset <ticket>` restores the ticket's own dump
again (`--latest`: the newest one). Without a dump, `wt new` stops and asks for `pnpm db:backup`.
Dumps of real data must not be put in this repository (GDPR, data minimisation); use demo or
anonymised data only.

## Inspecting data

Use the [psql-docker skill](../../.claude/skills/psql-docker/SKILL.md) instead of guessing from
code. It is read-only by default and reads the `.env` of the directory it is run from, so in a
worktree it reports the slot's database. `--rw` only on the user's explicit request.

## Pitfalls

- The postgres container is shared by every checkout. Never run `docker compose down` or
  `restart` for one slot.
- `DB_USER`, `DB_PASSWORD` and `DB_DATABASE` take effect only when the postgres volume is first
  initialised; changing them later needs a new volume.
- `DB_PORT` is the host port (5432 by default). If another PostgreSQL already uses it, set a
  different `DB_PORT` in the root `.env` before `docker compose up`.
- `pnpm typecheck` and the editor need the migrated database for the generated types; a
  missing `types.generated.ts` means `pnpm db:migrate` has not run in this checkout.
