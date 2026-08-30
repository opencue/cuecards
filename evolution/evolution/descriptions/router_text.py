"""Router-instruction text helpers (dspy-free, so they unit-test offline).

The skill-routing optimizer's key fix: DSPy optimizers (GEPA / MIPROv2) mutate a
predictor's *Signature instructions* and few-shot demos — NOT arbitrary Python
attributes. The old DescriptionModule stored the description as a plain attribute
and passed it as an input field, so the optimizer never touched it and every run
fell back to a proposal of the original text.

The fix: embed the candidate description INSIDE the Signature instructions, inside
a delimited block, so the optimizer rewrites it in place. After optimization we
read the evolved instructions back and pull the description out of the block.
These two pure functions are the (offline-testable) seam; description_module.py
wires them into the DSPy Signature, and _run_gepa reads the optimized
instructions back through `extract_description_from_instructions`.
"""

from __future__ import annotations

_OPEN = "<skill_description>"
_CLOSE = "</skill_description>"


def build_router_instructions(description: str) -> str:
    """Wrap a candidate description as router-Signature instructions, with the
    description in a clearly-delimited block the optimizer rewrites in place."""
    return (
        "You are a skill router. Decide whether THIS skill should handle the "
        "user's request, using only the skill description below as the signal.\n\n"
        f"{_OPEN}\n{description.strip()}\n{_CLOSE}\n\n"
        "Output exactly 'yes' if the description indicates this skill handles the "
        "request, or 'no' otherwise. Be decisive."
    )


def extract_description_from_instructions(instructions: str, fallback: str) -> str:
    """Pull the description back out of (possibly evolved) router instructions.

    Returns the text between the delimiters, stripped. If the optimizer dropped
    or mangled the delimiters, returns `fallback` (the caller then sees
    evolved == baseline → mutated=False → proposal, never a corrupt apply)."""
    if not instructions:
        return fallback
    i = instructions.find(_OPEN)
    j = instructions.find(_CLOSE)
    if i == -1 or j == -1 or j <= i:
        return fallback
    inner = instructions[i + len(_OPEN):j].strip()
    return inner or fallback
