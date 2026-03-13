import { RuntimeStorage } from "./storage/sqlite.js";
import type { Claim, NormalizedEvent, Outcome, RuntimeConfig, RuntimePaths, RuntimeStats } from "./types.js";
import { buildIngestionArtifacts } from "./ingestion/service.js";

export class ProjectMemoryRuntime {
  private readonly storage: RuntimeStorage;
  private initialized = false;

  constructor(config: RuntimeConfig = {}) {
    this.storage = new RuntimeStorage(config);
  }

  initialize(): void {
    if (this.initialized) return;
    this.storage.applyMigrations();
    this.initialized = true;
  }

  close(): void {
    this.storage.close();
    this.initialized = false;
  }

  getPaths(): RuntimePaths {
    return this.storage.paths;
  }

  recordEvent(event: NormalizedEvent): void {
    this.initialize();
    const inserted = this.storage.insertEventWithResult(event);
    if (!inserted) return;

    const artifacts = buildIngestionArtifacts(event);

    for (const claim of artifacts.claims) {
      const scopeJson = claim.scope ? JSON.stringify(claim.scope) : null;
      const existingClaims = this.storage.findActiveSingletonClaims(
        claim.project_id,
        claim.canonical_key,
        scopeJson
      );

      for (const existing of existingClaims) {
        if (existing.id === claim.id) continue;
        this.storage.supersedeClaim(
          existing.id,
          claim.id,
          "replaced by deterministic ingestion",
          "compiler",
          "system"
        );
      }

      this.storage.upsertClaim(claim);
    }

    for (const outcome of artifacts.outcomes) {
      this.storage.upsertOutcome(outcome);
    }
  }

  insertClaimRecord(claim: Claim): void {
    this.initialize();
    this.storage.insertClaim(claim);
  }

  insertOutcomeRecord(outcome: Outcome): void {
    this.initialize();
    this.storage.insertOutcome(outcome);
  }

  getStats(): RuntimeStats {
    this.initialize();
    return this.storage.getStats();
  }

  listEvents(projectId?: string): NormalizedEvent[] {
    this.initialize();
    return this.storage.listEvents(projectId);
  }

  listClaims(projectId?: string): Claim[] {
    this.initialize();
    return this.storage.listClaims(projectId);
  }

  listOutcomes(projectId?: string): Outcome[] {
    this.initialize();
    return this.storage.listOutcomes(projectId);
  }
}
