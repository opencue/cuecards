"""cue description self-evolution.

The description-level counterpart to `evolution.skills` (which evolves SKILL.md
*bodies*). This slice evolves the *description* text that decides whether Claude
reaches for a skill / command / tool at all, and lands the winner per-profile in
the cue repo — never in the opencue/skills submodule.

Landing targets (all in the cue repo):
  * skill   -> `persona_routing:` rows in profiles/<profile>/profile.yaml
  * command -> resources/commands/<name>.md            (Phase 4)
  * persona -> persona:/description: in profile.yaml   (Phase 4)
  * mcp/cli -> mcp-skill-map blurb / src help strings  (Phase 5, low ROI)
"""

__version__ = "0.2.0"
