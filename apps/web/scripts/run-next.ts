// Starts `next dev` / `next start` on the PORT from apps/web/.env.local.
// Next.js reads PORT from the process environment before it loads .env files, so the file is
// loaded here first (process env wins). Refuses to start without PORT, like the API.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(import.meta.dirname, "../.env.local");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

if (!process.env.PORT || !/^\d+$/.test(process.env.PORT)) {
  console.error("PORT is not set. Copy apps/web/.env.example to apps/web/.env.local and set PORT.");
  process.exit(1);
}

// Hand over to the Next.js CLI, which reads its command from process.argv ("dev" or "start").
await import("next/dist/bin/next");
