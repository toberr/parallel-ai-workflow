---
applyTo: "apps/api/**"
---

# API (`apps/api`)

Terms such as *generated files*, *workspace package* and `PORT` are defined in [CLAUDE.md](../../CLAUDE.md).

## Purpose

`apps/api` is the HTTP API: [Hono](https://hono.dev) with `@hono/zod-openapi` (routes are
described with Zod schemas and produce an OpenAPI 3.1 document) on `@hono/node-server`. It is
run with `tsx`; there is no compile step and no JavaScript output. It reads the database only
through the workspace package `@repo/db` (see [database.instructions.md](database.instructions.md)).
Every route lives under `/api`, because Caddy forwards `/api/*` to this app.

## Structure

| Path | Role |
|---|---|
| `src/index.ts` | Starts the server: reads `PORT`, creates one database instance with `createDb()`, calls `createApp({ db })`, closes the pool on SIGINT/SIGTERM. |
| `src/app.ts` | `createApp({ db })` builds the Hono app and registers the OpenAPI document at `/api/openapi.json`. It never listens and never connects. |
| `src/env.ts` | `requirePort()`: `PORT` from the process environment, else from `apps/api/.env`; stops with a clear message when it is missing or invalid. |
| `src/routes/*.ts` | One file per resource: Zod schemas, the route definition and a factory that takes `{ db }`. Tests sit next to them (`*.test.ts`). |
| `scripts/write-openapi.ts` | `pnpm openapi`: writes `apps/api/openapi.json` from the code. |
| `test/global-setup.ts`, `test/setup.ts` | Vitest set-up of the test database (see [testing.instructions.md](testing.instructions.md)). |

`app.ts` is separate from `index.ts` so that tests and `write-openapi.ts` can import the app
without starting a server or needing a running database (a Kysely pool connects lazily).

## Commands

Run from the repository root.

| Command | Effect |
|---|---|
| `pnpm dev` | Runs `pnpm openapi`, then every app's dev server in parallel (API with `tsx watch`, web with Next.js). |
| `pnpm --filter api dev` | The API dev server only. |
| `pnpm openapi` | Regenerates `apps/api/openapi.json`, then the web's API types. Needs no database and no server. |
| `pnpm typecheck` | `pnpm openapi`, then the type check of every package. |
| `pnpm test` | `pnpm openapi`, then Vitest (see the testing guide). |

## Environment variables

- `PORT` (required): the listen port, in `apps/api/.env` (copy `apps/api/.env.example`, value
  `4000` for the main checkout). The API refuses to start without it. `wt` writes the slot's
  value (`4000 + N*100`).
- Database settings are **not** set here. They are `DB_*` in the repository root `.env` and are
  read by `@repo/db`.
- Never `export` `DB_*` or `PORT` in a shell: the process environment overrides the `.env`
  files, so a worktree's API would silently use another checkout's database or port.

## Adding an OpenAPI route

1. In `src/routes/<resource>.ts`, define the response (and request) schemas with `z` from
   `@hono/zod-openapi`. Register a reusable schema with `.openapi("Name")` and add an
   `example` where useful. The name becomes the type name in the web's generated API types.
2. Describe the route with `createRoute({ method, path, summary, request, responses })`.
   The path starts with `/api/`.
3. Implement it with `new OpenAPIHono().openapi(route, handler)` inside a factory such as
   `ticketsRoutes({ db })`. Query through the `db` that is passed in, never through a global.
   Columns are snake_case; the API returns camelCase, so map explicitly.
4. Register the factory in `createApp` with `app.route("/", yourRoutes({ db }))`.
5. Add a test next to it (`app.request("/api/...")`), validating the body with the Zod schema.
6. Run `pnpm openapi` (or `pnpm typecheck`): `apps/api/openapi.json` and the web's API types
   are regenerated, and the web can import the new types.

Use `db` with Kysely's query builder. A raw `sql` template must never interpolate untrusted
strings; use parameters (`sql\`... ${value}\``) or `sql.id()` for identifiers.

## Generated files

`apps/api/openapi.json`, `apps/web/src/lib/api-types.generated.ts` and
`packages/db/src/types.generated.ts` are git-ignored and never edited by hand. They are
recreated by `pnpm db:migrate` (database types) and by the `dev`, `build`, `test` and
`typecheck` scripts (`pnpm openapi` runs first in each). After a pull, merge or rebase that
brings in migrations, run `pnpm db:migrate`; otherwise the database and the types lag behind
the code. On a fresh clone, run `pnpm db:migrate` before `pnpm typecheck`.

## Pitfalls

- A route file that imports from `packages/db` by relative path breaks the package boundary;
  import `@repo/db` only.
- Importing `./routes/x` without the `.ts` extension fails: this repository uses explicit
  `.ts` import extensions.
- Do not call `createDb()` at module level in route files or tests that share an app: create it
  once in `index.ts` (and once per test file) and pass it in.
- Plain HTTP and the absence of authentication are acceptable for local development only.
