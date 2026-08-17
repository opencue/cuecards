#!/usr/bin/env bash
# validate_output.sh — Validate generated documentation against the project
# Checks file references, Mermaid syntax, size targets, required sections,
# and command existence.
#
# Usage: bash validate_output.sh [project-root] [docs-file-path]
# Default project-root: current directory
# Default docs-file: docs/CODEBASE.md

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'USAGE'
Usage: bash scripts/validate_output.sh [project-root] [docs-file-path]

Validate generated CODEBASE.md against the actual project state.
Reports issues that should be fixed before finishing.

Checks performed:
  - File path references exist in the project
  - Mermaid diagram blocks have valid structure
  - Document size fits the depth-level target
  - All required sections are present
  - USER NOTES marker exists
  - Commands in Key Commands table exist in build system

Arguments:
  project-root     Path to the project (default: current directory)
  docs-file-path   Path to the docs file (default: docs/CODEBASE.md)

Exit codes:
  0    All checks passed
  1    Documentation file not found
  2    One or more checks failed

Examples:
  bash scripts/validate_output.sh
  bash scripts/validate_output.sh /path/to/project
  bash scripts/validate_output.sh /path/to/project docs/CODEBASE.md
USAGE
    exit 0
fi

PROJECT_ROOT="${1:-.}"
DOCS_FILE="${2:-${PROJECT_ROOT}/docs/CODEBASE.md}"

cd "$PROJECT_ROOT"

echo "========================================"
echo "DOCUMENTATION VALIDATION REPORT"
echo "========================================"
echo "Project: $(pwd)"
echo "Docs file: $DOCS_FILE"
echo ""

if [ ! -f "$DOCS_FILE" ]; then
    echo "ERROR: Documentation file not found: $DOCS_FILE"
    exit 1
fi

total_errors=0
total_warnings=0

# ── File Path References ─────────────────────────────────
echo "── FILE PATH REFERENCES ──"
echo "Checking that referenced file paths exist in the project:"
echo ""

# Extract file paths from inline code backticks (e.g. `src/foo/bar.py`)
# Matches common source and config file extensions
# shellcheck disable=SC2016
file_refs=$(grep -oE '`[a-zA-Z0-9_./-]+\.(py|js|ts|tsx|jsx|go|rs|rb|java|kt|swift|c|cpp|cs|php|yml|yaml|toml|json|md|sh|sql|ex|spec|cfg|txt|ini|lock)`' \
    "$DOCS_FILE" 2>/dev/null | sed 's/`//g' | sort -u || true)

# Also extract bare directory references like `src/services/`
# shellcheck disable=SC2016
dir_refs=$(grep -oE '`[a-zA-Z0-9_./-]+/`' \
    "$DOCS_FILE" 2>/dev/null | sed 's/`//g' | sort -u || true)

file_ref_errors=0
file_ref_ok=0
file_ref_skipped=0

if [ -n "$file_refs" ]; then
    while IFS= read -r ref; do
        # Skip references that look like generic examples or URLs
        case "$ref" in
            http*) continue ;;
        esac

        # Skip extension-only patterns (e.g., .aib.yml, .env.example) that describe
        # file types rather than referencing specific files
        if [[ "$ref" == .* ]]; then
            file_ref_skipped=$((file_ref_skipped + 1))
            continue
        fi

        # Skip paths containing placeholder names (hypothetical examples)
        case "$ref" in
            *myservice*|*example*|*your-*|*sample*)
                file_ref_skipped=$((file_ref_skipped + 1))
                continue
                ;;
        esac

        if [ -e "$ref" ]; then
            file_ref_ok=$((file_ref_ok + 1))
        else
            # Try to find the file by searching the project
            found=$(find . -path "*/${ref}" \
                -not -path '*/\.*' -not -path '*/node_modules/*' \
                -not -path '*/__pycache__/*' -not -path '*/dist/*' \
                2>/dev/null | head -1 || true)
            if [ -n "$found" ]; then
                file_ref_ok=$((file_ref_ok + 1))
            else
                echo "  [MISSING] $ref"
                file_ref_errors=$((file_ref_errors + 1))
            fi
        fi
    done <<< "$file_refs"
fi

if [ -n "$dir_refs" ]; then
    while IFS= read -r ref; do
        if [ -e "$ref" ]; then
            file_ref_ok=$((file_ref_ok + 1))
        else
            # Try to find the directory by searching the project
            found=$(find . -type d -path "*/${ref%/}" \
                -not -path '*/\.*' -not -path '*/node_modules/*' \
                2>/dev/null | head -1 || true)
            if [ -n "$found" ]; then
                file_ref_ok=$((file_ref_ok + 1))
            else
                echo "  [MISSING] $ref"
                file_ref_errors=$((file_ref_errors + 1))
            fi
        fi
    done <<< "$dir_refs"
fi

if [ "$file_ref_errors" -eq 0 ]; then
    skip_msg=""
    if [ "$file_ref_skipped" -gt 0 ]; then
        skip_msg=" ($file_ref_skipped skipped: patterns/examples)"
    fi
    echo "  OK: All $file_ref_ok file/directory references exist.${skip_msg}"
else
    echo ""
    echo "  FAILED: $file_ref_errors missing, $file_ref_ok valid, $file_ref_skipped skipped."
fi
total_errors=$((total_errors + file_ref_errors))
echo ""

# ── Mermaid Diagram Validation ───────────────────────────
echo "── MERMAID DIAGRAMS ──"
echo "Checking Mermaid diagram blocks for structural validity:"
echo ""

mermaid_errors=0
mermaid_ok=0

# Extract mermaid blocks and validate basic structure
in_mermaid=0
mermaid_block=""
mermaid_line_start=0
block_num=0
line_num=0

while IFS= read -r line; do
    line_num=$((line_num + 1))
    if [[ "$line" =~ ^\`\`\`mermaid ]]; then
        in_mermaid=1
        mermaid_block=""
        mermaid_line_start=$line_num
        block_num=$((block_num + 1))
        continue
    fi
    if [ "$in_mermaid" -eq 1 ]; then
        if [[ "$line" =~ ^\`\`\` ]]; then
            in_mermaid=0

            # Validate the collected block
            if [ -z "$mermaid_block" ]; then
                echo "  [ERROR] Block $block_num (line $mermaid_line_start): Empty mermaid block"
                mermaid_errors=$((mermaid_errors + 1))
                continue
            fi

            # Check for valid diagram type on first non-empty line
            first_line=$(echo "$mermaid_block" | grep -v '^$' | head -1 || true)
            if ! echo "$first_line" | grep -qiE '^(graph |flowchart |sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)'; then
                echo "  [ERROR] Block $block_num (line $mermaid_line_start): Invalid diagram type: '$first_line'"
                mermaid_errors=$((mermaid_errors + 1))
                continue
            fi

            # Check for unclosed brackets/parentheses in node definitions
            open_brackets=$(echo "$mermaid_block" | tr -cd '[' | wc -c | tr -d ' ')
            close_brackets=$(echo "$mermaid_block" | tr -cd ']' | wc -c | tr -d ' ')
            if [ "$open_brackets" -ne "$close_brackets" ]; then
                echo "  [ERROR] Block $block_num (line $mermaid_line_start): Mismatched brackets ([ $open_brackets, ] $close_brackets)"
                mermaid_errors=$((mermaid_errors + 1))
                continue
            fi

            open_parens=$(echo "$mermaid_block" | tr -cd '(' | wc -c | tr -d ' ')
            close_parens=$(echo "$mermaid_block" | tr -cd ')' | wc -c | tr -d ' ')
            if [ "$open_parens" -ne "$close_parens" ]; then
                echo "  [ERROR] Block $block_num (line $mermaid_line_start): Mismatched parentheses (open $open_parens, close $close_parens)"
                mermaid_errors=$((mermaid_errors + 1))
                continue
            fi

            # Check for unclosed quotes
            quote_count=$(echo "$mermaid_block" | tr -cd '"' | wc -c | tr -d ' ')
            if [ $((quote_count % 2)) -ne 0 ]; then
                echo "  [ERROR] Block $block_num (line $mermaid_line_start): Odd number of quotes ($quote_count)"
                mermaid_errors=$((mermaid_errors + 1))
                continue
            fi

            mermaid_ok=$((mermaid_ok + 1))
        else
            mermaid_block="${mermaid_block}${line}
"
        fi
    fi
done < "$DOCS_FILE"

# Check for unclosed mermaid block
if [ "$in_mermaid" -eq 1 ]; then
    echo "  [ERROR] Block $block_num (line $mermaid_line_start): Unclosed mermaid block (missing closing \`\`\`)"
    mermaid_errors=$((mermaid_errors + 1))
fi

if [ "$block_num" -eq 0 ]; then
    echo "  WARNING: No mermaid diagrams found in documentation."
    total_warnings=$((total_warnings + 1))
elif [ "$mermaid_errors" -eq 0 ]; then
    echo "  OK: All $mermaid_ok mermaid diagrams have valid structure."
else
    echo ""
    echo "  FAILED: $mermaid_errors invalid, $mermaid_ok valid."
fi
total_errors=$((total_errors + mermaid_errors))
echo ""

# ── Size Check ───────────────────────────────────────────
echo "── SIZE CHECK ──"

total_lines=$(wc -l < "$DOCS_FILE" | tr -d ' ')
echo "Total lines: $total_lines"

# Try to detect depth level from source file count
src_count=0
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    src_count=$(git ls-files 2>/dev/null \
        | grep -ciE '\.(py|js|ts|tsx|jsx|go|rs|rb|java|kt|swift|c|cpp|cs|php|ex|exs|scala|clj|hs|ml|vue|svelte|sh)$' \
        || echo "0")
else
    src_count=$(find . -type f \
        -not -path '*/\.*' -not -path '*/node_modules/*' \
        -not -path '*/vendor/*' -not -path '*/__pycache__/*' \
        -not -path '*/dist/*' -not -path '*/build/*' \
        \( -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.tsx' \
           -o -name '*.jsx' -o -name '*.go' -o -name '*.rs' -o -name '*.rb' \
           -o -name '*.java' -o -name '*.kt' -o -name '*.sh' \) \
        2>/dev/null | wc -l | tr -d ' ')
fi

if [ "$src_count" -lt 15 ]; then
    depth="Quick"
    min_lines=100
    max_lines=200
elif [ "$src_count" -le 100 ]; then
    depth="Standard"
    min_lines=200
    max_lines=400
else
    depth="Deep"
    min_lines=400
    max_lines=700
fi

echo "Source files: $src_count → depth level: $depth"
echo "Target range: ${min_lines}–${max_lines} lines"

if [ "$total_lines" -gt "$max_lines" ]; then
    echo "  WARNING: Document is $((total_lines - max_lines)) lines over the $depth maximum ($max_lines)."
    total_warnings=$((total_warnings + 1))
elif [ "$total_lines" -lt "$min_lines" ]; then
    echo "  WARNING: Document is $((min_lines - total_lines)) lines under the $depth minimum ($min_lines)."
    total_warnings=$((total_warnings + 1))
else
    echo "  OK: Size is within the $depth target range."
fi
echo ""

# ── Required Sections ────────────────────────────────────
echo "── REQUIRED SECTIONS ──"
echo "Checking for all expected sections:"
echo ""

section_errors=0

# Required for all depths
required_sections=(
    "Architecture Overview"
    "Project Structure"
    "Key Components"
    "Development Guide"
    "Critical Paths"
)

# Data Flow is required for Standard and Deep, optional for Quick
if [ "$src_count" -ge 15 ]; then
    required_sections+=("Data Flow")
fi

for section in "${required_sections[@]}"; do
    if grep -qi "## .*${section}" "$DOCS_FILE" 2>/dev/null; then
        echo "  [OK] $section"
    else
        echo "  [MISSING] $section"
        section_errors=$((section_errors + 1))
    fi
done

# Check for Project Overview (the H1 header — first line of content)
if head -5 "$DOCS_FILE" | grep -q '^# ' 2>/dev/null; then
    echo "  [OK] Project Overview (H1 header)"
else
    echo "  [MISSING] Project Overview (H1 header)"
    section_errors=$((section_errors + 1))
fi

# Check for purpose line (blockquote after H1)
if grep -q '^>' "$DOCS_FILE" 2>/dev/null; then
    echo "  [OK] Purpose statement (blockquote)"
else
    echo "  [MISSING] Purpose statement (blockquote)"
    section_errors=$((section_errors + 1))
fi

if [ "$section_errors" -gt 0 ]; then
    echo ""
    echo "  FAILED: $section_errors required sections missing."
fi
total_errors=$((total_errors + section_errors))
echo ""

# ── USER NOTES Marker ────────────────────────────────────
echo "── USER NOTES MARKER ──"

if grep -q '<!-- USER NOTES' "$DOCS_FILE" 2>/dev/null; then
    echo "  OK: USER NOTES marker found."
else
    echo "  [MISSING] No <!-- USER NOTES --> marker found."
    echo "  This marker is required for update mode to preserve user content."
    total_errors=$((total_errors + 1))
fi
echo ""

# ── Command Verification ─────────────────────────────────
echo "── COMMAND VERIFICATION ──"
echo "Checking that commands in Key Commands table exist in build system:"
echo ""

# Extract commands from the Key Commands table specifically
# Find the section, then extract command cells until the next section or empty line
in_key_commands=0
table_cmds=""
while IFS= read -r line; do
    if [[ "$line" =~ ^###[[:space:]]+(Key\ )?Commands$ ]]; then
        in_key_commands=1
        continue
    fi
    if [ "$in_key_commands" -eq 1 ]; then
        # Stop at next heading or blank line after table
        if [[ "$line" =~ ^## ]] || [[ "$line" =~ ^### ]]; then
            break
        fi
        # Extract command from table row: | `command here` | description |
        # shellcheck disable=SC2016
        cmd=$(echo "$line" | sed -n 's/^| *`\([^`]*\)`.*/\1/p' || true)
        if [ -n "$cmd" ]; then
            table_cmds="${table_cmds}${cmd}
"
        fi
    fi
done < "$DOCS_FILE"
table_cmds=$(echo "$table_cmds" | grep -v '^$' || true)

cmd_errors=0
cmd_ok=0
cmd_skipped=0

if [ -n "$table_cmds" ]; then
    while IFS= read -r cmd; do
        # Extract the base command (e.g., "make test" -> target "test" in Makefile)
        if [[ "$cmd" == make\ * ]]; then
            target="${cmd#make }"
            # Remove any variable assignments (e.g., make migrate MSG="desc" -> migrate)
            target="${target%% *}"
            if [ -f "Makefile" ]; then
                if grep -qE "^${target}:" Makefile 2>/dev/null; then
                    cmd_ok=$((cmd_ok + 1))
                else
                    echo "  [MISSING] $cmd — target '$target' not found in Makefile"
                    cmd_errors=$((cmd_errors + 1))
                fi
            else
                echo "  [SKIP] $cmd — no Makefile found"
                cmd_skipped=$((cmd_skipped + 1))
            fi
        elif [[ "$cmd" == npm\ run\ * || "$cmd" == yarn\ * || "$cmd" == pnpm\ * ]]; then
            script="${cmd#* run }"
            script="${script#* }"
            script="${script%% *}"
            if [ -f "package.json" ]; then
                if grep -q "\"${script}\"" package.json 2>/dev/null; then
                    cmd_ok=$((cmd_ok + 1))
                else
                    echo "  [MISSING] $cmd — script '$script' not found in package.json"
                    cmd_errors=$((cmd_errors + 1))
                fi
            else
                echo "  [SKIP] $cmd — no package.json found"
                cmd_skipped=$((cmd_skipped + 1))
            fi
        else
            # Can't verify other command types (pip, python, etc.)
            cmd_skipped=$((cmd_skipped + 1))
        fi
    done <<< "$table_cmds"
fi

if [ -z "$table_cmds" ]; then
    echo "  WARNING: No Key Commands table found in documentation."
    total_warnings=$((total_warnings + 1))
elif [ "$cmd_errors" -eq 0 ]; then
    echo "  OK: $cmd_ok commands verified, $cmd_skipped skipped (not verifiable)."
else
    echo ""
    echo "  FAILED: $cmd_errors commands missing, $cmd_ok verified, $cmd_skipped skipped."
fi
total_errors=$((total_errors + cmd_errors))
echo ""

# ── Summary ──────────────────────────────────────────────
echo "========================================"
echo "VALIDATION SUMMARY"
echo "========================================"
echo ""
echo "Errors:   $total_errors"
echo "Warnings: $total_warnings"
echo ""

if [ "$total_errors" -eq 0 ] && [ "$total_warnings" -eq 0 ]; then
    echo "All checks passed."
elif [ "$total_errors" -eq 0 ]; then
    echo "All checks passed with $total_warnings warning(s)."
else
    echo "FAILED: $total_errors error(s) found. Fix before finishing."
fi

echo ""
echo "========================================"
echo "END OF VALIDATION REPORT"
echo "========================================"

if [ "$total_errors" -gt 0 ]; then
    exit 2
fi
exit 0
