import { inject } from "vitest";

// Runs in each test worker before the test files import anything: the app under test then
// connects to the test database, never to DB_DATABASE.
process.env.DB_DATABASE = inject("testDatabase");
