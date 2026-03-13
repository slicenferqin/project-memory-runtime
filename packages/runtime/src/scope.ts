import type { ClaimScope } from "./types.js";

function sameFiles(left?: string[], right?: string[]): boolean {
  if (!left?.length && !right?.length) return true;
  if (!left?.length || !right?.length) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
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

  return (
    (left?.repo ?? null) === (right?.repo ?? null) &&
    (left?.branch ?? null) === (right?.branch ?? null) &&
    (left?.cwd_prefix ?? null) === (right?.cwd_prefix ?? null) &&
    sameFiles(left?.files, right?.files)
  );
}

export function scopeSpecificity(scope?: ClaimScope): number {
  const normalized = normalizeClaimScope(scope);
  if (!normalized) return 0;

  let score = 0;
  if (normalized.repo) score += 1;
  if (normalized.branch) score += 2;
  if (normalized.cwd_prefix) score += 4;
  if (normalized.files?.length) score += 8;
  return score;
}
