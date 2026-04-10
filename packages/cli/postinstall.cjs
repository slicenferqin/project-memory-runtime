#!/usr/bin/env node
/*
 * Minimal bootstrap for the cli package `postinstall` lifecycle script.
 *
 * Responsibilities:
 *  1. Silently exit 0 when dist/postinstall.js does not exist yet
 *     (e.g. fresh monorepo clone before `pnpm build`).
 *  2. Otherwise spawn the compiled ESM script as a separate `node` process
 *     so its `invokedDirectly` guard (based on process.argv[1]) fires
 *     naturally.
 *
 * All "should we actually configure hooks?" logic lives in
 * ./src/postinstall.ts (compiled to ./dist/postinstall.js). This bootstrap
 * is intentionally dumb — it only exists so that `pnpm install` in a fresh
 * clone of the monorepo does not fail trying to load a file that hasn't
 * been built yet.
 *
 * This file is CommonJS (.cjs) so it can run unconditionally regardless of
 * whether the parent package has a `type: "module"` field.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const target = path.join(__dirname, "dist", "postinstall.js");

if (!fs.existsSync(target)) {
  // dist not built (monorepo pre-build) — nothing to do.
  process.exit(0);
}

try {
  spawnSync(process.execPath, [target], { stdio: "inherit" });
} catch {
  // Never fail npm install.
}

process.exit(0);
