import path from "node:path";
import process from "node:process";
import { ProjectMemoryRuntime } from "@slicenfer/project-memory-runtime-core";
import {
  defaultGlobalInstallConfig,
  loadGlobalInstallConfig,
  resolveGlobalInstallPaths,
  writeGlobalInstallConfig,
  installClaudeHookSettings,
  validateClaudeHookSettings,
} from "@slicenfer/project-memory-adapter-claude-code";
import type { CliOptions } from "../shared.js";
import { installProjectMemorySkill, resolveGlobalHookCommand } from "../global.js";

export async function runInstallGlobal(options: CliOptions): Promise<void> {
  const existingConfig = loadGlobalInstallConfig();
  const baseConfig = defaultGlobalInstallConfig();
  const config = {
    ...(existingConfig ?? baseConfig),
    ...baseConfig,
    ignored_repo_globs: existingConfig?.ignored_repo_globs ?? baseConfig.ignored_repo_globs,
  };
  const hookCommand = typeof options.command === "string"
    ? options.command
    : resolveGlobalHookCommand();

  const steps: { label: string; detail: string }[] = [];
  const errors: string[] = [];

  let runtime: ProjectMemoryRuntime | undefined;
  try {
    runtime = new ProjectMemoryRuntime({
      dataDir: config.data_dir,
      dbPath: config.db_path,
    });
    runtime.initialize();
    steps.push({ label: "Database", detail: config.db_path });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Database initialization failed: ${message}`);
  } finally {
    runtime?.close();
  }

  try {
    const configFile = writeGlobalInstallConfig(config);
    steps.push({ label: "Config", detail: configFile });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Global config write failed: ${message}`);
  }

  try {
    const result = installClaudeHookSettings({
      target: "global",
      settings_file: config.settings_file,
      command: hookCommand,
      omit_default_data_dir: true,
    });
    const hookCount = Object.keys(result.settings.hooks ?? {}).length;
    steps.push({ label: "Hooks", detail: `${hookCount} global lifecycle hooks installed` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Global hook installation failed: ${message}`);
  }

  try {
    const skillFile = installProjectMemorySkill(config.skill_dir, "global");
    steps.push({ label: "Skill", detail: skillFile });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Global skill installation failed: ${message}`);
  }

  try {
    const validation = validateClaudeHookSettings({
      target: "global",
      settings_file: config.settings_file,
    });
    if (validation.is_valid) {
      steps.push({ label: "Validation", detail: "all global checks passed" });
    } else {
      errors.push(`Validation: missing hooks for ${validation.missing_events.join(", ")}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Global validation failed: ${message}`);
  }

  console.log("");
  for (const step of steps) {
    console.log(`  ✓ ${step.label}: ${step.detail}`);
  }
  for (const error of errors) {
    console.log(`  ✗ ${error}`);
  }

  if (errors.length > 0) {
    console.log(`\n  ${errors.length} issue(s) found. Check above for details.`);
    process.exitCode = 1;
    return;
  }

  const paths = resolveGlobalInstallPaths();
  console.log("");
  console.log(`  Claude settings: ${config.settings_file}`);
  console.log(`  Global skill dir: ${path.join(config.skill_dir, "project-memory")}`);
  console.log(`  Shared data dir: ${paths.dataDir}`);
  console.log("");
}
