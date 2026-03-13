import type { ClaimScope } from "./types.js";

function sameFiles(left?: string[], right?: string[]): boolean {
  if (!left?.length && !right?.length) return true;
  if (!left?.length || !right?.length) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function scopeLevel(scope?: ClaimScope): "project" | "branch" | "cwd" | "files" {
  if (scope?.files?.length) return "files";
  if (scope?.cwd_prefix) return "cwd";
  if (scope?.branch) return "branch";
  return "project";
}

export function normalizeClaimScope(scope?: ClaimScope): ClaimScope | undefined {
  if (!scope) return undefined;

  const normalized: ClaimScope = {};
  if (scope.repo) normalized.repo = scope.repo;
  if (scope.branch) normalized.branch = scope.branch;
  if (scope.cwd_prefix) normalized.cwd_prefix = scope.cwd_prefix;
  if (scope.files?.length) normalized.files = [...scope.files].sort();

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function scopeSignature(scope?: ClaimScope): string {
  return JSON.stringify(normalizeClaimScope(scope) ?? null);
}

export function singletonScopeCompatible(
  leftScope?: ClaimScope,
  rightScope?: ClaimScope
): boolean {
  const left = normalizeClaimScope(leftScope);
  const right = normalizeClaimScope(rightScope);

  if (scopeLevel(left) !== scopeLevel(right)) return false;
  if ((left?.branch ?? null) !== (right?.branch ?? null)) return false;
  if ((left?.cwd_prefix ?? null) !== (right?.cwd_prefix ?? null)) return false;
  if (!sameFiles(left?.files, right?.files)) return false;
  if (left?.repo && right?.repo && left.repo !== right.repo) return false;

  return true;
}
