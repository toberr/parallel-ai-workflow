import { z } from "@hono/zod-openapi";
import { createDb } from "@repo/db";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { TicketSchema } from "./tickets.ts";

const db = createDb();
const app = createApp({ db });

afterAll(async () => {
  await db.destroy();
});

describe("GET /api/tickets", () => {
  it("returns the seed ticket matching the response schema", async () => {
    const res = await app.request("/api/tickets");
    expect(res.status).toBe(200);

    const body = z.array(TicketSchema).parse(await res.json());
    expect(body).toContainEqual({
      id: expect.any(Number),
      name: "demo-ticket",
      gitBranch: "feature/demo-ticket",
      services: ["api", "web", "postgres"],
    });
  });
});

describe("GET /api/openapi.json", () => {
  it("serves an OpenAPI 3.1 document", async () => {
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths).toHaveProperty("/api/tickets");
  });
});
