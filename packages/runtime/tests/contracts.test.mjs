import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function parseOutcomeTypesFromSql(sql) {
  const match = sql.match(/outcome_type NOT IN \(([^)]+)\)/);
  assert.ok(match, "SQL outcome_type validation clause should exist");

  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

test("stable outcome types stay aligned across types, validation, and sqlite constraints", async () => {
  const runtimeMod = await import("../dist/index.js");
  const validationMod = await import("../dist/validation.js");

  const stableTypes = [...runtimeMod.STABLE_OUTCOME_TYPES];
  const sql = fs.readFileSync(
    path.join(repoRoot, "src", "storage", "migrations", "002_constraints.sql"),
    "utf8"
  );
  const sqlOutcomeTypes = parseOutcomeTypesFromSql(sql);

  assert.deepEqual(sqlOutcomeTypes, stableTypes);

  for (const outcomeType of stableTypes) {
    assert.doesNotThrow(() => validationMod.assertOutcomeType(outcomeType));
  }

  for (const experimentalType of ["human_approved", "human_rejected", "claim_superseded"]) {
    assert.throws(() => validationMod.assertOutcomeType(experimentalType), /invalid outcome_type/);
  }
});
