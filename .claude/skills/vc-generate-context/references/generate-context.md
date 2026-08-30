# Generate Context Reference

Generate and maintain the broad authoritative repository context file at `process/context/all-context.md`. Use `process/context/all-context.md` as the context router before selecting grouped docs to consult.

## Behavior Modes

- **Full Scan Mode**: use when `process/context/all-context.md` does not exist.
- **Delta Update Mode**: use when the file exists; preserve stable content and update changed sections.

## Required Output

Always produce exactly one file:

- `process/context/all-context.md`

Include:

- Scanned timestamp.
- Repo HEAD from `git rev-parse HEAD` if available.
- Mode: Full Scan or Delta Update.
- Changes since last update when in Delta mode.
- Open Questions when anything is ambiguous.
- References to source files used.

Update only `process/context/all-context.md` in this workflow. Do not rewrite grouped context docs; if they are stale, missing from the router, or poorly organized, report that `audit-context` should be run.

## Validation

After updating `process/context/all-context.md`, run:

```bash
node .claude/skills/vc-generate-context/scripts/validate-all-context.mjs
```

If the update changes context routing, group membership, or grouped docs, also run:

```bash
node .claude/skills/vc-audit-context/scripts/validate-context-discovery.mjs
```

Fix validation failures before presenting the context as refreshed. Treat warnings as freshness
or quality findings unless the user asks for strict enforcement.

## Data Sources

Inspect as relevant:

- `pnpm-workspace.yaml`
- Root and workspace `package.json` files.
- `tsconfig*.json` and shared TypeScript tooling.
- Apps and packages under `apps/` and `packages/`.
- API routers, database schema/client, validators, container services, and infra modules.
- Tailwind and UI component setup.
- `.env` usage patterns without exposing secrets.
- `process/development-protocols/`, `AGENTS.md`, `.codex/agents/`, and `.agents/skills/` for workflow conventions.
- `process/general-plans/active/*` and `process/features/*/active/*`.
- `process/context/all-context.md` for context routing and group ownership.
- Existing `process/context/**/*.md` files, loading only relevant grouped docs.
- `process/context/planning/example-complex-prd.md` for plan/PRD depth expectations.

## Full Scan Structure

Use these sections unless a focused user request justifies a smaller update:

1. Product and PRD context.
2. Tech stack overview.
3. Monorepo layout.
4. Package manager and scripts.
5. TypeScript and module resolution.
6. API and backend.
7. Database and data layer.
8. Auth, payments, and integrations.
9. UI and styling.
10. Environment variables.
11. Linting, formatting, and quality.
12. Conventions and rules.
13. Security posture.
14. Monitoring and operations.
15. References and key files.
16. Open questions.

## Delta Update Rules

1. Parse the existing context and preserve unchanged sections.
2. Verify likely drift areas: dependencies, scripts, package layout, API routes, schemas, env vars, active plans, feature folders, and context router/group changes.
3. Add a "Changes since last update" section near the top.
4. Tag product-impacting changes with `[Product]`.
5. Keep stale or contradicted statements out of the final file.
6. If `all-context.md` contradicts a grouped context doc, inspect source code before deciding which statement is stale.
7. Run the context validator and report any remaining warnings.
