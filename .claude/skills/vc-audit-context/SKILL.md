---
name: vc:audit-context
description: Audit Flowser context routing, shared-skill discoverability, and Claude/Codex wiring. Use when context docs or skill surfaces move, split, or drift.
metadata:
  author: flowser
  version: "1.0.0"
---

# Audit Context

Use this skill to verify that Flowser's durable context layer is discoverable and organized.

Optional input: a context group, agent, skill, or folder scope to prioritize during the audit.

## Workflow

1. Read `process/context/all-context.md` for the context routing protocol.
2. Read `references/audit-context.md` for the full audit process.
3. Run the context discovery validator:
   ```bash
   node .claude/skills/vc-audit-context/scripts/validate-context-discovery.mjs
   ```
4. Run the shared skill routing coverage validator:
   ```bash
   node .claude/skills/vc-audit-context/scripts/validate-skill-routing.mjs
   ```
5. Run the skill cross-reference validator:
   ```bash
   node .claude/skills/vc-audit-context/scripts/validate-skill-cross-refs.mjs
   ```
6. Run the skill dependency/confusable analysis:
   ```bash
   node .claude/skills/vc-audit-context/scripts/validate-skill-dependencies.mjs
   node .claude/skills/vc-audit-context/scripts/validate-confusable-skills.mjs
   ```
7. Regenerate or check the machine-readable skill catalog:
   ```bash
   node .claude/skills/vc-audit-context/scripts/generate-skills-catalog.mjs --write
   node .claude/skills/vc-audit-context/scripts/generate-skills-catalog.mjs --check
   ```
8. If any script reports failures, inspect the referenced files and patch the smallest
   relevant surface.
9. Re-run the failed validators until they pass.

For agent/skill harness validation (agent parity, skill frontmatter, README.md sync, protocol wiring), use the `audit-vc` skill.

## Rules

- Treat `.claude/skills/` as canonical; `.agents/skills/` is the Codex discovery symlink.
- Treat `.claude/skills/vc-audit-context/references/skill-routing-policy.json` as the explicit allowlist for intentionally non-routed shared skills.
- Do not move large context files without updating `process/context/all-context.md`.
- Do not delete compatibility wrappers unless no current reference points to them.
- Keep context groups durable-domain based, not one group per temporary feature.
- When updating agents, mirror Claude markdown and Codex TOML surfaces together.
- Treat validator warnings as audit findings unless the user asks for a strict cleanup.
- Prefer validator-backed routing truth over adding more soft prose.
- Treat `process/context/generated-skills-catalog.json` as the machine-readable catalog owned by `audit-context`.
