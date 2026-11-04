# Parallel AI workflow — implementation notes

Companion to [parallel-workflow-monorepo.md](parallel-workflow-monorepo.md). It records how the
plan was implemented, deviations from it, and findings from the implementing agents and the
reviews.

## Process

- Orchestrator: Claude Opus 5.5 (Claude Code). It writes the briefs, reviews each phase,
  checks the "Done when" items and ticks the plan's checkboxes.
- Implementation: one Claude Sonnet 5.5 sub-agent per phase (medium effort), one phase at a
  time, never in parallel. Each phase is reviewed after it finishes; requested changes go back
  to the same sub-agent. After two unsuccessful fix rounds the orchestrator makes the fix itself.
- No commits are made; all changes stay in the working tree.

## Environment findings (2026-11-04)

- Machine: WSL2 (Linux 5.15), Node 24.15.0, pnpm 11.0.9, Docker 28.1.1.
- **Port conflict:** the other project stack on the same machine already binds
  `127.0.0.1:80` (its Caddy) and `0.0.0.0:5432` (its PostgreSQL), and it has active slots. Those
  containers are not stopped. Decision: the compose host ports are configurable from the root
  `.env` — `DB_PORT` (already in the plan) and an added `PROXY_PORT` (default `80`). The
  `.env.example` files keep the plan's defaults (5432, 80); the local `.env` on this machine
  uses `DB_PORT=5433` and `PROXY_PORT=8080`. As a result, the URLs checked on this machine are
  `http://localhost:8080` and `http://sN.localhost:8080` in place of `http://localhost` and
  `http://sN.localhost`.

## Phase log

### Phase 1 — Monorepo skeleton and local stack

- Sub-agent: one run, no rework needed. Review: files read and the stack checked by the
  orchestrator.
- Versions: `pnpm@11.0.9`, Node `24.15.0` (`.nvmrc`, `engines` `>=22.18.0`),
  `postgres:18-alpine`, `caddy:2.11.7-alpine`.
- Deviations:
  - pnpm 11 replaced `onlyBuiltDependencies` with `allowBuilds` in `pnpm-workspace.yaml`
    (`allowBuilds: { esbuild: true }`); that is what this pnpm version honours.
  - PostgreSQL 18 images keep data in a versioned subdirectory, so the volume is mounted at
    `/var/lib/postgresql` (not `.../data`).
  - Explicit compose project `name: parallel-ai-workflow` and container names
    `parallel-ai-postgres` / `parallel-ai-caddy`, so worktrees address the same shared stack
    and nothing collides with the `other-project-*` containers. `wt` must run compose from the main
    checkout (bind mounts and `.env` resolve relative to the working directory).
  - `PROXY_PORT` added (see Environment findings).
- Findings: Caddy matches the site address `http://localhost` regardless of the port in the
  Host header, so `localhost:8080` works without a different site address. `DB_USER`,
  `DB_PASSWORD`, `DB_DATABASE` only take effect on the first volume initialisation.
- 1.A was checked without dependencies; it is re-checked in Phase 2 once `esbuild` is
  installed.

### Phase 2 — Shared database package and API

- Sub-agent: one run, no rework needed. Review: source read; `pnpm test` and `pnpm typecheck`
  re-run by the orchestrator.
- Versions: TypeScript 7.0.2 at first (changed to 6.0.3 in Phase 3), Vitest 5.1.0, Kysely 0.29.8 (inside
  kysely-ctl's peer range `<0.30`), kysely-ctl 0.22.0, kysely-codegen 0.20.0, pg 8.23.1,
  Hono 4.13.16, `@hono/zod-openapi` 1.6.3 with Zod 4.6.7, `@hono/node-server` 2.1.6,
  tsx 4.23.15, `@types/node` 24.19.2 (matches Node 24). All pinned exactly.
- `allowUnorderedMigrations`: confirmed in kysely-ctl's `dist/bin.mjs` (`getMigrator` spreads
  the `migrations.*` options into `new Migrator(...)`), and by experiment: a migration with an
  older timestamp than an applied one was applied by `pnpm db:migrate`.
- Finding: `db:migrate:down` reverts the most recently *executed* migration, not the one with
  the highest name. `wt reset` therefore restores from a dump rather than migrating down.
- Deviations:
  - Extra test-only export `@repo/db/testing` (`prepareTestDatabase()`), used by the API's
    Vitest global setup. `index.ts` still exports only `createDb` and the types.
  - The test database name reaches the workers through Vitest's `provide`/`inject`; an extra
    `apps/api/test/setup.ts` sets `DB_DATABASE` before the app is built. The test setup refuses
    to run when `DB_TEST_DATABASE` equals `DB_DATABASE`.
  - `app.ts` exports `createApp({ db })` instead of a ready-made app; `pnpm openapi` builds it
    with a lazy pool and works with the database stopped.
  - Root `package.json` has `"type": "module"` (needed by `vitest.config.ts`).
  - Codegen is a small script (`packages/db/scripts/codegen.ts`) that passes `DATABASE_URL` to
    kysely-codegen through its own environment, so the password never appears on a command line.
  - Imports use explicit `.ts` extensions (`allowImportingTsExtensions`), so plain `node` can
    run the codegen script.
- On this machine 2.C was checked at `http://localhost:8080/api/openapi.json`.

### Phase 3 — Web app

- Sub-agent: one run, no rework needed. Review: source read; `pnpm test` (6 tests) and
  `pnpm typecheck` re-run by the orchestrator. The browser checks (3.B, 3.C) were run by the
  sub-agent with playwright-cli and reviewed from its report; they were not repeated
  independently.
- Versions: Next.js 16.4.5, React 19.3.1, openapi-typescript 7.13.0, jsdom 30.1.3, Testing
  Library (react 16.3.3, dom 10.4.2, jest-dom 7.0.1), `@vitejs/plugin-react` 6.2.1.
- **TypeScript changed to 6.0.3 repo-wide.** Next 16 itself works with TypeScript 7, but
  openapi-typescript uses the TypeScript JS API (`ts.factory`), which the native TS 7 package
  does not provide; it crashes at import. One version for the whole repo was preferred over a
  second TypeScript only for the generator. openapi-typescript declares `typescript ^5`, so
  `pnpm-workspace.yaml` has `peerDependencyRules.allowedVersions` for it (works; re-check on
  upgrades).
- `allowedDevOrigins` (checked in Next's source and docs): matching uses the hostname only, the
  port is ignored; `*` matches one label. `localhost` and `**.localhost` are allowed by default
  anyway; the explicit entries are kept as the plan asks.
- `PORT`: Next reads `PORT` from the process environment before it loads `.env.local`, so
  `apps/web/scripts/run-next.ts` loads `.env.local` (Node's `process.loadEnvFile`), refuses
  to start without `PORT`, and then hands over to the Next CLI in the same process.
- Additions: `agentRules: false` in `next.config.ts` (otherwise `next dev` writes an
  `apps/web/AGENTS.md` on every start); `src/app/icon.svg` (the favicon 404 was a console
  error). `.gitignore` gains `.next/`, `next-env.d.ts`, `apps/web/tsconfig.tsbuildinfo`.
- Web `typecheck` is `next typegen && tsc`; web `build` is `next build`.
- Browser checks on this machine: playwright-cli needs `--browser=chromium` (the `chrome`
  channel is not installed). In dev, React StrictMode fetches twice; the first request shows
  as aborted (expected).
- Finding for Phase 4: `pnpm dev` produces several processes (pnpm, sh, node, next-server,
  tsx) in one process group; killing only the PID leaves `next-server` running, so the group
  has to be stopped.

### Phase 4 — Database snapshots and worktree slots

- Sub-agent: one run plus one rework round (requested by the review: `wt ls` showed slots with
  busy ports as free; the evidence for 4.E did not show which test database a slot's
  `pnpm test` used). Both fixed in the second round.
- **Verification in a throwaway clone.** Nothing in the repository is committed (the user
  makes all commits), so `git worktree add` from it would check out only the plan. The
  sub-agent cloned the repository into the session scratchpad, copied the working tree in,
  committed there with a test identity, and ran all `wt` checks (including the merge test 4.G)
  in that clone and its own `../wt`. For the duration, the shared stack was started from the
  clone and afterwards brought back to the repository (Caddy validates, postgres healthy,
  `app_dev` restored from the dump). The repository got no commits.
- On this machine other-project-web's `next dev` holds ports 3100 and 3200 (slots 1 and 2). `wt new`
  therefore skips slots whose API or web port is busy, `--slot N` refuses them, and `wt ls`
  lists them as busy. The checks used slots 3 and 4 (`http://s3.localhost:8080`,
  `http://s4.localhost:8080`) instead of s1/s2.
- Design decisions and deviations:
  - `restoreDump` refuses a dump without pg_dump's "dump complete" trailer before anything is
    dropped (4.B); `ON_ERROR_STOP` still covers SQL errors in complete dumps.
  - Dumps are written as `.partial` with mode 0600 and renamed on success.
  - `new` rolls back everything (servers, databases, Caddy site, worktree, a branch it created,
    folder, state entry) when a step fails after the slot was reserved; if the rollback fails,
    `rm` finishes it.
  - Ticket name = last branch segment, validated strictly; `--name` overrides it. Database
    names map hyphens to underscores.
  - `dev` runs `pnpm openapi`, then starts `pnpm --filter api dev` and `pnpm --filter web dev`,
    each detached (own process group) with logs in `../wt/<ticket>/logs/`.
  - `reset` stops running servers, restores and migrates both databases, and restarts the
    servers that were running (pooled connections would otherwise break).
  - `DB_DATABASE`, `DB_TEST_DATABASE` and `PORT` are removed from every child process `wt`
    starts in a worktree, because process env beats `.env` in `@repo/db`.
  - `new` calls `claude-access` itself (as in other-project): it adds `../wt` to
    `permissions.additionalDirectories` in the git-ignored `.claude/settings.local.json`.
  - Added root scripts `db:backup`, `db:restore`, `wt`, `check:scripts` (type-checks
    `scripts/`), and root devDependency `@types/node`. `.gitignore` gains
    `.claude/settings.local.json` and `CLAUDE.local.md`.
- Findings:
  - The first 4.E evidence was invalid: the sub-agent's own shell had exported the main
    `.env`, so a slot's tests used `app_test`. Redone in a clean environment, the slot's run
    created and migrated `app_wt_demo_one_test` (including the branch-only migration) and left
    `app_dev`, `app_test` and the slot's dev database unchanged. Lesson for the docs: never
    export `DB_*` or `PORT` in a shell.
  - 4.I: on Linux, Next starts a short-lived `telemetry/detached-flush.js` in its own process
    group at shutdown; it exits by itself within about 5 seconds. Everything in the slot's
    process group is gone right after `park`.
  - Not tested: the Windows branch (`taskkill`), macOS, and the interactive "yes" answer of
    `confirm()` on a terminal (only `--yes` and the no-terminal refusal).
  - `park`/`rm` signal the stored PID's process group even when the ports are closed (to catch
    a crashed `tsx watch`); a PID reused after a reboot is a theoretical risk.

### Phase 5 — Documentation and agent skills

- Sub-agent: one run, no rework needed. Review: CLAUDE.md, AGENTS.md, README and the guides'
  structure read; 5.E (forbidden-term search, plus a search for the section sign) and 5.F
  (psql.ts read query and read-only refusal) re-run by the orchestrator. 5.B and 5.G ran in
  the verification clone (same stack-switching procedure as in Phase 4); the stack is back in
  the repository afterwards.
- Decisions and deviations:
  - `psql.ts` keeps psql.js's launch method (`docker run --rm -i --network=host` on Linux,
    `host.docker.internal` on macOS and Windows) with the default image `postgres:18-alpine`;
    it reads the `.env` of the current directory, so in a slot's worktree it reports the slot's
    database (5.G).
  - `scripts/tsconfig.json` also includes the psql-docker skill, so `pnpm check:scripts`
    type-checks `psql.ts`.
  - psql-docker `SKILL.md`: the schema-dump tip was replaced by a pointer to the migrations and
    the generated types; examples query `tickets`.
  - README: playwright-cli is installed with `npm install -g @playwright/cli`; it explains
    `PROXY_PORT` and `DB_PORT` for taken ports.
- 5.A: the link checker found one unresolved target, `./settings-after.png` in
  `playwright-cli/references/pr-attachments.md`. It is an example image reference inside the
  copied skill text, not a link to a repository file, and was left as is.

## Final state (2026-11-04)

- All plan items and "Done when" checks are ticked. `pnpm test` (6 tests), `pnpm typecheck` and
  `pnpm check:scripts` pass in the repository.
- Nothing is committed. The repository's compose stack (`parallel-ai-postgres`,
  `parallel-ai-caddy`) is running with `app_dev` and `app_test`; no slots exist.
- Local, git-ignored files on this machine: `.env` (`DB_PORT=5433`, `PROXY_PORT=8080`),
  `apps/api/.env`, `apps/web/.env.local`, one dump in `db-backups/`.
- The verification clone lives in the session scratchpad only (outside the repository) and can
  be deleted.
- Open points: native Windows and macOS are untested (`wt` process handling); the interactive
  confirmation path of `confirm()` was tested only through `--yes` and the no-terminal refusal;
  openapi-typescript's peer range is overridden for TypeScript 6 (re-check on upgrades); the
  browser checks were run by the sub-agents and reviewed from their reports, not repeated
  independently by the orchestrator.
