import fs from "node:fs";

export interface SqlMigration {
  id: string;
  sql: string;
}

const MIGRATION_FILES = ["001_init.sql"];

export function loadSqlMigrations(): SqlMigration[] {
  return MIGRATION_FILES.map((fileName) => {
    const fileUrl = new URL(`./migrations/${fileName}`, import.meta.url);
    return {
      id: fileName.replace(/\.sql$/, ""),
      sql: fs.readFileSync(fileUrl, "utf8"),
    };
  });
}
