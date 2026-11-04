---
applyTo: "apps/web/**"
---

# Web (`apps/web`)

Terms such as *Caddy*, *main checkout*, *slot* and *generated files* are defined in [CLAUDE.md](../../CLAUDE.md).

## Purpose

`apps/web` is a Next.js (App Router, TypeScript) application. Its start page lists the rows of
the `tickets` table, which it fetches from the API in the browser. The web does **not** use
`@repo/db`; it gets its types from the API's OpenAPI document.

## Structure

| Path | Role |
|---|---|
| `src/app/layout.tsx`, `src/app/page.tsx` | App Router layout and start page (a server component that renders the client component). |
| `src/app/icon.svg` | Favicon (without it the browser console reports a 404). |
| `src/components/*.tsx` | Components and their tests (`*.test.tsx`, next to the code). |
| `src/lib/api-types.generated.ts` | Generated API types (git-ignored, never edited). |
| `scripts/run-next.ts` | Starts `next dev` / `next start`; see the environment section. |
| `next.config.ts` | `allowedDevOrigins` for `localhost` and `*.localhost`; `agentRules: false`. |

## Commands

Run from the repository root.

| Command | Effect |
|---|---|
| `pnpm dev` | `pnpm openapi`, then the API and the web dev servers in parallel. |
| `pnpm --filter web dev` | The web dev server only. |
| `pnpm openapi` | Regenerates `apps/api/openapi.json` and `apps/web/src/lib/api-types.generated.ts` (`openapi-typescript`). |
| `pnpm typecheck` | Includes `next typegen && tsc` for the web. |
| `pnpm build` | `next build` for the web (and the API's type check). |

## Environment variables

- `PORT` (required): in `apps/web/.env.local` (copy `apps/web/.env.example`; `3000` for the main
  checkout, `3000 + N*100` in a slot). Next.js reads `PORT` from the process environment before
  it loads `.env.local`, so `scripts/run-next.ts` loads the file itself and refuses to start
  without `PORT`. Always start the web through the package scripts (`dev`, `start`), not with a
  bare `next dev`, or the file is ignored.
- Do not `export` `PORT` in a shell: it overrides the file.

## Data fetching and the same origin

The browser always requests `/api/...` as a relative URL. Caddy serves one origin per checkout
(`http://localhost` for the main checkout, `http://sN.localhost` for a slot) and forwards
`/api/*` to the API and everything else to the web. There is therefore no CORS configuration,
no API host name and no base-URL setting. Consequences:

- The app works only through Caddy. Open `http://localhost` (or `http://localhost:<PROXY_PORT>`
  when `PROXY_PORT` is not 80), not `http://localhost:3000`, where `/api` does not exist.
- Interactive data is fetched in a client component (`"use client"`) in `useEffect`, with
  loading, empty and error states and an `AbortController` that ignores aborted requests. In
  development React StrictMode runs effects twice, so the first request appears as aborted in
  the network log; this is expected.
- Do not call the API with an absolute URL or a port in browser code.

## Generated API types

`src/lib/api-types.generated.ts` is produced from `apps/api/openapi.json` by `pnpm openapi`. Use
it instead of hand-written types:

```ts
import type { components } from "../lib/api-types.generated.ts";
type Ticket = components["schemas"]["Ticket"];
```

The schema names come from `.openapi("Name")` in the API's Zod schemas. After an API change, run
`pnpm openapi` and fix the type errors it reveals. The file is git-ignored: do not edit or
commit it.

## Adding a page or component

1. Put a page in `src/app/<route>/page.tsx` and components in `src/components/`.
2. Use `"use client"` only for components that need state, effects or browser APIs.
3. Fetch from `/api/...` as described above; derive types from the generated file.
4. Add a component test with `fetch` mocked (see [testing.instructions.md](testing.instructions.md)).
5. Check the page in a browser through Caddy (browser testing section of the testing guide),
   including the browser console, because hot reload and the proxy cannot be verified by unit tests.

## Pitfalls

- `next dev` would write an `apps/web/AGENTS.md` on every start; `agentRules: false` in
  `next.config.ts` prevents it. Keep that setting.
- A web `typecheck` on a fresh clone needs the generated API types, so run it through
  `pnpm typecheck` (which runs `pnpm openapi` first), not `tsc` alone.
- TypeScript stays on 6.x repository-wide: `openapi-typescript` needs the TypeScript JS API,
  which TypeScript 7 does not provide. Do not upgrade TypeScript on its own.
- Hot reload through Caddy depends on `allowedDevOrigins`; if the dev overlay or HMR fails on a
  slot URL, check that setting first.
