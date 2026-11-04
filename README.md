# Parallel AI workflow

A minimal TypeScript pnpm monorepo in which several tickets can be worked on in parallel, each in
its own git worktree ("slot") with its own databases, ports and URL. It consists of a Hono API,
a shared database package (`@repo/db`, Kysely), a Next.js web app, PostgreSQL and Caddy in Docker,
and Vitest tests. The example feature is a page that lists the rows of a `tickets` table, which it
fetches from the API.

## Supported environments

- Linux and macOS.
- Windows through WSL2, with the repository in the Linux file system (for example
  `~/projects`), not under `/mnt/c`: installs and file watching are slow and unreliable there.
- Native Windows is untested. The `wt` process handling is written to be cross-platform but has
  only been tested on POSIX.

## Prerequisites

- Node.js as in [`.nvmrc`](.nvmrc) (at least the version in `engines` of `package.json`).
- pnpm as pinned in `packageManager` of `package.json` (`corepack enable` provides it).
- Docker with the Compose plugin.
- [playwright-cli](https://www.npmjs.com/package/@playwright/cli) for browser checks:
  `npm install -g @playwright/cli`. If Chrome is not installed, open the browser with
  `playwright-cli open --browser=chromium`.

## Quick start

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
docker compose up -d --wait   # PostgreSQL and Caddy
pnpm install
pnpm db:migrate               # creates the tickets table and the generated types
pnpm dev                      # API and web dev servers
```

Open <http://localhost>: the page lists the seed ticket `demo-ticket`.

- The `.env.example` files hold placeholders; change `DB_PASSWORD` in `.env` before the first
  `docker compose up` (it takes effect only when the database volume is created).
- If port 80 is taken, set `PROXY_PORT` (for example `8080`) in `.env` before
  `docker compose up` and open `http://localhost:8080`. If port 5432 is taken, set `DB_PORT`
  (for example `5433`) in the same way.
- Stop the dev servers with Ctrl+C; `docker compose down` stops the stack (it keeps the data).

Further commands: `pnpm test`, `pnpm typecheck`, `pnpm db:backup`, and `pnpm wt help` for parallel
worktree tickets (a dump from `pnpm db:backup` is needed before `pnpm wt new`).

## Documentation

- [CLAUDE.md](CLAUDE.md): the project dictionary (glossary, layout, links to the guides and skills).
- [AGENTS.md](AGENTS.md): pointer to `CLAUDE.md` for agents that read that file name.
- Guides in [`docs/instructions/`](docs/instructions/):
  [api](docs/instructions/api.instructions.md),
  [web](docs/instructions/web.instructions.md),
  [database](docs/instructions/database.instructions.md),
  [testing](docs/instructions/testing.instructions.md).
  For VS Code Copilot to apply them, add that folder to `chat.instructionsFilesLocations`.
- Skills in [`.claude/skills/`](.claude/skills/):
  [wt](.claude/skills/wt/SKILL.md),
  [checkbox-plan](.claude/skills/checkbox-plan/SKILL.md),
  [playwright-cli](.claude/skills/playwright-cli/SKILL.md),
  [psql-docker](.claude/skills/psql-docker/SKILL.md).
- [Plan](docs/plan/parallel-workflow-monorepo.md) of how the repository was built.

### Skills and other agents

The skills live in `.claude/skills/`, the location Claude Code reads. An agent that reads another
folder (for example `.agents/skills/`) needs the folder renamed, or symlinked to that location
(`ln -s .claude/skills .agents/skills`); the `wt` skill is specific to Claude Code.

## Third-party software and compliance

Hono, `@hono/zod-openapi`, Zod, Kysely, kysely-ctl, kysely-codegen, `pg`, Next.js and React,
openapi-typescript, Vitest, Testing Library, jsdom, tsx, playwright-cli and Playwright, and the
`postgres` and `caddy` Docker images are third-party software. Each requires compliance review
before it is used in government projects. The `.env` files, database dumps and generated Caddy
sites are git-ignored; do not put dumps of real data into this repository.
