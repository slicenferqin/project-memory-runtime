import process from "node:process";

/**
 * Detect whether the current npm/pnpm/yarn operation is a global install.
 *
 * npm and pnpm set `npm_config_global=true` during global installs. Yarn
 * classic does not, so `yarn global add` users still have to run
 * `pmr install-global` manually.
 */
export function isGlobalInstall(): boolean {
  return process.env.npm_config_global === "true";
}

/**
 * Skip auto-setup on CI build machines to avoid polluting their home dirs
 * and slowing down builds. Covers GitHub Actions, GitLab CI, Jenkins, and
 * Azure Pipelines.
 */
export function isCIEnvironment(): boolean {
  return !!(
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.BUILD_NUMBER ||
    process.env.TF_BUILD
  );
}

async function main(): Promise<void> {
  // Local install → silently skip. This path is also taken when the
  // monorepo root runs `pnpm install` during development.
  if (!isGlobalInstall()) return;
  // CI → do not write to the user's home dir.
  if (isCIEnvironment()) return;

  try {
    const { runInstallGlobal } = await import("./commands/install-global.js");
    // Pass the bin name as a literal so runInstallGlobal skips the `which`
    // lookup inside resolveGlobalHookCommand(). During postinstall the bin
    // is not yet linked, but we only WRITE this string into settings.json —
    // by the time Claude Code actually executes the hook, npm has finished
    // linking the bin and the command resolves correctly.
    await runInstallGlobal({ command: "project-memory-claude-hook" });
  } catch {
    process.stderr.write(
      "\nproject-memory-runtime: auto-setup skipped (non-fatal).\n" +
      "Run 'pmr install-global' manually to configure hooks.\n\n"
    );
  }
}

// Only run main() when invoked directly (not when imported by tests).
const invokedDirectly =
  !!process.argv[1] && process.argv[1].endsWith("postinstall.js");
if (invokedDirectly) {
  main().then(
    () => process.exit(0),
    () => process.exit(0)
  );
}
