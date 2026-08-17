# Flowser Tech Graph Scripts

These helper scripts make SVG generation, validation, and proof capture more reliable.

## Scripts

### `validate-svg.sh`

Validate SVG syntax and fail fast on malformed XML or missing closing tags.

```bash
bash .claude/skills/tech-graph/scripts/validate-svg.sh <svg-file>
```

Checks:

- XML parseability
- closing `</svg>` tag
- `rsvg-convert` renderability when the binary is available

### `generate-diagram.sh`

Validate an existing SVG and export a sibling PNG when raster export is available.

```bash
bash .claude/skills/tech-graph/scripts/generate-diagram.sh -o <svg-file> [-w 1920]
```

Behavior:

- always validates the SVG first
- exports `<name>.png` next to the SVG when `rsvg-convert` is installed
- warns and succeeds in SVG-only mode when `rsvg-convert` is missing

### `generate-from-template.py`

Render a diagram from a template plus JSON input.

```bash
python3 .claude/skills/tech-graph/scripts/generate-from-template.py <template-type> <output.svg> '<json-data>'
```

Useful inputs include:

- `style`
- `title`
- `subtitle`
- `containers`
- `nodes`
- `arrows`
- `legend`
- `style_overrides`

Template types supported by the imported asset pack include:

- `architecture`
- `data-flow`
- `flowchart`
- `sequence`
- `comparison`
- `timeline`
- `mind-map`
- `agent`
- `memory`
- `use-case`
- `class`
- `state-machine`
- `er-diagram`
- `network-topology`

### `test-all-styles.sh`

Batch-render the imported regression fixtures and collect proof outputs.

```bash
bash .claude/skills/tech-graph/scripts/test-all-styles.sh
```

Optional environment override:

```bash
TECH_GRAPH_TEST_OUTPUT_DIR=/absolute/output/path bash .claude/skills/tech-graph/scripts/test-all-styles.sh
```

Default output location:

- `process/general-plans/reports/visuals/tech-graph-test-output/`

The script:

- verifies the style reference files exist
- renders each matching fixture through `generate-from-template.py`
- validates each generated SVG
- exports PNGs when `rsvg-convert` is available

## Flowser Output Rules

For durable artifacts, prefer:

- `process/general-plans/references/`
- `process/general-plans/reports/visuals/`
- `process/features/{feature}/references/`
- `process/features/{feature}/reports/visuals/`

Do not treat skill-local scratch folders, `~/Desktop`, or `/tmp` as the canonical destination for final outputs.

## Requirements

- `python3`
- shell utilities available on macOS/Linux
- optional `rsvg-convert` for PNG export

Check PNG export support with:

```bash
rsvg-convert --version
```

## Typical Flow

1. Generate an SVG directly or via `generate-from-template.py`.
2. Run `validate-svg.sh`.
3. Run `generate-diagram.sh` if PNG output is needed.
4. Use `preview` or direct image inspection for the visual proof step.
