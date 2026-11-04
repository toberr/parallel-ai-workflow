import { serve } from "@hono/node-server";
import { createDb } from "@repo/db";
import { createApp } from "./app.ts";
import { requirePort } from "./env.ts";

const port = requirePort();
const db = createDb();
const app = createApp({ db });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

function shutdown() {
  server.close();
  void db.destroy().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
