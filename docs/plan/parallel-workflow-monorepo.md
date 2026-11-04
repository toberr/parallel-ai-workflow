# Parallel AI workflow — minimal pnpm monorepo

Goal: A minimal TypeScript pnpm monorepo (Hono API, Kysely + kysely-ctl + kysely-codegen,
Next.js web, PostgreSQL, Caddy, Vitest) in which several tickets can be worked on in parallel,
each in its own git worktree "slot" with its own databases, ports and URLs. The slots are
managed by a simplified port of the `wt` CLI from hsup-directus. The example feature is a page
that lists the rows of a `tickets` table, which it fetches from the API.

Scope: monorepo skeleton, local Docker stack (PostgreSQL, Caddy), one kysely-ctl migration
(`tickets` table and one seed row) with generated database types, one OpenAPI-documented API
endpoint, one client-rendered Next.js page, Vitest tests, local DB backup/restore scripts, the
`wt` CLI, four repository skills (wt, checkbox-plan, playwright-cli, psql-docker), CLAUDE.md as
a dictionary with direct links to four `*.instructions.md` guides, AGENTS.md pointing to it.
· Not included: mobile app, Azure or any remote database, Valkey/cache, authentication,
CI/CD, production deployment, HTTPS.

## Phase 1 — Monorepo skeleton and local stack

- [ ] 1.1 Set up the pnpm workspace: root `package.json` (`packageManager` pinned, Node version
      in `engines`), `pnpm-workspace.yaml` (`apps/*`, plus an `onlyBuiltDependencies` list
      for the packages whose install scripts must run, e.g. `esbuild`), shared
      `tsconfig.base.json`, `.nvmrc`, and `.gitignore` (`node_modules`, `.env*` except
      `*.example`, `db-backups/`, `dev-proxy/sites/*.caddy`, and the generated files:
      `apps/api/src/db/types.generated.ts`, `apps/api/openapi.json`, the web's generated API
      types)
- [ ] 1.2 Add `docker-compose.yml` with `postgres` (official image, pinned major version, port
      bound to `127.0.0.1`, named volume, healthcheck) and `caddy` (pinned image,
      `extra_hosts: host.docker.internal:host-gateway`, port 80 on `127.0.0.1`)
- [ ] 1.3 Add `dev-proxy/Caddyfile`: `auto_https off`, the main checkout's site
      `http://localhost`, and `import sites/*.caddy` for the slots. Routing per site:
      `/api/*` → API port, everything else → web port
- [ ] 1.4 Add `.env.example` files with placeholder values only: root (`DB_HOST=127.0.0.1`,
      `DB_PORT=5432`, `DB_USER=app_dev`, `DB_PASSWORD=change-me`, `DB_DATABASE=app_dev`),
      `apps/api` (`PORT`, `DATABASE_URL`, `TEST_DATABASE_URL`), `apps/web` (`PORT`)

Done when:

- [ ] 1.A `pnpm install` succeeds on a clean clone without warnings about ignored build scripts
- [ ] 1.B `docker compose up -d --wait` shows `postgres` as healthy
- [ ] 1.C `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` succeeds

## Phase 2 — Database and API

Depends on: Phase 1

- [ ] 2.1 Create `apps/api`: Hono with `@hono/zod-openapi` and `@hono/node-server`, started with
      `tsx watch`. It refuses to start without `PORT` and `DATABASE_URL`
- [ ] 2.2 Add `kysely-ctl` with `kysely.config.ts`: Postgres dialect from `DATABASE_URL`,
      migrations in `src/db/migrations`, `allowUnorderedMigrations: true` (see Notes). Root
      scripts: `db:migrate`, `db:migrate:down`, `db:migrate:make <name>`, `db:migrate:list`
- [ ] 2.3 Create the migration with `pnpm db:migrate:make create_tickets`. `up` creates
      `tickets` (`id` identity primary key, `name` text not null unique, `git_branch` text not
      null, `services` text[] not null) and inserts one row: `name: 'demo-ticket'`,
      `git_branch: 'feature/demo-ticket'`, `services: ['api', 'web', 'postgres']`. `down` drops
      the table
- [ ] 2.4 Add `kysely-codegen`: `pnpm db:codegen` generates `src/db/types.generated.ts` from the
      migrated database (Kysely's migration tables excluded). `pnpm db:migrate` and
      `pnpm db:migrate:down` run it afterwards, so the types always match the checkout's
      database. The file is git-ignored and never edited by hand
- [ ] 2.5 Create the Kysely instance (`src/db/client.ts`, `pg` driver, `DATABASE_URL`), typed
      with the generated `DB` interface
- [ ] 2.6 Implement `GET /api/tickets` with a Zod response schema; it returns
      `[{ "id": 1, "name": "…", "gitBranch": "…", "services": ["…"] }]`
- [ ] 2.7 Serve the OpenAPI 3.1 document at `GET /api/openapi.json`; `pnpm openapi` writes it to
      `apps/api/openapi.json` (git-ignored) from the code, without a database or a running
      server
- [ ] 2.8 Set up Vitest: a root `vitest.config.ts` with one project per app (this phase: `api`,
      Node environment). A global setup creates the database in `TEST_DATABASE_URL` if it is
      missing and migrates it to the latest version
- [ ] 2.9 Add a Vitest test for `/api/tickets` (through `app.request`): status 200, the response
      matches the schema, the seed ticket is included
- [ ] 2.10 Add root scripts: `dev` (every app's dev server in parallel), `build`, `test`,
      `typecheck`. Each one runs `pnpm openapi` first, chained explicitly in the script
      (`pnpm openapi && …`), not through `pre*` hooks

Done when:

- [ ] 2.A `pnpm test` and `pnpm typecheck` pass
- [ ] 2.B After `pnpm db:migrate`, `curl http://localhost:4000/api/tickets` returns the seed ticket
- [ ] 2.C `curl http://localhost/api/openapi.json` (through Caddy) returns a valid OpenAPI document
- [ ] 2.D `pnpm db:migrate:down` then `pnpm db:migrate` succeeds and leaves exactly one seed
      ticket; `pnpm db:migrate:list` shows the migration as applied
- [ ] 2.E On a fresh clone (no generated files), `docker compose up -d --wait`,
      `pnpm db:migrate` and `pnpm typecheck` pass in that order, and `git status` lists no
      generated file
- [ ] 2.F `pnpm test` leaves the development database (`app_dev`) unchanged

## Phase 3 — Web app

Depends on: Phase 2

- [ ] 3.1 Create `apps/web`: Next.js (App Router, TypeScript), `PORT` from the environment, and
      `allowedDevOrigins` for `localhost` and `*.localhost` in `next.config.ts` (check the
      installed version's behaviour)
- [ ] 3.2 Generate the web's API types from `apps/api/openapi.json` with `openapi-typescript`
      (git-ignored); `pnpm openapi` now also regenerates them
- [ ] 3.3 Add a client component (`"use client"`) on the start page: `fetch('/api/tickets')` on
      mount, a list or table of name, branch and services, and loading, empty and error states
- [ ] 3.4 Add the Vitest `web` project (jsdom, Testing Library) and a component test with
      `fetch` mocked: the tickets are rendered; a failed request shows the error state

Done when:

- [ ] 3.A `pnpm test` and `pnpm typecheck` pass
- [ ] 3.B With `pnpm dev` running, `http://localhost` shows the seed ticket, and the browser's
      network log shows the client request to `/api/tickets` (checked with playwright-cli)
- [ ] 3.C An edit to the component appears at `http://localhost` without a manual reload, and
      the browser console has no errors (hot reload through Caddy works)

## Phase 4 — Database snapshots and worktree slots

Depends on: Phase 3

- [ ] 4.1 Port `scripts/lib/common.ts` (run, confirm, env file parse/upsert, process helpers),
      keeping only what the DB scripts and `wt` use
- [ ] 4.2 Port `scripts/lib/db.ts`: config from the root `.env`, `psql` via
      `docker compose exec` (password through the environment, never on the command line),
      `dropDatabase … WITH (FORCE)`, `createDatabase`, `restoreDump` with `ON_ERROR_STOP`,
      `newestDump`. No Valkey
- [ ] 4.3 `scripts/db-backup.ts` (`pnpm db:backup`): `pg_dump` of the local main database inside
      the postgres container (no Azure, no Key Vault) to
      `db-backups/dump-app-dev-<date>-<HHMM>.sql`, written to a temporary file and renamed on
      success
- [ ] 4.4 `scripts/db-restore.ts` (`pnpm db:restore`): restores the newest dump (or `--file`)
      into `--db` (default: the main database); asks for confirmation, `--yes` skips it
- [ ] 4.5 Port `scripts/wt.ts` (`pnpm wt`) with the simplified slot model: one worktree per
      ticket in `../wt/<ticket>/`; slot N = 1–9; API port `4000+N*100`; web port
      `3000+N*100`; databases `app_wt_<ticket>` and `app_wt_<ticket>_test`; URL
      `http://sN.localhost`. Keep the locked `wt-state.json`, options objects for functions
      with more than 3 parameters, and the `--yes`/terminal confirmation rules
- [ ] 4.6 Commands: `new <branch> [--base <ref>] [--dump <file>] [--slot N]`, `dev`, `park`,
      `reset [--latest]`, `rm`, `ls`, `info`, `claude-access`, `help`. Not ported: `modify`,
      web/mobile options, the extension build cache, the npm-to-pnpm lock conversion, Valkey,
      `docker-compose.slot.yml`, shared services other than postgres and caddy
- [ ] 4.7 `new`, databases: both ticket databases are restored from the newest dump (or
      `--dump`), and then migrated with `pnpm db:migrate` in the worktree, so migrations that
      exist only on the branch are applied to that slot only. Without a dump, `new` stops with
      a hint to run `pnpm db:backup`
- [ ] 4.8 `new`, files: worktree, `pnpm install --frozen-lockfile`, and the generated env files.
      The worktree's root `.env` sets `DB_DATABASE=app_wt_<ticket>`, `apps/api/.env` sets
      `PORT`, `DATABASE_URL` and `TEST_DATABASE_URL`, and `apps/web/.env.local` sets `PORT`.
      It also writes `dev-proxy/sites/sN.caddy` (and reloads Caddy), plus `CLAUDE.local.md` and
      a `.code-workspace` in the ticket folder
- [ ] 4.9 `dev`/`park`: start and stop the API and web dev servers in the background with PID
      tracking (pid + cwd check) and logs in `../wt/<ticket>/logs/`; `dev` ends with the
      status block
- [ ] 4.10 `reset`: restores both ticket databases from the ticket's dump (`--latest`: the
      newest dump) and migrates them
- [ ] 4.11 `rm`: refuses with uncommitted changes; removes processes, both databases, the Caddy
      site and the worktree; the branch stays
- [ ] 4.12 Add `.claude/skills/wt/SKILL.md`, adapted from hsup-directus (`/wt <ticket>`, the
      command table with an "ask first" column, pitfalls)

Done when:

- [ ] 4.A `pnpm db:backup` creates a dump. After the seed ticket's `git_branch` is changed,
      `pnpm db:restore --yes` restores the original value
- [ ] 4.B Restoring a truncated dump fails with a non-zero exit code and a clear message
- [ ] 4.C `pnpm wt new feature/demo-one` and `… feature/demo-two` run at the same time:
      `http://s1.localhost` and `http://s2.localhost` both show the ticket list, and
      `pnpm wt ls` lists both
- [ ] 4.D A ticket inserted in slot 1 appears only at `http://s1.localhost`;
      `pnpm wt reset demo-one --yes` removes it again
- [ ] 4.E `pnpm test` runs in both worktrees at the same time, passes in both, and neither run
      changes the other slot's databases or `app_dev`
- [ ] 4.F A migration created and applied with `pnpm db:migrate` in slot 1 changes only slot
      1's database and slot 1's generated types
- [ ] 4.G Unordered migrations: a migration is created in slot 1, then one in slot 2. The
      slot 2 branch is merged into `main` first, then the slot 1 branch. `pnpm db:migrate` on
      main applies both without errors
- [ ] 4.H `pnpm wt rm demo-one --yes` leaves no route, database, process or worktree
      (`pnpm wt ls`, `git worktree list`, `psql \l`)

## Phase 5 — Documentation and agent skills

Depends on: Phase 4

- [ ] 5.1 Write `docs/instructions/<area>.instructions.md` with `applyTo` front matter. Each file
      covers purpose, commands, conventions and pitfalls:
    - [ ] 5.1.1 `api.instructions.md`: app structure, adding an OpenAPI route with a Zod
          schema, environment variables, `pnpm openapi`
    - [ ] 5.1.2 `web.instructions.md`: Next.js structure, client components, data fetching
          through `/api` (same origin via Caddy), generated API types
    - [ ] 5.1.3 `database.instructions.md`: the schema-change workflow (`db:migrate:make` →
          `up`/`down` → `db:migrate`, which regenerates the types → commit the migration);
          migration rules (one change per migration, no edits after merge, unordered
          migrations allowed); slot databases and backup/restore; data inspection with the
          psql-docker skill (direct link)
    - [ ] 5.1.4 `testing.instructions.md`: Vitest projects, the test database per checkout,
          API and component tests, `pnpm test` options, and the browser testing section (5.2)
          with a direct link to the playwright-cli skill
    - [ ] 5.1.5 In the api and database guides: generated files (`types.generated.ts`,
          `openapi.json`, the web's API types) are git-ignored, are never edited, and are
          recreated by `db:migrate` and by the `dev`/`build`/`test`/`typecheck` scripts.
          After a pull, merge or rebase that brings in migrations, run `pnpm db:migrate`
- [ ] 5.2 Copy the browser testing section of the user-level guide into
      `testing.instructions.md` with **playwright-cli only**. Keep: when to check in a
      browser, the narrow viewport (375×667, `playwright-cli resize 375 667`), the required
      checks (URL and page content, record counts), the report sections (Completed,
      Verification, Problems, Next action), and that a sub-agent's report is not independent
      verification. Remove: vscode-browser, the integrated browser, Expo/mobile, and all
      tool- or model-specific parts (Agent calls, model names, effort levels, forks).
      Delegation is worded neutrally
- [ ] 5.3 Copy the playwright-cli skill (`SKILL.md` and `references/`) to
      `.claude/skills/playwright-cli/`. Its link to the user-level guide is changed to
      `testing.instructions.md`, and the wording about effort levels is removed
- [ ] 5.4 Copy the psql-docker skill to `.claude/skills/psql-docker/`:
    - [ ] 5.4.1 Port `psql.js` to TypeScript (`psql.ts`) without changing its behaviour:
          read-only by default, statement timeout, 100-line output cap, password through the
          environment only, `--show-config`
    - [ ] 5.4.2 In `SKILL.md`: repository path (`node .claude/skills/psql-docker/psql.ts`, run
          from the repository root), the default image set to the compose `postgres` image,
          neutral wording instead of tool-specific references; safety rules and the rule to
          show SQL and result rows kept
- [ ] 5.5 Copy the checkbox-plan skill to `.claude/skills/checkbox-plan/SKILL.md`, with its
      default plan location set to `docs/plan/<slug>.md` and no tool- or model-specific text
- [ ] 5.6 Write `CLAUDE.md` as a dictionary: a glossary (slot, wt ticket, `tickets` table, main
      checkout, dump, migration, generated types, …), short entries for the monorepo layout,
      Caddy routing and `wt`, an "Instructions" table and a "Skills" table with direct
      relative links. It contains no detailed procedures
- [ ] 5.7 Add `AGENTS.md`: a short statement that `CLAUDE.md` is the project's dictionary,
      with a link to it. It repeats no content
- [ ] 5.8 Write `README.md`: prerequisites (Node, pnpm, Docker, playwright-cli), quick start
      (stack up, `pnpm db:migrate`, `pnpm dev`), links to `CLAUDE.md`, `AGENTS.md`, the
      guides and the skills, and a note that the skills live in `.claude/skills/` (Claude
      Code's location). For an agent that does not read that folder, rename the folder or
      symlink it to the location that agent reads

Done when:

- [ ] 5.A Every term and command used in the guides is defined in `CLAUDE.md` or in the guide
      itself, and every link resolves
- [ ] 5.B Following `README.md` from a clean clone ends with the seed ticket shown at
      `http://localhost`
- [ ] 5.C `CLAUDE.md` links directly to the four guides and the four skills
- [ ] 5.D `AGENTS.md` links to `CLAUDE.md` and duplicates none of its content
- [ ] 5.E `rg -i 'vscode-browser|integrated browser|haiku|sonnet|opus|subagent_type|effort|/home/|~/\.claude|~/\.agents'`
      over `docs/instructions/` and the checkbox-plan, playwright-cli and psql-docker skills
      finds nothing
- [ ] 5.F From the repository root,
      `node .claude/skills/psql-docker/psql.ts 'select name from tickets'` returns the seed
      ticket, and an `insert` without `--rw` fails as read-only
- [ ] 5.G In a slot's worktree, `psql.ts --show-config` reports that slot's database

## Notes

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
- Possible follow-ups: Swagger UI at `/api/docs`; a shared `packages/db` if a second app needs
  the database; CI for `test`/`typecheck` (with a Postgres service); a Playwright smoke
  test per slot; moving the skills to a tool-neutral `.agents/skills/` folder.
