import { sql, type Kysely } from "kysely";

// `any` is required here since migrations should be frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("tickets")
    .addColumn("id", "integer", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("name", "text", (col) => col.notNull().unique())
    .addColumn("git_branch", "text", (col) => col.notNull())
    .addColumn("services", sql`text[]`, (col) => col.notNull())
    .execute();

  await db
    .insertInto("tickets")
    .values({
      name: "demo-ticket",
      git_branch: "feature/demo-ticket",
      services: ["api", "web", "postgres"],
    })
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("tickets").execute();
}
