import { prepareTestDatabase } from "@repo/db/testing";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabase: string;
  }
}

/** Creates and migrates the DB_TEST_DATABASE database; the name is passed on to the workers. */
export default async function setup(project: TestProject) {
  project.provide("testDatabase", await prepareTestDatabase());
}
