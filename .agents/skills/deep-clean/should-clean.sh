#!/usr/bin/env bash
#
# should-clean.sh - Check if deep clean consolidation should run
#
# Returns exit code 0 if deep clean should run, 1 if not.
# Condition: 7+ days since last deep clean.
#
# Works with any project structure — no config file needed.

set -euo pipefail

# Find the most recent .last-deep-clean timestamp across all project memory dirs
LAST_CLEAN_FILE=""
LAST_CLEAN_TS=0

for dir in "$HOME/.claude/projects/"*/memory/; do
    if [[ -f "$dir/.last-deep-clean" ]]; then
        ts=$(cat "$dir/.last-deep-clean" 2>/dev/null || echo "0")
        if (( ts > LAST_CLEAN_TS )); then
            LAST_CLEAN_TS=$ts
            LAST_CLEAN_FILE="$dir/.last-deep-clean"
        fi
    fi
done

# If no .last-deep-clean found anywhere, deep clean has never run
if [[ -z "$LAST_CLEAN_FILE" ]]; then
    echo "Deep clean conditions met: first-run (no .last-deep-clean found)"
    exit 0
fi

# Check: 7+ days since last deep clean
NOW=$(date +%s)
ELAPSED=$(( NOW - LAST_CLEAN_TS ))
DAYS_ELAPSED=$(( ELAPSED / 86400 ))

if (( DAYS_ELAPSED < 7 )); then
    exit 1  # Too soon
fi

echo "Deep clean conditions met: ${DAYS_ELAPSED} days since last clean"
exit 0
