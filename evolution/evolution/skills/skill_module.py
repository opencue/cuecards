"""Wraps a SKILL.md body as a DSPy module so GEPA can optimize it.

Adapted from hermes-agent-self-evolution, with a CORRECTNESS FIX:

Upstream stored the skill body as a plain attribute (`self.skill_text`) and
passed it as an *input field value* at forward time. DSPy optimizers (GEPA,
MIPROv2) only mutate the *signature instructions* of their predictors — never
arbitrary instance attributes — so `optimized.skill_text` came back UNCHANGED
and the skill never actually evolved (verified by introspection: skill_text is
not in named_predictors()).

Fix: the skill body IS the predictor's signature instructions, which is exactly
what GEPA optimizes. After `optimizer.compile(...)`, the evolved body is read
back from those instructions via the `skill_text` property.
"""

import dspy


def _skill_predictor(skill_text: str) -> dspy.Module:
    """A ChainOfThought whose signature INSTRUCTIONS are the skill body.

    The "task_input -> output" string defines the I/O fields; the second
    positional arg sets the signature instructions to the skill body — the
    string GEPA mutates each iteration.
    """
    signature = dspy.Signature("task_input -> output", skill_text)
    return dspy.ChainOfThought(signature)


class SkillModule(dspy.Module):
    """A DSPy module whose optimizable parameter IS the skill body text.

    `self.predictor.predict.signature.instructions` holds the body; GEPA/MIPRO
    rewrite it during compile, and the `skill_text` property reads it back.
    """

    def __init__(self, skill_text: str):
        super().__init__()
        self.baseline_text = skill_text  # frozen reference (never mutated)
        self.predictor = _skill_predictor(skill_text)

    def forward(self, task_input: str) -> dspy.Prediction:
        result = self.predictor(task_input=task_input)
        return dspy.Prediction(output=result.output)

    @property
    def skill_text(self) -> str:
        """The CURRENT skill body = the predictor's (optimizable) instructions.

        On a freshly built module this equals the baseline; on a module returned
        by `optimizer.compile(...)` it is the EVOLVED body.
        """
        return self.predictor.predict.signature.instructions
