import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));

/** The listen port from apps/api/.env (process env wins). Stops if it is missing or invalid. */
export function requirePort(): number {
  const fromFile = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
  const raw = process.env.PORT ?? fromFile.PORT;
  if (!raw) {
    throw new Error(`PORT is not set. Copy apps/api/.env.example to ${ENV_FILE} and set PORT.`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a port number, got "${raw}".`);
  }
  return port;
}
