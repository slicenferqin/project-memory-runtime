import fs from "node:fs";

export interface SqlMigration {
  id: string;
  sql: string;
}

const MIGRATION_FILES = [
  "001_init.sql",
  "002_constraints.sql",
  "003_event_provenance.sql",
  "004_event_capture_path.sql",
];

export function loadSqlMigrations(): SqlMigration[] {
  return MIGRATION_FILES.map((fileName) => {
    const fileUrl = new URL(`./migrations/${fileName}`, import.meta.url);
    return {
      id: fileName.replace(/\.sql$/, ""),
      sql: fs.readFileSync(fileUrl, "utf8"),
    };
  });
}
