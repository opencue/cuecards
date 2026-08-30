#!/usr/bin/env bash
# detect_staleness.sh — Compare existing documentation against current project state
# Identifies sections of the documentation that may be stale.
#
# Usage: bash detect_staleness.sh [project-root] [docs-file-path]
# Default project-root: current directory
# Default docs-file: docs/CODEBASE.md

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'USAGE'
Usage: bash scripts/detect_staleness.sh [project-root] [docs-file-path]

Compare existing documentation against current project state.
Reports which sections may be stale and why.

Checks: dependency file changes, missing referenced files, new directories
and modules, entry point changes, git activity since last update.

Arguments:
  project-root     Path to the project (default: current directory)
  docs-file-path   Path to the docs file (default: docs/CODEBASE.md)

Exit codes:
  0    Report generated (staleness may or may not exist)
  1    Documentation file not found — run in generate mode instead

Examples:
  bash scripts/detect_staleness.sh
  bash scripts/detect_staleness.sh /path/to/project
  bash scripts/detect_staleness.sh /path/to/project docs/CODEBASE.md
USAGE
    exit 0
fi

PROJECT_ROOT="${1:-.}"
DOCS_FILE="${2:-${PROJECT_ROOT}/docs/CODEBASE.md}"

cd "$PROJECT_ROOT"

echo "========================================"
echo "STALENESS DETECTION REPORT"
echo "========================================"
echo "Project: $(pwd)"
echo "Docs file: $DOCS_FILE"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

if [ ! -f "$DOCS_FILE" ]; then
    echo "ERROR: Documentation file not found: $DOCS_FILE"
    echo "Run in generate mode instead."
    exit 1
fi

DOCS_MTIME=""
if stat -f '%Sm' "$DOCS_FILE" &>/dev/null 2>&1; then
    # macOS
    DOCS_MTIME=$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S' "$DOCS_FILE" 2>/dev/null)
elif stat -c '%y' "$DOCS_FILE" &>/dev/null 2>&1; then
    # Linux
    DOCS_MTIME=$(stat -c '%y' "$DOCS_FILE" 2>/dev/null | cut -d. -f1)
fi
echo "Docs file last modified: ${DOCS_MTIME:-unknown}"
echo ""

# ── Dependency Changes ──────────────────────────────────────
echo "── DEPENDENCY CHANGES ──"

check_dep_freshness() {
    local dep_file="$1"
    local label="$2"

    if [ ! -f "$dep_file" ]; then
        return
    fi

    echo ""
    echo "--- $label ($dep_file) ---"

    if [ -n "$DOCS_MTIME" ]; then
        local dep_mtime
        if stat -f '%Sm' "$dep_file" &>/dev/null 2>&1; then
            dep_mtime=$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S' "$dep_file" 2>/dev/null)
        elif stat -c '%y' "$dep_file" &>/dev/null 2>&1; then
            dep_mtime=$(stat -c '%y' "$dep_file" 2>/dev/null | cut -d. -f1)
        fi
        if [ -n "${dep_mtime:-}" ]; then
            echo "  Dependency file last modified: $dep_mtime"
            if [[ "${dep_mtime}" > "${DOCS_MTIME}" ]]; then
                echo "  *** STALE: $dep_file is newer than documentation ***"
            else
                echo "  OK: documentation is newer"
            fi
        fi
    fi
}

for f in pyproject.toml setup.py setup.cfg requirements.txt Pipfile \
         package.json go.mod Cargo.toml Gemfile pom.xml build.gradle \
         build.gradle.kts composer.json mix.exs pubspec.yaml; do
    check_dep_freshness "$f" "$(echo "$f" | tr '[:lower:]' '[:upper:]')"
done
echo ""

# ── Files Referenced in Documentation ──────────────────────
echo "── FILE REFERENCES CHECK ──"
echo "Files/directories mentioned in documentation that may have changed:"
echo ""

# Extract file paths from inline code (patterns like `src/foo/bar.py` or `file.py:42`)
# shellcheck disable=SC2016
file_refs=$(grep -oE '`[a-zA-Z0-9_./-]+\.(py|js|ts|tsx|jsx|go|rs|rb|java|kt|swift|c|cpp|cs|php|yml|yaml|toml|json|md|sh|sql|ex)`' \
    "$DOCS_FILE" 2>/dev/null | sed 's/`//g' | sort -u || true)

# shellcheck disable=SC2016
file_line_refs=$(grep -oE '`[a-zA-Z0-9_./-]+\.(py|js|ts|tsx|jsx|go|rs|rb|java|kt|swift|c|cpp|cs|php):[0-9]+`' \
    "$DOCS_FILE" 2>/dev/null | sed 's/`//g; s/:[0-9]*$//' | sort -u || true)

all_refs=$(echo -e "${file_refs}\n${file_line_refs}" | sort -u | grep -v '^$' || true)

missing_count=0
if [ -n "$all_refs" ]; then
    while IFS= read -r ref; do
        if [ ! -e "$ref" ]; then
            echo "  [MISSING] $ref"
            missing_count=$((missing_count + 1))
        fi
    done <<< "$all_refs"
fi

if [ "$missing_count" -eq 0 ]; then
    echo "  All referenced files still exist."
fi
echo ""

# ── New Top-Level Directories ──────────────────────────────
echo "── NEW DIRECTORIES ──"
echo "Top-level directories not mentioned in documentation:"
echo ""

new_count=0
for dir in */; do
    dir_name="${dir%/}"
    case "$dir_name" in
        node_modules|__pycache__|dist|build|target|vendor|venv|htmlcov|coverage)
            continue
            ;;
    esac

    if ! grep -q "$dir_name" "$DOCS_FILE" 2>/dev/null; then
        echo "  [NEW] $dir_name/"
        new_count=$((new_count + 1))
    fi
done

if [ "$new_count" -eq 0 ]; then
    echo "  No new top-level directories."
fi
echo ""

# ── Structural Changes ────────────────────────────────────
echo "── STRUCTURAL CHANGES ──"
echo "Checking for new modules/packages not mentioned in documentation:"
echo ""

new_module_count=0
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    # Find directories at depth 2 that contain source files
    modules=$(git ls-files 2>/dev/null \
        | grep -iE '\.(py|js|ts|tsx|jsx|go|rs|rb|java|kt)$' \
        | sed 's|/[^/]*$||' | sort -u | awk -F/ 'NF==2' | head -30)
else
    modules=$(find . -maxdepth 2 -type f \
        \( -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.go' \
           -o -name '*.rs' -o -name '*.rb' -o -name '*.java' \) \
        -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/vendor/*' \
        2>/dev/null | sed 's|^\./||; s|/[^/]*$||' | sort -u | head -30)
fi

if [ -n "$modules" ]; then
    while IFS= read -r mod; do
        mod_name=$(basename "$mod")
        if ! grep -q "$mod_name" "$DOCS_FILE" 2>/dev/null; then
            echo "  [NEW MODULE] $mod"
            new_module_count=$((new_module_count + 1))
        fi
    done <<< "$modules"
fi

if [ "$new_module_count" -eq 0 ]; then
    echo "  No new modules detected."
fi
echo ""

# ── Entry Point Changes ───────────────────────────────────
echo "── ENTRY POINT CHECK ──"
echo "Verifying entry points mentioned in documentation still exist:"
echo ""

# shellcheck disable=SC2016
entry_refs=$(grep -B2 -A2 -i 'entry\|main\|cli\|app factory' "$DOCS_FILE" 2>/dev/null \
    | grep -oE '`[a-zA-Z0-9_./-]+\.(py|js|ts|go|rs|rb|java)`' \
    | sed 's/`//g' | sort -u || true)

entry_missing=0
if [ -n "$entry_refs" ]; then
    while IFS= read -r ref; do
        if [ ! -e "$ref" ]; then
            echo "  [MISSING ENTRY POINT] $ref"
            entry_missing=$((entry_missing + 1))
        fi
    done <<< "$entry_refs"
fi

if [ "$entry_missing" -eq 0 ]; then
    echo "  All entry points still exist."
fi
echo ""

# ── Git Changes Since Documentation ───────────────────────
echo "── GIT CHANGES SINCE DOCUMENTATION ──"
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    if [ -n "$DOCS_MTIME" ]; then
        commit_count=$(git log --oneline --since="$DOCS_MTIME" 2>/dev/null | wc -l | tr -d ' ')
        echo "Commits since documentation was last modified: $commit_count"
        echo ""

        if [ "$commit_count" -gt 0 ]; then
            echo "--- Commit subjects since last update ---"
            git log --oneline --since="$DOCS_MTIME" 2>/dev/null | head -30
            echo ""

            echo "--- Files most changed since last update ---"
            git log --name-only --pretty=format: --since="$DOCS_MTIME" 2>/dev/null \
            | grep -v '^$' | sort | uniq -c | sort -rn | head -15
        fi
    else
        echo "  Could not determine documentation file modification time."
        echo "  Showing last 20 commits for reference:"
        git log --oneline -20 2>/dev/null
    fi
else
    echo "  Not a git repository — skipping."
fi
echo ""

# ── Summary ────────────────────────────────────────────────
echo "========================================"
echo "STALENESS SUMMARY"
echo "========================================"
echo ""

stale_areas=""

# Dependency staleness
for f in pyproject.toml package.json go.mod Cargo.toml Gemfile composer.json; do
    if [ -f "$f" ] && [ -n "$DOCS_MTIME" ]; then
        dep_mtime=""
        if stat -f '%Sm' "$f" &>/dev/null 2>&1; then
            dep_mtime=$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S' "$f" 2>/dev/null)
        elif stat -c '%y' "$f" &>/dev/null 2>&1; then
            dep_mtime=$(stat -c '%y' "$f" 2>/dev/null | cut -d. -f1)
        fi
        if [ -n "${dep_mtime:-}" ] && [[ "${dep_mtime}" > "${DOCS_MTIME}" ]]; then
            stale_areas="${stale_areas}  - Project Overview / Key Frameworks (${f} changed)\n"
        fi
    fi
done

if [ "$missing_count" -gt 0 ]; then
    stale_areas="${stale_areas}  - Project Structure ($missing_count referenced files missing)\n"
fi

if [ "$new_count" -gt 0 ]; then
    stale_areas="${stale_areas}  - Project Structure ($new_count new top-level directories)\n"
fi

if [ "$new_module_count" -gt 0 ]; then
    stale_areas="${stale_areas}  - Key Components ($new_module_count new modules not documented)\n"
fi

if [ "$entry_missing" -gt 0 ]; then
    stale_areas="${stale_areas}  - Architecture Overview ($entry_missing entry points missing or renamed)\n"
fi

if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    if [ -n "$DOCS_MTIME" ]; then
        cc=$(git log --oneline --since="$DOCS_MTIME" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$cc" -gt 10 ]; then
            stale_areas="${stale_areas}  - Critical Paths & Gotchas ($cc commits since last update — review for new patterns)\n"
        fi
        if [ "$cc" -gt 30 ]; then
            stale_areas="${stale_areas}  - Architecture Overview (significant activity — $cc commits — may indicate structural changes)\n"
        fi
    fi
fi

if [ -n "$stale_areas" ]; then
    echo "Potentially stale sections:"
    echo -e "$stale_areas"
else
    echo "No obvious staleness detected. Documentation appears up to date."
fi

echo ""
echo "========================================"
echo "END OF STALENESS REPORT"
echo "========================================"
