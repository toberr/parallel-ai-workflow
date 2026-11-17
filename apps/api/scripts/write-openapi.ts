// `pnpm openapi`: writes apps/api/openapi.json from the code. No database, no server.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "@repo/db";
import { createApp, openApiInfo } from "../src/app.ts";

const db = createDb(); // lazy pool: nothing connects unless a route runs
// The document describes the dev server, so it includes the development routes (/api/wt-tickets)
const app = createApp({ db, devRoutes: true });
const document = app.getOpenAPI31Document(openApiInfo);
writeFileSync(
  fileURLToPath(new URL("../openapi.json", import.meta.url)),
  JSON.stringify(document, null, 2) + "\n",
);
await db.destroy();
