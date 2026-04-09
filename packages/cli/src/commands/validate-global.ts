import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  loadGlobalInstallConfig,
  resolveGlobalInstallPaths,
  validateClaudeHookSettings,
} from "@slicenfer/project-memory-adapter-claude-code";

function commandExists(command: string): boolean {
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(whichCmd, [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

export async function runValidateGlobal(): Promise<void> {
  const config = loadGlobalInstallConfig();
  const paths = resolveGlobalInstallPaths();

  if (!config) {
    console.error(`Global config not found: ${paths.configFile}`);
    process.exitCode = 1;
    return;
  }

  const hookValidation = validateClaudeHookSettings({
    target: "global",
    settings_file: config.settings_file,
  });
  const skillFile = path.join(config.skill_dir, "project-memory", "SKILL.md");
  const commandOk = commandExists("project-memory-claude-hook") || commandExists("npx");

  console.log("");
  console.log(`  Config: ${paths.configFile}`);
  console.log(`  Hooks: ${hookValidation.is_valid ? "ok" : "invalid"}`);
  console.log(`  Skill: ${fs.existsSync(skillFile) ? "ok" : "missing"}`);
  console.log(`  Command: ${commandOk ? "ok" : "missing"}`);
  console.log(`  Data DB: ${fs.existsSync(config.db_path) ? "present" : "not created yet"}`);
  console.log("");

  if (!hookValidation.is_valid || !fs.existsSync(skillFile) || !commandOk) {
    process.exitCode = 1;
  }
}
