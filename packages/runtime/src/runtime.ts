import { RuntimeStorage } from "./storage/sqlite.js";
import type { Claim, NormalizedEvent, Outcome, RuntimeConfig, RuntimePaths, RuntimeStats } from "./types.js";

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
    this.storage.insertEvent(event);
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
}
