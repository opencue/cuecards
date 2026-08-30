"""Wrap a skill *description* as a DSPy module so GEPA can optimize it.

The counterpart to evolution.skills.skill_module.SkillModule (which optimizes a
SKILL.md *body*). Here the optimizable parameter is the description text, and a
forward pass uses it as a *router*: given the candidate description and a real
user prompt, decide whether THIS skill should fire. The routing-accuracy metric
(routing_fitness) then scores that decision — so GEPA evolves the description
toward the wording that routes correctly.

The description rides in the predictor's Signature *instructions* (a delimited
block), NOT a plain attribute, because DSPy optimizers mutate instructions, not
attributes. `current_description()` reads the evolved text back out; if the
optimizer mangled the delimiters it returns `baseline_description`, so
evolve_description.py sees evolved==baseline → mutated=False → proposal (never a
corrupt apply). See router_text.py for the build/extract seam.

IMPORTANT — lazy-import contract: this module requires DSPy at *import* time, so
it CANNOT be made offline-importable. Import it ONLY from inside DSPy-guarded
code (e.g. evolve_description._run_gepa, after the `import dspy` check).
"""

import dspy

from evolution.descriptions.router_text import (
    build_router_instructions,
    extract_description_from_instructions,
)


class DescriptionModule(dspy.Module):
    """A DSPy module whose optimizable parameter is a skill description string.

    The description rides INSIDE the predictor's Signature instructions (not as a
    plain attribute / input field), because DSPy optimizers mutate instructions,
    not attributes. After optimization, `current_description()` reads the evolved
    description back out of the (possibly rewritten) instructions.
    """

    def __init__(self, description_text: str):
        super().__init__()
        self.baseline_description = description_text
        # `user_prompt -> should_route`, with the description embedded in the
        # instructions block that GEPA/MIPROv2 will rewrite in place.
        sig = dspy.Signature(
            "user_prompt -> should_route",
            instructions=build_router_instructions(description_text),
        )
        self.router = dspy.ChainOfThought(sig)

    def _instructions(self) -> str:
        """Best-effort read of the predictor's (possibly evolved) instructions
        across DSPy layouts."""
        for obj in (getattr(self.router, "predict", None), self.router):
            sig = getattr(obj, "signature", None)
            instr = getattr(sig, "instructions", None)
            if isinstance(instr, str) and instr:
                return instr
        return ""

    def current_description(self) -> str:
        """The evolved description (extracted from instructions), or the baseline
        if the optimizer left/mangled the delimited block."""
        return extract_description_from_instructions(self._instructions(), self.baseline_description)

    def forward(self, user_prompt: str) -> dspy.Prediction:
        result = self.router(user_prompt=user_prompt)
        return dspy.Prediction(should_route=result.should_route)
