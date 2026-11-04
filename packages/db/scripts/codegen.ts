// Generates src/types.generated.ts from the migrated database (Kysely's migration tables
// excluded). The password reaches kysely-codegen through this process's environment only,
// never on a command line.
import { fileURLToPath } from "node:url";
import { Cli } from "kysely-codegen";
import { getDbConfig } from "../src/config.ts";

const { host, port, user, password, database } = getDbConfig();
process.env.DATABASE_URL = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;

const outFile = fileURLToPath(new URL("../src/types.generated.ts", import.meta.url));
await new Cli().run({
  argv: ["--dialect", "postgres", "--out-file", outFile, "--exclude-pattern", "kysely_migration*"],
});
