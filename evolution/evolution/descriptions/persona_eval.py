"""Persona / profile-description optimization — rewrite + LLM-judge.

Distinct from the routing engine: a profile's `persona:` (and one-line
`description:`) is always-on system-prompt text that primes the agent's identity
and defaults — it does not *route* to anything, so routing-F1 does not apply.
The metric is an LLM-judge over behavioral scenarios (role consistency / defaults
applied / freestyling avoided). Per the Phase-4 design verdict, persona changes
touch the whole agent identity, so this path is **propose-only by default**.

DSPy is imported lazily inside each function that needs it (the Signature class
bodies evaluate dspy at definition time), so this module imports offline. The
scenario builder is fully offline — it harvests grounded task prompts from the
"Trigger phrases the profile should handle" sections of resources/evals/*.md.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from evolution.core.config import CueEvolutionConfig

# A trigger line in an eval file: `- "ship a new feature"`.
_TRIGGER_LINE = re.compile(r'^\s*-\s*["“]([^"”]+)["”]')


@dataclass
class PersonaScenario:
    task_input: str
    expected_behaviors: str = ""
    source: str = "evals"


def build_persona_scenarios(config: CueEvolutionConfig, n: int = 12) -> list[PersonaScenario]:
    """Offline: harvest grounded task prompts from resources/evals/*.md
    'Trigger phrases the profile should handle' sections. No LLM."""
    evals_dir = config.cue_repo_path / "resources" / "evals"
    scenarios: list[PersonaScenario] = []
    if not evals_dir.exists():
        return scenarios
    for md in sorted(evals_dir.glob("*.md")):
        try:
            text = md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        ename = md.stem
        in_trig = False
        for line in text.split("\n"):
            head = line.lstrip("# ").lower()
            if line.startswith("#"):
                in_trig = head.startswith("trigger phrases")
                continue
            if in_trig:
                m = _TRIGGER_LINE.match(line)
                if m:
                    scenarios.append(PersonaScenario(
                        task_input=m.group(1).strip(),
                        expected_behaviors=f"Handle '{ename}'-type work in role, "
                                           "applying the profile's stated defaults.",
                        source="evals",
                    ))
    return scenarios[:n] if n else scenarios


def _f(v) -> float:
    try:
        return min(1.0, max(0.0, float(str(v).strip())))
    except (ValueError, TypeError):
        return 0.5


def rewrite_persona(
    config: CueEvolutionConfig,
    baseline: str,
    description: str,
    skills_summary: str,
    failure_hints: str = "",
) -> str:
    """One LLM pass: produce a sharper, more behaviorally-directive persona
    WITHOUT changing the domain or inventing capabilities. (Rewrite+judge beats
    GEPA here — a persona is identity text, not a routable program.)"""
    import dspy

    class PersonaRewriter(dspy.Signature):
        """Rewrite an agent persona to be sharper and more behaviorally directive
        without changing its domain or inventing capabilities. Keep concrete
        defaults, cut vague filler, stay concise. Output ONLY the persona text."""

        current_persona: str = dspy.InputField()
        profile_description: str = dspy.InputField()
        skills_summary: str = dspy.InputField(desc="what this profile can actually do")
        failure_hints: str = dspy.InputField(desc="known weak spots; may be '(none)'")
        improved_persona: str = dspy.OutputField(desc="the rewritten persona text only")

    gen = dspy.ChainOfThought(PersonaRewriter)
    lm = dspy.LM(config.optimizer_model, **config.lm_kwargs())
    with dspy.context(lm=lm):
        out = gen(
            current_persona=baseline,
            profile_description=description,
            skills_summary=skills_summary or "(unspecified)",
            failure_hints=failure_hints or "(none)",
        )
    return str(out.improved_persona).strip()


def judge_persona(
    config: CueEvolutionConfig,
    persona: str,
    description: str,
    scenarios: list[PersonaScenario],
) -> dict:
    """LLM-judge the persona over behavioral scenarios. Composite =
    0.4*role_consistency + 0.4*defaults_applied + 0.2*freestyling_avoided."""
    import dspy

    class PersonaJudge(dspy.Signature):
        """Given a task and an agent persona, score how well that persona would
        steer the agent. Each 0.0-1.0: role_consistency (stays in role),
        defaults_applied (applies the profile's stated defaults), and
        freestyling_avoided (doesn't invent scope / wander)."""

        task_input: str = dspy.InputField()
        persona: str = dspy.InputField()
        profile_description: str = dspy.InputField()
        expected_behaviors: str = dspy.InputField()
        role_consistency: float = dspy.OutputField()
        defaults_applied: float = dspy.OutputField()
        freestyling_avoided: float = dspy.OutputField()

    judge = dspy.ChainOfThought(PersonaJudge)
    lm = dspy.LM(config.eval_model, **config.lm_kwargs())
    rc = da = fa = 0.0
    k = 0
    with dspy.context(lm=lm):
        for s in scenarios:
            r = judge(
                task_input=s.task_input, persona=persona,
                profile_description=description, expected_behaviors=s.expected_behaviors,
            )
            rc += _f(r.role_consistency)
            da += _f(r.defaults_applied)
            fa += _f(r.freestyling_avoided)
            k += 1
    k = max(1, k)
    rc, da, fa = rc / k, da / k, fa / k
    composite = 0.4 * rc + 0.4 * da + 0.2 * fa
    return {
        "composite": round(composite, 4),
        "role_consistency": round(rc, 4),
        "defaults_applied": round(da, 4),
        "freestyling_avoided": round(fa, 4),
        "n": k,
    }
