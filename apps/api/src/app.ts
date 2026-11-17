import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { ticketsRoutes, type Db } from "./routes/tickets.ts";
import { wtTicketsRoutes, type WtLs } from "./routes/wt-tickets.ts";

export const OPENAPI_PATH = "/api/openapi.json";
export const DOCS_PATH = "/api/docs";

/**
 * swagger-ui-dist version the docs page loads from the jsDelivr CDN. Pinned, so the browser
 * always gets the same assets (the middleware would otherwise load the newest release).
 */
const SWAGGER_UI_VERSION = "5.34.1";

export const openApiInfo = {
  openapi: "3.1.0",
  info: { title: "Parallel AI workflow API", version: "0.0.0" },
} as const;

/**
 * Builds the Hono app. It never listens and never connects: the database instance is created
 * by the caller (a Kysely pool connects lazily), so importing and building the app needs no
 * running database.
 *
 * `devRoutes` adds the development aids: `/api/wt-tickets` (the worktree tickets from the wt
 * CLI; `listWt` replaces the CLI call in tests) and a Swagger UI for the OpenAPI document at
 * `DOCS_PATH`. Off by default; the server turns it on outside production only.
 */
export function createApp({
  db,
  devRoutes = false,
  listWt,
}: {
  db: Db;
  devRoutes?: boolean;
  listWt?: () => Promise<WtLs>;
}) {
  const app = new OpenAPIHono();
  app.route("/", ticketsRoutes({ db }));
  if (devRoutes) app.route("/", wtTicketsRoutes({ listWt }));
  app.doc31(OPENAPI_PATH, openApiInfo);
  if (devRoutes) {
    app.get(DOCS_PATH, swaggerUI({ url: OPENAPI_PATH, version: SWAGGER_UI_VERSION }));
  }
  return app;
}
