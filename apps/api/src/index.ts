import { serve } from "@hono/node-server";
import { createDb } from "@repo/db";
import { createApp, DOCS_PATH } from "./app.ts";
import { requirePort } from "./env.ts";

const port = requirePort();
const db = createDb();
// The Swagger UI and /api/wt-tickets are development aids: a production deployment does not publish them
const devRoutes = process.env.NODE_ENV !== "production";
const app = createApp({ db, devRoutes });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
  if (devRoutes) console.log(`API docs (Swagger UI) under ${DOCS_PATH}`);
});

function shutdown() {
  server.close();
  void db.destroy().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
