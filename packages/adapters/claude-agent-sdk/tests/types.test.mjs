import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("public exports typecheck against the official Claude Agent SDK types", () => {
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tempRoot = path.join(packageDir, ".tmp");
  mkdirSync(tempRoot, { recursive: true });
  const tempDir = mkdtempSync(path.join(tempRoot, "pmr-sdk-types-"));
  const entryPath = path.join(tempDir, "entry.ts");
  const distImportPath = path
    .relative(tempDir, path.join(packageDir, "dist", "index.js"))
    .replaceAll(path.sep, "/");

  writeFileSync(
    entryPath,
    [
      "import type { Options } from '@anthropic-ai/claude-agent-sdk';",
      `import { createProjectMemoryHooks, withProjectMemory, type ProjectMemoryAgentSdkConfig } from '${distImportPath.startsWith(".") ? distImportPath : `./${distImportPath}`}';`,
      "",
      "const config: ProjectMemoryAgentSdkConfig = { agent_id: 'my-app', dataDir: '.memory' };",
      "const hooks = createProjectMemoryHooks(config);",
      "const options: Options = withProjectMemory({ cwd: process.cwd(), hooks, settingSources: ['project'] }, config);",
      "void hooks;",
      "void options;",
      "",
    ].join("\n")
  );

  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "tsc",
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--skipLibCheck",
      "true",
      "--types",
      "node",
      entryPath,
    ],
    {
      cwd: packageDir,
      encoding: "utf8",
    }
  );

  rmSync(tempDir, { recursive: true, force: true });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
