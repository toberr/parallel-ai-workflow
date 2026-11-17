import { z } from "@hono/zod-openapi";
import { createDb } from "@repo/db";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.ts";
import { WtTicketSchema, wtTicketsRoutes, type WtLs } from "./wt-tickets.ts";

// Placeholder tickets in the shape of `wt ls --json`; the real CLI is not run
const ls: WtLs = {
  version: 1,
  tickets: [
    {
      ticket: "demo-two",
      slot: 2,
      branch: "feature/demo-two",
      url: "http://s2.localhost",
      servers: { api: { up: false }, web: { up: false } },
    },
    {
      ticket: "demo-one",
      slot: 1,
      branch: "feature/demo-one",
      url: "http://s1.localhost",
      servers: { api: { up: true }, web: { up: true } },
    },
  ],
};

describe("GET /api/wt-tickets", () => {
  it("maps the wt tickets to the response schema, ordered by slot", async () => {
    const app = wtTicketsRoutes({ listWt: async () => ls });
    const res = await app.request("/api/wt-tickets");
    expect(res.status).toBe(200);

    const body = z.array(WtTicketSchema).parse(await res.json());
    expect(body).toEqual([
      { id: 1, name: "demo-one", gitBranch: "feature/demo-one", services: ["api", "web"], url: "http://s1.localhost" },
      { id: 2, name: "demo-two", gitBranch: "feature/demo-two", services: [], url: "http://s2.localhost" },
    ]);
  });

  it("answers 503 without details when the wt CLI fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = wtTicketsRoutes({
      listWt: async () => {
        throw new Error("spawn failed in /some/local/path");
      },
    });
    const res = await app.request("/api/wt-tickets");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { message: string };
    expect(body.message).not.toContain("/some/local/path");
    log.mockRestore();
  });
});

describe("createApp", () => {
  const db = createDb(); // lazy pool: these tests never query
  afterAll(async () => {
    await db.destroy();
  });

  it("serves /api/wt-tickets only with devRoutes", async () => {
    expect((await createApp({ db }).request("/api/wt-tickets")).status).toBe(404);
    const dev = createApp({ db, devRoutes: true, listWt: async () => ls });
    expect((await dev.request("/api/wt-tickets")).status).toBe(200);
  });
});
