"""Evaluation dataset generation.

Ported from hermes-agent-self-evolution. Sources:
  A) synthetic — an LLM reads the skill and generates (task, rubric) test cases
  B) sessiondb — real usage mined from Claude Code / Copilot / Hermes history
     (see external_importers.py)
  C) golden    — hand-curated JSONL
"""

import json
import random
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

import dspy

from evolution.core.config import CueEvolutionConfig


@dataclass
class EvalExample:
    task_input: str
    expected_behavior: str
    difficulty: str = "medium"
    category: str = "general"
    source: str = "synthetic"

    def to_dict(self) -> dict:
        return {
            "task_input": self.task_input,
            "expected_behavior": self.expected_behavior,
            "difficulty": self.difficulty,
            "category": self.category,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EvalExample":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class EvalDataset:
    train: list = field(default_factory=list)
    val: list = field(default_factory=list)
    holdout: list = field(default_factory=list)

    @property
    def all_examples(self) -> list:
        return self.train + self.val + self.holdout

    def save(self, path: Path):
        path.mkdir(parents=True, exist_ok=True)
        for name, data in [("train", self.train), ("val", self.val), ("holdout", self.holdout)]:
            with open(path / f"{name}.jsonl", "w") as f:
                for ex in data:
                    f.write(json.dumps(ex.to_dict()) + "\n")

    @classmethod
    def load(cls, path: Path) -> "EvalDataset":
        dataset = cls()
        for name in ["train", "val", "holdout"]:
            split_file = path / f"{name}.jsonl"
            if split_file.exists():
                examples = []
                with open(split_file) as f:
                    for line in f:
                        if line.strip():
                            examples.append(EvalExample.from_dict(json.loads(line)))
                setattr(dataset, name, examples)
        return dataset

    def to_dspy_examples(self, split: str = "train") -> list:
        data = getattr(self, split)
        return [
            dspy.Example(
                task_input=ex.task_input,
                expected_behavior=ex.expected_behavior,
            ).with_inputs("task_input")
            for ex in data
        ]


class SyntheticDatasetBuilder:
    """Generate eval datasets with a strong LLM from the skill text."""

    class GenerateTestCases(dspy.Signature):
        """Generate realistic evaluation test cases for an agent skill or tool.

        Each case: a realistic task_input (what a user would actually ask), an
        expected_behavior rubric (what a good response contains/does, NOT exact
        text), a difficulty (easy/medium/hard), and a category.
        """

        artifact_text: str = dspy.InputField(desc="The full text of the skill/tool/prompt")
        artifact_type: str = dspy.InputField(desc="'skill', 'tool_description', or 'prompt_section'")
        num_cases: int = dspy.InputField(desc="Number of test cases to generate")
        test_cases: str = dspy.OutputField(desc="JSON array; each: task_input, expected_behavior, difficulty, category")

    def __init__(self, config: CueEvolutionConfig):
        self.config = config
        self.generator = dspy.ChainOfThought(self.GenerateTestCases)

    def generate(self, artifact_text: str, artifact_type: str = "skill",
                 num_cases: Optional[int] = None) -> EvalDataset:
        from evolution.core.claude_lm import make_lm
        n = num_cases or self.config.eval_dataset_size
        lm = make_lm(self.config.judge_model, self.config)
        with dspy.context(lm=lm):
            result = self.generator(artifact_text=artifact_text, artifact_type=artifact_type, num_cases=n)

        try:
            cases_raw = json.loads(result.test_cases)
        except json.JSONDecodeError:
            import re
            match = re.search(r"\[.*\]", result.test_cases, re.DOTALL)
            if match:
                cases_raw = json.loads(match.group())
            else:
                raise ValueError(f"Could not parse test cases: {result.test_cases[:200]}")

        examples = [
            EvalExample(
                task_input=c.get("task_input", ""),
                expected_behavior=c.get("expected_behavior", ""),
                difficulty=c.get("difficulty", "medium"),
                category=c.get("category", "general"),
                source="synthetic",
            )
            for c in cases_raw
            if c.get("task_input") and c.get("expected_behavior")
        ]

        random.shuffle(examples)
        n_total = len(examples)
        n_train = max(1, int(n_total * self.config.train_ratio))
        n_val = max(1, int(n_total * self.config.val_ratio))
        return EvalDataset(
            train=examples[:n_train],
            val=examples[n_train:n_train + n_val],
            holdout=examples[n_train + n_val:],
        )


class GoldenDatasetLoader:
    """Load hand-curated eval datasets from JSONL."""

    @staticmethod
    def load(path: Path) -> EvalDataset:
        if (path / "train.jsonl").exists():
            return EvalDataset.load(path)

        golden_file = path if path.suffix == ".jsonl" else path / "golden.jsonl"
        if not golden_file.exists():
            raise FileNotFoundError(f"No golden dataset found at {golden_file}")

        examples = []
        with open(golden_file) as f:
            for line in f:
                if line.strip():
                    examples.append(EvalExample.from_dict(json.loads(line)))

        random.shuffle(examples)
        n = len(examples)
        n_train = max(1, int(n * 0.5))
        n_val = max(1, int(n * 0.25))
        return EvalDataset(
            train=examples[:n_train],
            val=examples[n_train:n_train + n_val],
            holdout=examples[n_train + n_val:],
        )
