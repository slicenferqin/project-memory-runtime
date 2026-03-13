import type { Claim, NormalizedEvent, Outcome } from "../types.js";
import { extractDeterministicArtifacts } from "../compiler/deterministic.js";

export interface IngestionArtifacts {
  claims: Claim[];
  outcomes: Outcome[];
}

export function buildIngestionArtifacts(event: NormalizedEvent): IngestionArtifacts {
  return extractDeterministicArtifacts(event);
}
