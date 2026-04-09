import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface GlobalInstallConfig {
  version: number;
  mode: "global";
  data_dir: string;
  db_path: string;
  settings_file: string;
  skill_dir: string;
  ignored_repo_globs: string[];
}

export interface LocalProjectMemoryConfig {
  mode: "disabled" | "local";
  data_dir?: string;
}

export type RuntimeLocationMode =
  | "explicit"
  | "local_override"
  | "legacy_local"
  | "global"
  | "default_local"
  | "disabled";

export interface ResolveRuntimeLocationInput {
  cwd: string;
  dataDir?: string;
  dbPath?: string;
  project_id?: string;
  repo_id?: string;
  workspace_id?: string;
  branch?: string;
}

export interface ResolvedRuntimeLocation {
  enabled: boolean;
  mode: RuntimeLocationMode;
  cwd: string;
  project_root?: string;
  dataDir?: string;
  dbPath?: string;
  project_id?: string;
  repo_id?: string;
  workspace_id?: string;
  branch?: string;
  global_config?: GlobalInstallConfig;
  local_override?: LocalProjectMemoryConfig;
  reason?: string;
}

const GLOBAL_CONFIG_VERSION = 1;
const LOCAL_OVERRIDE_FILE = path.join(".claude", "project-memory.json");
const LEGACY_LOCAL_DIR_NAME = ".memory";
const LEGACY_LOCAL_DB_NAME = "runtime.sqlite";
const CLAUDE_HOME_ENV = "PMR_CLAUDE_HOME";

function hashValue(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function localProjectId(repoRoot: string): string {
  return `local:${hashValue(repoRoot)}`;
}

function normalizeGitRemote(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return undefined;

  const scpLike = trimmed.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^#?]+)$/i);
  if (scpLike) {
    const host = scpLike[1].toLowerCase();
    const repoPath = scpLike[2].replace(/\.git$/i, "").replace(/^\/+/, "");
    return `${host}/${repoPath}`;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const repoPath = parsed.pathname.replace(/\.git$/i, "").replace(/^\/+/, "");
    if (!repoPath) return undefined;
    return `${host}/${repoPath}`;
  } catch {
    return undefined;
  }
}

function runGit(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function findGitRoot(cwd: string): string | undefined {
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  return root ? path.resolve(root) : undefined;
}

function deriveProjectIdFromGitRoot(repoRoot: string): string {
  const remotes = (runGit(repoRoot, ["remote"]) ?? "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  const remoteName = remotes.includes("origin")
    ? "origin"
    : remotes.includes("upstream")
      ? "upstream"
      : remotes.length === 1
        ? remotes[0]
        : undefined;

  if (remoteName) {
    const remoteUrl = runGit(repoRoot, ["remote", "get-url", remoteName]);
    const normalizedRemote = remoteUrl ? normalizeGitRemote(remoteUrl) : undefined;
    if (normalizedRemote) return normalizedRemote;
  }

  return localProjectId(repoRoot);
}

function deriveWorkspaceId(repoRoot: string): string {
  const realPath = fs.realpathSync.native?.(repoRoot) ?? fs.realpathSync(repoRoot);
  return hashValue(realPath).slice(0, 64);
}

function deriveBranch(repoRoot: string): string | undefined {
  const branch = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") return undefined;
  return branch;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexBody = escaped
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${regexBody}$`);
}

function repoIgnored(projectRoot: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(projectRoot));
}

export function resolveClaudeHomeDir(): string {
  const explicit = process.env[CLAUDE_HOME_ENV];
  if (explicit) return path.resolve(explicit);
  return path.join(os.homedir(), ".claude");
}

export function resolveGlobalInstallPaths() {
  const claudeHome = resolveClaudeHomeDir();
  const globalRoot = path.join(claudeHome, "project-memory-runtime");
  const dataDir = path.join(globalRoot, "data");
  return {
    claudeHome,
    globalRoot,
    configFile: path.join(globalRoot, "config.json"),
    settingsFile: path.join(claudeHome, "settings.local.json"),
    skillDir: path.join(claudeHome, "skills"),
    dataDir,
    dbPath: path.join(dataDir, LEGACY_LOCAL_DB_NAME),
  };
}

export function defaultGlobalInstallConfig(): GlobalInstallConfig {
  const paths = resolveGlobalInstallPaths();
  return {
    version: GLOBAL_CONFIG_VERSION,
    mode: "global",
    data_dir: paths.dataDir,
    db_path: paths.dbPath,
    settings_file: paths.settingsFile,
    skill_dir: paths.skillDir,
    ignored_repo_globs: [],
  };
}

export function loadGlobalInstallConfig(): GlobalInstallConfig | undefined {
  const { configFile } = resolveGlobalInstallPaths();
  if (!fs.existsSync(configFile)) return undefined;

  const parsed = JSON.parse(fs.readFileSync(configFile, "utf8")) as GlobalInstallConfig;
  if (
    !parsed ||
    parsed.mode !== "global" ||
    typeof parsed.data_dir !== "string" ||
    typeof parsed.db_path !== "string" ||
    typeof parsed.settings_file !== "string" ||
    typeof parsed.skill_dir !== "string" ||
    !Array.isArray(parsed.ignored_repo_globs)
  ) {
    throw new Error(`invalid global Project Memory config at ${configFile}`);
  }

  return {
    ...parsed,
    data_dir: path.resolve(parsed.data_dir),
    db_path: path.resolve(parsed.db_path),
    settings_file: path.resolve(parsed.settings_file),
    skill_dir: path.resolve(parsed.skill_dir),
  };
}

export function writeGlobalInstallConfig(config: GlobalInstallConfig): string {
  const { configFile } = resolveGlobalInstallPaths();
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return configFile;
}

export function removeGlobalInstallConfig(): void {
  const { configFile } = resolveGlobalInstallPaths();
  if (fs.existsSync(configFile)) {
    fs.rmSync(configFile, { force: true });
  }
}

export function loadLocalProjectMemoryConfig(projectRoot: string): LocalProjectMemoryConfig | undefined {
  const configPath = path.join(projectRoot, LOCAL_OVERRIDE_FILE);
  if (!fs.existsSync(configPath)) return undefined;

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as LocalProjectMemoryConfig;
  if (!parsed || (parsed.mode !== "disabled" && parsed.mode !== "local")) {
    throw new Error(`invalid local Project Memory config at ${configPath}`);
  }

  return parsed;
}

function resolveLocalDataDir(projectRoot: string, override?: LocalProjectMemoryConfig): string {
  if (override?.data_dir) {
    return path.isAbsolute(override.data_dir)
      ? override.data_dir
      : path.resolve(projectRoot, override.data_dir);
  }

  return path.join(projectRoot, LEGACY_LOCAL_DIR_NAME);
}

function resolveDerivedIds(
  cwd: string,
  projectRoot: string | undefined,
  input: ResolveRuntimeLocationInput
) {
  if (projectRoot) {
    const repoId = input.repo_id ?? deriveProjectIdFromGitRoot(projectRoot);
    return {
      project_id: input.project_id ?? repoId,
      repo_id: repoId,
      workspace_id: input.workspace_id ?? deriveWorkspaceId(projectRoot),
      branch: input.branch ?? deriveBranch(projectRoot),
    };
  }

  const fallbackRoot = path.resolve(cwd);
  const repoId = input.repo_id ?? localProjectId(fallbackRoot);
  return {
    project_id: input.project_id ?? repoId,
    repo_id: repoId,
    workspace_id: input.workspace_id ?? deriveWorkspaceId(fallbackRoot),
    branch: input.branch,
  };
}

export function resolveRuntimeLocation(input: ResolveRuntimeLocationInput): ResolvedRuntimeLocation {
  const cwd = path.resolve(input.cwd);
  const explicitDataDir = input.dataDir ? path.resolve(cwd, input.dataDir) : undefined;
  const explicitDbPath = input.dbPath ? path.resolve(cwd, input.dbPath) : undefined;
  const projectRoot = findGitRoot(cwd);
  const derivedIds = resolveDerivedIds(cwd, projectRoot, input);
  const globalConfig = loadGlobalInstallConfig();

  if (explicitDataDir || explicitDbPath) {
    const dataDir = explicitDataDir ?? path.dirname(explicitDbPath!);
    return {
      enabled: true,
      mode: "explicit",
      cwd,
      project_root: projectRoot,
      dataDir,
      dbPath: explicitDbPath ?? path.join(dataDir, LEGACY_LOCAL_DB_NAME),
      global_config: globalConfig,
      ...derivedIds,
    };
  }

  if (projectRoot) {
    const localOverride = loadLocalProjectMemoryConfig(projectRoot);
    if (localOverride?.mode === "disabled") {
      return {
        enabled: false,
        mode: "disabled",
        cwd,
        project_root: projectRoot,
        local_override: localOverride,
        global_config: globalConfig,
        reason: "project memory disabled by repo override",
        ...derivedIds,
      };
    }

    if (globalConfig && repoIgnored(projectRoot, globalConfig.ignored_repo_globs)) {
      return {
        enabled: false,
        mode: "disabled",
        cwd,
        project_root: projectRoot,
        global_config: globalConfig,
        reason: "project memory disabled by global ignore rules",
        ...derivedIds,
      };
    }

    if (localOverride?.mode === "local") {
      const dataDir = resolveLocalDataDir(projectRoot, localOverride);
      return {
        enabled: true,
        mode: "local_override",
        cwd,
        project_root: projectRoot,
        dataDir,
        dbPath: path.join(dataDir, LEGACY_LOCAL_DB_NAME),
        global_config: globalConfig,
        local_override: localOverride,
        ...derivedIds,
      };
    }

    const legacyDbPath = path.join(projectRoot, LEGACY_LOCAL_DIR_NAME, LEGACY_LOCAL_DB_NAME);
    if (fs.existsSync(legacyDbPath)) {
      return {
        enabled: true,
        mode: "legacy_local",
        cwd,
        project_root: projectRoot,
        dataDir: path.dirname(legacyDbPath),
        dbPath: legacyDbPath,
        global_config: globalConfig,
        ...derivedIds,
      };
    }

    if (globalConfig) {
      return {
        enabled: true,
        mode: "global",
        cwd,
        project_root: projectRoot,
        dataDir: globalConfig.data_dir,
        dbPath: globalConfig.db_path,
        global_config: globalConfig,
        ...derivedIds,
      };
    }

    const dataDir = path.join(projectRoot, LEGACY_LOCAL_DIR_NAME);
    return {
      enabled: true,
      mode: "default_local",
      cwd,
      project_root: projectRoot,
      dataDir,
      dbPath: path.join(dataDir, LEGACY_LOCAL_DB_NAME),
      global_config: globalConfig,
      ...derivedIds,
    };
  }

  if (globalConfig) {
    return {
      enabled: false,
      mode: "disabled",
      cwd,
      global_config: globalConfig,
      reason: "project memory global mode is inactive outside git repositories",
      ...derivedIds,
    };
  }

  const dataDir = path.join(cwd, LEGACY_LOCAL_DIR_NAME);
  return {
    enabled: true,
    mode: "default_local",
    cwd,
    dataDir,
    dbPath: path.join(dataDir, LEGACY_LOCAL_DB_NAME),
    ...derivedIds,
  };
}
