# Parallel AI workflow — minimal pnpm monorepo

Goal: A minimal TypeScript pnpm monorepo (Hono API, Kysely + kysely-ctl + kysely-codegen,
Next.js web, PostgreSQL, Caddy, Vitest) in which several tickets can be worked on in parallel,
each in its own git worktree "slot" with its own databases, ports and URLs. The slots are
managed by a simplified port of the `wt` CLI from hsup-directus. The example feature is a page
that lists the rows of a `tickets` table, which it fetches from the API.

Scope: monorepo skeleton, local Docker stack (PostgreSQL, Caddy), a shared workspace package
`@repo/db` (`packages/db`) with one kysely-ctl migration (`tickets` table and one seed row)
and generated database types, used by the API as an example of a shared package, one OpenAPI-documented API
endpoint, one client-rendered Next.js page, Vitest tests, local DB backup/restore scripts, the
`wt` CLI, four repository skills (wt, checkbox-plan, playwright-cli, psql-docker), CLAUDE.md as
a dictionary with direct links to four `*.instructions.md` guides, AGENTS.md pointing to it.
· Not included: mobile app, Azure or any remote database, Valkey/cache, authentication,
CI/CD, production deployment, HTTPS.

## Phase 1 — Monorepo skeleton and local stack

- [x] 1.1 Set up the pnpm workspace: root `package.json` (`packageManager` pinned, Node version
      in `engines`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`, plus an
      `onlyBuiltDependencies` list for the packages whose install scripts must run, e.g.
      `esbuild`), shared `tsconfig.base.json`, `.nvmrc`, and `.gitignore` (`node_modules`,
      `.env*` except `*.example`, `db-backups/`, `dev-proxy/sites/*.caddy`, and the generated
      files: `packages/db/src/types.generated.ts`, `apps/api/openapi.json`, the web's
      generated API types)
- [x] 1.2 Add `docker-compose.yml` with `postgres` (official image, pinned major version, port
      bound to `127.0.0.1`, named volume, healthcheck) and `caddy` (pinned image,
      `extra_hosts: host.docker.internal:host-gateway`, port 80 on `127.0.0.1`)
- [x] 1.3 Add `dev-proxy/Caddyfile`: `auto_https off`, the main checkout's site
      `http://localhost`, and `import sites/*.caddy` for the slots. Routing per site:
      `/api/*` → API port, everything else → web port
- [x] 1.4 Add `.env.example` files with placeholder values only: root (`DB_HOST=127.0.0.1`,
      `DB_PORT=5432`, `DB_USER=app_dev`, `DB_PASSWORD=change-me`, `DB_DATABASE=app_dev`,
      `DB_TEST_DATABASE=app_test`), `apps/api` (`PORT`), `apps/web` (`PORT`). The root `.env`
      is the only place for database settings (see Notes)

Done when:

- [x] 1.A `pnpm install` succeeds on a clean clone without warnings about ignored build scripts
- [x] 1.B `docker compose up -d --wait` shows `postgres` as healthy
- [x] 1.C `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` succeeds

## Phase 2 — Shared database package and API

Depends on: Phase 1

- [x] 2.11 Create the workspace package `packages/db` (`@repo/db`, `private`). Its
      `package.json` `exports` points to the TypeScript source (`./src/index.ts`), so there
      is no build step. It has its own scripts (`migrate`, `migrate:down`, `migrate:make`,
      `migrate:list`, `codegen`, `typecheck`), and the root `db:*` scripts call them with
      `pnpm --filter @repo/db …`
- [x] 2.12 `packages/db/src/config.ts`: the connection settings are built from `DB_HOST`,
      `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_DATABASE`, read from the repository root's
      `.env` (process env wins), and the package stops with a clear message if one is
      missing. `DB_DATABASE` can be overridden per call, which the test setup uses for
      `DB_TEST_DATABASE`
- [x] 2.2 Add `kysely-ctl` to `packages/db` with `kysely.config.ts`: Postgres dialect from
      `config.ts`, migrations in `src/migrations`, `allowUnorderedMigrations: true` (see
      Notes). Root scripts: `db:migrate`, `db:migrate:down`, `db:migrate:make <name>`,
      `db:migrate:list`
- [x] 2.3 Create the migration with `pnpm db:migrate:make create_tickets`. `up` creates
      `tickets` (`id` identity primary key, `name` text not null unique, `git_branch` text not
      null, `services` text[] not null) and inserts one row: `name: 'demo-ticket'`,
      `git_branch: 'feature/demo-ticket'`, `services: ['api', 'web', 'postgres']`. `down` drops
      the table
- [x] 2.4 Add `kysely-codegen` to `packages/db`: `pnpm db:codegen` generates
      `packages/db/src/types.generated.ts` from the migrated database (Kysely's migration
      tables excluded). `pnpm db:migrate` and `pnpm db:migrate:down` run it afterwards, so
      the types always match the checkout's database. The file is git-ignored and never
      edited by hand
- [x] 2.5 Public API of the package (`src/index.ts`): `createDb()` (Kysely instance with the
      `pg` driver, typed with the generated `DB` interface) and the table types
      (`Selectable<Tickets>` etc.). Nothing else is exported; migrations and config
      internals stay private
- [x] 2.1 Create `apps/api`: Hono with `@hono/zod-openapi` and `@hono/node-server`, run with
      tsx (`dev`: `tsx watch src/index.ts`, `start`: `tsx src/index.ts`; `build` only
      type-checks, there is no JavaScript output). It depends on `"@repo/db": "workspace:*"`, creates one database instance
      with `createDb()` at start-up, and refuses to start without `PORT`
- [x] 2.6 Implement `GET /api/tickets` with a Zod response schema, querying through
      `@repo/db`; it returns `[{ "id": 1, "name": "…", "gitBranch": "…", "services": ["…"] }]`
- [x] 2.7 Serve the OpenAPI 3.1 document at `GET /api/openapi.json`; `pnpm openapi` writes it to
      `apps/api/openapi.json` (git-ignored) from the code, without a database or a running
      server
- [x] 2.8 Set up Vitest: a root `vitest.config.ts` with one project per app (this phase: `api`,
      Node environment). A global setup creates the database named in `DB_TEST_DATABASE` if
      it is missing and migrates it to the latest version with the `@repo/db` migrations
      (`DB_DATABASE` overridden). The API under test uses that database
- [x] 2.9 Add a Vitest test for `/api/tickets` (through `app.request`): status 200, the response
      matches the schema, the seed ticket is included
- [x] 2.10 Add root scripts: `dev` (every app's dev server in parallel), `build`, `test`,
      `typecheck`. Each one runs `pnpm openapi` first, chained explicitly in the script
      (`pnpm openapi && …`), not through `pre*` hooks

Done when:

- [x] 2.A `pnpm test` and `pnpm typecheck` pass
- [x] 2.B After `pnpm db:migrate`, `curl http://localhost:4000/api/tickets` returns the seed ticket
- [x] 2.C `curl http://localhost/api/openapi.json` (through Caddy) returns a valid OpenAPI document
- [x] 2.D `pnpm db:migrate:down` then `pnpm db:migrate` succeeds and leaves exactly one seed
      ticket; `pnpm db:migrate:list` shows the migration as applied
- [x] 2.E On a fresh clone (no generated files), `docker compose up -d --wait`,
      `pnpm db:migrate` and `pnpm typecheck` pass in that order, and `git status` lists no
      generated file
- [x] 2.F `pnpm test` leaves the development database (`app_dev`) unchanged
- [x] 2.G The API imports database code only through `@repo/db` (`rg "packages/db" apps/`
      finds no relative imports), `pnpm --filter api ls @repo/db` shows it as a workspace
      link, and `pnpm --filter @repo/db typecheck` passes on its own

## Phase 3 — Web app

Depends on: Phase 2

- [x] 3.1 Create `apps/web`: Next.js (App Router, TypeScript), `PORT` from the environment, and
      `allowedDevOrigins` for `localhost` and `*.localhost` in `next.config.ts` (check the
      installed version's behaviour)
- [x] 3.2 Generate the web's API types from `apps/api/openapi.json` with `openapi-typescript`
      (git-ignored); `pnpm openapi` now also regenerates them
- [x] 3.3 Add a client component (`"use client"`) on the start page: `fetch('/api/tickets')` on
      mount, a list or table of name, branch and services, and loading, empty and error states
- [x] 3.4 Add the Vitest `web` project (jsdom, Testing Library) and a component test with
      `fetch` mocked: the tickets are rendered; a failed request shows the error state

Done when:

- [x] 3.A `pnpm test` and `pnpm typecheck` pass
- [x] 3.B With `pnpm dev` running, `http://localhost` shows the seed ticket, and the browser's
      network log shows the client request to `/api/tickets` (checked with playwright-cli)
- [x] 3.C An edit to the component appears at `http://localhost` without a manual reload, and
      the browser console has no errors (hot reload through Caddy works)

## Phase 4 — Database snapshots and worktree slots

Depends on: Phase 3

- [x] 4.1 Port `scripts/lib/common.ts` (run, confirm, env file parse/upsert, process helpers),
      keeping only what the DB scripts and `wt` use
- [x] 4.2 Port `scripts/lib/db.ts`: config from the root `.env`, `psql` via
      `docker compose exec` (password through the environment, never on the command line),
      `dropDatabase … WITH (FORCE)`, `createDatabase`, `restoreDump` with `ON_ERROR_STOP`,
      `newestDump`. No Valkey
- [x] 4.3 `scripts/db-backup.ts` (`pnpm db:backup`): `pg_dump` of the local main database inside
      the postgres container (no Azure, no Key Vault) to
      `db-backups/dump-app-dev-<date>-<HHMM>.sql`, written to a temporary file and renamed on
      success
- [x] 4.4 `scripts/db-restore.ts` (`pnpm db:restore`): restores the newest dump (or `--file`)
      into `--db` (default: the main database); asks for confirmation, `--yes` skips it
- [x] 4.5 Port `scripts/wt.ts` (`pnpm wt`) with the simplified slot model: one worktree per
      ticket in `../wt/<ticket>/`; slot N = 1–9; API port `4000+N*100`; web port
      `3000+N*100`; databases `app_wt_<ticket>` and `app_wt_<ticket>_test`; URL
      `http://sN.localhost`. Keep the locked `wt-state.json`, options objects for functions
      with more than 3 parameters, and the `--yes`/terminal confirmation rules
- [x] 4.6 Commands: `new <branch> [--base <ref>] [--dump <file>] [--slot N]`, `dev`, `park`,
      `reset [--latest]`, `rm`, `ls`, `info`, `claude-access`, `help`. Not ported: `modify`,
      web/mobile options, the extension build cache, the npm-to-pnpm lock conversion, Valkey,
      `docker-compose.slot.yml`, shared services other than postgres and caddy
- [x] 4.7 `new`, databases: both ticket databases are restored from the newest dump (or
      `--dump`), and then migrated with `pnpm db:migrate` in the worktree, so migrations that
      exist only on the branch are applied to that slot only. Without a dump, `new` stops with
      a hint to run `pnpm db:backup`
- [x] 4.8 `new`, files: worktree, `pnpm install --frozen-lockfile`, and the generated env files.
      The worktree's root `.env` sets `DB_DATABASE=app_wt_<ticket>` and
      `DB_TEST_DATABASE=app_wt_<ticket>_test` (used by `@repo/db`, the scripts and
      psql-docker); `apps/api/.env` and `apps/web/.env.local` set only `PORT`.
      It also writes `dev-proxy/sites/sN.caddy` (and reloads Caddy), plus `CLAUDE.local.md` and
      a `.code-workspace` in the ticket folder
- [x] 4.9 `dev`/`park`: start and stop the API and web dev servers in the background, with
      logs in `../wt/<ticket>/logs/`; `dev` ends with the status block. Process handling uses
      only Node built-ins and works the same on Linux, macOS and Windows:
    - [x] 4.9.1 Running state comes from the slot's ports. A server counts as running when a
          TCP connection to its port succeeds (`node:net`); `ls`, `info`, `dev` and `park`
          use this check. The stored PID is used only for stopping. No working-directory
          check, so a reused PID can no longer be mistaken for a running server
    - [x] 4.9.2 Stopping goes through one helper with a single platform branch. On POSIX,
          the server is started `detached` (its own process group) and stopped with
          `process.kill(-pid)`, SIGTERM first and SIGKILL after a timeout. On Windows it is
          stopped with `taskkill /PID <pid> /T /F`. `park` then waits until the ports are
          closed, and it reports any port that stays open
- [x] 4.10 `reset`: restores both ticket databases from the ticket's dump (`--latest`: the
      newest dump) and migrates them
- [x] 4.11 `rm`: refuses with uncommitted changes; removes processes, both databases, the Caddy
      site and the worktree; the branch stays
- [x] 4.12 Add `.claude/skills/wt/SKILL.md`, adapted from hsup-directus (`/wt <ticket>`, the
      command table with an "ask first" column, pitfalls)

Done when:

- [x] 4.A `pnpm db:backup` creates a dump. After the seed ticket's `git_branch` is changed,
      `pnpm db:restore --yes` restores the original value
- [x] 4.B Restoring a truncated dump fails with a non-zero exit code and a clear message
- [x] 4.C `pnpm wt new feature/demo-one` and `… feature/demo-two` run at the same time:
      `http://s1.localhost` and `http://s2.localhost` both show the ticket list, and
      `pnpm wt ls` lists both
- [x] 4.D A ticket inserted in slot 1 appears only at `http://s1.localhost`;
      `pnpm wt reset demo-one --yes` removes it again
- [x] 4.E `pnpm test` runs in both worktrees at the same time, passes in both, and neither run
      changes the other slot's databases or `app_dev`
- [x] 4.F A migration created and applied with `pnpm db:migrate` in slot 1 changes only slot
      1's database and slot 1's generated types
- [x] 4.G Unordered migrations: a migration is created in slot 1, then one in slot 2. The
      slot 2 branch is merged into `main` first, then the slot 1 branch. `pnpm db:migrate` on
      main applies both without errors
- [x] 4.H `pnpm wt rm demo-one --yes` leaves no route, database, process or worktree
      (`pnpm wt ls`, `git worktree list`, `psql \l`)
- [x] 4.I After `pnpm wt park demo-one`, the slot's API and web ports are closed and no
      process of the slot is left, including the workers that `next dev` starts (checked
      with `ps` on Linux)

## Phase 5 — Documentation and agent skills

Depends on: Phase 4

- [x] 5.1 Write `docs/instructions/<area>.instructions.md` with `applyTo` front matter. Each file
      covers purpose, commands, conventions and pitfalls:
    - [x] 5.1.1 `api.instructions.md`: app structure, adding an OpenAPI route with a Zod
          schema, environment variables, `pnpm openapi`
    - [x] 5.1.2 `web.instructions.md`: Next.js structure, client components, data fetching
          through `/api` (same origin via Caddy), generated API types
    - [x] 5.1.3 `database.instructions.md`: the `@repo/db` package as the example of a shared
          workspace package (what it exports, how an app adds it with `workspace:*`, why it
          has no build step, how to add another shared package the same way); the
          schema-change workflow (`db:migrate:make` →
          `up`/`down` → `db:migrate`, which regenerates the types → commit the migration);
          migration rules (one change per migration, no edits after merge, unordered
          migrations allowed); slot databases and backup/restore; data inspection with the
          psql-docker skill (direct link)
    - [x] 5.1.4 `testing.instructions.md`: Vitest projects, the test database per checkout,
          API and component tests, `pnpm test` options, and the browser testing section (5.2)
          with a direct link to the playwright-cli skill
    - [x] 5.1.5 In the api and database guides: generated files (`types.generated.ts`,
          `openapi.json`, the web's API types) are git-ignored, are never edited, and are
          recreated by `db:migrate` and by the `dev`/`build`/`test`/`typecheck` scripts.
          After a pull, merge or rebase that brings in migrations, run `pnpm db:migrate`
- [x] 5.2 Copy the browser testing section of the user-level guide into
      `testing.instructions.md` with **playwright-cli only**. Keep: when to check in a
      browser, the narrow viewport (375×667, `playwright-cli resize 375 667`), the required
      checks (URL and page content, record counts), the report sections (Completed,
      Verification, Problems, Next action), and that a sub-agent's report is not independent
      verification. Remove: vscode-browser, the integrated browser, Expo/mobile, and all
      tool- or model-specific parts (Agent calls, model names, effort levels, forks).
      Delegation is worded neutrally
- [x] 5.3 Copy the playwright-cli skill (`SKILL.md` and `references/`) to
      `.claude/skills/playwright-cli/`. Its link to the user-level guide is changed to
      `testing.instructions.md`, and the wording about effort levels is removed
- [x] 5.4 Copy the psql-docker skill to `.claude/skills/psql-docker/`:
    - [x] 5.4.1 Port `psql.js` to TypeScript (`psql.ts`) without changing its behaviour:
          read-only by default, statement timeout, 100-line output cap, password through the
          environment only, `--show-config`
    - [x] 5.4.2 In `SKILL.md`: repository path (`node .claude/skills/psql-docker/psql.ts`, run
          from the repository root), the default image set to the compose `postgres` image,
          neutral wording instead of tool-specific references; safety rules and the rule to
          show SQL and result rows kept
- [x] 5.5 Copy the checkbox-plan skill to `.claude/skills/checkbox-plan/SKILL.md`, with its
      default plan location set to `docs/plan/<slug>.md` and no tool- or model-specific text
- [x] 5.6 Write `CLAUDE.md` as a dictionary: a glossary (slot, wt ticket, `tickets` table, main
      checkout, dump, migration, generated types, workspace package, …), short entries for the
      monorepo layout (`apps/` vs `packages/`),
      Caddy routing and `wt`, an "Instructions" table and a "Skills" table with direct
      relative links. It contains no detailed procedures
- [x] 5.7 Add `AGENTS.md`: a short statement that `CLAUDE.md` is the project's dictionary,
      with a link to it. It repeats no content
- [x] 5.8 Write `README.md`: supported environments (Linux, macOS, Windows through WSL2 with
      the repository in the Linux file system; native Windows untested, see Notes),
      prerequisites (Node, pnpm, Docker, playwright-cli), quick start
      (stack up, `pnpm db:migrate`, `pnpm dev`), links to `CLAUDE.md`, `AGENTS.md`, the
      guides and the skills, and a note that the skills live in `.claude/skills/` (Claude
      Code's location). For an agent that does not read that folder, rename the folder or
      symlink it to the location that agent reads

Done when:

- [x] 5.A Every term and command used in the guides is defined in `CLAUDE.md` or in the guide
      itself, and every link resolves
- [x] 5.B Following `README.md` from a clean clone ends with the seed ticket shown at
      `http://localhost`
- [x] 5.C `CLAUDE.md` links directly to the four guides and the four skills
- [x] 5.D `AGENTS.md` links to `CLAUDE.md` and duplicates none of its content
- [x] 5.E `rg -i 'vscode-browser|integrated browser|haiku|sonnet|opus|subagent_type|effort|/home/|~/\.claude|~/\.agents'`
      over `docs/instructions/` and the checkbox-plan, playwright-cli and psql-docker skills
      finds nothing
- [x] 5.F From the repository root,
      `node .claude/skills/psql-docker/psql.ts 'select name from tickets'` returns the seed
      ticket, and an `insert` without `--rw` fails as read-only
- [x] 5.G In a slot's worktree, `psql.ts --show-config` reports that slot's database

## Notes

- **Directory layout** (target; *generated* files are git-ignored):

  ```
  parallel-ai-workflow/
  ├── AGENTS.md  CLAUDE.md  README.md
  ├── package.json  pnpm-workspace.yaml  pnpm-lock.yaml
  ├── tsconfig.base.json  vitest.config.ts  docker-compose.yml
  ├── .env.example  .gitignore  .nvmrc
  ├── apps/
  │   ├── api/
  │   │   ├── package.json                     # depends on "@repo/db": "workspace:*"
  │   │   ├── tsconfig.json  .env.example      # PORT only
  │   │   ├── openapi.json                     # generated
  │   │   ├── scripts/write-openapi.ts         # `pnpm openapi`
  │   │   ├── test/global-setup.ts             # creates + migrates the test database
  │   │   └── src/
  │   │       ├── index.ts                     # starts the server (PORT)
  │   │       ├── app.ts                       # Hono app + OpenAPI doc, no listen()
  │   │       ├── env.ts                       # required env vars, fails fast
  │   │       └── routes/tickets.ts  routes/tickets.test.ts
  │   └── web/
  │       ├── package.json  tsconfig.json  next.config.ts  .env.example
  │       └── src/
  │           ├── app/layout.tsx  app/page.tsx
  │           ├── components/tickets-list.tsx  components/tickets-list.test.tsx
  │           └── lib/api-types.generated.ts   # generated (openapi-typescript)
  ├── packages/
  │   └── db/                                  # @repo/db, shared workspace package
  │       ├── package.json                     # exports ./src/index.ts, no build step
  │       ├── tsconfig.json  kysely.config.ts
  │       └── src/
  │           ├── index.ts                     # public API: createDb(), table types
  │           ├── config.ts                    # DB_* from the root .env
  │           ├── client.ts
  │           ├── types.generated.ts           # generated (kysely-codegen)
  │           └── migrations/<timestamp>_create_tickets.ts
  ├── dev-proxy/
  │   ├── Caddyfile
  │   └── sites/                               # sN.caddy written by wt (ignored), .gitkeep
  ├── scripts/                                 # repo tooling, plain `node`, no dependencies
  │   ├── tsconfig.json
  │   ├── lib/common.ts  lib/db.ts
  │   └── db-backup.ts  db-restore.ts  wt.ts
  ├── db-backups/                              # dumps (ignored)
  ├── docs/
  │   ├── plan/parallel-workflow-monorepo.md
  │   └── instructions/{api,web,database,testing}.instructions.md
  └── .claude/skills/
      ├── wt/SKILL.md
      ├── checkbox-plan/SKILL.md
      ├── playwright-cli/SKILL.md  playwright-cli/references/
      └── psql-docker/SKILL.md  psql-docker/psql.ts

  ../wt/                                       # created by wt, outside the repository
  ├── wt-state.json
  └── <ticket>/
      ├── parallel-ai-workflow/                # the git worktree
      ├── logs/                                # api.log, web.log
      ├── CLAUDE.local.md
      └── <ticket>.code-workspace
  ```

  `app.ts` is separate from `index.ts` so that tests and `write-openapi.ts` can import the
  app without starting a server. Tests are placed next to the code they test. The web does
  not use `@repo/db`; it gets its types from `openapi.json`.
- **Shared package `@repo/db`:** an example of how a workspace package works, even though
  only the API uses it for now. It is an "internal" package: `exports` points to the
  TypeScript source, and the consumers (tsx, Vitest, `tsc` with bundler module resolution)
  compile it themselves, so it has no build step and changes need no rebuild. The API runs
  through tsx in `dev` and `start` (decided), because Node's own type stripping refuses `.ts`
  files under `node_modules`; so the API has no compile step either. Plain `node` is used
  only for the repo scripts in `scripts/`, which import nothing from the workspace. The
  `@repo/` scope is local-only and never published.
- **Database settings come only from the root `.env`:** `DB_*` is read by Docker Compose,
  `@repo/db` (and therefore the API, kysely-ctl and kysely-codegen), the DB scripts and
  psql-docker. There is no `DATABASE_URL` in the app `.env` files, so a checkout has one
  place that names its database, and `wt` only rewrites `DB_DATABASE` and
  `DB_TEST_DATABASE` there.
- **Language:** everything that has a TypeScript form is TypeScript (including
  `kysely.config.ts`, `vitest.config.ts`, `psql.ts`). Exceptions: `docker-compose.yml`,
  `Caddyfile`, `.env*`, JSON/YAML config. Scripts run directly with `node` (type stripping,
  Node ≥ 22.18; exact version in `.nvmrc`).
- **Routing:** one origin per checkout (`http://localhost` for main, `http://sN.localhost` for
  slot N); Caddy routes `/api/*` to the API. No CORS and no separate API hostname, but the web
  app works only through Caddy. `*.localhost` resolves in browsers only; host tools use the
  ports. Dev servers run on the host. Only PostgreSQL and Caddy are containers, shared by all
  slots.
- **`tickets` table:** `services` is `text[]`. Columns are snake_case, and the API returns
  camelCase (`gitBranch`). The table has an `id` primary key as well as the three requested
  columns, and `name` is unique. The seed row is part of the migration as requested. Later
  demo data would go into kysely-ctl seeds. The `tickets` table (demo data) and a `wt` ticket
  (a worktree slot) are different things, and the CLAUDE.md glossary has to make that clear.
- **Databases per checkout:** main uses `app_dev` and `app_test`. Each wt ticket gets
  `app_wt_<ticket>` and `app_wt_<ticket>_test`, both restored from the newest dump and then
  migrated. Parallel test runs therefore never share a database. `reset` keeps the ticket's
  dump as its fixed starting point unless `--latest` is given. A dump contains the
  `kysely_migration` tables, so `db:migrate` after a restore applies only the branch's newer
  migrations.
- **Unordered migrations:** kysely-ctl names migrations by timestamp, and parallel branches
  merge in any order. `allowUnorderedMigrations: true` lets an older migration that arrives
  later still run (4.G). It has to be confirmed that kysely-ctl passes the option through to
  Kysely's `Migrator`.
- **Generated files are git-ignored:** `types.generated.ts` (kysely-codegen, from the live
  migrated database), `openapi.json` and the web's API types. This avoids merge conflicts
  between parallel branches, and each checkout's database types match its own database
  (`db:migrate` runs codegen; in a slot it reads the slot's database). The schema and API
  changes stay reviewable in the migrations and the Zod route schemas. The cost: on a fresh
  clone, `typecheck` and the editor need the database up and migrated first, and a future CI
  needs a Postgres service.
- **Docs layout:** CLAUDE.md is the dictionary and links to the guides with plain Markdown
  links, not `@path` imports, so an agent opens only the guide it needs. AGENTS.md only points
  to CLAUDE.md. The guides are in `docs/instructions/`; for VS Code Copilot to use them, that
  folder has to be added to `chat.instructionsFilesLocations`.
- **Skills:** they stay in `.claude/skills/` (README explains renaming or symlinking for other
  agents). The copied skills contain no tool- or model-specific text. The `wt` skill stays
  specific to Claude Code (`/wt`, `claude-access`). The playwright-cli `allowed-tools` front
  matter is kept; other agents ignore it.
- **Windows:** the supported environments are Linux, macOS and Windows through WSL2. On
  WSL2, the repository belongs in the Linux file system (e.g. `~/projects`), not under
  `/mnt/c`, where installs and hot-reload file watching are slow and unreliable. Native
  Windows is untested. pnpm's workspace links work there (directory junctions, no admin
  rights). Process handling in `wt` is written to be cross-platform (4.9.1: running state
  from the ports; 4.9.2: `taskkill /T` on Windows), but it has only been tested on POSIX.
  Other problems `wt` may run into:
  - path length: `..\wt\<ticket>\parallel-ai-workflow\node_modules\.pnpm\…` can exceed
    260 characters (enable `LongPathsEnabled` and `git config core.longpaths true`);
  - a pnpm store on another drive than the worktrees: pnpm copies instead of hard-linking,
    so each `wt new` install is slower and uses more disk;
  - shell differences in commands that `wt` runs (quoting, `docker compose exec` with
    redirected input) and line endings (`core.autocrlf` must not change scripts or SQL).
  The README states the supported environments. Native Windows support for `wt` is a
  possible follow-up.
- **Versions:** current versions are looked up and pinned at implementation time. kysely-ctl
  is still 0.x.
- **Security:** `.env.example` files contain placeholders only. Real `.env` files, dumps and
  generated Caddy sites are git-ignored. PostgreSQL and Caddy listen on `127.0.0.1` only.
  Plain HTTP is for local development only. Raw `sql` templates in Kysely must not interpolate
  untrusted strings. Tests never touch a development database. psql-docker is read-only unless
  the user explicitly asks for `--rw`, and it is for the local database only. Dumps of real
  data must not be put in this repository (GDPR, data minimisation).
- **Compliance:** Hono, `@hono/zod-openapi`, Zod, Kysely, kysely-ctl, kysely-codegen, `pg`,
  Next.js/React, openapi-typescript, Vitest, Testing Library, jsdom, tsx,
  playwright-cli/Playwright, and the `postgres` and `caddy` images are third-party
  dependencies. Each requires compliance review before it is used in government projects.
- **Workflow:** implement one phase at a time, check its "Done when" items, then stop for
  review. The user makes all commits.
- Possible follow-ups: Swagger UI at `/api/docs`; a second shared package (e.g.
  `packages/api-contract` with the Zod schemas, if the web should share them); CI for `test`/`typecheck` (with a Postgres service); a Playwright smoke
  test per slot; moving the skills to a tool-neutral `.agents/skills/` folder.
