import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

/** The repository's wt CLI, in the same checkout as this API (main checkout or worktree). */
const WT_SCRIPT = fileURLToPath(new URL("../../../../scripts/wt.ts", import.meta.url));
const WT_TIMEOUT_MS = 15_000;

/** The part of `wt ls --json` (version 1) this route uses; other keys are ignored. */
const WtLsSchema = z.object({
  version: z.literal(1),
  tickets: z.array(
    z.object({
      ticket: z.string(),
      slot: z.number().int(),
      branch: z.string(),
      url: z.string(),
      servers: z.object({
        api: z.object({ up: z.boolean() }),
        web: z.object({ up: z.boolean() }),
      }),
    }),
  ),
});
export type WtLs = z.infer<typeof WtLsSchema>;

/** Runs `node scripts/wt.ts ls --json` (no shell, fixed arguments) and validates its output. */
export async function runWtLs(): Promise<WtLs> {
  const { stdout } = await promisify(execFile)(process.execPath, [WT_SCRIPT, "ls", "--json"], {
    timeout: WT_TIMEOUT_MS,
  });
  return WtLsSchema.parse(JSON.parse(stdout));
}

export const WtTicketSchema = z
  .object({
    id: z.number().int().openapi({ example: 1, description: "The ticket's slot number" }),
    name: z.string().openapi({ example: "demo-one" }),
    gitBranch: z.string().openapi({ example: "feature/demo-one" }),
    services: z
      .array(z.enum(["api", "web"]))
      .openapi({ example: ["api", "web"], description: "Dev servers that are up (their port accepts connections)" }),
    url: z.string().openapi({ example: "http://s1.localhost" }),
  })
  .openapi("WtTicket");

const ErrorSchema = z.object({ message: z.string() }).openapi("Error");

const listWtTickets = createRoute({
  method: "get",
  path: "/api/wt-tickets",
  summary: "List the worktree (wt) tickets",
  description:
    "The parallel worktree tickets as `pnpm wt ls --json` reports them, ordered by slot. " +
    "Development only: not served in production.",
  responses: {
    200: {
      description: "All wt tickets, ordered by slot",
      content: { "application/json": { schema: z.array(WtTicketSchema) } },
    },
    503: {
      description: "The wt CLI could not be run or returned unexpected output",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

/** `listWt` defaults to the real CLI; tests pass a stub. */
export function wtTicketsRoutes({ listWt = runWtLs }: { listWt?: () => Promise<WtLs> } = {}) {
  return new OpenAPIHono().openapi(listWtTickets, async (c) => {
    let ls: WtLs;
    try {
      ls = await listWt();
    } catch (error) {
      // Details (paths, stderr) go to the server log only
      console.error("wt ls --json failed:", error);
      return c.json({ message: "The wt CLI could not list the tickets." }, 503);
    }
    const tickets = [...ls.tickets]
      .sort((a, b) => a.slot - b.slot)
      .map((t) => ({
        id: t.slot,
        name: t.ticket,
        gitBranch: t.branch,
        services: (["api", "web"] as const).filter((key) => t.servers[key].up),
        url: t.url,
      }));
    return c.json(tickets, 200);
  });
}
