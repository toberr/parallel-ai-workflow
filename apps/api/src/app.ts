import { OpenAPIHono } from "@hono/zod-openapi";
import { ticketsRoutes, type Db } from "./routes/tickets.ts";

export const OPENAPI_PATH = "/api/openapi.json";

export const openApiInfo = {
  openapi: "3.1.0",
  info: { title: "Parallel AI workflow API", version: "0.0.0" },
} as const;

/**
 * Builds the Hono app. It never listens and never connects: the database instance is created
 * by the caller (a Kysely pool connects lazily), so importing and building the app needs no
 * running database.
 */
export function createApp({ db }: { db: Db }) {
  const app = new OpenAPIHono();
  app.route("/", ticketsRoutes({ db }));
  app.doc31(OPENAPI_PATH, openApiInfo);
  return app;
}
