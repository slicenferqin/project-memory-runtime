import { createHash } from "node:crypto";
import {
  NEGATIVE_OUTCOME_TYPES as NEGATIVE_OUTCOME_TYPE_VALUES,
  POSITIVE_OUTCOME_TYPES as POSITIVE_OUTCOME_TYPE_VALUES,
  type OutcomeType,
} from "./types.js";

/** Returns the current timestamp in ISO 8601 format. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Clamps a number between min and max bounds. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Calculates the non-negative number of days between two ISO timestamps. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.max(0, (to - from) / (1000 * 60 * 60 * 24));
}

/** Safely converts an unknown value to a trimmed string, or undefined if empty/non-string. */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Generates a deterministic 24-char hex ID from input parts via SHA-256. */
export function hashId(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex").slice(0, 24);
}

/** Canonical set of positive outcome types. Single source of truth. */
export const POSITIVE_OUTCOME_TYPES: ReadonlySet<OutcomeType> = new Set<OutcomeType>([
  ...POSITIVE_OUTCOME_TYPE_VALUES,
]);

/** Canonical set of negative outcome types. Single source of truth. */
export const NEGATIVE_OUTCOME_TYPES: ReadonlySet<OutcomeType> = new Set<OutcomeType>([
  ...NEGATIVE_OUTCOME_TYPE_VALUES,
]);
