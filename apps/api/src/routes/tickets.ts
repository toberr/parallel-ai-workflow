import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { createDb } from "@repo/db";

export type Db = ReturnType<typeof createDb>;

export const TicketSchema = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    name: z.string().openapi({ example: "demo-ticket" }),
    gitBranch: z.string().openapi({ example: "feature/demo-ticket" }),
    services: z.array(z.string()).openapi({ example: ["api", "web", "postgres"] }),
  })
  .openapi("Ticket");

const listTickets = createRoute({
  method: "get",
  path: "/api/tickets",
  summary: "List all tickets",
  responses: {
    200: {
      description: "All tickets, ordered by id",
      content: { "application/json": { schema: z.array(TicketSchema) } },
    },
  },
});

export function ticketsRoutes({ db }: { db: Db }) {
  return new OpenAPIHono().openapi(listTickets, async (c) => {
    const rows = await db.selectFrom("tickets").selectAll().orderBy("id").execute();
    // Columns are snake_case in the database; the API returns camelCase.
    const tickets = rows.map((row) => ({
      id: row.id,
      name: row.name,
      gitBranch: row.git_branch,
      services: row.services,
    }));
    return c.json(tickets, 200);
  });
}
