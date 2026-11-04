---
applyTo: "**/*.test.ts,**/*.test.tsx,vitest.config.ts,apps/api/test/**,apps/web/test-setup.ts"
---

# Testing

Terms such as *slot*, *main checkout* and *generated files* are defined in [CLAUDE.md](../../CLAUDE.md).

## Purpose

Automated tests use [Vitest](https://vitest.dev) from the repository root, with one project per
app. Pages are additionally checked in a real browser with the
[playwright-cli skill](../../.claude/skills/playwright-cli/SKILL.md) (see "Browser testing" below).

## Vitest projects

`vitest.config.ts` at the root defines two projects:

| Project | Root | Environment | Files | Set-up |
|---|---|---|---|---|
| `api` | `apps/api` | Node | `src/**/*.test.ts` | `test/global-setup.ts` creates and migrates the test database; `test/setup.ts` points each worker at it. |
| `web` | `apps/web` | jsdom (Testing Library) | `src/**/*.test.{ts,tsx}` | `test-setup.ts` adds the `jest-dom` matchers. |

Tests are placed next to the code they test (`tickets.ts` and `tickets.test.ts`).

## Commands

Run from the repository root (or from a worktree root).

| Command | Effect |
|---|---|
| `pnpm test` | `pnpm openapi`, then all tests once (`vitest run`). |
| `pnpm test --project web` | Only one project (`api` or `web`). |
| `pnpm test tickets` | Only test files whose path contains the text. |
| `pnpm test -t "error state"` | Only tests whose name matches. |
| `pnpm typecheck` | Type check of every package (not a test, but part of the same gate). |
| `pnpm check:scripts` | Type check of `scripts/` and of the psql-docker script. |

Arguments after `pnpm test` are passed to Vitest. For a watch mode run
`pnpm exec vitest` (without `run`).

## The test database

- The API tests need the postgres container (`docker compose up -d --wait`).
- The global setup creates the database named in `DB_TEST_DATABASE` if it is missing and
  migrates it with the `@repo/db` migrations. Each checkout has its own: `app_test` in the main
  checkout, `app_wt_<ticket>_test` in a slot. Parallel runs in different slots therefore never
  share a database, and `pnpm test` leaves the development database unchanged.
- The setup refuses to run when `DB_TEST_DATABASE` equals `DB_DATABASE`.
- Never `export` `DB_*` or `PORT` in a shell. The process environment overrides the checkout's
  `.env`, so a slot's tests would run against another checkout's database. A clean shell is the
  only requirement.
- The seed row (`demo-ticket`) comes from the migration. Tests that need other data create it
  themselves and must not rely on the data of other tests.

## API tests

Build the app with `createApp({ db })` and call it through `app.request`, with no network and
no port:

```ts
const db = createDb();
const app = createApp({ db });
afterAll(async () => { await db.destroy(); });

const res = await app.request("/api/tickets");
expect(res.status).toBe(200);
```

Validate response bodies with the route's Zod schema. Destroy the database instance after the
file. `DB_DATABASE` is set to the test database by `test/setup.ts` before the app is imported.

## Component tests

Render with Testing Library in jsdom and mock `fetch` with `vi.stubGlobal("fetch", ...)`.
Restore it in `afterEach` (`vi.unstubAllGlobals()`) and call `cleanup()`. Cover the loading,
loaded, empty and error states. Query by role and accessible name rather than by CSS class.

## Browser testing

Unit tests cannot show that the proxy, hot reload and the rendered page work together. Check in
a real browser when a change affects what a page shows or how it behaves: a new or changed page
or component, a change to an API route that a page uses, a routing, Caddy or port change, or a
fix for a problem that was only visible in the browser.

Use the [playwright-cli skill](../../.claude/skills/playwright-cli/SKILL.md) for all browser
work. The dev servers must be running (`pnpm dev`, or `pnpm wt dev <ticket>` in a slot), and the
page is opened through Caddy: `http://localhost` for the main checkout, `http://sN.localhost` for
slot N, with `:<PROXY_PORT>` appended when `PROXY_PORT` in the root `.env` is not 80. If
Chrome is not installed, open the browser with `playwright-cli open --browser=chromium`.
`*.localhost` names resolve in browsers only; command-line tools use the ports.

### Narrow viewport

When testing a mobile or narrow layout, use the iPhone SE screen size of **375×667** CSS pixels,
unless the task names another size. Open the browser, then run `playwright-cli resize 375 667`
before checking the layout. Do not use `--device="iPhone SE"`: the Playwright device of that
name is the first-generation 320×568 screen. If full device emulation (touch, mobile user
agent) is needed, use `"iPhone SE (3rd gen)"`. State the viewport size in the report.

### Delegation

Browser testing and browser data collection may be delegated to a separate agent. Do not
delegate when the whole job is one or two commands (one screenshot, one URL read, one console
check): doing it directly costs less. A delegated agent starts without any context, so the
brief is its only input. It states:

- the concrete goal and the pass/fail criteria;
- that the playwright-cli skill is to be loaded first;
- the URL to work on and the slot, if any;
- test accounts or credentials, if needed (local and test environments only; never real ones);
- what has already been ruled out, so that it is not repeated;
- where to save collected data (a path inside the repository's working directory).

Keep routine actions at the ordinary level of reasoning. Use a more capable agent only when an
earlier attempt leaves an unresolved failure that needs deeper diagnosis, or when the task
involves complex application state or ambiguous expected behaviour; do not escalate for a
locator or navigation-timing error that can be corrected directly. Carry the failure evidence
and the checks already completed into any handoff.

### What must be verified

The agent performs the browser actions and verifies the results; it does not report intent.

- After navigation, check the expected URL **and** the page content.
- For collected data, check the expected record count, uniqueness, required values and the
  requested sort order.
- Check the browser console for errors and the network log for the requests the page is expected
  to make (for example `GET /api/tickets`).
- Record the navigation actions taken. Derive check counts from executed checks, not from memory.

The report is concise and has these sections:

- **Completed**: results and saved file paths.
- **Verification**: checks performed, pass or fail per check, record counts, a compact action log.
- **Problems**: failures, retries, missing data, unresolved issues.
- **Next action**: any work that is still required.

### Reviewing the report

For routine, read-only browser tasks, review the report for completeness and internal
consistency. Do not repeat the browser actions merely to validate a successful report. If it is
incomplete or contradictory, send the same agent back to investigate before doing anything
yourself.

Verify independently only when the user asks, when a reported problem is still unresolved, or
when the task involved consequential actions such as deletion, security-sensitive changes or
release approval. Keep independent checks to the minimum that settles the question.

A delegated agent's report is not independent verification. Never state that a result was
independently verified when only that report was reviewed.

## Pitfalls

- Stale generated files: `pnpm test` runs `pnpm openapi` first; running `vitest` directly does not.
- A browser check at `http://localhost:3000` shows the page without `/api`; use the Caddy URL.
- Dev servers started for a check must be stopped afterwards (`pnpm wt park <ticket>` in a slot).
- Playwright and its browsers are third-party software and require compliance review before use
  in government projects.
