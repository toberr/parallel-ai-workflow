# Parallel AI workflow: project dictionary

A minimal TypeScript pnpm monorepo (Hono API, Kysely database package, Next.js web, PostgreSQL,
Caddy, Vitest) in which several tickets are worked on in parallel, each in its own git worktree
with its own databases, ports and URL. This file is a dictionary: it defines terms and points to
the guides and skills that hold the procedures. It contains no step-by-step instructions.

## Glossary

| Term | Meaning |
|---|---|
| **main checkout** | The repository clone that is not a worktree. It stays on `main`, uses `app_dev`/`app_test`, ports 3000 (web) and 4000 (API) and the URL `http://localhost`. |
| **worktree** | A git worktree of a ticket's branch, in `../wt/<ticket>/parallel-ai-workflow/`. |
| **slot** | The number N (1 to 9) a `wt` ticket occupies: it fixes the ports, the URL and the database names of that worktree. |
| **`wt` ticket** | A unit of parallel work managed by `pnpm wt`: one worktree, one branch, one slot, two databases. Named after the last part of the branch (`feature/demo-one` gives `demo-one`). Not a row of the `tickets` table. |
| **`tickets` table** | The demo table in the database (`id`, `name`, `git_branch`, `services`), seeded by the first migration and listed by the web page. Unrelated to `wt` tickets, although the seed row is called `demo-ticket`. |
| **port scheme** | Slot N: API `4000 + N*100`, web `3000 + N*100`, URL `http://sN.localhost`, databases `app_wt_<ticket>` and `app_wt_<ticket>_test` (hyphens become underscores). |
| **shared stack** | The two containers `postgres` and `caddy` from `docker-compose.yml`, started once and used by the main checkout and every slot. Never stop or recreate them for a single slot. |
| **Caddy** | The reverse proxy in the shared stack. Per checkout, one origin: `/api/*` goes to the API, everything else to the web. Slot routes are `dev-proxy/sites/sN.caddy`, written by `wt` (git-ignored). |
| **`PROXY_PORT`** | Host port of Caddy, set in the root `.env` (default 80). When it is not 80, every URL carries it, for example `http://localhost:8080`. |
| **`DB_*`, `DB_PORT`** | Database settings in the root `.env` (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `DB_TEST_DATABASE`). `DB_PORT` is the host port of the postgres container. Never exported in a shell. |
| **`PORT`** | Listen port of one app, in `apps/api/.env` and `apps/web/.env.local`. Never exported in a shell. |
| **migration** | A kysely-ctl file in `packages/db/src/migrations/` that changes the schema (`up`/`down`). Created with `pnpm db:migrate:make`, applied with `pnpm db:migrate`. |
| **dump** | An SQL file in `db-backups/` written by `pnpm db:backup`. New slots restore their databases from it. Git-ignored; no real data. |
| **generated files** | `packages/db/src/types.generated.ts`, `apps/api/openapi.json` and `apps/web/src/lib/api-types.generated.ts`. Git-ignored, never edited, recreated by `pnpm db:migrate` and by the `dev`, `build`, `test` and `typecheck` scripts. |
| **workspace package** | A package in `packages/` that apps depend on with `"workspace:*"`; here `@repo/db`. It is consumed as TypeScript source and has no build step. |

## Monorepo layout

- `apps/api`: Hono API with OpenAPI documentation (run with `tsx`).
- `apps/web`: Next.js web app; it fetches `/api/tickets` in the browser.
- `packages/db`: `@repo/db`, the shared workspace package: migrations, generated types, `createDb()`.
- `apps/` holds deployable applications with their own ports; `packages/` holds libraries that apps import.
- `scripts/`: repository tooling run with plain `node` (`wt`, database backup and restore).
- `dev-proxy/`: Caddy configuration. `docker-compose.yml`: the shared stack.
- `docs/instructions/`: the guides below. `docs/plan/`: plans.
- `.claude/skills/`: the skills below.

## Caddy routing

One origin per checkout: `http://localhost` (main checkout) or `http://sN.localhost` (slot N),
each with `:<PROXY_PORT>` when that is not 80. `*.localhost` resolves in browsers only; command-line
tools use the ports of the port scheme. Dev servers run on the host; only PostgreSQL and Caddy
are containers.

## Worktree tickets (`wt`)

`pnpm wt` creates, starts, parks, resets and removes `wt` tickets (`pnpm wt help` lists the
commands). The session stays in the main checkout; ticket work targets the worktree explicitly.
The procedure for attaching to a ticket is in the `wt` skill.

## Instructions

| Guide | Applies to | Covers |
|---|---|---|
| [api.instructions.md](docs/instructions/api.instructions.md) | `apps/api` | API structure, adding an OpenAPI route, environment, `pnpm openapi` |
| [web.instructions.md](docs/instructions/web.instructions.md) | `apps/web` | Next.js structure, client components, `/api` through Caddy, generated API types |
| [database.instructions.md](docs/instructions/database.instructions.md) | `packages/db`, `scripts/db-*.ts` | `@repo/db`, shared packages, schema-change workflow, migrations, backup and restore |
| [testing.instructions.md](docs/instructions/testing.instructions.md) | tests, `vitest.config.ts` | Vitest projects, test database, browser testing |

## Skills

| Skill | Use for |
|---|---|
| [wt](.claude/skills/wt/SKILL.md) | Working on a ticket in a slot: `/wt <ticket>`, creating, starting, parking, resetting, removing |
| [checkbox-plan](.claude/skills/checkbox-plan/SKILL.md) | Writing a checkbox plan in `docs/plan/` |
| [playwright-cli](.claude/skills/playwright-cli/SKILL.md) | Driving and checking pages in a browser |
| [psql-docker](.claude/skills/psql-docker/SKILL.md) | Read-only inspection of the local database |

## Conventions

- Everything that can be TypeScript is TypeScript. Imports use explicit `.ts` extensions.
- Use placeholder data in code, docs and examples; never real names, identifiers or personal data.
