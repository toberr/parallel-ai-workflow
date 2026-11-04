---
name: wt
description: Attach this Claude session to a ticket worktree slot (own branch, databases, ports and URL) while the session itself stays in the main checkout. Use when the user types /wt <ticket>, asks to work on, continue, test or review a ticket or branch "in a worktree" / "in a slot", or asks to create, list, start, park, reset or remove a worktree ticket.
---

# Worktree tickets (`scripts/wt.ts`)

Tickets are worked on in parallel in git worktrees under `../wt/<ticket>/`. Each ticket owns a
numbered slot N (1-9): its own worktree and branch, databases `app_wt_<ticket>` and
`app_wt_<ticket>_test`, API port `4000+N*100`, web port `3000+N*100` and the URL
`http://sN.localhost`. The `postgres` and `caddy` containers are **shared** by the main checkout
and every slot.

Sessions are always started in the **main** checkout, so they stay in its session history after
the worktree is removed. That makes the session's default working directory the wrong place for
ticket work: every path and command must target the worktree explicitly.

Full command reference: `pnpm wt --help` and `pnpm wt <command> --help`.

## Attaching the session: `/wt <ticket>`

1. Run `pnpm wt info <ticket>` in the main checkout. It prints a status block (URL, ports, server
   status, databases, Caddy route, worktree and log paths) followed by the branch and the working
   rules for the ticket.
   - Unknown ticket: run `pnpm wt ls` and ask the user whether to create it
     (`pnpm wt new <branch> [--base <ref>]`; the argument of `/wt` may be the branch). Creating
     installs dependencies and restores two databases, so confirm the branch and base first.
     `new` ends with the same status block.
2. Read `CLAUDE.md` in the ticket's worktree. The branch may have changed it, and it then applies
   instead of the main checkout's copy (with the slot rules from step 1 on top).
3. Answer with the status block from `info` (or `new`) verbatim in a code block, plus one line on
   what is not running yet (e.g. "dev servers not started: `pnpm wt dev <ticket>`"). Do not
   re-assemble the URLs yourself; the block is the single source.
4. For the rest of the session follow the rules printed by `info`. In short:
   - edit only under the worktree path; the main checkout stays on `main`, untouched;
   - `git -C <worktree> ...`, `cd <worktree> && pnpm ...`; nothing bare in the main checkout;
   - the worktree's own `.env` names its databases; never export `DB_DATABASE`,
     `DB_TEST_DATABASE` or `PORT` in a shell;
   - browser checks on the slot URL (`http://sN.localhost`, plus `:<PROXY_PORT>` when `PROXY_PORT`
     in the root `.env` is not 80; the status block shows the right one).

When the work spans several tickets, use one session per ticket.

## Commands

| Command | Effect | Ask the user first? |
|---|---|---|
| `ls`, `info <ticket>` | Read-only: all slots / one ticket's status block and rules | no |
| `dev <ticket>` | Start the API and web dev servers in the background (logs in `../wt/<ticket>/logs/`); ends with the status block | no |
| `park <ticket>` | Stop the dev servers and their child processes; worktree and databases stay | no |
| `new <branch> [--base <ref>] [--dump <file>] [--slot N]` | Worktree (new branch from `main`, or from `--base`), env files, install, both databases from the newest dump, migrations, Caddy route | yes |
| `reset <ticket> --yes` | Both ticket databases restored from the ticket's dump again (`--latest`: newest dump) and migrated; running servers restart | yes: data is lost |
| `rm <ticket> --yes` | Servers, databases, Caddy route and worktree removed (refuses with uncommitted changes; the branch stays) | yes |
| `claude-access` | Add `../wt` to `.claude/settings.local.json` (git-ignored) so this session may edit it | no (tell the user to restart the session) |

`reset`, `rm` and `db:restore` ask for confirmation on a terminal and refuse without one; pass
`--yes` only after the user agreed.

## Pitfalls

- **The stack is shared.** Never run `docker compose down`, `restart` or `up` for a slot: that
  would stop the database and proxy of every other checkout. `wt` starts missing services itself.
- **`PROXY_PORT`.** When the root `.env` sets `PROXY_PORT` to something other than 80, every URL
  carries it (`http://s1.localhost:8080`). The Caddy site address stays `http://sN.localhost`.
- `*.localhost` resolves only in browsers. Node processes and curl on the host use the ports
  (`http://localhost:<4000 + N*100>/api/tickets`).
- **Another project may use a slot's ports.** `new` skips slots whose ports already accept
  connections, and `--slot N` refuses them; `ls` shows the slot that was chosen.
- **Generated files exist per worktree** (`packages/db/src/types.generated.ts`,
  `apps/api/openapi.json`, the web's API types). They are git-ignored and never edited; `db:migrate`
  and the `dev`/`build`/`test`/`typecheck` scripts recreate them from the worktree's own database.
- **Run `pnpm db:migrate` in the worktree after a pull, merge or rebase** that brings in
  migrations. A migration created in a slot is applied to that slot's database only.
- After `pnpm db:backup`, existing tickets keep their databases; `reset <ticket> --latest` moves
  one to the new dump.
- A ticket that builds on unmerged work needs `--base <branch>` on `new`; without it the new
  branch starts from `main`.
- `park` reports a port that stays open: something other than the stored dev server holds it.
  `wt` never kills processes it did not start; look at what listens there before acting.
- File access outside the session's working directories prompts for every edit. If the worktree
  folder is not an additional directory of the session, run `pnpm wt claude-access` and tell the
  user to restart the session.
