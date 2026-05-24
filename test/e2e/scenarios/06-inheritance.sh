#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
ensure_temp_home

repo="$(fresh_repo 06-inheritance)"
install_deps "$repo"
require_profile "$repo" "core"
require_profile "$repo" "medusa-dev"

script="$SOUL_E2E_WORK/06-inheritance.mjs"
cat > "$script" <<'JS'
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repo = process.argv[2];
const loaderUrl = pathToFileURL(join(repo, "src/lib/profile-loader.ts")).href;
const { loadProfile } = await import(loaderUrl);

const core = await loadProfile("core");
const child = await loadProfile("medusa-dev");
const chain = child.inheritanceChain.join(" -> ");
if (chain !== "core -> medusa-dev") {
  throw new Error(`expected core -> medusa-dev inheritance chain, got ${chain}`);
}

const coreLocalSkills = core.skills.local.map((s) => (typeof s === "string" ? s : s.id));
const childLocalSkills = child.skills.local.map((s) => (typeof s === "string" ? s : s.id));
for (const skill of coreLocalSkills) {
  if (!childLocalSkills.includes(skill)) {
    throw new Error(`medusa-dev did not inherit core local skill ${skill}`);
  }
}
const corePlugins = (core.plugins ?? []).map((p) => p.id);
const childPlugins = (child.plugins ?? []).map((p) => p.id);
for (const plugin of corePlugins) {
  if (!childPlugins.includes(plugin)) {
    throw new Error(`medusa-dev did not inherit core plugin ${plugin}`);
  }
}
const coreMcps = core.mcps.map((m) => (typeof m === "string" ? m : m.id));
const childMcps = child.mcps.map((m) => (typeof m === "string" ? m : m.id));
for (const mcp of coreMcps) {
  if (!childMcps.includes(mcp)) {
    throw new Error(`medusa-dev did not inherit core MCP ${mcp}`);
  }
}
JS

bun "$script" "$repo"

log "medusa-dev resolves inherited core skills and MCPs"
