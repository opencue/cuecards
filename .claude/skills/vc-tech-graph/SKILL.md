---
name: vc:tech-graph
description: "Use when you need publish-grade SVG or PNG technical diagrams for architecture, flow, sequence, UML, state, or comparison visuals, with preview used afterward for review rather than generation."
license: MIT
argument-hint: "[diagram-type or system description] [--style <n>] [--output <path>] [--feature <name>]"
metadata:
  author: flowser
  version: "1.1.0"
  attribution: "Adapted from upstream fireworks-tech-graph concepts and assets, narrowed for Flowser"
---

# Tech Graph

Generate publish-grade technical diagrams as SVG first, then PNG when raster export is needed.

This is a helper skill only.

- Do use it for architecture diagrams, data flow diagrams, flowcharts, sequence diagrams, state machines, ER diagrams, use-case diagrams, timelines, and comparison matrices that should become durable artifacts.
- Do use it when the output should live under `process/general-plans/references/`, `process/general-plans/reports/visuals/`, `process/features/{feature}/references/`, or `process/features/{feature}/reports/visuals/`.
- Do use `preview` after generation when you want explanation, HTML framing, Mermaid review, or visual self-check of the finished artifact.
- Do not use it as a plan or execution workflow.
- Do not use it to replace inline doc diagrams when a lightweight Mermaid or ASCII explanation is enough.

## Capability Surface

The local Flowser skill now includes upstream-style assets:

- 7 visual style references
- style-to-diagram guidance matrix
- icon and SVG layout reference material
- reusable SVG templates
- JSON regression fixtures
- template-driven generation script
- batch style validation script

Load the smallest references that fit the request:

- `references/style-diagram-matrix.md` to choose a style and diagram family
- `references/style-1-flat-icon.md` through `references/style-7-openai.md` for exact visual language
- `references/icons.md` for semantic shapes and product-icon guidance
- `references/svg-layout-best-practices.md` for spacing, routing, label, and export discipline
- `references/tech-graph-workflow.md` for Flowser-specific routing and proof rules

## Routing Matrix

Use `tech-graph` when the output should become a durable artifact:

- `process/general-plans/references/`
- `process/general-plans/reports/visuals/`
- `process/features/{feature}/references/`
- `process/features/{feature}/reports/visuals/`

Use `preview` instead when the goal is:

- explain a concept visually
- review an existing diagram
- generate HTML slides or recaps
- create inline Mermaid-first discussion material

## Output Policy

Prefer `.svg` as the source artifact. Generate `.png` alongside it when:

- the user wants an image for sharing
- you want a visual proof artifact
- you need to inspect the render rather than only the XML

If the user does not specify an output path, route outputs to the matching Flowser process folder rather than ad hoc locations like `~/Desktop` or `/tmp`.

## Diagram Types

The imported templates and references support these common families directly:

- architecture
- data-flow
- flowchart
- sequence
- comparison
- timeline
- mind-map
- agent
- memory
- use-case
- class
- state-machine
- er-diagram
- network-topology

When the diagram type is ambiguous, classify it before drawing. If the request is really an explanation-first visual, switch to `preview` instead of forcing a publish-grade diagram.

## Workflow

1. Decide if the task needs publish-grade SVG/PNG or just `preview`.
2. Classify the diagram type and pick the output destination.
3. Load the matching style reference. Default to style 1 unless the request implies another visual language.
4. Use a template from `templates/` or fixture structure from `fixtures/` when it speeds up clean SVG generation.
5. Generate the SVG directly or render it with:

```bash
python3 .claude/skills/tech-graph/scripts/generate-from-template.py <template-type> <output.svg> '<json-data>'
```

6. Validate the result:

```bash
bash .claude/skills/tech-graph/scripts/validate-svg.sh <file.svg>
```

7. Export PNG when needed:

```bash
bash .claude/skills/tech-graph/scripts/generate-diagram.sh -o <file.svg>
```

8. If useful, review the output visually and iterate.

## Helper Scripts

- `scripts/generate-diagram.sh`
  - validates an SVG
  - exports a sibling PNG when `rsvg-convert` is available
  - warns and succeeds in SVG-only mode when `rsvg-convert` is missing
- `scripts/generate-from-template.py`
  - renders starter diagrams from the imported templates plus JSON structure
  - supports the upstream visual style system and semantic shapes
- `scripts/test-all-styles.sh`
  - renders the regression fixtures
  - validates every generated SVG
  - exports PNG proofs when `rsvg-convert` is present
  - writes batch outputs to a Flowser process artifact folder by default
- `scripts/validate-svg.sh`
  - checks XML structure and closing tags
  - uses `rsvg-convert` as an extra validator when available

## Dependency Contract

- Required for SVG validation: shell, Python 3, and basic Unix tools
- Optional but recommended for PNG export: `rsvg-convert`

Flowser allows degraded SVG-only mode when `rsvg-convert` is unavailable. The skill should warn clearly instead of failing silently.

## Good Trigger Phrases

- `generate architecture diagram`
- `draw the system flow`
- `make this sequence diagram publishable`
- `create a clean SVG for this process`
- `turn this architecture into PNG`
- `generate a UML state machine`
- `build a comparison matrix for these systems`

Load `references/tech-graph-workflow.md` for the Flowser-specific routing, proof, and preview-boundary rules.
