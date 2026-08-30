"""Fitness functions for scoring evolved skill candidates.

Ported from hermes-agent-self-evolution.

NOTE (carried over from upstream, surfaced honestly): the metric passed to GEPA
(`skill_fitness_metric`) is a fast KEYWORD-OVERLAP heuristic, not the LLM judge.
The richer multi-dimensional `LLMJudge` rubric below exists but upstream does
NOT wire it into the optimization loop. Overlap is a weak proxy for "the skill
is genuinely better." Treat holdout deltas as directional, and rely on the
`cue lint-skill` gate + human review of proposals for real quality control.
A follow-up (slice 2b) can swap `skill_fitness_metric` to call `LLMJudge`.
"""

import dspy
from dataclasses import dataclass
from typing import Optional

from evolution.core.config import CueEvolutionConfig


@dataclass
class FitnessScore:
    """Multi-dimensional fitness score."""

    correctness: float = 0.0
    procedure_following: float = 0.0
    conciseness: float = 0.0
    length_penalty: float = 0.0
    feedback: str = ""

    @property
    def composite(self) -> float:
        raw = 0.5 * self.correctness + 0.3 * self.procedure_following + 0.2 * self.conciseness
        return max(0.0, raw - self.length_penalty)


class LLMJudge:
    """LLM-as-judge scorer with rubric-based, multi-dimensional evaluation.

    Available but NOT wired into the GEPA loop upstream (see module docstring).
    """

    class JudgeSignature(dspy.Signature):
        """Evaluate an agent's response against an expected-behavior rubric.

        Score on three dimensions (0.0-1.0): correctness, procedure_following,
        conciseness. Also give specific, actionable improvement feedback.
        """

        task_input: str = dspy.InputField(desc="The task the agent was given")
        expected_behavior: str = dspy.InputField(desc="Rubric describing a good response")
        agent_output: str = dspy.InputField(desc="The agent's actual response")
        skill_text: str = dspy.InputField(desc="The skill/instructions the agent followed")
        correctness: float = dspy.OutputField(desc="0.0-1.0: did it correctly address the task?")
        procedure_following: float = dspy.OutputField(desc="0.0-1.0: did it follow the procedure?")
        conciseness: float = dspy.OutputField(desc="0.0-1.0: appropriately concise?")
        feedback: str = dspy.OutputField(desc="Specific, actionable improvement feedback")

    def __init__(self, config: CueEvolutionConfig):
        self.config = config
        self.judge = dspy.ChainOfThought(self.JudgeSignature)

    def score(
        self,
        task_input: str,
        expected_behavior: str,
        agent_output: str,
        skill_text: str,
        artifact_size: Optional[int] = None,
        max_size: Optional[int] = None,
    ) -> FitnessScore:
        from evolution.core.claude_lm import make_lm
        lm = make_lm(self.config.eval_model, self.config)
        with dspy.context(lm=lm):
            result = self.judge(
                task_input=task_input,
                expected_behavior=expected_behavior,
                agent_output=agent_output,
                skill_text=skill_text,
            )

        length_penalty = 0.0
        if artifact_size is not None and max_size is not None:
            ratio = artifact_size / max_size
            if ratio > 0.9:
                length_penalty = min(0.3, (ratio - 0.9) * 3.0)

        return FitnessScore(
            correctness=_parse_score(result.correctness),
            procedure_following=_parse_score(result.procedure_following),
            conciseness=_parse_score(result.conciseness),
            length_penalty=length_penalty,
            feedback=str(result.feedback),
        )


def skill_fitness_metric(example: "dspy.Example", prediction: "dspy.Prediction",
                         trace=None, *args, **kwargs) -> float:
    """DSPy-compatible metric for GEPA/MIPROv2. Fast keyword-overlap proxy (0-1).

    Accepts extra args/kwargs because GEPA invokes metrics with additional
    positional/keyword params (pred_name, pred_trace, …); ignoring them keeps
    one metric usable by both optimizers.

    This is the OFFLINE / CI default — it makes no LLM call. For a real behavioral
    signal use `make_judge_metric` (LLM-as-judge), which is opt-in because it
    costs one eval call per scored example.
    """
    agent_output = getattr(prediction, "output", "") or ""
    expected = getattr(example, "expected_behavior", "") or ""

    if not agent_output.strip():
        return 0.0

    score = 0.5
    expected_words = set(expected.lower().split())
    output_words = set(agent_output.lower().split())
    if expected_words:
        overlap = len(expected_words & output_words) / len(expected_words)
        score = 0.3 + (0.7 * overlap)

    return min(1.0, max(0.0, score))


def make_judge_metric(config: CueEvolutionConfig, skill_text: str = ""):
    """Build a DSPy-compatible metric backed by the multi-dimensional `LLMJudge`.

    Returns the judge's `composite` (0.5·correctness + 0.3·procedure + 0.2·
    conciseness − length_penalty) instead of the keyword-overlap proxy, so GEPA
    and the holdout comparison optimize "did the agent behave well against the
    rubric" rather than "do the words overlap". One eval-model call per scored
    example — opt in with `--metric judge` / `CUE_EVOLVE_METRIC=judge`.

    Fails SOFT to overlap on any judge error so a flaky eval endpoint degrades
    the signal rather than crashing the optimization run.
    """
    judge = LLMJudge(config)

    def _judge_metric(example, prediction, trace=None, *args, **kwargs) -> float:
        agent_output = getattr(prediction, "output", "") or ""
        if not agent_output.strip():
            return 0.0
        try:
            return judge.score(
                task_input=getattr(example, "task_input", "") or "",
                expected_behavior=getattr(example, "expected_behavior", "") or "",
                agent_output=agent_output,
                skill_text=skill_text,
            ).composite
        except Exception:
            # Degrade to the cheap proxy rather than aborting the whole run.
            return skill_fitness_metric(example, prediction)

    return _judge_metric


def _parse_score(value) -> float:
    if isinstance(value, (int, float)):
        return min(1.0, max(0.0, float(value)))
    try:
        return min(1.0, max(0.0, float(str(value).strip())))
    except (ValueError, TypeError):
        return 0.5
