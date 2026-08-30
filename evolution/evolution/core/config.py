"""Configuration and cue repo / skills discovery.

Adapted from hermes-agent-self-evolution's EvolutionConfig. Key cue-specific
changes:
  * skills live under <cue-repo>/resources/skills/skills/<category>/<slug>/SKILL.md
  * the constraint gate is `cue lint-skill <path> --json` (CueEvolutionConfig.lint_cmd)
  * models are NOT hardcoded to OpenAI — cue is a Claude shop, so the default
    LM string is read from env (CUE_EVOLVE_*_MODEL), falling back to a Claude
    model. DSPy/LiteLLM resolves the provider from the string prefix.
"""

import os
import shutil
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional


# Default models. Overridable via env so no provider is baked in.
#   CUE_EVOLVE_OPTIMIZER_MODEL — model GEPA uses to reflect/mutate the skill
#   CUE_EVOLVE_EVAL_MODEL       — model used for LLM-as-judge + dataset gen
# DSPy/LiteLLM picks the provider from the string prefix
# ("anthropic/...", "openai/...", "openrouter/...", etc.).
_DEFAULT_OPTIMIZER_MODEL = os.getenv(
    "CUE_EVOLVE_OPTIMIZER_MODEL", "anthropic/claude-sonnet-4-5"
)
_DEFAULT_EVAL_MODEL = os.getenv(
    "CUE_EVOLVE_EVAL_MODEL", "anthropic/claude-haiku-4-5"
)
# Independent reviewer for the single-shot quality gate. Deliberately a DIFFERENT
# (stronger) model than the optimizer so the proposer isn't grading its own work
# — mirrors the auto-review fresh-reviewer pattern.
_DEFAULT_REVIEWER_MODEL = os.getenv(
    "CUE_EVOLVE_REVIEWER_MODEL", "anthropic/claude-opus-4-1"
)


@dataclass
class CueEvolutionConfig:
    """Configuration for a cue skill-content evolution run."""

    # cue repo root + the skills tree inside it.
    cue_repo_path: Path = field(default_factory=lambda: get_cue_repo_path())

    # Optimization parameters
    iterations: int = 10
    population_size: int = 5
    # Single-shot writer->lint->critic loop: how many writer rounds to spend
    # repairing lint failures / acting on critic fixes before giving up. 1 = the
    # old one-shot behaviour. Env-overridable so the Stop-hook loop can tune it.
    writer_loop_rounds: int = field(
        default_factory=lambda: max(1, int(os.getenv("CUE_WRITER_LOOP_ROUNDS", "2")))
    )

    # LLM configuration (provider inferred from the string prefix by LiteLLM)
    optimizer_model: str = _DEFAULT_OPTIMIZER_MODEL
    eval_model: str = _DEFAULT_EVAL_MODEL
    judge_model: str = _DEFAULT_OPTIMIZER_MODEL  # dataset generation
    reviewer_model: str = _DEFAULT_REVIEWER_MODEL  # independent single-shot gate

    # Constraints — mirror hermes defaults; the real gate is `cue lint-skill`.
    max_skill_size: int = 15_000  # 15KB
    max_prompt_growth: float = 0.2  # 20% max growth over baseline

    # Generic OpenAI-compatible endpoint support (MiniMax, vLLM, LM Studio, any
    # OpenAI-shaped server). When set, these are passed to every dspy.LM() call.
    # Provider with a native LiteLLM prefix (anthropic/, openai/, nvidia_nim/,
    # openrouter/) needs neither — LiteLLM resolves the base + key from env.
    api_base: Optional[str] = field(default_factory=lambda: os.getenv("CUE_EVOLVE_API_BASE") or None)
    api_key: Optional[str] = field(default_factory=lambda: os.getenv("CUE_EVOLVE_API_KEY") or None)

    # The auto-apply gate. `{path}` is substituted with the candidate SKILL.md.
    # Overridable for tests / non-PATH installs via CUE_LINT_CMD.
    lint_cmd: str = field(
        default_factory=lambda: os.getenv("CUE_LINT_CMD", "cue lint-skill {path} --json")
    )

    # Eval dataset
    eval_dataset_size: int = 20
    train_ratio: float = 0.5
    val_ratio: float = 0.25
    holdout_ratio: float = 0.25

    def __post_init__(self):
        # The lint gate template must carry the {path} placeholder, else it
        # would lint nothing (or stdin) and the gate becomes meaningless.
        if "{path}" not in self.lint_cmd:
            raise ValueError(
                f"lint_cmd / CUE_LINT_CMD must contain the {{path}} placeholder: {self.lint_cmd!r}"
            )
        # NVIDIA NIM convenience: LiteLLM's nvidia_nim provider reads
        # NVIDIA_NIM_API_KEY, but the common env var is NVIDIA_API_KEY. Bridge
        # it so a `nvidia_nim/...` model works with either name.
        if self._uses_nvidia_nim() and not os.getenv("NVIDIA_NIM_API_KEY"):
            nv = os.getenv("NVIDIA_API_KEY")
            if nv:
                os.environ["NVIDIA_NIM_API_KEY"] = nv

    def _uses_nvidia_nim(self) -> bool:
        return any(
            str(m).startswith("nvidia_nim/")
            for m in (self.optimizer_model, self.eval_model, self.judge_model, self.reviewer_model)
        )

    def lm_kwargs(self) -> dict:
        """Extra kwargs for dspy.LM() — set only for custom OpenAI-compatible
        endpoints (e.g. MiniMax). Empty for providers LiteLLM resolves from env."""
        kw = {}
        if self.api_base:
            kw["api_base"] = self.api_base
        if self.api_key:
            kw["api_key"] = self.api_key
        return kw

    @property
    def skills_root(self) -> Path:
        return self.cue_repo_path / "resources" / "skills" / "skills"

    @property
    def evolution_log(self) -> Path:
        """Reuse the same log `cue evolve` writes (~/.config/cue/evolution-log.jsonl)."""
        cfg = Path(os.getenv("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "cue"
        return cfg / "evolution-log.jsonl"

    @property
    def analytics_log(self) -> Path:
        """The cue telemetry stream (~/.config/cue/analytics.jsonl) — the source
        of real `skill_hit` first_prompts the routing dataset mines (see
        src/lib/analytics.ts SessionEvent). Same XDG resolution as the CLI."""
        cfg = Path(os.getenv("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "cue"
        return cfg / "analytics.jsonl"

    @property
    def profiles_root(self) -> Path:
        """Where per-profile persona_routing edits land — in the cue repo, NOT a
        submodule. profiles/<name>/profile.yaml."""
        return self.cue_repo_path / "profiles"


def get_cue_repo_path() -> Path:
    """Discover the cue repo root.

    Priority:
    1. CUE_REPO env var
    2. Walk up from this file looking for the resources/skills/skills tree
       (this package is vendored at <cue-repo>/evolution/).
    3. ~/Documents/cue (known checkout on this machine)
    """
    env_path = os.getenv("CUE_REPO")
    if env_path:
        p = Path(env_path).expanduser()
        if (p / "resources" / "skills" / "skills").exists():
            return p

    # This file: <cue-repo>/evolution/evolution/core/config.py → repo is 3 up.
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "resources" / "skills" / "skills").exists():
            return parent

    fallback = Path.home() / "Documents" / "cue"
    if (fallback / "resources" / "skills" / "skills").exists():
        return fallback

    raise FileNotFoundError(
        "Cannot find the cue repo. Set CUE_REPO env var to your cue checkout "
        "(the dir containing resources/skills/skills/)."
    )
