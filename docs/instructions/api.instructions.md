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
| `src/index.ts` | Starts the server: reads `PORT`, creates one database instance with `createDb()`, calls `createApp({ db, devRoutes })` (development routes on unless `NODE_ENV=production`), closes the pool on SIGINT/SIGTERM. |
| `src/app.ts` | `createApp({ db, devRoutes })` builds the Hono app and registers the OpenAPI document at `/api/openapi.json`; with `devRoutes`, also `/api/wt-tickets` and the Swagger UI at `/api/docs`. It never listens and never connects. |
| `src/env.ts` | `requirePort()`: `PORT` from the process environment, else from `apps/api/.env`; stops with a clear message when it is missing or invalid. |
| `src/routes/*.ts` | One file per resource: Zod schemas, the route definition and a factory that takes `{ db }`. Tests sit next to them (`*.test.ts`). |
| `src/routes/wt-tickets.ts` | `/api/wt-tickets`: runs `node scripts/wt.ts ls --json` of the same checkout and maps the worktree tickets. |
| `scripts/write-openapi.ts` | `pnpm openapi`: writes `apps/api/openapi.json` from the code, development routes included. |
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

## API documentation (Swagger UI)

The dev server serves a Swagger UI for the OpenAPI document at `/api/docs`, for example
`http://localhost/api/docs` or `http://sN.localhost/api/docs` (with `:<PROXY_PORT>` when that is
not 80). It reads the live `/api/openapi.json`, so it always shows the current routes. It comes
from `@hono/swagger-ui` and is on unless `NODE_ENV=production`; tests build the app without it
unless they pass `devRoutes: true`.

The page loads its JavaScript and CSS from the jsDelivr CDN (`swagger-ui-dist`, pinned in
`SWAGGER_UI_VERSION` in `src/app.ts`), so the browser needs internet access. The CDN is a third-party
service: a compliance review is needed before the page is used in a government project, and it
stays off in production. To avoid the CDN, serve `swagger-ui-dist` yourself and pass its
location as the middleware's `baseUrl`.

## Development routes

`createApp({ devRoutes: true })`, which the server uses unless `NODE_ENV=production`, adds:

- `/api/docs`: the Swagger UI (see above).
- `GET /api/wt-tickets`: the parallel worktree tickets (`wt` tickets, not rows of the `tickets`
  table) as `[{ id (slot), name, gitBranch, services (dev servers that are up), url }]`, ordered
  by slot. The route runs `node scripts/wt.ts ls --json` of its own checkout (no shell, fixed
  arguments, 15 s timeout) and validates the output with Zod. If the CLI fails, it answers 503
  with a generic message; the details go to the API log only. It exposes no paths, PIDs or
  database settings. Tests pass `listWt` to replace the CLI call.

These routes describe the local machine and are never served in production. The OpenAPI
document (`pnpm openapi`) includes `/api/wt-tickets`, because it describes the dev server.

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
