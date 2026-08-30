# Flowser Tech-Graph Workflow

`tech-graph` is the Flowser publish-grade diagram path.

## Use It For

- architecture diagrams
- data flow diagrams
- sequence diagrams
- process flowcharts
- state machines
- class, use-case, and ER diagrams
- comparison matrices
- system maps that should be kept as durable reference artifacts

## Do Not Use It For

- plan ownership
- general HTML recap generation
- slide-deck generation
- lightweight inline doc sketches when `preview --diagram` is enough

## Companion Story

- `tech-graph`: create the durable SVG and optional PNG
- `preview`: explain, wrap, compare, or review visuals
- Mermaid: useful for inline docs or rapid planning, but not the publish-grade default when `tech-graph` is chosen

## Asset Pack

Use the imported asset pack intentionally:

- `templates/` for starter SVG skeletons by diagram family
- `fixtures/` for known-good regression structures across styles
- `references/style-diagram-matrix.md` to choose the right visual treatment
- `references/svg-layout-best-practices.md` for spacing and arrow-routing discipline

## Output Destinations

- Cross-cutting:
  - `process/general-plans/references/`
  - `process/general-plans/reports/visuals/`
- Feature-scoped:
  - `process/features/{feature}/references/`
  - `process/features/{feature}/reports/visuals/`

Prefer `references/` for durable architecture/process artifacts and `reports/visuals/` for review snapshots tied to a specific execution or checkpoint.

## Dependency Rules

- `rsvg-convert` present:
  - validate SVG
  - export PNG
- `rsvg-convert` missing:
  - validate SVG only
  - keep SVG as the source of truth
  - warn that PNG export is unavailable

## Verification

```bash
bash .claude/skills/tech-graph/scripts/validate-svg.sh <file.svg>
bash .claude/skills/tech-graph/scripts/generate-diagram.sh -o <file.svg>
bash .claude/skills/tech-graph/scripts/test-all-styles.sh
```

Then review the output with `preview` or direct image inspection when available.
