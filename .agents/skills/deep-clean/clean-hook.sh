#!/usr/bin/env bash
#
# clean-hook.sh - Stop hook that checks deep clean conditions
#
# Add to settings.json:
#   "hooks": {
#     "Stop": [{
#       "type": "command",
#       "command": "bash ~/.claude/skills/deep-clean/clean-hook.sh"
#     }]
#   }
#
# Fires when a Claude Code session ends. Checks if 7+ days
# have passed since last deep clean. If so, creates a
# .deep-clean-pending flag. On next session, Claude reads
# the flag from CLAUDE.md instructions and runs /deep-clean.
#
# Zero overhead when conditions aren't met (~5ms check).

SKILL_DIR="$HOME/.claude/skills/deep-clean"

# Run the condition check
if bash "$SKILL_DIR/should-clean.sh" 2>/dev/null; then
    # Conditions met - create pending flag
    touch "$HOME/.claude/.deep-clean-pending"
    echo "Deep clean flagged for next session"
fi

# Always exit 0 so we don't block the session from closing
exit 0
