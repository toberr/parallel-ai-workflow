---
implement_model: sonnet
implement_effort: high
browser_model: haiku
browser_effort: xhigh
---

# OpenAPI UI and wt tickets endpoint

Goal: The API serves a Swagger UI for its OpenAPI document at `/api/docs`, and a development
endpoint `GET /api/wt-tickets` lists the parallel worktree (`wt`) tickets in the same shape as
`/api/tickets`. Both are available on the dev server only.

Scope: Swagger UI in `apps/api`, `pnpm wt ls --json`, the `/api/wt-tickets` route, tests and
documentation · Not included: changes to `/api/tickets` or the demo `tickets` table, a web page
for the wt tickets, self-hosted Swagger UI assets, write operations on wt tickets.

## Phase 1 — Swagger UI

- [x] 1.1 Add `@hono/swagger-ui` (exact version 0.6.2) to `apps/api`.
- [x] 1.2 Serve the Swagger UI at `/api/docs`, reading the live `/api/openapi.json`; pin the
      `swagger-ui-dist` version the page loads (5.34.1).
- [x] 1.3 Make the page optional in `createApp` (off by default) and enable it in the server
      unless `NODE_ENV=production`.
- [x] 1.4 Add tests: the page is served when enabled and points at the spec; `/api/docs` is 404
      by default.
- [x] 1.5 Document the page, its CDN use and the compliance note in `api.instructions.md`.

Done when:

- [x] 1.A `pnpm typecheck` and `pnpm test` pass in the worktree.
- [x] 1.B `http://s1.localhost:8080/api/docs` renders in a browser (Chromium) and "Execute" on
      `GET /api/tickets` returns 200 with the seed ticket.

## Phase 2 — wt tickets endpoint

Depends on: Phase 1

- [x] 2.1 Add `pnpm wt ls --json` to `scripts/wt.ts`: one JSON object (`version: 1`) with the
      tickets (name, slot, branch, URL, server status and ports) and the free and busy slots; no
      paths, PIDs or database settings. Document the shape in the `ls` help.
- [x] 2.2 Add `GET /api/wt-tickets` in `apps/api/src/routes/wt-tickets.ts`: run
      `node scripts/wt.ts ls --json` of the same checkout (no shell, fixed arguments, 15 s
      timeout), validate the output with Zod and return
      `[{ id (slot), name, gitBranch, services (servers that are up), url }]` ordered by slot.
- [x] 2.3 On a CLI failure, answer 503 with a generic message and log the details on the server only.
- [x] 2.4 Replace the `docsUi` option with `devRoutes`, which enables both `/api/docs` and
      `/api/wt-tickets`; `pnpm openapi` builds the document with `devRoutes` on.
- [x] 2.5 Add tests with a stubbed CLI call (placeholder tickets): mapping and order, 503 without
      details, 404 without `devRoutes`.
- [x] 2.6 Document the development routes in `api.instructions.md`, and `ls --json` in
      `CLAUDE.md` and the `wt` skill.

Done when:

- [x] 2.A `pnpm typecheck`, `pnpm test` (11 tests) and `pnpm check:scripts` pass in the worktree.
- [x] 2.B On the running slot, `GET /api/wt-tickets` answers 200 through the host port and
      through Caddy, listing every ticket of `pnpm wt ls` with its slot, branch and running servers.
- [x] 2.C `/api/openapi.json` lists `/api/wt-tickets`.
- [ ] 2.D The endpoint is executed once from the Swagger UI in a browser (so far checked with
      curl only).

## Notes

- Decisions (agreed with the user): a new endpoint instead of changing `/api/tickets`; the data
  comes from the wt CLI (`ls --json`), not from reading `wt-state.json` in the API, so `wt` stays
  the only code that knows its state file; `id` is the slot number and `services` lists the dev
  servers whose port accepts connections.
- The development routes describe the local machine and must never be served in production;
  `devRoutes` is off unless the server runs without `NODE_ENV=production`.
- Compliance: `@hono/swagger-ui` is a third-party dependency, and the Swagger UI page loads its
  JavaScript and CSS from the public jsDelivr CDN. Both require compliance review before use in
  government projects. Follow-up option: serve `swagger-ui-dist` from the API itself and pass
  its location as the middleware's `baseUrl`.
- This plan was written after the implementation, as a record. The work was done directly in
  the main session, without phase subagents, so there is no Agent log.
- No phase commits in this repository: the changes stay uncommitted in the worktree for the
  user to commit.
