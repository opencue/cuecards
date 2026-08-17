# Flowser Tech Graph

> Describe a system, flow, or architecture and turn it into a publish-grade SVG, then PNG when raster export is needed.

This skill materially adapts upstream `fireworks-tech-graph` assets for Flowser.

- Upstream references, templates, fixtures, and attribution are vendored locally.
- Flowser keeps `tech-graph` as a helper skill only.
- `preview` remains the companion for explanation, HTML framing, comparison, and review after generation.
- Durable outputs belong in Flowser process folders, not ad hoc paths.

## What You Get

- 7 visual styles
- imported SVG templates across common diagram families
- JSON fixtures for regression-style proof runs
- style-aware template generation script
- SVG validation and PNG export helpers
- style matrix, icon reference, and SVG layout guidance
- support for architecture, data-flow, flowchart, sequence, comparison, timeline, state, class, use-case, ER, agent, memory, and network-topology visuals

## Flowser Output Policy

Preferred destinations for final artifacts:

- `process/general-plans/references/`
- `process/general-plans/reports/visuals/`
- `process/features/{feature}/references/`
- `process/features/{feature}/reports/visuals/`

Use `references/` for durable architecture or system artifacts. Use `reports/visuals/` for proof snapshots tied to execution or review.

If `rsvg-convert` is missing, Flowser runs in explicit SVG-only mode. Validation still runs and the SVG remains the source of truth.

## Preview Boundary

Use `tech-graph` first when the task needs a durable publish-grade SVG or PNG artifact.

Use `preview` instead when the goal is:

- explanation-first Mermaid or HTML visuals
- slide or recap generation
- reviewing or wrapping a finished `tech-graph` artifact

## Asset Pack

### References

- `references/style-diagram-matrix.md`
- `references/style-1-flat-icon.md`
- `references/style-2-dark-terminal.md`
- `references/style-3-blueprint.md`
- `references/style-4-notion-clean.md`
- `references/style-5-glassmorphism.md`
- `references/style-6-claude-official.md`
- `references/style-7-openai.md`
- `references/icons.md`
- `references/svg-layout-best-practices.md`
- `references/tech-graph-workflow.md`

### Templates

- `templates/architecture.svg`
- `templates/data-flow.svg`
- `templates/flowchart.svg`
- `templates/sequence.svg`
- `templates/comparison-matrix.svg`
- `templates/timeline.svg`
- `templates/state-machine.svg`
- `templates/use-case.svg`
- `templates/er-diagram.svg`
- `templates/agent-architecture.svg`

### Fixtures

The imported fixtures exercise the local style system across representative diagram families:

- `mem0-style1.json`
- `tool-call-style2.json`
- `microservices-style3.json`
- `agent-memory-types-style4.json`
- `multi-agent-style5.json`
- `system-architecture-style6.json`
- `api-flow-style7.json`

## Styles

| # | Name | Best For |
|---|------|----------|
| 1 | Flat Icon | docs, blogs, general architecture |
| 2 | Dark Terminal | technical flows, README-style visuals, sequence-heavy work |
| 3 | Blueprint | infrastructure, engineering architecture, state/process visuals |
| 4 | Notion Clean | wiki docs, internal specs, minimal diagrams |
| 5 | Glassmorphism | polished presentations, multi-agent views |
| 6 | Claude Official | warm professional system visuals |
| 7 | OpenAI Official | clean white API and product integration diagrams |

Start with style 1 unless the request or surrounding design language clearly implies another style.

## Diagram Families

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

## Scripts

### Validate SVG

```bash
bash .claude/skills/tech-graph/scripts/validate-svg.sh <file.svg>
```

### Validate SVG and Export PNG

```bash
bash .claude/skills/tech-graph/scripts/generate-diagram.sh -o <file.svg> [-w 1920]
```

### Generate from Template

```bash
python3 .claude/skills/tech-graph/scripts/generate-from-template.py <template-type> <output.svg> '<json-data>'
```

### Batch-Render the Imported Fixtures

```bash
bash .claude/skills/tech-graph/scripts/test-all-styles.sh
```

Default batch proof output:

- `process/general-plans/reports/visuals/tech-graph-test-output/`

Override the batch proof destination if needed:

```bash
TECH_GRAPH_TEST_OUTPUT_DIR=/absolute/output/path bash .claude/skills/tech-graph/scripts/test-all-styles.sh
```

## Typical Flow

1. Classify the diagram family.
2. Pick the Flowser output destination.
3. Load `references/style-diagram-matrix.md` and the selected style reference.
4. Use a template or fixture structure when it speeds up clean layout.
5. Generate the SVG.
6. Validate the SVG.
7. Export PNG if `rsvg-convert` is available and a raster proof is useful.
8. Review the rendered result with `preview` or direct image inspection.

## Example Output Requests

```text
Generate a Mem0 memory architecture diagram in style 1 and write it to process/general-plans/reports/visuals/mem0-architecture.svg
```

```text
Draw a microservices architecture in style 3 and store the final artifact under process/general-plans/references/microservices-blueprint.svg
```

```text
Create a sequence diagram for OAuth2 authorization code flow, then export PNG for review
```

```text
Generate a comparison matrix for RAG vs fine-tuning vs prompt engineering in style 4
```

## Requirements

`python3` is required for template-driven generation.

`rsvg-convert` is optional but recommended for PNG export.

```bash
# macOS
brew install librsvg

# Ubuntu/Debian
sudo apt install librsvg2-bin

# Verify
rsvg-convert --version
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| PNG not generated | `rsvg-convert` not installed | Expected Flowser SVG-only mode. Install `librsvg` only if PNG export is required. |
| PNG is blank or all-black | SVG imports external fonts/resources | Remove external imports and keep everything inline. |
| Diagram cut off | viewBox too small | Increase width/height or re-space the layout. |
| Labels collide | layout too dense | Use the layout best-practices reference and widen gutters before adding more content. |
| Icons do not render | external icon/CDN usage | Use inline SVG paths or semantic shapes from `references/icons.md`. |

## Attribution

This Flowser skill includes locally adapted upstream material from `fireworks-tech-graph` under the MIT license in [LICENSE](./LICENSE).
