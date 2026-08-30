// Bun test preload — make `bun test` hermetic, matching CI.
//
// CI runs the suite from a fresh `actions/checkout` where none of cue's runtime
// env vars exist, so the profile loader resolves its repo root / profiles /
// schema from its own on-disk location (import.meta.url). Locally, the cue shell
// shim exports `CUE_REPO_ROOT`, `SOUL_REPO_ROOT`, `CUE_PROFILE`, etc. pointing at
// the *installed* tree. The loader honors those over its own location, so a
// `bun test` run — especially from a git worktree (cue's own recommended
// workflow) — silently validates against the installed tree's working copy
// instead of the code under test. That produces failures that don't reproduce in
// CI and pass/fail based on whatever uncommitted state the installed tree holds.
//
// Stripping these before any test module loads restores the fresh-checkout
// behavior CI relies on. A test that wants any of these set does so itself
// (after this preload runs), so its own value still wins.
const AMBIENT_SHIM_VARS = [
  // --- Location / resolution: redirect where cue reads code + config from. ---
  // The first two bake into module-level `const`s at import time (e.g.
  // profile-loader.ts `const REPO_ROOT = process.env.CUE_REPO_ROOT ?? ...`), so
  // they MUST be cleared before any test module loads — only a preload can.
  // Repo root → schema.json + default profiles dir.
  "CUE_REPO_ROOT",
  "SOUL_REPO_ROOT",
  // Profiles dir override.
  "CUE_PROFILES_DIR",
  "SOUL_PROFILES_DIR",
  // Other resource-root overrides resolved off the installed tree.
  "CUE_SKILLS_ROOT",
  "SOUL_PLUGINS_ROOT",
  "CUE_COMMANDS_DIR",
  "CUE_PLAYBOOKS_DIR",
  "CUE_WORKFLOWS_DIR",
  "CUE_PLUGIN_LOGOS_DIR",
  // Active-profile selection — absent on a fresh checkout; tests that assert
  // "no active profile" behavior break when the shim leaves this set.
  "CUE_PROFILE",

  // --- Session / runtime flags the shim injects per launch. CI never has ---
  // these, and they change behavior: CUE_SMART_SUBSET makes the launch parser
  // treat passthrough args (e.g. `--help`) as a subset prompt, defeating the
  // help-bypass; CUE_LAUNCHING trips the shim-recursion guard.
  "CUE_LAUNCHING",
  "CUE_SMART_SUBSET",
  "CUE_AGENT",
  "CUE_KITTY",
];

for (const name of AMBIENT_SHIM_VARS) {
  delete process.env[name];
}
