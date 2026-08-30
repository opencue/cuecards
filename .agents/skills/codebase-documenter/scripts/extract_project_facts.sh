#!/usr/bin/env bash
# extract_project_facts.sh — Fast project facts extraction for codebase documentation
# Gathers structured facts about a project in one call so the agent
# doesn't need 10-15 individual tool calls for basic project info.
#
# Usage: bash extract_project_facts.sh [project-root]
# Default project-root: current directory

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'USAGE'
Usage: bash scripts/extract_project_facts.sh [project-root]

Fast project snapshot in one call. Outputs structured sections:
  ROOT FILES, KEY FILES, LANGUAGE DETECTION, SOURCE FILE COUNT,
  DEPENDENCY FILES, DIRECTORY STRUCTURE, ENTRY POINTS, TEST FRAMEWORK,
  BUILD & TASK COMMANDS, README EXCERPT, GIT STATS, CI/CD CONFIGURATION.

Arguments:
  project-root    Path to the project (default: current directory)

Examples:
  bash scripts/extract_project_facts.sh
  bash scripts/extract_project_facts.sh /path/to/project
USAGE
    exit 0
fi

PROJECT_ROOT="${1:-.}"
cd "$PROJECT_ROOT"

echo "========================================"
echo "PROJECT FACTS EXTRACTION"
echo "========================================"
echo "Root: $(pwd)"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ── Root Files ──────────────────────────────────────────────
echo "── ROOT FILES ──"
printf '%s\n' .* * 2>/dev/null | head -40
echo ""

# ── Key File Presence ───────────────────────────────────────
echo "── KEY FILES ──"
for f in README.md README.rst README CLAUDE.md docs/CODEBASE.md \
         ARCHITECTURE.md CONTRIBUTING.md CHANGELOG.md \
         Dockerfile docker-compose.yml docker-compose.yaml \
         .gitlab-ci.yml .github/workflows Makefile Taskfile.yml justfile \
         .pre-commit-config.yaml .editorconfig .env.example env.example; do
    if [ -e "$f" ]; then
        echo "  [EXISTS] $f"
    fi
done
echo ""

# ── Primary Language Detection ──────────────────────────────
echo "── LANGUAGE DETECTION (by file count) ──"
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    git ls-files 2>/dev/null | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -15
else
    find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' \
           -not -path '*/vendor/*' -not -path '*/__pycache__/*' \
           -not -path '*/dist/*' -not -path '*/build/*' \
           -not -path '*/.git/*' 2>/dev/null \
    | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -15
fi
echo ""

# ── Source File Count (for depth detection) ─────────────────
echo "── SOURCE FILE COUNT ──"
src_count=0
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    src_count=$(git ls-files 2>/dev/null \
        | grep -ciE '\.(py|js|ts|tsx|jsx|go|rs|rb|java|kt|swift|c|cpp|cs|php|ex|exs|scala|clj|hs|ml|vue|svelte)$' \
        || echo "0")
else
    src_count=$(find . -type f \
        -not -path '*/\.*' -not -path '*/node_modules/*' \
        -not -path '*/vendor/*' -not -path '*/__pycache__/*' \
        -not -path '*/dist/*' -not -path '*/build/*' \
        \( -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.tsx' \
           -o -name '*.jsx' -o -name '*.go' -o -name '*.rs' -o -name '*.rb' \
           -o -name '*.java' -o -name '*.kt' -o -name '*.swift' -o -name '*.c' \
           -o -name '*.cpp' -o -name '*.cs' -o -name '*.php' -o -name '*.ex' \
           -o -name '*.vue' -o -name '*.svelte' \) \
        2>/dev/null | wc -l | tr -d ' ')
fi
echo "Source files: $src_count"
if [ "$src_count" -lt 15 ]; then
    echo "Suggested depth: Quick"
elif [ "$src_count" -le 100 ]; then
    echo "Suggested depth: Standard"
else
    echo "Suggested depth: Deep"
fi
echo ""

# ── Dependency Files ────────────────────────────────────────
echo "── DEPENDENCY FILES ──"

dep_files=(
    "pyproject.toml" "setup.py" "setup.cfg" "requirements.txt" "Pipfile"
    "package.json" "yarn.lock" "pnpm-lock.yaml"
    "go.mod" "go.sum"
    "Cargo.toml"
    "Gemfile" "Gemfile.lock"
    "pom.xml" "build.gradle" "build.gradle.kts"
    "composer.json"
    "mix.exs"
    "pubspec.yaml"
    "Package.swift"
    "CMakeLists.txt" "conanfile.txt"
)

found_deps=0
for f in "${dep_files[@]}"; do
    if [ -f "$f" ]; then
        echo ""
        echo "--- $f ---"
        line_count=$(wc -l < "$f" 2>/dev/null || echo "0")
        if [ "$line_count" -gt 200 ]; then
            head -200 "$f"
            echo "... (truncated, $line_count total lines)"
        else
            cat "$f"
        fi
        found_deps=1
    fi
done

if [ "$found_deps" -eq 0 ]; then
    echo "  No standard dependency files found."
fi
echo ""

# ── Directory Structure ────────────────────────────────────
echo "── DIRECTORY STRUCTURE (top 3 levels) ──"
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    git ls-files 2>/dev/null | sed 's|/[^/]*$||' | sort -u | \
        awk -F/ 'NF<=3' | head -50
else
    find . -type d -maxdepth 3 -not -path '*/\.*' -not -path '*/node_modules/*' \
           -not -path '*/vendor/*' -not -path '*/__pycache__/*' \
           -not -path '*/dist/*' -not -path '*/build/*' 2>/dev/null \
    | sed 's|^\./||' | sort | head -50
fi
echo ""

# ── Entry Point Detection ─────────────────────────────────
echo "── ENTRY POINTS ──"

# Python entry points
if [ -f "pyproject.toml" ]; then
    scripts=$(grep -A 20 '^\[project\.scripts\]' pyproject.toml 2>/dev/null | \
        grep -E '^[a-zA-Z]' | head -10) || true
    if [ -n "$scripts" ]; then
        echo "Python CLI entry points (pyproject.toml [project.scripts]):"
        echo "$scripts"
    fi
fi

# Search for common entry point patterns
echo ""
echo "Files with entry point patterns:"
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    git ls-files 2>/dev/null | xargs grep -l -E \
        '(if __name__|func main\(\)|def main\(\)|app\.listen|createServer|FastAPI\(\)|Flask\(__name__|Express\(\)|\.run\(|entry_points)' \
        2>/dev/null | head -15 || echo "  (none detected)"
else
    grep -rl -E \
        '(if __name__|func main\(\)|def main\(\)|app\.listen|createServer|FastAPI\(\)|Flask\(__name__|Express\(\)|\.run\()' \
        --include='*.py' --include='*.js' --include='*.ts' --include='*.go' \
        --include='*.rs' --include='*.rb' --include='*.java' \
        . 2>/dev/null | grep -v node_modules | grep -v __pycache__ | head -15 || echo "  (none detected)"
fi

# package.json bin/main
if [ -f "package.json" ]; then
    bin=$(grep -A 5 '"bin"' package.json 2>/dev/null) || true
    main=$(grep '"main"' package.json 2>/dev/null) || true
    if [ -n "$bin" ]; then
        echo ""
        echo "package.json bin:"
        echo "$bin"
    fi
    if [ -n "$main" ]; then
        echo ""
        echo "package.json main: $main"
    fi
fi
echo ""

# ── Test Framework Detection ──────────────────────────────
echo "── TEST FRAMEWORK ──"

test_frameworks=""

# Python
if [ -f "pytest.ini" ] || [ -f "conftest.py" ] || grep -q "pytest" pyproject.toml 2>/dev/null; then
    test_frameworks="${test_frameworks}  pytest\n"
fi
if [ -f "tox.ini" ]; then
    test_frameworks="${test_frameworks}  tox\n"
fi

# JavaScript/TypeScript
if [ -f "jest.config.js" ] || [ -f "jest.config.ts" ] || [ -f "jest.config.mjs" ]; then
    test_frameworks="${test_frameworks}  jest\n"
fi
if [ -f "vitest.config.js" ] || [ -f "vitest.config.ts" ] || [ -f "vitest.config.mjs" ]; then
    test_frameworks="${test_frameworks}  vitest\n"
fi
if [ -f ".mocharc.yml" ] || [ -f ".mocharc.json" ]; then
    test_frameworks="${test_frameworks}  mocha\n"
fi
if [ -f "cypress.config.js" ] || [ -f "cypress.config.ts" ]; then
    test_frameworks="${test_frameworks}  cypress\n"
fi
if [ -f "playwright.config.ts" ] || [ -f "playwright.config.js" ]; then
    test_frameworks="${test_frameworks}  playwright\n"
fi

# Go
if find . -name '*_test.go' -maxdepth 3 2>/dev/null | head -1 | grep -q .; then
    test_frameworks="${test_frameworks}  go test\n"
fi

# Ruby
if [ -f ".rspec" ]; then
    test_frameworks="${test_frameworks}  rspec\n"
fi

# Rust
if grep -q '\[dev-dependencies\]' Cargo.toml 2>/dev/null; then
    test_frameworks="${test_frameworks}  cargo test\n"
fi

# Java
if [ -f "pom.xml" ] && grep -q "junit" pom.xml 2>/dev/null; then
    test_frameworks="${test_frameworks}  junit\n"
fi

if [ -n "$test_frameworks" ]; then
    echo "Detected frameworks:"
    echo -e "$test_frameworks"
else
    echo "  No test framework detected."
fi

# Test file count
test_count=0
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    test_count=$(git ls-files 2>/dev/null | grep -ciE '(test_|_test\.|\.test\.|\.spec\.|tests/|__tests__/)' || echo "0")
else
    test_count=$(find . -type f \( -name 'test_*' -o -name '*_test.*' -o -name '*.test.*' -o -name '*.spec.*' \) \
        -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | wc -l | tr -d ' ')
fi
echo "Test files found: $test_count"
echo ""

# ── Build/Task Runner Commands ─────────────────────────────
echo "── BUILD & TASK COMMANDS ──"

# Makefile
if [ -f "Makefile" ]; then
    echo "Makefile targets:"
    grep -E '^[a-zA-Z_-]+:' Makefile 2>/dev/null | sed 's/:.*//' | head -20
    echo ""
fi

# package.json scripts
if [ -f "package.json" ]; then
    echo "package.json scripts:"
    grep -A 50 '"scripts"' package.json 2>/dev/null | \
        grep -E '^\s+"[^"]+":' | sed 's/[",]//g' | head -20
    echo ""
fi

# Taskfile
if [ -f "Taskfile.yml" ]; then
    echo "Taskfile tasks:"
    grep -E '^  [a-zA-Z_-]+:' Taskfile.yml 2>/dev/null | sed 's/:.*//' | head -20
    echo ""
fi

# justfile
if [ -f "justfile" ]; then
    echo "justfile recipes:"
    grep -E '^[a-zA-Z_-]+:' justfile 2>/dev/null | sed 's/:.*//' | head -20
    echo ""
fi
echo ""

# ── README Excerpt ─────────────────────────────────────────
echo "── README EXCERPT (first 20 lines) ──"
for f in README.md README.rst README; do
    if [ -f "$f" ]; then
        echo "--- $f ---"
        head -20 "$f"
        echo ""
        break
    fi
done
echo ""

# ── Git Stats ──────────────────────────────────────────────
echo "── GIT STATS ──"
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    total_commits=$(git rev-list --count HEAD 2>/dev/null || echo "unknown")
    echo "Total commits: $total_commits"

    first_commit=$(git log --reverse --format='%ci' 2>/dev/null | head -1 || true)
    echo "First commit: ${first_commit:-unknown}"

    contributors=$(git shortlog -sn --no-merges 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    echo "Contributors: $contributors"

    echo ""
    echo "--- Last 30 commit subjects ---"
    git log --oneline -30 2>/dev/null || echo "  (no commits)"

    echo ""
    echo "--- Most changed files (top 15 by commit frequency) ---"
    git log --name-only --pretty=format: --diff-filter=ACMR 2>/dev/null \
    | grep -v '^$' | sort | uniq -c | sort -rn | head -15 || true

    echo ""
    echo "--- Recent tags ---"
    git tag --sort=-version:refname 2>/dev/null | head -5 || echo "  (no tags)"
else
    echo "  Not a git repository."
fi
echo ""

# ── CI/CD Config ───────────────────────────────────────────
echo "── CI/CD CONFIGURATION ──"
for f in .gitlab-ci.yml .github/workflows/*.yml .github/workflows/*.yaml \
         .circleci/config.yml .travis.yml Jenkinsfile .drone.yml \
         bitbucket-pipelines.yml azure-pipelines.yml; do
    if [ -f "$f" ] 2>/dev/null; then
        echo "  [EXISTS] $f"
    fi
done
if [ -d ".gitlab" ]; then
    echo "  GitLab CI includes (.gitlab/):"
    find .gitlab -type f \( -name "*.yml" -o -name "*.yaml" \) 2>/dev/null | sort | head -20
fi
if [ -d ".github/workflows" ]; then
    echo "  GitHub Actions workflows:"
    find .github/workflows/ -maxdepth 1 -type f -name '*.yml' -o -name '*.yaml' 2>/dev/null | sed 's|.*/||' | sort | head -10
fi
echo ""

echo "========================================"
echo "END OF FACTS EXTRACTION"
echo "========================================"
