import fs from "node:fs";
import path from "node:path";
import {
  loadGlobalInstallConfig,
  removeGlobalInstallConfig,
  resolveGlobalInstallPaths,
  uninstallClaudeHookSettings,
} from "@slicenfer/project-memory-adapter-claude-code";

export async function runUninstallGlobal(): Promise<void> {
  const config = loadGlobalInstallConfig();
  const paths = resolveGlobalInstallPaths();
  const settingsFile = config?.settings_file ?? paths.settingsFile;
  const skillDir = path.join(config?.skill_dir ?? paths.skillDir, "project-memory");

  const uninstallResult = uninstallClaudeHookSettings({
    target: "global",
    settings_file: settingsFile,
  });

  if (fs.existsSync(skillDir)) {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }

  removeGlobalInstallConfig();

  console.log("");
  console.log(`  Hooks removed from: ${uninstallResult.settings_file}`);
  console.log(`  Removed managed events: ${uninstallResult.removed_events.length}`);
  console.log(`  Skill removed: ${skillDir}`);
  console.log(`  Config removed: ${paths.configFile}`);
  console.log(`  Shared data kept: ${config?.data_dir ?? paths.dataDir}`);
  console.log("");
}
